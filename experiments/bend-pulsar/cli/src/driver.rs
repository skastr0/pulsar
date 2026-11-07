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
use crate::policy::{ActiveRule, Lanes};
use crate::lang::{self, Degraded, FileOut};
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
    pub bend_files: usize,
    pub laws: usize,
    pub markers: usize,
    pub sites: usize,
    /// Lanes that ran on weaker input than they wanted; also noted in the facts header.
    pub degraded: Vec<Degraded>,
}

/// Run the lanes on the git checkout at `repo`.
pub fn build_repo(
    repo: &Path,
    lanes: &Lanes,
    rules: &[ActiveRule],
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    let root: PathBuf = std::fs::canonicalize(repo).map_err(|e| format!("{}: {e}", repo.display()))?;
    let tracked = git_ls_files(&root)?;
    build(&root, tracked, lanes, rules, w, tables)
}

/// Run the lanes on the tree at `root`; `tracked` is its file list, repo-relative (for a tree that
/// is not a git checkout, for example one materialised from a sha). `lanes` is the policy's
/// per-lane scope: a file outside it is in no lane and gets no id.
pub fn build(
    root: &Path,
    tracked: Vec<String>,
    lanes: &Lanes,
    rules: &[ActiveRule],
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    let files = list_files(root, &tracked, lanes);
    let ts_files = lane_files(&files, lang::ts::owns);
    let rust_files = lane_files(&files, lang::rust::owns);
    let bend_files = lane_files(&files, lang::bend::owns);

    let mut st = Stats { files: files.len(), ts_files: ts_files.len(), rust_files: rust_files.len(), bend_files: bend_files.len(), ..Stats::default() };

    // Lanes run one after another: each already uses every core, and one lane's ASTs are gone
    // before the next lane parses.
    let mut per: Vec<Option<FileOut>> = (0..files.len()).map(|_| None).collect();
    let sym_classes = analyze_ts(root, &tracked, &ts_files, &mut per, w, &mut st)?;
    // What a lane's analysis decided about production code, per file id: None keeps the path rule.
    let mut lane_prod: Vec<Option<bool>> = vec![None; files.len()];
    analyze_rust(root, &tracked, &rust_files, &mut per, &mut lane_prod, w, &mut st)?;
    tables.laws = bend_lane(root, &bend_files, &files, &mut per, &mut lane_prod, w, &mut st)?;
    // F rows come after the lanes, because only a lane's analysis can tell some test files.
    push_files(w, &files, lanes, &lane_prod, &mut st);

    // Function ids are global: files in id order, functions in start-offset order within a file.
    // Each file's rows move into the writer and are freed before the next file.
    let total_fns: usize = per.iter().flatten().map(|f| f.fns.fns.len()).sum();
    let total_ct: usize = per.iter().flatten().map(|f| f.fns.ct.len()).sum();
    w.reserve(Rel::Fn, total_fns);
    w.reserve(Rel::Fk, total_fns);
    w.reserve(Rel::Ct, total_ct);
    w.push(Rel::M, &[total_fns as u32]);
    tables.fns.reserve(total_fns);
    push_sites(w, &per, &sym_classes, tables, &mut st);
    let fn_keys = push_functions(w, per, tables, &mut st);
    push_rules(w, rules, tables);
    st.fns = total_fns;
    for d in &st.degraded {
        w.note(&format!("degraded {}: {}", d.lane, d.cause));
    }
    tables.paths = files.clone();
    let prod = st.prod;
    Ok((FactSet { files, prod, fn_keys }, st))
}

/// One id space: every existing file some lane owns and the policy allows, byte-sorted.
fn list_files(root: &Path, tracked: &[String], lanes: &Lanes) -> Vec<String> {
    let mut files: Vec<String> = tracked
        .iter()
        .filter(|p| {
            ((lang::ts::owns(p) && lanes.ts.allows(p))
                || (lang::rust::owns(p) && lanes.rust.allows(p))
                || (lang::bend::owns(p) && lanes.bend.allows(p)))
                && root.join(p).is_file()
        })
        .cloned()
        .collect();
    files.sort();
    files.dedup();
    files
}

/// `(global file id, path)` for the files one lane owns.
fn lane_files(files: &[String], owns: fn(&str) -> bool) -> Vec<(u32, String)> {
    files.iter().enumerate().filter(|(_, p)| owns(p)).map(|(i, p)| (i as u32, p.clone())).collect()
}

