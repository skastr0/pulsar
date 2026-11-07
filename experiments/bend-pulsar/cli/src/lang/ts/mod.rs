//! TypeScript lane: parse the files the driver hands over (one AST at a time per thread), resolve
//! imports, and return per-file function rows plus `I` and `U` rows over global file ids. The
//! driver owns file ids and function numbering and writes every row through `crate::facts`.

mod extract;
pub mod functions;
mod resolve;

use crate::lang::functions::FileFns;
use crate::lang::FileOut;
#[allow(unused_imports)]
pub use extract::{function_spans, FnSpan};
use extract::{extract, type_only_exports};
use oxc_allocator::Allocator;
use rayon::prelude::*;
use resolve::{Resolution, Resolved};
use std::path::Path;

#[derive(Default)]
pub struct Stats {
    pub files: usize,
    pub fatal: usize,
    pub unreadable: usize,
    pub i_facts: usize,
    pub u_facts: usize,
}

#[derive(Default)]
pub struct Analysis {
    /// Indexed like the `files` argument.
    pub per_file: Vec<FileOut>,
    /// `(src, dst, form, hv, ht)` over global file ids; sorted and deduped.
    pub i: Vec<[u32; 5]>,
    /// `(src, reason)` over global file ids; sorted and deduped.
    pub u: Vec<[u32; 2]>,
    pub stats: Stats,
}

/// Whether this lane owns a tracked path.
pub fn owns(p: &str) -> bool {
    (p.ends_with(".ts") || p.ends_with(".tsx") || p.ends_with(".mts") || p.ends_with(".cts"))
        && !p.ends_with(".d.ts")
        && !p.ends_with(".d.mts")
        && !p.ends_with(".d.cts")
}

/// Analyse the TypeScript files of a tree. `files` is `(global file id, repo-relative path)` for
/// every file this lane owns; `tracked` is every tracked path (for workspace package discovery).
pub fn analyze(root: &Path, files: &[(u32, String)], tracked: &[String]) -> Result<Analysis, String> {
    let paths: Vec<String> = files.iter().map(|(_, p)| p.clone()).collect();
    let res = Resolution::new(root, &paths, tracked);

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

    let mut per: Vec<PerFile> = paths
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
            let path = root.join(&paths[*dst as usize]);
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
    let mut i_rows: Vec<[u32; 5]> = Vec::new();
    let mut u_rows: Vec<[u32; 2]> = Vec::new();
    for (idx, p) in per.iter().enumerate() {
        let src = files[idx].0;
        st.fatal += p.fatal as usize;
        st.unreadable += p.unreadable as usize;
        for (dst, form, hv, ht) in &p.i {
            i_rows.push([src, files[*dst as usize].0, *form as u32, *hv as u32, *ht as u32]);
        }
        for r in &p.u {
            u_rows.push([src, *r as u32]);
        }
    }
    // Per-file lists are sorted and deduped; sorting globally keeps the same canonical order.
    i_rows.sort_unstable();
    u_rows.sort_unstable();
    st.i_facts = i_rows.len();
    st.u_facts = u_rows.len();
    let per_file = per.iter_mut().map(|p| FileOut { fns: std::mem::take(&mut p.fns), tests: Vec::new() }).collect();
    Ok(Analysis { per_file, i: i_rows, u: u_rows, stats: st })
}
