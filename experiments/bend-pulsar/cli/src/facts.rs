//! Build FACTS v0 for a TypeScript repo: enumerate files, parse in parallel (one AST at a
//! time per thread), resolve, and write canonical sorted facts.

use crate::extract::{extract, type_only_exports};
use crate::resolve::{Resolution, Resolved};
use crate::scope::is_prod;
use oxc_allocator::Allocator;
use rayon::prelude::*;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Stable file key: FNV-1a 64 over the UTF-8 bytes of the repo-relative path
/// (offset basis 0xcbf29ce484222325, prime 0x100000001b3). `K` emits (hi, lo) U32 halves.
pub fn stable_key(rel: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in rel.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub struct FactSet {
    pub files: Vec<String>,
    /// Number of production files (`F ... 1`).
    pub prod: usize,
}

#[derive(Default)]
pub struct Stats {
    pub files: usize,
    pub prod: usize,
    pub fatal: usize,
    pub unreadable: usize,
    pub i_facts: usize,
    pub u_facts: usize,
}

fn is_ts_source(p: &str) -> bool {
    (p.ends_with(".ts") || p.ends_with(".tsx") || p.ends_with(".mts") || p.ends_with(".cts"))
        && !p.ends_with(".d.ts")
        && !p.ends_with(".d.mts")
        && !p.ends_with(".d.cts")
}

pub fn git_ls_files(repo: &Path) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["ls-files", "-z"])
        .output()
        .map_err(|e| format!("cannot run git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git ls-files failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out
        .stdout
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect())
}

/// Write FACTS v0 to `out`; returns the sorted file list (index = file id) and stats.
pub fn build(repo: &Path, out: &mut dyn Write) -> Result<(FactSet, Stats), String> {
    let root: PathBuf = std::fs::canonicalize(repo).map_err(|e| format!("{}: {e}", repo.display()))?;
    let tracked = git_ls_files(&root)?;
    let mut files: Vec<String> = tracked
        .iter()
        .filter(|p| is_ts_source(p) && root.join(p).is_file())
        .cloned()
        .collect();
    files.sort();
    files.dedup();

    let res = Resolution::new(&root, &files, &tracked);
    drop(tracked);

    struct PerFileOut {
        i: Vec<(u32, u8, u8, u8)>,
        u: Vec<u8>,
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
        fatal: bool,
        unreadable: bool,
    }

    let mut per: Vec<PerFile> = files
        .par_iter()
        .map_init(Allocator::default, |alloc, rel| {
            alloc.reset();
            let path = root.join(rel);
            let Ok(bytes) = std::fs::read(&path) else {
                return PerFile { i: vec![], u: vec![], fatal: false, unreadable: true };
            };
            let text = String::from_utf8_lossy(&bytes);
            let ex = extract(alloc, &path, &text);
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
            PerFile { i, u, fatal: ex.fatal, unreadable: false }
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
    let per: Vec<_> = per
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
            PerFileOut { i, u: std::mem::take(&mut p.u), fatal: p.fatal, unreadable: p.unreadable }
        })
        .collect();

    let mut st = Stats { files: files.len(), ..Stats::default() };
    let w = |e: std::io::Error| format!("write: {e}");
    let mut buf = std::io::BufWriter::with_capacity(1 << 20, out);
    writeln!(buf, "pulsar-facts 0").map_err(w)?;
    writeln!(buf, "N {}", files.len()).map_err(w)?;
    for (id, rel) in files.iter().enumerate() {
        let prod = is_prod(rel);
        st.prod += prod as usize;
        writeln!(buf, "F {id} {}", prod as u8).map_err(w)?;
    }
    for (id, rel) in files.iter().enumerate() {
        let k = stable_key(rel);
        writeln!(buf, "K {id} {} {}", k >> 32, k & 0xffff_ffff).map_err(w)?;
    }
    for (src, p) in per.iter().enumerate() {
        st.fatal += p.fatal as usize;
        st.unreadable += p.unreadable as usize;
        for (dst, form, hv, ht) in &p.i {
            writeln!(buf, "I {src} {dst} {form} {hv} {ht}").map_err(w)?;
            st.i_facts += 1;
        }
    }
    for (src, p) in per.iter().enumerate() {
        for r in &p.u {
            writeln!(buf, "U {src} {r}").map_err(w)?;
            st.u_facts += 1;
        }
    }
    buf.flush().map_err(w)?;
    let prod = st.prod;
    Ok((FactSet { files, prod }, st))
}

/// Side table: one repo-relative path per line, in id order.
pub fn write_paths(files: &[String], path: &Path) -> Result<(), String> {
    let mut s = String::with_capacity(files.iter().map(|f| f.len() + 1).sum());
    for f in files {
        s.push_str(f);
        s.push('\n');
    }
    std::fs::write(path, s).map_err(|e| format!("{}: {e}", path.display()))
}