/// `RL rule class ctx_any ctx_none` for every active catalog rule, numbered by sorted id. A
/// classification alone never makes a finding: only these rows do (class-in-context detector).
fn push_rules(w: &mut FactWriter, rules: &[ActiveRule], tables: &mut SideTables) {
    for (id, r) in rules.iter().enumerate() {
        w.push(Rel::Rl, &[id as u32, r.class_id, r.ctx_any, r.ctx_none]);
    }
    tables.rules = rules.iter().map(|r| r.id.clone()).collect();
}

/// `N`, `F` and `K` for every file.
fn push_files(w: &mut FactWriter, files: &[String], lanes: &Lanes, lane_prod: &[Option<bool>], st: &mut Stats) {
    w.push(Rel::N, &[files.len() as u32]);
    for (id, rel) in files.iter().enumerate() {
        let prod = lanes.is_prod(rel, lane_prod[id]);
        st.prod += prod as usize;
        w.push(Rel::F, &[id as u32, prod as u32]);
        let k = stable_key(rel);
        w.push(Rel::K, &[id as u32, (k >> 32) as u32, (k & 0xffff_ffff) as u32]);
    }
}

/// Run the TypeScript lane; returns the catalog classes of each symbol it saw.
fn analyze_ts(
    root: &Path,
    tracked: &[String],
    files: &[(u32, String)],
    per: &mut [Option<FileOut>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<std::collections::BTreeMap<String, Vec<u32>>, String> {
    if files.is_empty() {
        return Ok(Default::default());
    }
    let a = lang::ts::analyze(root, files, tracked)?;
    st.fatal += a.stats.fatal;
    st.unreadable += a.stats.unreadable;
    push_edges(w, &a.i, &a.u, st);
    for ((id, _), f) in files.iter().zip(a.per_file) {
        per[*id as usize] = Some(f);
    }
    Ok(a.sym_classes)
}

/// Run the Rust lane; a manifest cargo cannot read degrades the graph and is reported.
fn analyze_rust(
    root: &Path,
    tracked: &[String],
    files: &[(u32, String)],
    per: &mut [Option<FileOut>],
    lane_prod: &mut [Option<bool>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let a = lang::rust::analyze(root, files, tracked)?;
    for ((id, _), p) in files.iter().zip(&a.prod) {
        lane_prod[*id as usize] = *p;
    }
    st.fatal += a.stats.failed_parse;
    if a.stats.metadata_fallbacks > 0 {
        st.degraded.push(Degraded {
            lane: "rust",
            cause: format!(
                "cargo metadata failed for {} manifest(s) (missing toolchain or unresolvable workspace); the module graph uses the conventional layout, so use edges and cycles may be missing",
                a.stats.metadata_fallbacks
            ),
        });
    }
    push_edges(w, &a.i, &a.u, st);
    for ((id, _), f) in files.iter().zip(a.per_file) {
        per[*id as usize] = Some(FileOut { fns: f.fns, tests: f.tests });
    }
    Ok(())
}

/// Call sites and handlers: symbol ids are global and sorted by name, site ids run in
/// (file, source) order, so they need every file's rows before any is consumed.
fn push_sites(
    w: &mut FactWriter,
    per: &[Option<FileOut>],
    sym_classes: &std::collections::BTreeMap<String, Vec<u32>>,
    tables: &mut SideTables,
    st: &mut Stats,
) {
    let mut bases = Vec::new();
    let mut file_base = std::collections::HashMap::new();
    let mut next = 0u32;
    for (file, slot) in per.iter().enumerate() {
        let Some(f) = slot else { continue };
        file_base.insert(file as u32, next);
        bases.push((next, &f.fns));
        next += f.fns.fns.len() as u32;
    }
    let rows = crate::lang::functions::number_sites(
        &bases,
        &|file| file_base.get(&file).copied(),
        &|s| sym_classes.get(s).cloned().unwrap_or_default(),
    );
    for id in 0..rows.syms.len() {
        w.push(Rel::Sy, &[id as u32]);
    }
    rows.cl.iter().for_each(|r| w.push(Rel::Cl, r));
    rows.cs.iter().for_each(|r| w.push(Rel::Cs, r));
    rows.hd.iter().for_each(|r| w.push(Rel::Hd, r));
    rows.ce.iter().for_each(|r| w.push(Rel::Ce, r));
    rows.cu.iter().for_each(|r| w.push(Rel::Cu, r));
    st.sites = rows.cs.len() + rows.hd.len() + rows.ce.len();
    tables.syms = rows.syms;
}

/// Function ids are global: files in id order, functions in start-offset order within a file.
/// Each file's rows move into the writer and are freed before the next file. Returns the `FK`
/// key of each function.
fn push_functions(w: &mut FactWriter, mut per: Vec<Option<FileOut>>, tables: &mut SideTables, st: &mut Stats) -> Vec<u64> {
    let mut fn_keys = Vec::new();
    let mut base = 0u32;
    for (file, slot) in per.iter_mut().enumerate() {
        let Some(FileOut { fns: FileFns { fns, mut ct, mut ops, .. }, tests }) = slot.take() else { continue };
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
        // The boolean operator behind each kind-6 node.
        ops.sort_unstable_by_key(|o| (o.fn_local, o.node));
        for o in &ops {
            w.push(Rel::Co, &[base + o.fn_local, o.node, o.op as u32]);
        }
        for t in tests {
            w.push(Rel::Tf, &[base + t]);
        }
        base += count;
    }
    fn_keys
}

/// The Bend lane: its `I`/`U` rows and per-file functions, then `MK`/`L`/`LW`/`LN`, which name
/// functions by (file, local index) and so are numbered here, like `FN` below. Returns the
/// `.laws` table (empty when there are no Bend files or no laws).
fn bend_lane(
    root: &Path,
    bend_files: &[(u32, String)],
    files: &[String],
    per: &mut [Option<FileOut>],
    lane_prod: &mut [Option<bool>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<String, String> {
    if bend_files.is_empty() {
        return Ok(String::new());
    }
    let a = lang::bend::analyze(root, bend_files)?;
    for ((id, _), p) in bend_files.iter().zip(&a.prod) {
        lane_prod[*id as usize] = Some(*p);
    }
    st.unreadable += a.stats.unreadable;
    st.laws = a.stats.laws;
    st.markers = a.stats.markers;
    push_edges(w, &a.i, &a.u, st);
    for ((id, _), f) in bend_files.iter().zip(a.per_file) {
        per[*id as usize] = Some(f);
    }
    a.extra.push_rows(w, &lang::bend::fn_bases(per));
    Ok(a.extra.laws_table(files))
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
        build(root, tracked.iter().map(|s| s.to_string()).collect(), &Lanes::default(), &[], &mut w, &mut t).unwrap();
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

    #[test]
    fn bend_files_join_the_id_space_and_number_law_functions_globally() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-bend-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("e")).unwrap();
        std::fs::write(dir.join("a.ts"), "export function f() { return 1 }\n").unwrap();
        std::fs::write(dir.join("e/lib.bend"), "import Base\n\ndef inc(+x: U32) -> U32:\n  U32.add(x, 1)\n").unwrap();
        std::fs::write(
            dir.join("e/laws.bend"),
            "import Base\nimport ./lib.bend as L\n\nlaw inc_is:\n  for +x: U32\n  {L.inc(x) == U32.add(x, 1) : U32}\n",
        )
        .unwrap();
        let mut w = FactWriter::new();
        let mut t = SideTables::default();
        let tracked = ["e/laws.bend", "a.ts", "e/lib.bend"].map(String::from).to_vec();
        let (_, st) = build(&dir, tracked, &Lanes::default(), &[], &mut w, &mut t).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        let out = String::from_utf8(out).unwrap();
        // ids: a.ts 0, e/laws.bend 1, e/lib.bend 2; a.ts has one function (FN 0), lib's inc is FN 1.
        assert_eq!((st.bend_files, st.laws), (2, 1));
        assert!(out.contains("N 3\n") && out.contains("I 1 2 0 1 0\n"), "{out}");
        assert!(out.contains("FN 1 2 "), "{out}");
        assert!(out.contains("L 1\n") && out.contains("LW 0 1 0\n") && out.contains("LN 0 1\n"), "{out}");
        assert_eq!(t.laws, "0\te/laws.bend\t4\tinc_is\n");
    }
}
