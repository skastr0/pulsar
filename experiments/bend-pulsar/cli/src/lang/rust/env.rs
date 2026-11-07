//! The Rust lane's catalog environment and the pre-pass over a file's `use` items: the symbols the
//! active catalogs know, the crate names a path may start with, the names each module's `use`
//! binds, and the shapes the walker passes around (handler bodies). Nothing here touches the
//! walker, so `parse.rs` can use it without a cycle.

use super::cargo::Crates;
use crate::catalog::{self, Catalog, Scope, Via};
use std::collections::{HashMap, HashSet};
use syn::visit::{self, Visit};
use syn::{Expr, Item, ItemMod, ItemUse, Pat, Stmt, UseTree};

/// `CS.ctx` bit: the method call matched a `syntax#method.<name>` entry by name only.
pub const NAME_ONLY: u8 = 64;

/// The symbols and classes of the active catalogs, and what the repo's crates are called.
#[derive(Debug, Default)]
pub struct CallEnv {
    /// symbol -> class ids (sorted, unique).
    syms: HashMap<String, Vec<u32>>,
    /// Crate names a path may start with: workspace members and every declared dependency.
    crates: HashSet<String>,
    /// `foo = { package = "bar" }`: the name used in source -> the package's real name.
    renames: HashMap<String, String>,
}

impl CallEnv {
    pub fn new(catalogs: &[&Catalog], crates: HashSet<String>, renames: HashMap<String, String>) -> CallEnv {
        let mut syms: HashMap<String, Vec<u32>> = HashMap::new();
        for c in catalogs {
            let ids: HashMap<&str, u32> = c.classes.iter().map(|k| (k.class.as_str(), k.id)).collect();
            for s in &c.symbols {
                let (Some(&class), true) = (ids.get(s.class.as_str()), matches!(s.via, None | Some(Via::Call))) else {
                    continue;
                };
                let v = syms.entry(s.sym.clone()).or_default();
                if !v.contains(&class) {
                    v.push(class);
                    v.sort_unstable();
                }
            }
        }
        CallEnv { syms, crates, renames }
    }

    pub fn classes(&self, sym: &str) -> Option<&Vec<u32>> {
        self.syms.get(sym)
    }

    /// Every symbol's classes, for the driver's `CL` rows.
    pub fn symbol_classes(&self) -> &HashMap<String, Vec<u32>> {
        &self.syms
    }

    pub(super) fn is_crate(&self, name: &str) -> bool {
        self.crates.contains(name) || self.renames.contains_key(name)
    }

    /// The canonical crate name: a rename mapped back, `core` and `alloc` read as `std`.
    pub(super) fn canonical(&self, name: &str) -> String {
        match self.renames.get(name).map(String::as_str).unwrap_or(name) {
            "core" | "alloc" => "std".to_string(),
            other => other.replace('-', "_"),
        }
    }
}

/// What the module scan found: `use` bindings and constants with a literal value.
#[derive(Debug, Default)]
pub struct Scan {
    /// `(module path, local name)` -> the full path that name stands for.
    pub uses: HashMap<(Vec<String>, String), Vec<String>>,
    /// `(module path, name)` of every `const` or `static` initialised with a literal.
    pub consts: HashSet<(Vec<String>, String)>,
}

/// The `use` items of every module in a file, collected before the walk so a `use` below the
/// code that needs it still resolves.
pub fn scan_uses(file: &syn::File) -> Scan {
    let mut s = UseScan { mod_path: Vec::new(), scan: Scan::default() };
    s.visit_file(file);
    s.scan
}

struct UseScan {
    mod_path: Vec<String>,
    scan: Scan,
}

impl<'a> Visit<'a> for UseScan {
    fn visit_item_mod(&mut self, n: &'a ItemMod) {
        let Some((_, items)) = &n.content else { return };
        self.mod_path.push(n.ident.to_string());
        for item in items {
            self.visit_item(item);
        }
        self.mod_path.pop();
    }

    fn visit_item_use(&mut self, n: &'a ItemUse) {
        for (segs, local) in named_leaves(&n.tree) {
            if let Some(name) = local {
                self.scan.uses.insert((self.mod_path.clone(), name), segs);
            }
        }
    }

    fn visit_item_const(&mut self, n: &'a syn::ItemConst) {
        if matches!(&*n.expr, Expr::Lit(_)) {
            self.scan.consts.insert((self.mod_path.clone(), n.ident.to_string()));
        }
    }

    fn visit_item_static(&mut self, n: &'a syn::ItemStatic) {
        if matches!(&*n.expr, Expr::Lit(_)) && matches!(n.mutability, syn::StaticMutability::None) {
            self.scan.consts.insert((self.mod_path.clone(), n.ident.to_string()));
        }
    }

    fn visit_item(&mut self, n: &'a Item) {
        visit::visit_item(self, n);
    }
}

/// `use` leaves with the name each binds: `use a::b as c` is `([a, b], Some(c))`, a glob binds none.
pub fn named_leaves(tree: &UseTree) -> Vec<(Vec<String>, Option<String>)> {
    let mut out = Vec::new();
    walk_leaves(tree, &mut Vec::new(), &mut out);
    out
}

