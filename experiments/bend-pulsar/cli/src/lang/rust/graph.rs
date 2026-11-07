//! The module tree and `use` resolution. One tree per cargo target: the root file, then every
//! `mod x;` followed to its file (default layout, `mod.rs`, `#[path]`) and every inline
//! `mod x { }` as a node in the same file. A `use` path is resolved lexically:
//! `crate`, `self`, `super`, a child module in scope, or the name of a workspace member's lib.
//! The longest module prefix names the target file; whatever follows is an item inside it.
//!
//! `mod` declarations are not edges (they define the tree). `use` statements are: form 0, or
//! form 2 for a re-export (any visibility other than inherited). `hv` is always 1 and `ht`
//! always 0: whether a name is used as a value or only as a type is a type-checker question,
//! so the adapter does not guess. Paths that leave the repo are `U` reason 0; a path whose first
//! segment names nothing in scope is reason 3.

use super::cargo::Crates;
use super::parse::{ModDecl, RustFile, UseRec};
use std::collections::{HashMap, HashSet};

struct Node {
    file: u32,
    parent: Option<usize>,
    children: HashMap<String, usize>,
    /// Where out-of-line children are looked up by default.
    dir: String,
    /// Base for `#[path]` attributes.
    base_dir: String,
}

#[derive(Default)]
pub struct Graph {
    /// `(src, dst, form, hv, ht)`.
    pub i: Vec<[u32; 5]>,
    /// `(src, reason)`.
    pub u: Vec<[u32; 2]>,
    /// Files only reachable through `#[cfg(test)] mod x;`.
    pub test_files: HashSet<u32>,
    pub unresolved_mods: usize,
    pub orphans: usize,
    /// Per target: its root path and every file in its module tree, ascending. For the oracle
    /// diff against rustc's dep-info.
    pub trees: Vec<(String, Vec<u32>)>,
}

fn dirname(p: &str) -> &str {
    p.rfind('/').map_or("", |i| &p[..i])
}

fn join_norm(dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = if dir.is_empty() { vec![] } else { dir.split('/').collect() };
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

struct Build<'a> {
    files: &'a HashMap<&'a str, u32>,
    paths: &'a HashMap<u32, &'a str>,
    parsed: &'a HashMap<u32, &'a RustFile>,
    nodes: Vec<Node>,
    /// `(file, node)` of each file's top module, per tree: `tops[tree]`.
    tops: Vec<HashMap<u32, usize>>,
    test_files: HashSet<u32>,
    non_test_files: HashSet<u32>,
    unresolved: usize,
}

impl Build<'_> {
    fn file_node(&mut self, tree: usize, file: u32, parent: Option<usize>, loaded_by_path_attr: bool) -> usize {
        let path = self.paths[&file];
        let d = dirname(path).to_string();
        let name = path.rsplit('/').next().unwrap_or(path);
        let is_root_like = parent.is_none() || loaded_by_path_attr || name == "mod.rs";
        let dir = if is_root_like { d.clone() } else { join_norm(&d, name.trim_end_matches(".rs")) };
        let idx = self.nodes.len();
        self.nodes.push(Node { file, parent, children: HashMap::new(), dir, base_dir: d });
        self.tops[tree].insert(file, idx);
        idx
    }

    fn walk(&mut self, tree: usize, node: usize, test: bool) {
        let file = self.nodes[node].file;
        let Some(pf) = self.parsed.get(&file).copied() else { return };
        let decls: &[ModDecl] = &pf.mods;
        for decl in decls {
            // Find the module node this declaration sits in: descend by inline names.
            let mut at = node;
            let mut ok = true;
            for seg in &decl.mod_path {
                match self.nodes[at].children.get(seg) {
                    Some(&c) => at = c,
                    None => {
                        ok = false;
                        break;
                    }
                }
            }
            if !ok {
                continue;
            }
            let t = test || decl.test;
            if decl.inline {
                let dir = join_norm(&self.nodes[at].dir, &decl.name);
                let idx = self.nodes.len();
                self.nodes.push(Node { file, parent: Some(at), children: HashMap::new(), dir: dir.clone(), base_dir: dir });
                self.nodes[at].children.insert(decl.name.clone(), idx);
                continue;
            }
            let cands: Vec<(String, bool)> = match &decl.path_attr {
                Some(p) => vec![(join_norm(&self.nodes[at].base_dir, p), true)],
                None => {
                    let d = &self.nodes[at].dir;
                    vec![
                        (join_norm(d, &format!("{}.rs", decl.name)), false),
                        (join_norm(d, &format!("{}/mod.rs", decl.name)), false),
                    ]
                }
            };
            let Some((fid, by_attr)) = cands
                .iter()
                .find_map(|(c, a)| self.files.get(c.as_str()).map(|&f| (f, *a)))
            else {
                self.unresolved += 1;
                continue;
            };
            if self.tops[tree].contains_key(&fid) {
                continue; // already in this tree: a `#[path]` loop or a shared file
            }
            let child = self.file_node(tree, fid, Some(at), by_attr);
            self.nodes[at].children.insert(decl.name.clone(), child);
            if t {
                self.test_files.insert(fid);
            } else {
                self.non_test_files.insert(fid);
            }
            self.walk(tree, child, t);
        }
    }

    fn resolve(&self, tree: usize, roots: &[usize], lib_root_of: &HashMap<String, usize>, start: usize, u: &UseRec, dep_names: &HashSet<String>) -> Result<u32, u32> {
        let segs = &u.segs;
        let Some(first) = segs.first() else { return Ok(self.nodes[start].file) };
        let (mut cur, rest): (usize, &[String]) = if u.leading_colon {
            match lib_root_of.get(first) {
                Some(&r) => (r, &segs[1..]),
                None => return Err(0),
            }
        } else {
            match first.as_str() {
                "crate" => (roots[tree], &segs[1..]),
                "self" => (start, &segs[1..]),
                "super" => {
                    let mut at = start;
                    let mut n = 0;
                    while n < segs.len() && segs[n] == "super" {
                        match self.nodes[at].parent {
                            Some(p) => at = p,
                            None => return Err(1),
                        }
                        n += 1;
                    }
                    (at, &segs[n..])
                }
                name => {
                    if let Some(&c) = self.nodes[start].children.get(name) {
                        (c, &segs[1..])
                    } else if let Some(&r) = lib_root_of.get(name).filter(|_| dep_names.contains(name)) {
                        (r, &segs[1..])
                    } else if dep_names.contains(name) || matches!(name, "std" | "core" | "alloc" | "proc_macro" | "test") {
                        return Err(0);
                    } else {
                        return Err(3);
                    }
                }
            }
        };
        for seg in rest {
            match self.nodes[cur].children.get(seg) {
                Some(&c) => cur = c,
                None => break,
            }
        }
        Ok(self.nodes[cur].file)
    }
}

