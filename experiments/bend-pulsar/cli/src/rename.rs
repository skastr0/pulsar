//! Following git renames in `pulsar delta`.
//!
//! Finding keys hash the file path, so moving a file or a directory changes every key under it. The
//! comparison therefore asks git for the base-to-head renames (`git diff -M`, git's default
//! similarity) and, for findings whose key is on one side only, matches a base finding to a head
//! finding when they are the same rule and version about the same subjects once base paths are
//! rewritten onto head paths. Only renames are followed, not copies (a copy leaves the original in
//! place, so the original's findings match by key). A function that moved to another file keeps no
//! git evidence: it stays `-` plus `+`, and delta counts such pairs as `unmatched_moves`.

use crate::finding::{Finding, Subject};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

#[derive(Default)]
pub struct Renames {
    /// base path -> head path
    map: BTreeMap<String, String>,
}

impl Renames {
    pub fn count(&self) -> usize {
        self.map.len()
    }

    /// The head path of a base path (itself when git saw no rename).
    pub fn head_path<'a>(&'a self, base_path: &'a str) -> &'a str {
        self.map.get(base_path).map_or(base_path, String::as_str)
    }
}

/// Parse `git diff -M --name-status -z` output: `R<score> NUL old NUL new NUL`, other statuses carry
/// one path. Copies (`C`) are skipped.
fn parse(out: &[u8]) -> Renames {
    let mut toks = out.split(|b| *b == 0).filter(|t| !t.is_empty()).map(|t| String::from_utf8_lossy(t).into_owned());
    let mut map = BTreeMap::new();
    while let Some(status) = toks.next() {
        match status.as_bytes()[0] {
            b'R' => {
                if let (Some(old), Some(new)) = (toks.next(), toks.next()) {
                    map.insert(old, new);
                }
            }
            b'C' => {
                toks.next();
                toks.next();
            }
            _ => {
                toks.next();
            }
        }
    }
    Renames { map }
}

/// The renames between two commits of `repo`.
pub fn detect(repo: &Path, base: &str, head: &str) -> Result<Renames, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["diff", "-M", "--name-status", "-z", "--no-ext-diff", base, head])
        .output()
        .map_err(|e| format!("cannot run git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git diff -M failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(parse(&out.stdout))
}

/// What makes two findings "the same finding" across a rename: rule, version and the subjects by
/// path (mapped onto head paths) and symbol, never by key or line.
pub fn identity(f: &Finding, renames: &Renames, base_side: bool) -> String {
    let mut subs: Vec<String> = f
        .subjects
        .iter()
        .map(|s| match s {
            Subject::File { path, .. } => format!("F\0{}", if base_side { renames.head_path(path) } else { path }),
            Subject::Function { path, chain, .. } => {
                format!("N\0{}\0{chain}", if base_side { renames.head_path(path) } else { path })
            }
            Subject::Symbol { name, .. } => format!("S\0{name}"),
        })
        .collect();
    subs.sort();
    format!("{}\0{}\0{}", f.rule.id, f.rule.version, subs.join("\u{1}"))
}

/// Pair base-only findings with head-only findings that are the same finding under a rename. A pair
/// needs the identity to be unique on both sides. Returns (base key, head key) pairs.
pub fn match_findings(gone: &[&Finding], new: &[&Finding], renames: &Renames) -> Vec<(u64, u64)> {
    let mut base: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    for f in gone {
        base.entry(identity(f, renames, true)).or_default().push(f.key());
    }
    let mut head: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    for f in new {
        head.entry(identity(f, renames, false)).or_default().push(f.key());
    }
    base.iter()
        .filter_map(|(id, b)| match (b.as_slice(), head.get(id).map(Vec::as_slice)) {
            ([b], Some([h])) => Some((*b, *h)),
            _ => None,
        })
        .collect()
}

/// How many remaining removed/added function findings are the same finding about the same symbol
/// with the same measured values in another file: moves git cannot show.
pub fn unmatched_moves(gone: &[&Finding], new: &[&Finding]) -> usize {
    let sig = |f: &Finding| -> Option<String> {
        let chain = f.symbol.as_ref()?;
        Some(format!("{}\0{chain}\0{}\0{}", f.rule.id, f.evidence["value"], f.evidence["metrics"]))
    };
    let mut left: BTreeMap<String, usize> = BTreeMap::new();
    for f in gone {
        if let Some(s) = sig(f) {
            *left.entry(s).or_default() += 1;
        }
    }
    let mut moved = 0;
    for f in new {
        if let Some(s) = sig(f) {
            if let Some(n) = left.get_mut(&s).filter(|n| **n > 0) {
                *n -= 1;
                moved += 1;
            }
        }
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finding::{Rule, CYCLOMATIC};
    use serde_json::json;

    fn func(path: &str, chain: &str, key: u64, value: u64) -> Finding {
        Finding::new(
            CYCLOMATIC,
            vec![Subject::Function { key, path: path.into(), chain: chain.into() }],
            path.into(),
            Some(chain.into()),
            String::new(),
            json!({"value": value, "metrics": {"cyclomatic": value}}),
        )
    }

    #[test]
    fn parses_renames_and_skips_copies_and_other_statuses() {
        let r = parse(b"M\0a.ts\0R097\0src/old.ts\0dst/new.ts\0C100\0x.ts\0y.ts\0A\0z.ts\0D\0gone.ts\0");
        assert_eq!(r.count(), 1);
        assert_eq!(r.head_path("src/old.ts"), "dst/new.ts");
        assert_eq!(r.head_path("a.ts"), "a.ts");
    }

    #[test]
    fn a_renamed_function_matches_through_the_path_map_even_if_its_value_changed() {
        let r = parse(b"R100\0a.ts\0b/a.ts\0");
        let gone = func("a.ts", "f", 1, 12);
        let new = func("b/a.ts", "f", 2, 14);
        assert_eq!(match_findings(&[&gone], &[&new], &r), vec![(gone.key(), new.key())]);
        // another symbol, another rule version or no rename: no match
        let other = func("b/a.ts", "g", 3, 12);
        assert!(match_findings(&[&gone], &[&other], &r).is_empty());
        assert!(match_findings(&[&gone], &[&new], &Renames::default()).is_empty());
        let mut v2 = func("b/a.ts", "f", 4, 12);
        v2.rule = Rule { version: 2, ..CYCLOMATIC };
        assert!(match_findings(&[&gone], &[&v2], &r).is_empty());
    }

    #[test]
    fn an_ambiguous_identity_is_never_matched() {
        let r = parse(b"R100\0a.ts\0b.ts\0");
        let (g1, g2) = (func("a.ts", "f", 1, 12), func("a.ts", "f", 2, 12));
        let n = func("b.ts", "f", 3, 12);
        assert!(match_findings(&[&g1, &g2], &[&n], &r).is_empty());
    }

    #[test]
    fn a_function_moved_between_files_counts_as_an_unmatched_move() {
        let gone = [func("a.ts", "tangled", 1, 13), func("a.ts", "other", 2, 20)];
        let new = [func("b.ts", "tangled", 3, 13), func("b.ts", "other", 4, 21)];
        let (g, n): (Vec<&Finding>, Vec<&Finding>) = (gone.iter().collect(), new.iter().collect());
        assert_eq!(unmatched_moves(&g, &n), 1, "same symbol and values only");
    }
}
