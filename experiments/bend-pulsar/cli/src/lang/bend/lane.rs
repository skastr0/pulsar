//! The Bend lane as the driver sees it: `owns`, `analyze`, and the rows only this lane has
//! (`MK`, `L`, `LW`, `LN`, and the `.laws` side table).
//!
//! `analyze` returns per-file function rows in the shared `lang::FileOut` shape, so the driver
//! numbers them like every other lane's. Markers and laws name functions by `(file id, local
//! index)`; `Extra::push_rows` turns those into global `FN` ids once the driver knows each file's
//! first function id.

use super::{extract, link_laws, resolve, BendFile};
use crate::facts::{FactWriter, Rel};
use crate::lang::FileOut;
use std::collections::HashSet;
use std::path::Path;

/// Whether this lane owns a tracked path.
pub fn owns(path: &str) -> bool {
    path.ends_with(".bend")
}

#[derive(Debug, Default)]
pub struct Stats {
    pub files: usize,
    pub unreadable: usize,
    pub laws: usize,
    pub markers: usize,
}

/// One law, over global file ids. Laws are in law-id order: (file id, line).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GLaw {
    pub file: u32,
    pub line: u32,
    pub name: String,
    pub filled: bool,
    /// `(file id, local fn index)` of each function the statement names; sorted, deduped.
    pub fns: Vec<(u32, u32)>,
}

/// The rows only this lane emits, still in local function numbering.
#[derive(Debug, Default)]
pub struct Extra {
    /// `(file id, local fn index, class, count)`, count >= 1.
    pub marks: Vec<(u32, u32, u8, u32)>,
    pub laws: Vec<GLaw>,
}

#[derive(Debug, Default)]
pub struct Analysis {
    /// Indexed like the `files` argument.
    pub per_file: Vec<FileOut>,
    /// `(src, dst, form, hv, ht)` over global file ids; sorted and deduped.
    pub i: Vec<[u32; 5]>,
    /// `(src, reason)`; sorted and deduped.
    pub u: Vec<[u32; 2]>,
    pub extra: Extra,
    /// Production flag per file, indexed like `files` (see `prod_flags`).
    pub prod: Vec<bool>,
    pub stats: Stats,
}

/// Analyse the Bend files of a repo. `files` is `(global file id, repo-relative path)` for every
/// `.bend` file the lane owns, in id order.
pub fn analyze(root: &Path, files: &[(u32, String)]) -> Result<Analysis, String> {
    let mut st = Stats { files: files.len(), ..Stats::default() };
    let parsed: Vec<(String, BendFile)> = files
        .iter()
        .map(|(_, rel)| match std::fs::read(root.join(rel)) {
            Ok(bytes) => (rel.clone(), extract(rel, &String::from_utf8_lossy(&bytes))),
            Err(_) => {
                st.unreadable += 1;
                (rel.clone(), BendFile::default())
            }
        })
        .collect();

    // Imports: a repo file is an `I` edge (form 0, a value use, never type-only); a package or a
    // missing relative path is a `U` row with its reason.
    let id_of: std::collections::HashMap<&str, u32> = files.iter().map(|(id, p)| (p.as_str(), *id)).collect();
    let exists = |p: &str| id_of.contains_key(p);
    let (mut i, mut u) = (Vec::new(), Vec::new());
    for ((src, _), (rel, f)) in files.iter().zip(&parsed) {
        for imp in &f.imports {
            match resolve(rel, imp, &exists) {
                Ok(dst) => i.push([*src, id_of[dst.as_str()], 0, 1, 0]),
                Err(reason) => u.push([*src, reason as u32]),
            }
        }
    }
    i.sort_unstable();
    i.dedup();
    u.sort_unstable();
    u.dedup();

    let mut laws: Vec<GLaw> = link_laws(&parsed)
        .into_iter()
        .map(|l| GLaw {
            file: files[l.file].0,
            line: l.line,
            name: l.name,
            filled: l.filled,
            fns: l.fns.into_iter().map(|(fi, local)| (files[fi].0, local)).collect(),
        })
        .collect();
    laws.sort_by_key(|l| (l.file, l.line));
    st.laws = laws.len();

    let prod = prod_flags(files, &parsed, &i);
    let mut marks = Vec::new();
    let mut per_file = Vec::with_capacity(parsed.len());
    for ((id, path), (_, f)) in files.iter().zip(parsed) {
        for &(local, class, count) in &f.markers {
            if count > 0 {
                marks.push((*id, local, class, count));
            }
        }
        // Laws, proofs, checks and fixtures are not production code (the lane's prod rule), so
        // their functions are test functions for the metric rules: TF rows, which Metrics skips.
        let tests = if is_proof_path(path) || is_test_path(path) { (0..f.fns.fns.len() as u32).collect() } else { Vec::new() };
        per_file.push(FileOut { fns: f.fns, tests });
    }
    st.markers = marks.len();
    Ok(Analysis { per_file, i, u, extra: Extra { marks, laws }, prod, stats: st })
}

