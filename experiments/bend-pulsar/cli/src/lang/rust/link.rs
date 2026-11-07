//! Call edges: turn the call keys the walker left in `FileFns.names` into edges to repo
//! functions. A path call is resolved through the module trees to a file and then to a function
//! by its `.fns` chain; `self.m()` and `Self::m()` look in the same impl. A call that leaves the
//! repo is dropped; one that should resolve and does not becomes a `CU` row with a reason.

use super::calls::{KEY_SEP, SEG_SEP};
use super::graph::{Modules, Resolved};
use super::parse::RustFile;
use crate::lang::functions::{unres, Callee, SiteKind};
use std::collections::HashMap;

/// How the edges came out, for the stderr line.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EdgeStats {
    pub resolved: usize,
    pub external: usize,
    /// Unresolved calls by `CU` reason 1 to 4 (index 0 is unused).
    pub unresolved: [usize; 5],
}

/// Function chains of one file: chain -> local indices, in order.
fn chain_table(f: &RustFile) -> HashMap<&str, Vec<u32>> {
    let mut t: HashMap<&str, Vec<u32>> = HashMap::new();
    for (i, r) in f.fns.fns.iter().enumerate() {
        t.entry(r.chain.as_str()).or_default().push(i as u32);
    }
    t
}

enum Outcome {
    Edge(u32, u32),
    External,
    Unresolved(u8),
}

/// Link every edge of every file. `files` is `(global id, path)` aligned with `parsed`.
pub fn link_edges(files: &[(u32, String)], parsed: &mut [RustFile], modules: &Modules) -> EdgeStats {
    let tables: Vec<HashMap<&str, Vec<u32>>> = parsed.iter().map(chain_table).collect();
    let index: HashMap<u32, usize> = files.iter().enumerate().map(|(i, (id, _))| (*id, i)).collect();
    let mut stats = EdgeStats::default();
    let mut decided: Vec<Vec<Option<Outcome>>> = Vec::new();
    for (pi, f) in parsed.iter().enumerate() {
        let file = files[pi].0;
        let row = f
            .fns
            .sites
            .iter()
            .map(|s| match &s.kind {
                SiteKind::Edge { to: Callee::Local(k), .. } => {
                    Some(decide(&f.fns.names[*k as usize], file, modules, &index, &tables, pi, f))
                }
                _ => None,
            })
            .collect();
        decided.push(row);
    }
    for (pi, f) in parsed.iter_mut().enumerate() {
        let mut keep = Vec::with_capacity(f.fns.sites.len());
        let mut unresolved = Vec::new();
        for (site, d) in std::mem::take(&mut f.fns.sites).into_iter().zip(&decided[pi]) {
            match d {
                None => keep.push(site),
                Some(Outcome::Edge(file, fn_local)) => {
                    stats.resolved += 1;
                    let mut site = site;
                    if let SiteKind::Edge { to, .. } = &mut site.kind {
                        *to = Callee::Resolved { file: *file, fn_local: *fn_local };
                    }
                    keep.push(site);
                }
                Some(Outcome::External) => stats.external += 1,
                Some(Outcome::Unresolved(r)) => {
                    stats.unresolved[*r as usize] += 1;
                    unresolved.push((site.fn_local, *r));
                }
            }
        }
        f.fns.sites = keep;
        f.fns.unresolved.extend(unresolved);
    }
    stats
}

fn decide(
    key: &str,
    file: u32,
    modules: &Modules,
    index: &HashMap<u32, usize>,
    tables: &[HashMap<&str, Vec<u32>>],
    pi: usize,
    f: &RustFile,
) -> Outcome {
    let parts: Vec<&str> = key.split(KEY_SEP).collect();
    let segs = |s: &str| -> Vec<String> { s.split(SEG_SEP).filter(|x| !x.is_empty()).map(String::from).collect() };
    match parts.as_slice() {
        ["P", mod_path, path] => match modules.resolve(file, &segs(mod_path), &segs(path)) {
            Resolved::External => Outcome::External,
            Resolved::NotFound => Outcome::Unresolved(unres::NOT_FOUND),
            Resolved::Found { file: target, inline, rest } => {
                let Some(&ti) = index.get(&target) else { return Outcome::Unresolved(unres::NOT_FOUND) };
                lookup(&tables[ti], target, &inline, &rest)
            }
        },
        ["S", prefix, name] => self_target(&tables[pi], file, prefix, name, f),
        _ => Outcome::Unresolved(unres::DYNAMIC),
    }
}

/// A function of the target module by its chain: `f`, or `Type>method` (inherent), or the one
/// trait impl of `Type` that defines `method`.
fn lookup(table: &HashMap<&str, Vec<u32>>, file: u32, inline: &[String], rest: &[String]) -> Outcome {
    let prefix = inline.join(">");
    let join = |tail: String| if prefix.is_empty() { tail } else { format!("{prefix}>{tail}") };
    match rest {
        [f] => first(table, &join(f.clone()), file, unres::NOT_FOUND),
        [t, m] => {
            let direct = join(format!("{t}>{m}"));
            if table.contains_key(direct.as_str()) {
                return first(table, &direct, file, unres::UNKNOWN_MEMBER);
            }
            trait_impl(table, &join(t.clone()), m, file)
        }
        [] => Outcome::Unresolved(unres::NOT_FOUND),
        _ => Outcome::Unresolved(unres::UNKNOWN_MEMBER),
    }
}

fn first(table: &HashMap<&str, Vec<u32>>, chain: &str, file: u32, miss: u8) -> Outcome {
    match table.get(chain).and_then(|v| v.first()) {
        Some(&l) => Outcome::Edge(file, l),
        None => Outcome::Unresolved(miss),
    }
}

/// The unique `Type as Trait>method` of the file, when no inherent method has that name.
fn trait_impl(table: &HashMap<&str, Vec<u32>>, type_chain: &str, method: &str, file: u32) -> Outcome {
    let start = format!("{type_chain} as ");
    let end = format!(">{method}");
    let hits: Vec<&&str> = table.keys().filter(|k| k.starts_with(&start) && k.ends_with(&end)).collect();
    match hits.as_slice() {
        [one] => first(table, one, file, unres::UNKNOWN_MEMBER),
        _ => Outcome::Unresolved(unres::UNKNOWN_MEMBER),
    }
}

/// `self.m()` and `Self::m()` inside the impl whose container chain is `prefix`.
fn self_target(table: &HashMap<&str, Vec<u32>>, file: u32, prefix: &str, name: &str, _f: &RustFile) -> Outcome {
    let owner = prefix.split(" as ").next().unwrap_or(prefix);
    let inherent = format!("{owner}>{name}");
    if table.contains_key(inherent.as_str()) {
        return first(table, &inherent, file, unres::UNKNOWN_MEMBER);
    }
    let exact = format!("{prefix}>{name}");
    if table.contains_key(exact.as_str()) {
        return first(table, &exact, file, unres::UNKNOWN_MEMBER);
    }
    trait_impl(table, owner, name, file)
}
