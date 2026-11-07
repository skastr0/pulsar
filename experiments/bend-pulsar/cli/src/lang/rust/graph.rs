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

/// What a `use` path is resolved against.
struct Env<'a> {
    tree: usize,
    roots: &'a [usize],
    lib_root_of: &'a HashMap<String, usize>,
    dep_names: &'a HashSet<String>,
}

struct Build<'a> {
    files: &'a HashMap<&'a str, u32>,
    paths: &'a HashMap<u32, &'a str>,
    parsed: &'a HashMap<u32, &'a RustFile>,
    nodes: Vec<Node>,
    /// `(file -> node)` of each file's top module, per tree.
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

    fn inline_node(&mut self, at: usize, file: u32, name: &str) {
        let dir = join_norm(&self.nodes[at].dir, name);
        let idx = self.nodes.len();
        self.nodes.push(Node { file, parent: Some(at), children: HashMap::new(), dir: dir.clone(), base_dir: dir });
        self.nodes[at].children.insert(name.to_string(), idx);
    }

    /// Follow inline module names down from `from`; `None` if one is missing.
    fn descend_inline(&self, from: usize, names: &[String]) -> Option<usize> {
        names.iter().try_fold(from, |at, n| self.nodes[at].children.get(n).copied())
    }

    /// Candidate files for `mod x;` inside module node `at`, each with "loaded by `#[path]`".
    fn candidates(&self, at: usize, decl: &ModDecl) -> Vec<(String, bool)> {
        let n = &self.nodes[at];
        match &decl.path_attr {
            Some(p) => vec![(join_norm(&n.base_dir, p), true)],
            None => vec![
                (join_norm(&n.dir, &format!("{}.rs", decl.name)), false),
                (join_norm(&n.dir, &format!("{}/mod.rs", decl.name)), false),
            ],
        }
    }

    fn find_file(&self, cands: &[(String, bool)]) -> Option<(u32, bool)> {
        cands.iter().find_map(|(c, a)| self.files.get(c.as_str()).map(|&f| (f, *a)))
    }

    fn mark_test(&mut self, file: u32, test: bool) {
        if test {
            self.test_files.insert(file);
        } else {
            self.non_test_files.insert(file);
        }
    }

    fn walk(&mut self, tree: usize, node: usize, test: bool) {
        let file = self.nodes[node].file;
        let parsed = self.parsed;
        let Some(pf) = parsed.get(&file).copied() else { return };
        for decl in &pf.mods {
            self.walk_decl(tree, node, decl, test);
        }
    }

    fn walk_decl(&mut self, tree: usize, node: usize, decl: &ModDecl, test: bool) {
        let file = self.nodes[node].file;
        let Some(at) = self.descend_inline(node, &decl.mod_path) else { return };
        if decl.inline {
            self.inline_node(at, file, &decl.name);
            return;
        }
        let cands = self.candidates(at, decl);
        let Some((fid, by_attr)) = self.find_file(&cands) else {
            self.unresolved += 1;
            return;
        };
        if self.tops[tree].contains_key(&fid) {
            return; // already in this tree: a `#[path]` loop or a shared file
        }
        let t = test || decl.test;
        let child = self.file_node(tree, fid, Some(at), by_attr);
        self.nodes[at].children.insert(decl.name.clone(), child);
        self.mark_test(fid, t);
        self.walk(tree, child, t);
    }

    /// One tree per target; returns the root node of each (`usize::MAX` if the root is not a file).
    fn build_trees(&mut self, crates: &Crates) -> Vec<usize> {
        let mut roots = vec![usize::MAX; crates.targets.len()];
        for (ti, t) in crates.targets.iter().enumerate() {
            let Some(&fid) = self.files.get(t.root.as_str()) else { continue };
            let root = self.file_node(ti, fid, None, false);
            roots[ti] = root;
            self.non_test_files.insert(fid);
            self.walk(ti, root, false);
        }
        roots
    }

    // ---- use resolution ---------------------------------------------------------------

    fn descend(&self, mut cur: usize, rest: &[String]) -> usize {
        for seg in rest {
            match self.nodes[cur].children.get(seg) {
                Some(&c) => cur = c,
                None => break,
            }
        }
        cur
    }

    /// `super::super::x`: climb one parent per leading `super`.
    fn supers<'s>(&self, start: usize, segs: &'s [String]) -> Result<(usize, &'s [String]), u32> {
        let n = segs.iter().take_while(|s| s.as_str() == "super").count();
        let mut at = start;
        for _ in 0..n {
            at = self.nodes[at].parent.ok_or(1u32)?;
        }
        Ok((at, &segs[n..]))
    }

    /// A first segment that is a bare name: a child module in scope, a workspace lib, or outside.
    fn named_start<'s>(&self, env: &Env, start: usize, segs: &'s [String]) -> Result<(usize, &'s [String]), u32> {
        let name = segs[0].as_str();
        if let Some(&c) = self.nodes[start].children.get(name) {
            return Ok((c, &segs[1..]));
        }
        let declared = env.dep_names.contains(name);
        if let Some(&r) = env.lib_root_of.get(name).filter(|_| declared) {
            return Ok((r, &segs[1..]));
        }
        if declared || matches!(name, "std" | "core" | "alloc" | "proc_macro" | "test") {
            return Err(0);
        }
        Err(3)
    }

    fn resolve(&self, env: &Env, start: usize, u: &UseRec) -> Result<u32, u32> {
        let segs = &u.segs;
        let Some(first) = segs.first() else { return Ok(self.nodes[start].file) };
        let (cur, rest) = if u.leading_colon {
            let r = env.lib_root_of.get(first).ok_or(0u32)?;
            (*r, &segs[1..])
        } else {
            match first.as_str() {
                "crate" => (env.roots[env.tree], &segs[1..]),
                "self" => (start, &segs[1..]),
                "super" => self.supers(start, segs)?,
                _ => self.named_start(env, start, segs)?,
            }
        };
        Ok(self.nodes[self.descend(cur, rest)].file)
    }

    /// Resolve every `use` of every file in tree `ti`, pushing `I` and `U` rows.
    fn resolve_tree(&self, env: &Env, g: &mut Graph) {
        for (&file, &top) in &self.tops[env.tree] {
            let Some(pf) = self.parsed.get(&file) else { continue };
            for u in &pf.uses {
                let at = self.descend_inline(top, &u.mod_path).unwrap_or(top);
                match self.resolve(env, at, u) {
                    Ok(dst) => g.i.push([file, dst, if u.public { 2 } else { 0 }, 1, 0]),
                    Err(reason) => g.u.push([file, reason]),
                }
            }
        }
    }

    /// A package's lib and bin roots depend on its member dependencies' libs.
    fn crate_edges(&self, crates: &Crates, roots: &[usize], g: &mut Graph) {
        for (ti, t) in crates.targets.iter().enumerate() {
            if !(t.is_lib || t.is_bin) || roots[ti] == usize::MAX {
                continue;
            }
            let src = self.nodes[roots[ti]].file;
            for &d in &crates.packages[t.package].member_deps {
                let libs = crates.targets.iter().enumerate().filter(|(dj, dt)| dt.package == d && dt.is_lib && roots[*dj] != usize::MAX);
                for (dj, _) in libs {
                    g.i.push([src, self.nodes[roots[dj]].file, 1, 1, 0]);
                }
            }
        }
    }
}