/// Whether a path names a check or test program by convention: `*-CHECK.bend`, `*-TEST.bend`, or
/// a file under a `fixtures/` directory.
pub fn is_test_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.strip_suffix(".bend").unwrap_or(name);
    stem.ends_with("-CHECK") || stem.ends_with("-TEST") || path.split('/').rev().skip(1).any(|d| d == "fixtures")
}

/// Whether a path names a laws or proof file by convention: `*-LAWS.bend` or `*-PROOF.bend`.
pub fn is_proof_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.strip_suffix(".bend").unwrap_or(name);
    stem.ends_with("-LAWS") || stem.ends_with("-PROOF")
}

/// Which files are production code. Shipped Bend is what a program runs: a file is production when
/// an entry point (a non-test file that defines `main`) reaches it through imports, the entry
/// included. Laws, proofs and lemmas import the code; the code never imports them, so they fall
/// out without naming them. Test-named files are never production. A lane with no entry point
/// (a library) falls back to the content: a non-test file that states no law.
pub fn prod_flags(files: &[(u32, String)], parsed: &[(String, BendFile)], i: &[[u32; 5]]) -> Vec<bool> {
    let n = files.len();
    let test: Vec<bool> = files.iter().map(|(_, p)| is_test_path(p)).collect();
    let entry: Vec<bool> = (0..n).map(|k| !test[k] && parsed[k].1.defs.iter().any(|d| d.name == "main")).collect();
    if !entry.contains(&true) {
        return (0..n).map(|k| !test[k] && parsed[k].1.laws.is_empty()).collect();
    }
    let pos: std::collections::HashMap<u32, usize> = files.iter().enumerate().map(|(k, (id, _))| (*id, k)).collect();
    let mut adj = vec![Vec::new(); n];
    for r in i {
        adj[pos[&r[0]]].push(pos[&r[1]]);
    }
    let mut prod = vec![false; n];
    let mut stack: Vec<usize> = (0..n).filter(|&k| entry[k]).collect();
    while let Some(k) = stack.pop() {
        if prod[k] || test[k] {
            continue;
        }
        prod[k] = true;
        stack.extend(adj[k].iter().copied());
    }
    prod
}

impl Extra {
    /// Push `MK`, `L`, `LW` and `LN`. `bases[file id]` is that file's first global `FN` id.
    pub fn push_rows(&self, w: &mut FactWriter, bases: &[u32]) {
        for &(file, local, class, count) in &self.marks {
            w.push(Rel::Mk, &[bases[file as usize] + local, class as u32, count]);
        }
        if self.laws.is_empty() {
            return;
        }
        w.push(Rel::L, &[self.laws.len() as u32]);
        let mut seen: HashSet<(u32, u32)> = HashSet::new();
        for (law, l) in self.laws.iter().enumerate() {
            let law = law as u32;
            w.push(Rel::Lw, &[law, l.file, l.filled as u32]);
            for &(file, local) in &l.fns {
                let fnid = bases[file as usize] + local;
                if seen.insert((law, fnid)) {
                    w.push(Rel::Ln, &[law, fnid]);
                }
            }
        }
    }

    /// The `.laws` side table: one `law path line name` line per law, TAB-separated, in law-id
    /// order. `paths` is indexed by global file id.
    pub fn laws_table(&self, paths: &[String]) -> String {
        let mut out = String::new();
        for (law, l) in self.laws.iter().enumerate() {
            out.push_str(&format!("{law}\t{}\t{}\t{}\n", paths[l.file as usize], l.line, l.name));
        }
        out
    }
}

