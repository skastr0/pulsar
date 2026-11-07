//! The driver: one file-id space for every lane, global function numbering, one writer.
//!
//! It lists the tree's files once (every file some lane owns, byte-sorted, ids `0..n-1`), pushes
//! `N`, `F` and `K`, hands each lane its `(id, path)` list, and writes what the lanes return:
//! `I` and `U` rows over global ids, and per-file function rows that it numbers in file-id order
//! (`M`, `FN`, `FK`, `CT`, `TF`) together with the `.fns` side table. Lanes never format a fact
//! line and never see another lane's files.

use crate::facts::{stable_key, FactWriter, FnEntry, Rel, SideTables};
use crate::git::git_ls_files;
use crate::lang::functions::{FileFns, NO_PARENT};
use crate::lang::scope::is_prod;
use crate::lang::{self, FileOut};
use std::path::{Path, PathBuf};

pub struct FactSet {
    pub files: Vec<String>,
    /// Number of production files (`F ... 1`).
    pub prod: usize,
    /// `FK` key of each function, indexed by `FN` id (the `.fns` order).
    pub fn_keys: Vec<u64>,
}

#[derive(Default)]
pub struct Stats {
    pub files: usize,
    pub prod: usize,
    pub fatal: usize,
    pub unreadable: usize,
    pub i_facts: usize,
    pub u_facts: usize,
    pub fns: usize,
    pub ct: usize,
    pub ts_files: usize,
    pub rust_files: usize,
}

/// Run the lanes on the git checkout at `repo`.
pub fn build_repo(repo: &Path, w: &mut FactWriter, tables: &mut SideTables) -> Result<(FactSet, Stats), String> {
    let root: PathBuf = std::fs::canonicalize(repo).map_err(|e| format!("{}: {e}", repo.display()))?;
    let tracked = git_ls_files(&root)?;
    build(&root, tracked, w, tables)
}

