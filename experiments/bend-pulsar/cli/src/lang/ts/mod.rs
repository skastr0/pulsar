//! TypeScript lane: enumerate files, parse in parallel (one AST at a time per thread), resolve,
//! and push `F`, `K`, `I` and `U` facts into the shared writer.

mod extract;
pub mod functions;
mod resolve;
mod scope;

use crate::facts::{stable_key, FactWriter, FnEntry, Rel, SideTables};
use crate::git::git_ls_files;
use extract::{extract, type_only_exports};
use crate::lang::functions::{FileFns, NO_PARENT};
use oxc_allocator::Allocator;
use rayon::prelude::*;
use resolve::{Resolution, Resolved};
use scope::is_prod;
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
}

fn is_ts_source(p: &str) -> bool {
    (p.ends_with(".ts") || p.ends_with(".tsx") || p.ends_with(".mts") || p.ends_with(".cts"))
        && !p.ends_with(".d.ts")
        && !p.ends_with(".d.mts")
        && !p.ends_with(".d.cts")
}

/// Extract the repo's TypeScript facts into `w` and `tables`; returns the file set (index =
/// file id) and stats.
pub fn collect(repo: &Path, w: &mut FactWriter, tables: &mut SideTables) -> Result<(FactSet, Stats), String> {
    let root: PathBuf = std::fs::canonicalize(repo).map_err(|e| format!("{}: {e}", repo.display()))?;
    let tracked = git_ls_files(&root)?;
    collect_tracked(&root, tracked, w, tables)
}

