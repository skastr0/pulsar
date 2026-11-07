//! Link call edges across the TS files: each `Callee` the walker recorded becomes a repo
//! function (global file id, local function index), or is dropped and counted.
//!
//! The walker knows names; this step knows files. An import resolves through the lane's
//! resolver to a repo file, then through that file's exports, following `export { x } from`
//! and `export *` (cycle-guarded). A module-level name or `this.method` resolves by the
//! function's `.fns` chain. A call that leaves the repo is neither an edge nor unresolved.

use crate::lang::functions::{unres, Callee, FileFns, Site, SiteKind};
use std::collections::HashSet;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EdgeStats {
    pub resolved: usize,
    /// Calls of an import that is not a repo file (an external package, an unresolved path).
    pub external: usize,
    /// Unresolved calls by `CU` reason (index 1 to 4).
    pub unresolved: [usize; 5],
}

struct Tables<'a> {
    /// Per file: `(chain, local function)` sorted by chain, first ordinal kept; borrowed, so the
    /// table costs two words per function and no string copies.
    by_chain: Vec<Vec<(&'a str, u32)>>,
    /// Per file: spec index to the repo file it names.
    targets: Vec<Vec<Option<usize>>>,
}

impl<'a> Tables<'a> {
    fn build(fns: &'a [&mut FileFns]) -> Tables<'a> {
        let by_chain = fns
            .iter()
            .map(|f| {
                let mut v: Vec<(&str, u32)> =
                    f.fns.iter().enumerate().map(|(i, r)| (r.chain.as_str(), i as u32)).collect();
                v.sort_unstable();
                v.dedup_by_key(|e| e.0);
                v
            })
            .collect();
        let targets = fns
            .iter()
            .map(|f| f.spec_targets.iter().map(|t| t.map(|d| d as usize)).collect())
            .collect();
        Tables { by_chain, targets }
    }

    fn chain(&self, file: usize, chain: &str) -> Option<u32> {
        let v = &self.by_chain[file];
        v.binary_search_by(|e| e.0.cmp(chain)).ok().map(|i| v[i].1)
    }

    /// The function file `t` exports as `name` (a dotted member path allowed): a declaration, or
    /// a member of an exported object or class one level down, through re-exports.
    fn find(&self, fns: &[&mut FileFns], t: usize, name: &str, seen: &mut HashSet<(usize, String)>) -> Option<(usize, u32)> {
        if !seen.insert((t, name.to_string())) {
            return None;
        }
        let (head, tail) = match name.split_once('.') {
            Some((h, t)) => (h, Some(t)),
            None => (name, None),
        };
        self.declared(fns, t, head, tail).or_else(|| self.reexported(fns, t, name, (head, tail), seen))
    }

    /// An export this file declares itself: `head`, or `head.tail` as a member one level down.
    fn declared(&self, fns: &[&mut FileFns], t: usize, head: &str, tail: Option<&str>) -> Option<(usize, u32)> {
        fns[t].exports.iter().filter(|(exported, _)| exported == head).find_map(|(_, local)| {
            let chain = match tail {
                None => local.clone(),
                Some(member) if !member.contains('.') => format!("{local}>{member}"),
                Some(_) => return None,
            };
            self.chain(t, &chain).map(|i| (t, i))
        })
    }

    /// An export this file passes on from another module (`export { x } from`, `export *`).
    fn reexported(
        &self,
        fns: &[&mut FileFns],
        t: usize,
        name: &str,
        (head, tail): (&str, Option<&str>),
        seen: &mut HashSet<(usize, String)>,
    ) -> Option<(usize, u32)> {
        fns[t].reexports.iter().find_map(|r| {
            let dst = self.targets[t].get(r.spec as usize).copied().flatten()?;
            match &r.imported {
                Some(imp) if r.exported == head => {
                    let nm = tail.map_or_else(|| imp.clone(), |tl| format!("{imp}.{tl}"));
                    self.find(fns, dst, &nm, seen)
                }
                // `export *` never re-exports a default.
                None if head != "default" => self.find(fns, dst, name, seen),
                _ => None,
            }
        })
    }
}

/// Resolve every edge site of every file. `files` is `(global file id, path)` in the same order
/// as `fns`; each file's `spec_targets` says which repo file a specifier names.
pub fn link_edges(files: &[(u32, String)], fns: &mut [&mut FileFns]) -> EdgeStats {
    let mut stats = EdgeStats::default();
    let mut rewritten: Vec<(Vec<Site>, Vec<(u32, u8)>)> = Vec::with_capacity(fns.len());
    let tables = Tables::build(fns);
    for (i, f) in fns.iter().enumerate() {
        let (mut sites, mut unresolved) = (Vec::with_capacity(f.sites.len()), Vec::new());
        for s in &f.sites {
            let SiteKind::Edge { to, node, loop_depth, ctx } = &s.kind else {
                sites.push(s.clone());
                continue;
            };
            match target_of(&tables, fns, i, to) {
                Ok((t, fn_local)) => {
                    stats.resolved += 1;
                    let to = Callee::Resolved { file: files[t].0, fn_local };
                    sites.push(Site {
                        fn_local: s.fn_local,
                        kind: SiteKind::Edge { to, node: *node, loop_depth: *loop_depth, ctx: *ctx },
                    });
                }
                Err(reason) => unresolved.push((s.fn_local, reason)),
            }
        }
        rewritten.push((sites, unresolved));
    }
    drop(tables);
    for (f, (sites, unresolved)) in fns.iter_mut().zip(rewritten) {
        f.sites = sites;
        f.unresolved.extend(unresolved);
        stats.external += f.external;
        for (_, r) in &f.unresolved {
            stats.unresolved[(*r as usize).min(4)] += 1;
        }
    }
    stats
}

/// The function an edge callee names: `(file index, local function)`, or the `CU` reason.
fn target_of(tables: &Tables<'_>, fns: &[&mut FileFns], file: usize, to: &Callee) -> Result<(usize, u32), u8> {
    match to {
        Callee::Local(n) => {
            let chain = &fns[file].names[*n as usize];
            let miss = if chain.contains('>') { unres::UNKNOWN_MEMBER } else { unres::LOCAL_BINDING };
            tables.chain(file, chain).map(|l| (file, l)).ok_or(miss)
        }
        Callee::Import { spec, path } => {
            let Some(t) = tables.targets[file].get(*spec as usize).copied().flatten() else {
                return Err(unres::NOT_FOUND);
            };
            tables.find(fns, t, &fns[file].names[*path as usize], &mut HashSet::new()).ok_or(unres::NOT_FOUND)
        }
        Callee::Resolved { file, fn_local } => Ok((*file as usize, *fn_local)),
    }
}

#[cfg(test)]
mod tests {
    use super::super::analyze;
    use crate::lang::functions::{Callee, SiteKind};