/// Build the trees and resolve every `use`. `files` maps a repo-relative path to its file id;
/// `parsed` holds the extracted file for each id.
pub fn build(crates: &Crates, files: &HashMap<&str, u32>, parsed: &HashMap<u32, &RustFile>) -> Graph {
    let paths: HashMap<u32, &str> = files.iter().map(|(p, &i)| (i, *p)).collect();
    let n_targets = crates.targets.len();
    let mut b = Build {
        files,
        paths: &paths,
        parsed,
        nodes: Vec::new(),
        tops: vec![HashMap::new(); n_targets],
        test_files: HashSet::new(),
        non_test_files: HashSet::new(),
        unresolved: 0,
    };
    let mut roots = vec![usize::MAX; n_targets];
    for (ti, t) in crates.targets.iter().enumerate() {
        let Some(&fid) = files.get(t.root.as_str()) else { continue };
        let root = b.file_node(ti, fid, None, false);
        roots[ti] = root;
        b.non_test_files.insert(fid);
        b.walk(ti, root, false);
    }
    // Lib root node per crate name, for `use member_crate::...`.
    let mut lib_root_of: HashMap<String, usize> = HashMap::new();
    for (ti, t) in crates.targets.iter().enumerate() {
        if t.is_lib && roots[ti] != usize::MAX {
            lib_root_of.entry(t.crate_name.clone()).or_insert(roots[ti]);
        }
    }
    // A file also reached outside a cfg(test) mod is not test-only.
    let test_files: HashSet<u32> = b.test_files.difference(&b.non_test_files).copied().collect();

    let mut g = Graph { test_files, unresolved_mods: b.unresolved, ..Graph::default() };
    let mut reached: HashSet<u32> = HashSet::new();
    for (ti, t) in crates.targets.iter().enumerate() {
        if roots[ti] == usize::MAX {
            continue;
        }
        let dep_names = &crates.packages[t.package].dep_names;
        let tops: Vec<(u32, usize)> = b.tops[ti].iter().map(|(f, n)| (*f, *n)).collect();
        let mut tree_files: Vec<u32> = tops.iter().map(|(f, _)| *f).collect();
        tree_files.sort_unstable();
        g.trees.push((t.root.clone(), tree_files));
        for (file, top) in tops {
            reached.insert(file);
            let Some(pf) = parsed.get(&file) else { continue };
            for u in &pf.uses {
                // Descend to the module the statement sits in.
                let mut at = top;
                for seg in &u.mod_path {
                    if let Some(&c) = b.nodes[at].children.get(seg) {
                        at = c;
                    }
                }
                match b.resolve(ti, &roots, &lib_root_of, at, u, dep_names) {
                    Ok(dst) => {
                        let form = if u.public { 2 } else { 0 };
                        g.i.push([file, dst, form, 1, 0]);
                    }
                    Err(reason) => g.u.push([file, reason]),
                }
            }
        }
    }
    // Crate-level edges: a package's lib and bin roots depend on its member dependencies' libs.
    for (ti, t) in crates.targets.iter().enumerate() {
        if !(t.is_lib || t.is_bin) || roots[ti] == usize::MAX {
            continue;
        }
        let src = b.nodes[roots[ti]].file;
        for &d in &crates.packages[t.package].member_deps {
            for (dj, dt) in crates.targets.iter().enumerate() {
                if dt.package == d && dt.is_lib && roots[dj] != usize::MAX {
                    g.i.push([src, b.nodes[roots[dj]].file, 1, 1, 0]);
                }
            }
        }
    }
    g.orphans = files.values().filter(|f| !reached.contains(f)).count();
    g
}