fn walk_leaves(tree: &UseTree, prefix: &mut Vec<String>, out: &mut Vec<(Vec<String>, Option<String>)>) {
    match tree {
        UseTree::Path(p) => {
            prefix.push(p.ident.to_string());
            walk_leaves(&p.tree, prefix, out);
            prefix.pop();
        }
        UseTree::Name(n) => out.push(leaf(prefix, &n.ident.to_string(), None)),
        UseTree::Rename(r) => out.push(leaf(prefix, &r.ident.to_string(), Some(r.rename.to_string()))),
        UseTree::Glob(_) => out.push((prefix.clone(), None)),
        UseTree::Group(g) => g.items.iter().for_each(|t| walk_leaves(t, prefix, out)),
    }
}

fn leaf(prefix: &[String], ident: &str, rename: Option<String>) -> (Vec<String>, Option<String>) {
    let mut segs = prefix.to_vec();
    if ident != "self" {
        segs.push(ident.to_string());
    }
    let local = rename.or_else(|| segs.last().cloned());
    (segs, local)
}

/// Macros of the standard prelude, which need no `use`.
pub(super) const PRELUDE_MACROS: [&str; 16] = [
    "assert", "assert_eq", "assert_ne", "dbg", "eprint", "eprintln", "format", "matches", "panic", "print", "println",
    "todo", "unimplemented", "unreachable", "vec", "write",
];

/// The catalogs the Rust lane ships: `rust-core` always, packs when a `Cargo.toml` of the repo
/// lists a dependency their `activate` names.
const SHIPPED: [(&str, &str); 1] = [("rust-core", include_str!("catalog/rust-core.toml"))];

/// Build the call environment for a repo: the active catalogs, the crate names a path may start
/// with, and the crate renames. Returns the ids of the catalogs that are on.
pub fn env_for(root: &std::path::Path, crates: &Crates) -> Result<(CallEnv, Vec<String>), String> {
    let deps: HashSet<String> = crates.packages.iter().flat_map(|p| p.dep_names.iter().cloned()).collect();
    let mut loaded = Vec::new();
    for (name, text) in SHIPPED {
        let l = catalog::load(name, text)?;
        let on = match l.catalog.scope {
            Scope::Lane | Scope::Repo => true,
            Scope::Pack => l
                .catalog
                .activate
                .iter()
                .flatten()
                .filter_map(|a| a.strip_prefix("dep:"))
                .any(|d| deps.contains(&d.replace('-', "_"))),
        };
        if on {
            loaded.push(l);
        }
    }
    loaded.extend(repo_catalogs(root)?);
    let ids = loaded.iter().map(|l| l.catalog.id.clone()).collect();
    let refs: Vec<&Catalog> = loaded.iter().map(|l| &l.catalog).collect();
    let mut names = deps;
    names.extend(crates.packages.iter().map(|p| p.name.replace('-', "_")));
    let renames = crates.packages.iter().flat_map(|p| p.renames.iter().cloned()).collect();
    Ok((CallEnv::new(&refs, names, renames), ids))
}

/// The body of a handler: a block's statements or a single expression.
#[derive(Clone, Copy)]
pub enum Body<'a> {
    Stmts(&'a [Stmt]),
    Expr(&'a Expr),
}

/// A handler whose site is already in the file's site list but whose shape waits for its body.
#[derive(Debug)]
pub struct OpenHandler {
    pub(super) site: usize,
    /// Index of the first call site emitted inside the body.
    pub(super) first: usize,
    pub(super) binds: Vec<String>,
}

/// `Err(e)` or `Err(_)`: the names the pattern binds.
pub fn err_binds(p: &Pat) -> Option<Vec<String>> {
    let Pat::TupleStruct(t) = p else { return None };
    if t.path.segments.last()?.ident != "Err" {
        return None;
    }
    let mut names = Vec::new();
    t.elems.iter().for_each(|e| super::blocks::bindings(e, &mut names));
    Some(names)
}

/// `if let Err(e) = x`: the cond is exactly that `let`.
pub fn if_let_err_binds(cond: &Expr) -> Option<Vec<String>> {
    match cond {
        Expr::Let(l) => err_binds(&l.pat),
        Expr::Paren(p) => if_let_err_binds(&p.expr),
        _ => None,
    }
}

/// `<repo>/.pulsar/catalogs/*.toml`: the repo's own catalogs, always on, sorted by file name.
fn repo_catalogs(root: &std::path::Path) -> Result<Vec<catalog::Loaded>, String> {
    let Ok(rd) = std::fs::read_dir(root.join(".pulsar/catalogs")) else { return Ok(Vec::new()) };
    let mut paths: Vec<_> =
        rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "toml")).collect();
    paths.sort();
    let mut out = Vec::new();
    for p in paths {
        let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        let l = catalog::load(&format!(".pulsar/catalogs/{name}"), &text)?;
        if l.catalog.scope != Scope::Repo {
            return Err(format!(".pulsar/catalogs/{name}: repo catalogs use scope \"repo\""));
        }
        out.push(l);
    }
    Ok(out)
}