    fn write(dir: &std::path::Path, rel: &str, text: &str) {
        std::fs::write(dir.join(rel), text).unwrap();
    }

    /// Edges as `file:from -> file:to`, sorted, for readable expectations.
    fn edges(a: &super::super::Analysis, names: &[&str]) -> Vec<String> {
        let mut out = Vec::new();
        for (i, pf) in a.per_file.iter().enumerate() {
            for s in &pf.fns.sites {
                if let SiteKind::Edge { to: Callee::Resolved { file, fn_local }, .. } = &s.kind {
                    let from = &pf.fns.fns[s.fn_local as usize].chain;
                    let to = &a.per_file[*file as usize].fns.fns[*fn_local as usize].chain;
                    out.push(format!("{}:{from} -> {}:{to}", names[i], names[*file as usize]));
                }
            }
        }
        out.sort();
        out
    }

    #[test]
    fn calls_resolve_through_imports_reexports_objects_classes_and_this() {
        let dir = std::env::temp_dir().join(format!("pulsar-link-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        write(&dir, "a.ts", "export function leaf() {}\nexport const arrow = () => leaf();\nexport const api = { run() { return leaf(); } };\nexport class Svc {\n  go() { this.helper(); }\n  helper() {}\n  static make() { return 1; }\n}\nexport default function main() { arrow(); }\n");
        write(&dir, "b.ts", "import main, { leaf, arrow, api, Svc } from \"./a\";\nimport * as ns from \"./a\";\nimport { x } from \"pkg\";\nexport * from \"./a\";\nexport function b1(cb: () => void) {\n  leaf();\n  arrow();\n  api.run();\n  Svc.make();\n  ns.leaf();\n  main();\n  cb();\n  x();\n  missing();\n}\n");
        write(&dir, "c.ts", "import { leaf as l, nope } from \"./b\";\nexport function c1() {\n  l();\n  nope();\n}\n");
        let names = ["a.ts", "b.ts", "c.ts"];
        let files: Vec<(u32, String)> = names.iter().enumerate().map(|(i, n)| (i as u32, n.to_string())).collect();
        let tracked: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        let a = analyze(&dir, &files, &tracked).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(
            edges(&a, &names),
            [
                "a.ts:Svc>go -> a.ts:Svc>helper",
                "a.ts:api>run -> a.ts:leaf",
                "a.ts:arrow -> a.ts:leaf",
                "a.ts:main -> a.ts:arrow",
                "b.ts:b1 -> a.ts:Svc>make",
                "b.ts:b1 -> a.ts:api>run",
                "b.ts:b1 -> a.ts:arrow",
                "b.ts:b1 -> a.ts:leaf",
                "b.ts:b1 -> a.ts:leaf",
                "b.ts:b1 -> a.ts:main",
                "c.ts:c1 -> a.ts:leaf",
            ]
        );
        // b1: `cb()` is a parameter, `missing()` is an undeclared global (leaves the repo, not
        // counted); c1: `nope` is imported from a repo file that exports no such function.
        let st = &a.stats.edges;
        assert_eq!((st.resolved, st.external), (11, 1));
        assert_eq!(st.unresolved, [0, 0, 1, 0, 1]);
    }
}