/// Run the lanes on the tree at `root`; `tracked` is its file list, repo-relative (for a tree that
/// is not a git checkout, for example one materialised from a sha).
pub fn build(
    root: &Path,
    tracked: Vec<String>,
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    // One id space: every existing file some lane owns, byte-sorted.
    let mut files: Vec<String> = tracked
        .iter()
        .filter(|p| (lang::ts::owns(p) || lang::rust::owns(p)) && root.join(p).is_file())
        .cloned()
        .collect();
    files.sort();
    files.dedup();
    let ids = |owns: fn(&str) -> bool| -> Vec<(u32, String)> {
        files.iter().enumerate().filter(|(_, p)| owns(p)).map(|(i, p)| (i as u32, p.clone())).collect()
    };
    let (ts_files, rust_files) = (ids(lang::ts::owns), ids(lang::rust::owns));

    let mut st = Stats { files: files.len(), ts_files: ts_files.len(), rust_files: rust_files.len(), ..Stats::default() };
    w.push(Rel::N, &[files.len() as u32]);
    for (id, rel) in files.iter().enumerate() {
        let prod = is_prod(rel);
        st.prod += prod as usize;
        w.push(Rel::F, &[id as u32, prod as u32]);
        let k = stable_key(rel);
        w.push(Rel::K, &[id as u32, (k >> 32) as u32, (k & 0xffff_ffff) as u32]);
    }

    // Lanes run one after another: each already uses every core, and one lane's ASTs are gone
    // before the next lane parses.
    let mut per: Vec<Option<FileOut>> = (0..files.len()).map(|_| None).collect();
    if !ts_files.is_empty() {
        let a = lang::ts::analyze(root, &ts_files, &tracked)?;
        st.fatal += a.stats.fatal;
        st.unreadable += a.stats.unreadable;
        push_edges(w, &a.i, &a.u, &mut st);
        for ((id, _), f) in ts_files.iter().zip(a.per_file) {
            per[*id as usize] = Some(f);
        }
    }
    if !rust_files.is_empty() {
        let a = lang::rust::analyze(root, &rust_files, &tracked)?;
        st.fatal += a.stats.failed_parse;
        push_edges(w, &a.i, &a.u, &mut st);
        for ((id, _), f) in rust_files.iter().zip(a.per_file) {
            per[*id as usize] = Some(FileOut { fns: f.fns, tests: f.tests });
        }
    }

    // Function ids are global: files in id order, functions in start-offset order within a file.
    // Each file's rows move into the writer and are freed before the next file.
    let total_fns: usize = per.iter().flatten().map(|f| f.fns.fns.len()).sum();
    let total_ct: usize = per.iter().flatten().map(|f| f.fns.ct.len()).sum();
    w.reserve(Rel::Fn, total_fns);
    w.reserve(Rel::Fk, total_fns);
    w.reserve(Rel::Ct, total_ct);
    w.push(Rel::M, &[total_fns as u32]);
    tables.fns.reserve(total_fns);
    let mut fn_keys = Vec::with_capacity(total_fns);
    let mut base = 0u32;
    for (file, slot) in per.iter_mut().enumerate() {
        let Some(FileOut { fns: FileFns { fns, mut ct, .. }, tests }) = slot.take() else { continue };
        let count = fns.len() as u32;
        for (local, f) in fns.into_iter().enumerate() {
            let id = base + local as u32;
            let parent = f.parent.map(|l| base + l);
            w.push(Rel::Fn, &[id, file as u32, parent.unwrap_or(NO_PARENT), f.loc]);
            w.push(Rel::Fk, &[id, (f.key >> 32) as u32, (f.key & 0xffff_ffff) as u32]);
            fn_keys.push(f.key);
            tables.fns.push(FnEntry {
                file: file as u32,
                start_line: f.start_line,
                end_line: f.end_line,
                parent,
                kind: f.kind,
                chain: f.chain,
            });
        }
        // Canonical (fn, node) order, so the writer's sorted fast path applies.
        ct.sort_unstable_by_key(|c| (c.fn_local, c.node));
        st.ct += ct.len();
        for c in &ct {
            w.push(Rel::Ct, &[base + c.fn_local, c.node, c.parent, c.kind as u32]);
        }
        for t in tests {
            w.push(Rel::Tf, &[base + t]);
        }
        base += count;
    }
    st.fns = total_fns;
    tables.paths = files.clone();
    let prod = st.prod;
    Ok((FactSet { files, prod, fn_keys }, st))
}

fn push_edges(w: &mut FactWriter, i: &[[u32; 5]], u: &[[u32; 2]], st: &mut Stats) {
    w.reserve(Rel::I, i.len());
    w.reserve(Rel::U, u.len());
    for r in i {
        w.push(Rel::I, r);
    }
    for r in u {
        w.push(Rel::U, r);
    }
    st.i_facts += i.len();
    st.u_facts += u.len();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(root: &Path, tracked: &[&str]) -> String {
        let mut w = FactWriter::new();
        let mut t = SideTables::default();
        build(root, tracked.iter().map(|s| s.to_string()).collect(), &mut w, &mut t).unwrap();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn ts_and_rust_files_share_one_sorted_id_space() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("a.ts"), "export const a = 1\n").unwrap();
        std::fs::write(dir.join("b.ts"), "import {a} from \"./a\"\nexport const b = a\n").unwrap();
        std::fs::write(dir.join("src/lib.rs"), "pub fn f() {}\n").unwrap();
        std::fs::write(dir.join("notes.md"), "x\n").unwrap();
        let out = facts(&dir, &["notes.md", "src/lib.rs", "b.ts", "a.ts"]);
        std::fs::remove_dir_all(&dir).ok();
        // ids by byte-sorted path: a.ts 0, b.ts 1, src/lib.rs 2; notes.md has no lane.
        assert!(out.contains("N 3\n"), "{out}");
        assert!(out.contains("F 0 ") && out.contains("F 1 ") && out.contains("F 2 "), "{out}");
        assert!(out.contains("I 1 0 0 1 0\n"), "b imports a: {out}");
        // functions are numbered in file-id order: the Rust fn is in file 2.
        assert!(out.lines().any(|l| l.starts_with("FN ") && l.split(' ').nth(2) == Some("2")), "{out}");
    }
}