/// First global `FN` id of each file: functions are numbered in file-id order.
pub fn fn_bases(per: &[Option<FileOut>]) -> Vec<u32> {
    let mut next = 0u32;
    per.iter()
        .map(|f| {
            let b = next;
            next += f.as_ref().map_or(0, |f| f.fns.fns.len() as u32);
            b
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[(&str, &str)]) -> tempfile_dir::Dir {
        let d = tempfile_dir::Dir::new();
        for (p, src) in files {
            let path = d.0.join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, src).unwrap();
        }
        d
    }

    /// A scratch directory removed on drop (no extra dev-dependency).
    mod tempfile_dir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new() -> Dir {
                use std::sync::atomic::{AtomicU32, Ordering};
                static N: AtomicU32 = AtomicU32::new(0);
                let p = std::env::temp_dir().join(format!(
                    "pulsar-bend-lane-{}-{}",
                    std::process::id(),
                    N.fetch_add(1, Ordering::Relaxed)
                ));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    const LIB: &str = "import Base\n\ndef inc(+x: U32) -> U32:\n  U32.add(x, 1)\n\n@unsafe def raw(x: U32) -> U32:\n  x\n";
    const LAWS: &str = "import Base\nimport ./lib.bend as L\n\nlaw inc_grows:\n  for +x: U32\n  {L.inc(x) == L.inc(x) : U32}\n\nlaw orphan:\n  for +x: U32\n  {x == x : U32}\n";
    const PROOF: &str = "import Base\nimport ./laws.bend as W\nimport ./gone.bend as G\n\ndef W.inc_grows(+x: U32) -> {W.L.inc(x) == W.L.inc(x) : U32}:\n  {==}\n";

    fn files() -> Vec<(u32, String)> {
        // Ids as the driver would give them, with a non-Bend file at id 0.
        vec![(1, "e/laws.bend".into()), (2, "e/lib.bend".into()), (3, "e/proof.bend".into())]
    }

    #[test]
    fn owns_only_bend() {
        assert!(owns("engine/Metrics.bend"));
        assert!(!owns("engine/x.bendtt"));
        assert!(!owns("cli/src/main.rs"));
    }

    #[test]
    fn imports_markers_and_laws_over_global_ids() {
        let d = tree(&[("e/lib.bend", LIB), ("e/laws.bend", LAWS), ("e/proof.bend", PROOF)]);
        let a = analyze(&d.0, &files()).unwrap();
        // laws -> lib, proof -> laws; Base (x3) is reason 0, gone.bend reason 1.
        assert_eq!(a.i, vec![[1, 2, 0, 1, 0], [3, 1, 0, 1, 0]]);
        assert_eq!(a.u, vec![[1, 0], [2, 0], [3, 0], [3, 1]]);
        assert_eq!(a.per_file.len(), 3);
        let lib_fns = a.per_file[1].fns.fns.len() as u32;
        assert_eq!(lib_fns, 2);
        // raw is lib's second def: one unsafe marker.
        assert_eq!(a.extra.marks, vec![(2, 1, 1, 1)]);
        let names: Vec<_> = a.extra.laws.iter().map(|l| (l.file, l.name.as_str(), l.filled)).collect();
        assert_eq!(names, vec![(1, "inc_grows", true), (1, "orphan", false)]);
        assert_eq!(a.extra.laws[0].fns, vec![(2, 0)]);
        assert!(a.extra.laws[1].fns.is_empty());
    }

    #[test]
    fn push_rows_numbers_functions_globally() {
        let d = tree(&[("e/lib.bend", LIB), ("e/laws.bend", LAWS), ("e/proof.bend", PROOF)]);
        let a = analyze(&d.0, &files()).unwrap();
        // File 0 (another lane) has 5 functions; then the Bend files in id order.
        let mut per: Vec<Option<FileOut>> = vec![None, None, None, None];
        per[0] = Some(FileOut {
            fns: crate::lang::functions::FileFns {
                fns: (0..5)
                    .map(|k| crate::lang::functions::FnRec {
                        start_line: k,
                        end_line: k,
                        parent: None,
                        loc: 1,
                        kind: 0,
                        chain: format!("f{k}"),
                        key: k as u64,
                    })
                    .collect(),
                ..Default::default()
            },
            tests: vec![],
        });
        let laws_fns = a.per_file[0].fns.fns.len() as u32;
        for (k, f) in a.per_file.into_iter().enumerate() {
            per[k + 1] = Some(f);
        }
        let bases = fn_bases(&per);
        assert_eq!(bases[..3], [0, 5, 5 + laws_fns]);
        let mut w = FactWriter::new();
        a.extra.push_rows(&mut w, &bases);
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        let lib = 5 + laws_fns;
        assert!(text.contains(&format!("\nMK {} 1 1\n", lib + 1)), "{text}");
        assert!(text.contains("\nL 2\n"), "{text}");
        assert!(text.contains("\nLW 0 1 1\n") && text.contains("\nLW 1 1 0\n"), "{text}");
        assert!(text.contains(&format!("\nLN 0 {lib}\n")), "{text}");
        assert_eq!(text.matches("\nLN ").count(), 1, "{text}");

        let paths: Vec<String> = ["a.ts", "e/laws.bend", "e/lib.bend", "e/proof.bend"].map(String::from).to_vec();
        assert_eq!(a.extra.laws_table(&paths), "0\te/laws.bend\t4\tinc_grows\n1\te/laws.bend\t8\torphan\n");
    }

    #[test]
    fn no_laws_no_header() {
        let d = tree(&[("e/lib.bend", LIB)]);
        let a = analyze(&d.0, &[(0, "e/lib.bend".into())]).unwrap();
        let mut w = FactWriter::new();
        a.extra.push_rows(&mut w, &[0]);
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(!text.contains("\nL ") && !text.contains("\nLW "), "{text}");
        assert!(text.contains("\nMK 1 1 1\n"), "{text}");
    }

    #[test]
    fn prod_is_what_an_entry_point_reaches() {
        let main = "import Base\nimport ./lib.bend as L\n\ndef main() -> IO(Unit):\n  IO.print(\"x\")\n";
        let check = "import Base\nimport ./lib.bend as L\n\ndef main() -> IO(Unit):\n  IO.print(\"y\")\n";
        let lemma = "import Base\n\ndef helper(+x: U32) -> U32:\n  x\n";
        let fx = "import Base\nimport ../lib.bend as L\n\ndef main() -> IO(Unit):\n  IO.print(\"z\")\n";
        let d = tree(&[
            ("e/main.bend", main),
            ("e/lib.bend", LIB),
            ("e/laws.bend", LAWS),
            ("e/proof.bend", PROOF),
            ("e/lemma.bend", lemma),
            ("e/lib-CHECK.bend", check),
            ("e/fixtures/f.bend", fx),
        ]);
        let files: Vec<(u32, String)> =
            ["e/fixtures/f.bend", "e/laws.bend", "e/lemma.bend", "e/lib-CHECK.bend", "e/lib.bend", "e/main.bend", "e/proof.bend"]
                .iter()
                .enumerate()
                .map(|(k, p)| (k as u32 + 10, p.to_string()))
                .collect();
        let a = analyze(&d.0, &files).unwrap();
        let prod: Vec<&str> = files.iter().zip(&a.prod).filter(|(_, &p)| p).map(|((_, f), _)| f.as_str()).collect();
        // The lemma states no law but no entry point imports it; the check and fixture programs
        // define main but are tests; the laws and proof files import lib, not the other way round.
        assert_eq!(prod, ["e/lib.bend", "e/main.bend"]);
    }

    #[test]
    fn a_lane_with_no_entry_point_falls_back_to_files_without_laws() {
        let d = tree(&[("e/lib.bend", LIB), ("e/laws.bend", LAWS), ("e/lib-CHECK.bend", LIB)]);
        let files = vec![(0, "e/laws.bend".into()), (1, "e/lib-CHECK.bend".into()), (2, "e/lib.bend".into())];
        let a = analyze(&d.0, &files).unwrap();
        assert_eq!(a.prod, [false, false, true]);
    }

    #[test]
    fn test_paths() {
        assert!(is_test_path("engine/Metrics-CHECK.bend"));
        assert!(is_test_path("engine/fixtures/x.bend"));
        assert!(is_test_path("a/X-TEST.bend"));
        assert!(!is_test_path("engine/Metrics.bend"));
        assert!(!is_test_path("fixtures.bend"));
        assert!(!is_test_path("engine/CHECK.bend"));
        assert!(is_proof_path("engine/Rules-PROOF.bend"));
        assert!(is_proof_path("engine/Rules-LAWS.bend"));
        assert!(!is_proof_path("engine/Rules.bend"));
        assert!(!is_proof_path("engine/PROOF.bend"));
    }

    #[test]
    fn proof_and_check_functions_are_test_functions() {
        let d = tree(&[("e/lib.bend", LIB), ("e/lib-PROOF.bend", LIB), ("e/lib-CHECK.bend", LIB)]);
        let a = analyze(&d.0, &[(0, "e/lib.bend".into()), (1, "e/lib-PROOF.bend".into()), (2, "e/lib-CHECK.bend".into())]).unwrap();
        let n = a.per_file[0].fns.fns.len() as u32;
        assert!(n > 0);
        assert!(a.per_file[0].tests.is_empty());
        assert_eq!(a.per_file[1].tests, (0..n).collect::<Vec<_>>());
        assert_eq!(a.per_file[2].tests, (0..n).collect::<Vec<_>>());
    }

    #[test]
    fn unreadable_file_is_counted_not_fatal() {
        let d = tree(&[("e/lib.bend", LIB)]);
        let a = analyze(&d.0, &[(0, "e/lib.bend".into()), (1, "e/missing.bend".into())]).unwrap();
        assert_eq!(a.stats.unreadable, 1);
        assert_eq!(a.per_file.len(), 2);
        assert!(a.per_file[1].fns.fns.is_empty());
    }
}