/// Like `collect`, for a tree that is not a git checkout (for example one materialised from a
/// sha): `tracked` is the tree's file list, repo-relative.
pub fn collect_tracked(
    root: &Path,
    tracked: Vec<String>,
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    let mut files: Vec<String> = tracked
        .iter()
        .filter(|p| is_ts_source(p) && root.join(p).is_file())
        .cloned()
        .collect();
    files.sort();
    files.dedup();

    let res = Resolution::new(root, &files, &tracked);
    drop(tracked);

    struct PerFileOut {
        i: Vec<(u32, u8, u8, u8)>,
        u: Vec<u8>,
        fns: FileFns,
        fatal: bool,
        unreadable: bool,
    }
    struct IEntry {
        dst: u32,
        form: u8,
        hv: bool,
        ht: bool,
        pending: Vec<String>,
    }
    struct PerFile {
        i: Vec<IEntry>,
        u: Vec<u8>,
        fns: FileFns,
        fatal: bool,
        unreadable: bool,
    }

    let mut per: Vec<PerFile> = files
        .par_iter()
        .map_init(Allocator::default, |alloc, rel| {
            alloc.reset();
            let path = root.join(rel);
            let Ok(bytes) = std::fs::read(&path) else {
                return PerFile { i: vec![], u: vec![], fns: FileFns::default(), fatal: false, unreadable: true };
            };
            let text = String::from_utf8_lossy(&bytes);
            let ex = extract(alloc, rel, &path, &text);
            let mut i = Vec::new();
            let mut u = Vec::new();
            for imp in ex.imports {
                match res.resolve(rel, &imp.spec) {
                    Resolved::File(dst) => i.push(IEntry {
                        dst,
                        form: imp.form,
                        hv: imp.hv,
                        ht: imp.ht,
                        pending: imp.pending,
                    }),
                    Resolved::Unresolved(r) => u.push(r),
                }
            }
            PerFile { i, u, fns: ex.functions, fatal: ex.fatal, unreadable: false }
        })
        .collect();

    // Pass 2: `export { a } from "./x"` is type-only per specifier when the target declares `a` as an
    // interface/type alias (old Pulsar's rule). Re-parse only the targets that need the lookup.
    let mut wanted: std::collections::BTreeMap<u32, std::collections::BTreeSet<String>> = Default::default();
    for p in &per {
        for e in &p.i {
            if !e.pending.is_empty() {
                wanted.entry(e.dst).or_default().extend(e.pending.iter().cloned());
            }
        }
    }
    let targets: Vec<(u32, Vec<String>)> =
        wanted.into_iter().map(|(d, n)| (d, n.into_iter().collect())).collect();
    let settled: std::collections::HashMap<u32, std::collections::HashMap<String, bool>> = targets
        .par_iter()
        .map_init(Allocator::default, |alloc, (dst, names)| {
            alloc.reset();
            let path = root.join(&files[*dst as usize]);
            let names_ref: Vec<&str> = names.iter().map(String::as_str).collect();
            let flags = match std::fs::read(&path) {
                Ok(bytes) => type_only_exports(alloc, &path, &String::from_utf8_lossy(&bytes), &names_ref),
                Err(_) => vec![false; names.len()],
            };
            (*dst, names.iter().cloned().zip(flags).collect())
        })
        .collect();
    let mut per: Vec<_> = per
        .iter_mut()
        .map(|p| {
            let mut i: Vec<(u32, u8, u8, u8)> = Vec::with_capacity(p.i.len());
            for e in p.i.drain(..) {
                let (mut hv, mut ht) = (e.hv, e.ht);
                for n in &e.pending {
                    if settled.get(&e.dst).and_then(|m| m.get(n)).copied().unwrap_or(false) {
                        ht = true;
                    } else {
                        hv = true;
                    }
                }
                i.push((e.dst, e.form, hv as u8, ht as u8));
            }
            i.sort_unstable();
            i.dedup();
            p.u.sort_unstable();
            p.u.dedup();
            PerFileOut { i, u: std::mem::take(&mut p.u), fns: std::mem::take(&mut p.fns), fatal: p.fatal, unreadable: p.unreadable }
        })
        .collect();

    let mut st = Stats { files: files.len(), ..Stats::default() };
    w.push(Rel::N, &[files.len() as u32]);
    for (id, rel) in files.iter().enumerate() {
        let prod = is_prod(rel);
        st.prod += prod as usize;
        w.push(Rel::F, &[id as u32, prod as u32]);
        let k = stable_key(rel);
        w.push(Rel::K, &[id as u32, (k >> 32) as u32, (k & 0xffff_ffff) as u32]);
    }
    for (src, p) in per.iter().enumerate() {
        st.fatal += p.fatal as usize;
        st.unreadable += p.unreadable as usize;
        for (dst, form, hv, ht) in &p.i {
            w.push(Rel::I, &[src as u32, *dst, *form as u32, *hv as u32, *ht as u32]);
        }
        for r in &p.u {
            w.push(Rel::U, &[src as u32, *r as u32]);
        }
    }
    // Function ids are global: files in id order, functions in start-offset order within a file.
    // Each file's rows move into the writer and are freed before the next file, so the per-file
    // results and the writer's copy never coexist for the whole corpus.
    let total_fns: usize = per.iter().map(|p| p.fns.fns.len()).sum();
    let total_ct: usize = per.iter().map(|p| p.fns.ct.len()).sum();
    w.reserve(Rel::Fn, total_fns);
    w.reserve(Rel::Fk, total_fns);
    w.reserve(Rel::Ct, total_ct);
    w.push(Rel::M, &[total_fns as u32]);
    tables.fns.reserve(total_fns);
    let mut fn_keys = Vec::with_capacity(total_fns);
    let mut base = 0u32;
    for (file, p) in per.iter_mut().enumerate() {
        let FileFns { fns, mut ct } = std::mem::take(&mut p.fns);
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
        base += count;
    }
    st.fns = total_fns;
    // I and U counts are post-dedup: per-file lists are already sorted and deduped above.
    st.i_facts = per.iter().map(|p| p.i.len()).sum();
    st.u_facts = per.iter().map(|p| p.u.len()).sum();
    tables.paths = files.clone();
    let prod = st.prod;
    Ok((FactSet { files, prod, fn_keys }, st))
}
