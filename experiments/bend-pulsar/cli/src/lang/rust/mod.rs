//! Rust lane: files and crates from `cargo metadata`, the module tree and `use` graph, and
//! function and control-tree facts from one `syn` parse per file.
//!
//! The lane returns data, not fact lines: per-file [`FileFns`] with local ids, the test-code flags
//! (`TF`), and `I`/`U` rows over global file ids. The driver owns file ids, numbers functions in
//! file-id order and writes every row through `crate::facts::FactWriter`.

mod cargo;
mod graph;
mod parse;

use crate::lang::functions::FileFns;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::Path;

/// Whether this lane owns a tracked path.
pub fn owns(path: &str) -> bool {
    path.ends_with(".rs")
}

/// A function's span and stable key, for callers that parse a historical blob (CFN: lines a
/// commit touched inside each head function). Same walker as the head parse, so the key for
/// `key_path` is the key `FK` carries; pass the file's head path to follow renames. Same shape as
/// `lang::ts::extract::FnSpan`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FnSpan {
    pub key: u64,
    pub start_line: u32,
    pub end_line: u32,
}

/// Parse `source` and return its functions in id order (start offset). Test functions are
/// included, as in the `FN` rows. A file that does not parse yields an empty list.
pub fn function_spans(key_path: &str, source: &str) -> Vec<FnSpan> {
    let f = parse::extract(key_path, source, false);
    f.fns.fns.iter().map(|r| FnSpan { key: r.key, start_line: r.start_line, end_line: r.end_line }).collect()
}

/// Directory names whose files are never production code in any layout.
const NON_PROD_DIRS: [&str; 6] = ["tests", "test", "benches", "examples", "fixtures", "testdata"];

/// The Rust rule for the `F` prod flag, from the path alone: files under `tests/`, `test/`,
/// `benches/`, `examples/`, `fixtures/` or `testdata/`, and `build.rs` (build-time code, not what
/// ships). Files reachable only through `#[cfg(test)] mod x;` are also non-prod but only the
/// analysis can tell; they are folded in by [`analyze`] into [`Analysis::prod`].
pub fn is_prod(path: &str) -> bool {
    let mut segs = path.split('/');
    let file = segs.next_back().unwrap_or(path);
    file != "build.rs" && !segs.any(|s| NON_PROD_DIRS.contains(&s))
}

/// One file's function rows. `tests` holds local indices of test functions (`TF`).
#[derive(Debug, Default)]
pub struct FileOut {
    pub fns: FileFns,
    pub tests: Vec<u32>,
}

#[derive(Debug, Default)]
pub struct Stats {
    pub files: usize,
    pub failed_parse: usize,
    pub packages: usize,
    pub targets: usize,
    pub metadata_fallbacks: usize,
    pub unresolved_mods: usize,
    pub orphans: usize,
    pub i_facts: usize,
    pub u_facts: usize,
}

#[derive(Debug, Default)]
pub struct Analysis {
    /// Indexed like the `files` argument.
    pub per_file: Vec<FileOut>,
    /// `(src, dst, form, hv, ht)` over global file ids; sorted and deduped.
    pub i: Vec<[u32; 5]>,
    /// `(src, reason)`; sorted and deduped.
    pub u: Vec<[u32; 2]>,
    /// Per file, indexed like `files`: `Some(prod)` is the lane's decision (the path rule, and
    /// not reachable only through `#[cfg(test)] mod x;`); `None` would keep the driver's default.
    /// The driver writes `F` after the lanes run and lets policy globs override this.
    pub prod: Vec<Option<bool>>,
    /// Per target: root path and the file ids of its module tree.
    pub trees: Vec<(String, Vec<u32>)>,
    pub stats: Stats,
}

/// Analyse the Rust files of a repo. `files` is `(global file id, repo-relative path)` for every
/// `.rs` file the lane owns; `tracked` is every tracked path (to find `Cargo.toml` files).
pub fn analyze(root: &Path, files: &[(u32, String)], tracked: &[String]) -> Result<Analysis, String> {
    let pool = rayon::ThreadPoolBuilder::new()
        .stack_size(64 << 20)
        .build()
        .map_err(|e| format!("rust lane: thread pool: {e}"))?;
    let mut parsed: Vec<parse::RustFile> = pool.install(|| {
        files
            .par_iter()
            .map(|(_, rel)| match std::fs::read(root.join(rel)) {
                Ok(bytes) => parse::extract(rel, &String::from_utf8_lossy(&bytes), false),
                Err(_) => parse::RustFile { failed: true, ..parse::RustFile::default() },
            })
            .collect()
    });

    let path_ids: HashMap<&str, u32> = files.iter().map(|(id, p)| (p.as_str(), *id)).collect();
    let owned: std::collections::HashSet<&str> = files.iter().map(|(_, p)| p.as_str()).collect();
    let crates = cargo::discover(root, tracked, &owned);
    if let Some((first, why)) = crates.fallbacks.first() {
        // One line, not one per manifest: the graph is degraded (no crate edges, default target
        // layout only) and the reader must be able to see that.
        eprintln!(
            "pulsar: cargo metadata failed for {} Cargo.toml files (first: {first}: {why}); those crates use the conventional layout, with no crate-level edges",
            crates.fallbacks.len(),
        );
    }

    let by_id: HashMap<u32, &parse::RustFile> =
        files.iter().zip(parsed.iter()).map(|((id, _), pf)| (*id, pf)).collect();
    let g = graph::build(&crates, &path_ids, &by_id);

    // A file only reachable through `#[cfg(test)] mod x;` is test code from top to bottom.
    for ((id, _), pf) in files.iter().zip(parsed.iter_mut()) {
        if g.test_files.contains(id) {
            pf.tests = (0..pf.fns.fns.len() as u32).collect();
        }
    }

    let prod: Vec<Option<bool>> =
        files.iter().map(|(id, rel)| Some(is_prod(rel) && !g.test_files.contains(id))).collect();
    let (gi, gu, trees) = (g.i, g.u, g.trees);
    let mut i = gi;
    i.sort_unstable();
    i.dedup();
    let mut u = gu;
    u.sort_unstable();
    u.dedup();
    let stats = Stats {
        files: files.len(),
        failed_parse: parsed.iter().filter(|p| p.failed).count(),
        packages: crates.packages.len(),
        targets: crates.targets.len(),
        metadata_fallbacks: crates.fallbacks.len(),
        unresolved_mods: g.unresolved_mods,
        orphans: g.orphans,
        i_facts: i.len(),
        u_facts: u.len(),
    };
    let per_file = parsed.into_iter().map(|p| FileOut { fns: p.fns, tests: p.tests }).collect();
    Ok(Analysis { per_file, i, u, prod, trees, stats })
}

#[cfg(test)]
mod tests;