/// Lib root node per crate name, for `use member_crate::...`.
fn lib_roots(crates: &Crates, roots: &[usize]) -> HashMap<String, usize> {
    let mut out = HashMap::new();
    for (ti, t) in crates.targets.iter().enumerate() {
        if t.is_lib && roots[ti] != usize::MAX {
            out.entry(t.crate_name.clone()).or_insert(roots[ti]);
        }
    }
    out
}

/// Build the trees and resolve every `use`. `files` maps a repo-relative path to its file id;
/// `parsed` holds the extracted file for each id.
pub fn build(crates: &Crates, files: &HashMap<&str, u32>, parsed: &HashMap<u32, &RustFile>) -> Graph {
    let paths: HashMap<u32, &str> = files.iter().map(|(p, &i)| (i, *p)).collect();
    let mut b = Build {
        files,
        paths: &paths,
        parsed,
        nodes: Vec::new(),
        tops: vec![HashMap::new(); crates.targets.len()],
        test_files: HashSet::new(),
        non_test_files: HashSet::new(),
        unresolved: 0,
    };
    let roots = b.build_trees(crates);
    let lib_root_of = lib_roots(crates, &roots);
    // A file also reached outside a cfg(test) mod is not test-only.
    let test_files: HashSet<u32> = b.test_files.difference(&b.non_test_files).copied().collect();
    let mut g = Graph { test_files, unresolved_mods: b.unresolved, ..Graph::default() };

    let mut reached: HashSet<u32> = HashSet::new();
    for (ti, t) in crates.targets.iter().enumerate() {
        if roots[ti] == usize::MAX {
            continue;
        }
        let env = Env { tree: ti, roots: &roots, lib_root_of: &lib_root_of, dep_names: &crates.packages[t.package].dep_names };
        let mut tree_files: Vec<u32> = b.tops[ti].keys().copied().collect();
        tree_files.sort_unstable();
        reached.extend(&tree_files);
        g.trees.push((t.root.clone(), tree_files));
        b.resolve_tree(&env, &mut g);
    }
    b.crate_edges(crates, &roots, &mut g);
    g.orphans = files.values().filter(|f| !reached.contains(f)).count();
    g
}
