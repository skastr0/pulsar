//! One `syn` walk per Rust file: function and control-tree rows, `use` statements and `mod`
//! declarations. The walk reports what the syntax says; the engine decides what counts.
//!
//! Naming follows FACTS.md `FK`: containers are inline modules, traits, impl blocks and
//! enclosing functions; an impl block is named `Type` (inherent) or `Type as Trait` (trait impl,
//! with the trait's generic arguments, so `From<A>` and `From<B>` stay apart). A closure is
//! anonymous and shown as `#<ordinal>`. Code inside macro invocations is a token stream and
//! emits nothing.

use crate::lang::functions::{ct, fk, fnv_parts, op, CoRec, CtRec, FileFns, FnRec};
use proc_macro2::{Span, TokenStream, TokenTree};
use std::collections::{HashMap, HashSet};
use syn::spanned::Spanned;
use syn::visit::{self, Visit};
use syn::*;

/// One `use` leaf: `use a::{b, c::d}` is two leaves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UseRec {
    /// Inline module names between the file's root module and the statement.
    pub mod_path: Vec<String>,
    /// Path segments, `self` stripped from the end. A glob leaf holds the segments before `*`.
    pub segs: Vec<String>,
    /// `use ::name::...`: the first segment is an extern crate name.
    pub leading_colon: bool,
    /// Any visibility other than inherited: a re-export (`I` form 2).
    pub public: bool,
    /// Under `#[cfg(test)]` or in a test function.
    pub test: bool,
}

/// One `mod` declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModDecl {
    pub name: String,
    pub mod_path: Vec<String>,
    /// `mod x { ... }`: the module lives in this file.
    pub inline: bool,
    /// `#[path = "..."]`.
    pub path_attr: Option<String>,
    pub test: bool,
}

#[derive(Debug, Default)]
pub struct RustFile {
    pub fns: FileFns,
    /// Local indices of functions that are test code (`TF`).
    pub tests: Vec<u32>,
    pub uses: Vec<UseRec>,
    pub mods: Vec<ModDecl>,
    /// The file did not parse; no rows came from it.
    pub failed: bool,
}

/// Parse and walk one file. `file_is_test` marks every function in it as test code (the file is
/// only reachable through a `#[cfg(test)] mod x;`).
pub fn extract(rel: &str, src: &str, file_is_test: bool) -> RustFile {
    let Ok(file) = syn::parse_file(src) else {
        return RustFile { failed: true, ..RustFile::default() };
    };
    let mut w = Walker::new(rel, src, file_is_test);
    w.visit_file(&file);
    RustFile { fns: w.out, tests: w.tests, uses: w.uses, mods: w.mods, failed: false }
}

struct Frame {
    local: u32,
    next_node: u32,
    /// Control parents, innermost last; 0 is the function body.
    stack: Vec<u32>,
}

struct Lines {
    /// `nonblank[k]` = non-blank lines among the first `k` lines.
    nonblank: Vec<u32>,
}

impl Lines {
    fn new(src: &str) -> Lines {
        let mut nonblank = vec![0u32];
        let mut count = 0;
        for line in src.split('\n') {
            if !line.trim().is_empty() {
                count += 1;
            }
            nonblank.push(count);
        }
        Lines { nonblank }
    }

    /// Non-blank lines in the 1-based inclusive range.
    fn loc(&self, start: u32, end: u32) -> u32 {
        let n = self.nonblank.len() as u32;
        let (s, e) = (start.clamp(1, n - 1), end.clamp(1, n - 1));
        self.nonblank[e as usize] - self.nonblank[s as usize - 1]
    }
}

struct Walker<'s> {
    rel: &'s str,
    lines: Lines,
    out: FileFns,
    tests: Vec<u32>,
    uses: Vec<UseRec>,
    mods: Vec<ModDecl>,
    frames: Vec<Frame>,
    /// Container chain, `>`-joined, and the same chain `0x1f`-joined for the key.
    prefix: String,
    key_prefix: Vec<u8>,
    marks: Vec<(usize, usize)>,
    counters: HashMap<u64, u32>,
    /// Inline modules between the root and here.
    mod_path: Vec<String>,
    /// >0 while inside `#[cfg(test)]` code or a test function.
    test_depth: u32,
    /// `return` expressions that end a function body: not early exits (by node address).
    terminal: HashSet<usize>,
}

fn line_of(s: Span) -> u32 {
    s.start().line as u32
}

fn end_line_of(s: Span) -> u32 {
    s.end().line as u32
}

impl<'s> Walker<'s> {
    fn new(rel: &'s str, src: &'s str, file_is_test: bool) -> Self {
        Walker {
            rel,
            lines: Lines::new(src),
            out: FileFns::default(),
            tests: Vec::new(),
            uses: Vec::new(),
            mods: Vec::new(),
            frames: Vec::new(),
            prefix: String::new(),
            key_prefix: Vec::new(),
            marks: Vec::new(),
            counters: HashMap::new(),
            mod_path: Vec::new(),
            test_depth: file_is_test as u32,
            terminal: HashSet::new(),
        }
    }

    // ---- functions ----------------------------------------------------------------------

    fn enter(&mut self, start_line: u32, end_line: u32, own: Option<&str>, kind: u8) {
        let (element, ordinal, anonymous) = match own {
            Some(n) => (n.to_string(), self.ordinal(n.as_bytes(), kind, false), false),
            None => {
                let ord = self.ordinal(b"", kind, true);
                (format!("#{ord}"), ord, true)
            }
        };
        let chain =
            if self.prefix.is_empty() { element.clone() } else { format!("{}>{element}", self.prefix) };
        let digits = ordinal.to_string();
        let key_name: &[u8] = if anonymous { b"" } else { element.as_bytes() };
        let key = fnv_parts(&[self.rel.as_bytes(), &self.key_prefix, key_name, &[kind], digits.as_bytes()]);
        let end_line = end_line.max(start_line);
        let loc = self.lines.loc(start_line, end_line);
        let parent = self.frames.last().map(|f| f.local);
        // The boundary marker belongs to the parent's tree.
        self.leaf(ct::NESTED_FN);
        let local = self.out.fns.len() as u32;
        self.out.fns.push(FnRec { start_line, end_line, parent, loc, kind, chain, key });
        if self.test_depth > 0 {
            self.tests.push(local);
        }
        self.frames.push(Frame { local, next_node: 1, stack: vec![0] });
        self.push_container(&element);
    }

    fn leave(&mut self) {
        self.frames.pop();
        self.pop_container();
    }

    fn push_container(&mut self, name: &str) {
        self.marks.push((self.prefix.len(), self.key_prefix.len()));
        if !self.prefix.is_empty() {
            self.prefix.push('>');
            self.key_prefix.push(0x1f);
        }
        self.prefix.push_str(name);
        self.key_prefix.extend_from_slice(name.as_bytes());
    }

    fn pop_container(&mut self) {
        if let Some((p, k)) = self.marks.pop() {
            self.prefix.truncate(p);
            self.key_prefix.truncate(k);
        }
    }

    /// Next ordinal for this (container chain, name, kind); anonymous functions count per chain.
    fn ordinal(&mut self, name: &[u8], kind: u8, anonymous: bool) -> u32 {
        let tag: &[u8] = if anonymous { &[1] } else { &[0, kind] };
        let h = fnv_parts(&[self.prefix.as_bytes(), name, tag]);
        let slot = self.counters.entry(h).or_insert(0);
        let ord = *slot;
        *slot += 1;
        ord
    }

    // ---- control tree -------------------------------------------------------------------

    fn node(&mut self, kind: u8) -> u32 {
        let Some(f) = self.frames.last_mut() else { return 0 };
        let id = f.next_node;
        f.next_node += 1;
        let parent = *f.stack.last().unwrap_or(&0);
        self.out.ct.push(CtRec { fn_local: f.local, node: id, parent, kind });
        id
    }

    fn leaf(&mut self, kind: u8) {
        self.node(kind);
    }

    /// A kind-6 node plus its `CO` row: which boolean operator it stands for.
    fn short_circuit(&mut self, operator: u8) {
        let id = self.node(ct::SHORT_CIRCUIT);
        if let Some(local) = self.frames.last().map(|f| f.local) {
            self.out.ops.push(CoRec { fn_local: local, node: id, op: operator });
        }
    }

    fn push_parent(&mut self, id: u32) {
        if let Some(f) = self.frames.last_mut() {
            f.stack.push(id);
        }
    }

    fn pop_parent(&mut self) {
        if let Some(f) = self.frames.last_mut() {
            f.stack.pop();
        }
    }

    /// Mark the final top-level `return` of a body as not an early exit.
    fn mark_terminal(&mut self, block: &Block) {
        if let Some(Stmt::Expr(Expr::Return(r), _)) = block.stmts.last() {
            self.terminal.insert(std::ptr::from_ref(r) as usize);
        }
    }

    /// Run `f` inside an arm node under `parent`.
    fn arm(&mut self, f: impl FnOnce(&mut Self)) {
        let a = self.node(ct::ARM);
        self.push_parent(a);
        f(self);
        self.pop_parent();
    }

    fn with_test<R>(&mut self, attrs: &[Attribute], f: impl FnOnce(&mut Self) -> R) -> R {
        let t = attrs_mark_test(attrs);
        if t {
            self.test_depth += 1;
        }
        let r = f(self);
        if t {
            self.test_depth -= 1;
        }
        r
    }

    fn fn_item(&mut self, sig: &Signature, vis: Option<&Visibility>, block: &Block, kind: u8) {
        let mut start = line_of(sig.fn_token.span);
        if let Some(v) = vis {
            if !matches!(v, Visibility::Inherited) {
                start = start.min(line_of(v.span()));
            }
        }
        if let Some(a) = &sig.asyncness {
            start = start.min(line_of(a.span));
        }
        if let Some(c) = &sig.constness {
            start = start.min(line_of(c.span));
        }
        if let Some(u) = &sig.unsafety {
            start = start.min(line_of(u.span));
        }
        let end = end_line_of(block.brace_token.span.close());
        let name = sig.ident.to_string();
        self.enter(start, end, Some(name.strip_prefix("r#").unwrap_or(&name)), kind);
        self.mark_terminal(block);
        self.visit_block(block);
        self.leave();
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_item_fn(&mut self, n: &'a ItemFn) {
        self.with_test(&n.attrs, |w| w.fn_item(&n.sig, Some(&n.vis), &n.block, fk::DECL));
    }

    fn visit_impl_item_fn(&mut self, n: &'a ImplItemFn) {
        self.with_test(&n.attrs, |w| w.fn_item(&n.sig, Some(&n.vis), &n.block, fk::METHOD));
    }

    fn visit_trait_item_fn(&mut self, n: &'a TraitItemFn) {
        // A method with no body is a signature: no code, no row.
        if let Some(block) = &n.default {
            self.with_test(&n.attrs, |w| w.fn_item(&n.sig, None, block, fk::METHOD));
        }
    }

    fn visit_item_impl(&mut self, n: &'a ItemImpl) {
        let name = match &n.trait_ {
            Some((_, path, _)) => format!("{} as {}", self_type_name(&n.self_ty), trait_name(path)),
            None => self_type_name(&n.self_ty),
        };
        self.with_test(&n.attrs, |w| {
            w.push_container(&name);
            for item in &n.items {
                w.visit_impl_item(item);
            }
            w.pop_container();
        });
    }

    fn visit_item_trait(&mut self, n: &'a ItemTrait) {
        let name = n.ident.to_string();
        self.with_test(&n.attrs, |w| {
            w.push_container(&name);
            for item in &n.items {
                w.visit_trait_item(item);
            }
            w.pop_container();
        });
    }

    fn visit_item_mod(&mut self, n: &'a ItemMod) {
        let name = n.ident.to_string();
        let test = attrs_mark_test(&n.attrs);
        self.mods.push(ModDecl {
            name: name.clone(),
            mod_path: self.mod_path.clone(),
            inline: n.content.is_some(),
            path_attr: path_attr(&n.attrs),
            test: test || self.test_depth > 0,
        });
        let Some((_, items)) = &n.content else { return };
        self.with_test(&n.attrs, |w| {
            w.push_container(&name);
            w.mod_path.push(name.clone());
            for item in items {
                w.visit_item(item);
            }
            w.mod_path.pop();
            w.pop_container();
        });
    }

    fn visit_item_use(&mut self, n: &'a ItemUse) {
        let test = self.test_depth > 0 || attrs_mark_test(&n.attrs);
        let public = !matches!(n.vis, Visibility::Inherited);
        let mut leaves = Vec::new();
        flatten_use(&n.tree, &mut Vec::new(), &mut leaves);
        for segs in leaves {
            self.uses.push(UseRec {
                mod_path: self.mod_path.clone(),
                segs,
                leading_colon: n.leading_colon.is_some(),
                public,
                test,
            });
        }
    }

    fn visit_expr_closure(&mut self, n: &'a ExprClosure) {
        let start = line_of(n.or1_token.spans[0]);
        let end = end_line_of(n.body.span());
        self.enter(start, end, None, fk::ARROW);
        match &*n.body {
            Expr::Block(b) => self.mark_terminal(&b.block),
            Expr::Return(r) => {
                self.terminal.insert(std::ptr::from_ref(r) as usize);
            }
            _ => {}
        }
        self.visit_expr(&n.body);
        self.leave();
    }

    // ---- control structure --------------------------------------------------------------

    fn visit_expr_if(&mut self, n: &'a ExprIf) {
        let b = self.node(ct::BRANCH);
        self.push_parent(b);
        self.visit_expr(&n.cond);
        self.arm(|w| w.visit_block(&n.then_branch));
        if let Some((_, e)) = &n.else_branch {
            self.arm(|w| w.visit_expr(e));
        }
        self.pop_parent();
    }

    fn visit_expr_match(&mut self, n: &'a ExprMatch) {
        let m = self.node(ct::MULTI);
        self.push_parent(m);
        self.visit_expr(&n.expr);
        let mut flagged = false;
        for arm in &n.arms {
            self.arm(|w| {
                if let Some((_, g)) = &arm.guard {
                    w.visit_expr(g);
                }
                w.visit_expr(&arm.body);
            });
            if !flagged && is_catch_all(arm) {
                flagged = true;
                self.leaf(ct::DEFAULT_FLAG);
            }
        }
        self.pop_parent();
    }

    fn visit_expr_while(&mut self, n: &'a ExprWhile) {
        let l = self.node(ct::LOOP);
        self.push_parent(l);
        self.visit_expr(&n.cond);
        self.visit_block(&n.body);
        self.pop_parent();
    }

    fn visit_expr_for_loop(&mut self, n: &'a ExprForLoop) {
        let l = self.node(ct::LOOP);
        self.push_parent(l);
        self.visit_expr(&n.expr);
        self.visit_block(&n.body);
        self.pop_parent();
    }

    fn visit_expr_loop(&mut self, n: &'a ExprLoop) {
        let l = self.node(ct::LOOP);
        self.push_parent(l);
        self.visit_block(&n.body);
        self.pop_parent();
    }

    fn visit_expr_try(&mut self, n: &'a ExprTry) {
        self.visit_expr(&n.expr);
        self.leaf(ct::EXIT);
    }

    fn visit_expr_return(&mut self, n: &'a ExprReturn) {
        if !self.terminal.contains(&(std::ptr::from_ref(n) as usize)) {
            self.leaf(ct::EXIT);
        }
        if let Some(e) = &n.expr {
            self.visit_expr(e);
        }
    }

    fn visit_expr_break(&mut self, n: &'a ExprBreak) {
        self.leaf(ct::EXIT);
        if let Some(e) = &n.expr {
            self.visit_expr(e);
        }
    }

    fn visit_expr_continue(&mut self, _: &'a ExprContinue) {
        self.leaf(ct::EXIT);
    }

    fn visit_expr_binary(&mut self, n: &'a ExprBinary) {
        let operator = match n.op {
            BinOp::And(_) => op::AND,
            BinOp::Or(_) => op::OR,
            _ => return visit::visit_expr_binary(self, n),
        };
        self.visit_expr(&n.left);
        self.short_circuit(operator);
        self.visit_expr(&n.right);
    }

    fn visit_local(&mut self, n: &'a Local) {
        let Some(init) = &n.init else { return };
        self.visit_expr(&init.expr);
        // `let PAT = EXPR else { .. }` is a decision with one arm: the else block.
        if let Some((_, diverge)) = &init.diverge {
            let b = self.node(ct::BRANCH);
            self.push_parent(b);
            self.arm(|w| w.visit_expr(diverge));
            self.pop_parent();
        }
    }
}

// ---- helpers ----------------------------------------------------------------------------

/// `#[cfg(test)]` (also `cfg(all(test, ..))`, but not under `not(..)`), or a test attribute.
fn attrs_mark_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|a| {
        let p = a.path();
        if p.is_ident("cfg") {
            return matches!(&a.meta, Meta::List(l) if tokens_have_test(l.tokens.clone()));
        }
        let last = p.segments.last().map(|s| s.ident.to_string());
        matches!(last.as_deref(), Some("test" | "rstest" | "test_case" | "bench"))
    })
}

fn tokens_have_test(ts: TokenStream) -> bool {
    let mut it = ts.into_iter().peekable();
    let mut found = false;
    while let Some(tt) = it.next() {
        match tt {
            TokenTree::Ident(i) if i == "not" => {
                if let Some(TokenTree::Group(_)) = it.peek() {
                    it.next();
                }
            }
            TokenTree::Ident(i) if i == "test" => found = true,
            TokenTree::Group(g) => found |= tokens_have_test(g.stream()),
            _ => {}
        }
    }
    found
}

fn path_attr(attrs: &[Attribute]) -> Option<String> {
    attrs.iter().find_map(|a| {
        if !a.path().is_ident("path") {
            return None;
        }
        match &a.meta {
            Meta::NameValue(nv) => match &nv.value {
                Expr::Lit(ExprLit { lit: Lit::Str(s), .. }) => Some(s.value()),
                _ => None,
            },
            _ => None,
        }
    })
}

/// A catch-all arm: `_`, or a lowercase binding, with no guard. An uppercase bare name is a
/// constant or a unit variant, not a catch-all.
fn is_catch_all(arm: &Arm) -> bool {
    if arm.guard.is_some() {
        return false;
    }
    match &arm.pat {
        Pat::Wild(_) => true,
        Pat::Ident(p) => {
            p.subpat.is_none()
                && p.by_ref.is_none()
                && p.ident.to_string().chars().next().is_some_and(|c| c.is_lowercase() || c == '_')
        }
        _ => false,
    }
}

fn flatten_use(tree: &UseTree, prefix: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match tree {
        UseTree::Path(p) => {
            prefix.push(p.ident.to_string());
            flatten_use(&p.tree, prefix, out);
            prefix.pop();
        }
        UseTree::Name(n) => {
            let id = n.ident.to_string();
            let mut segs = prefix.clone();
            if id != "self" {
                segs.push(id);
            }
            out.push(segs);
        }
        UseTree::Rename(r) => {
            let id = r.ident.to_string();
            let mut segs = prefix.clone();
            if id != "self" {
                segs.push(id);
            }
            out.push(segs);
        }
        UseTree::Glob(_) => out.push(prefix.clone()),
        UseTree::Group(g) => {
            for t in &g.items {
                flatten_use(t, prefix, out);
            }
        }
    }
}

/// The self type of an impl block: its last path segment, without generic arguments.
fn self_type_name(ty: &Type) -> String {
    match ty {
        Type::Path(p) => p.path.segments.last().map_or_else(|| "_".into(), |s| s.ident.to_string()),
        Type::Reference(r) => format!("&{}", self_type_name(&r.elem)),
        Type::Slice(s) => format!("[{}]", self_type_name(&s.elem)),
        Type::Array(a) => format!("[{};]", self_type_name(&a.elem)),
        Type::Tuple(t) => {
            format!("({})", t.elems.iter().map(self_type_name).collect::<Vec<_>>().join(","))
        }
        Type::Ptr(p) => format!("*{}", self_type_name(&p.elem)),
        Type::Paren(p) => self_type_name(&p.elem),
        Type::Group(g) => self_type_name(&g.elem),
        Type::TraitObject(t) => {
            let first = t.bounds.iter().find_map(|b| match b {
                TypeParamBound::Trait(tb) => Some(trait_name(&tb.path)),
                _ => None,
            });
            format!("dyn {}", first.unwrap_or_else(|| "_".into()))
        }
        _ => "_".into(),
    }
}

/// A trait's last path segment with its type arguments, so `From<A>` and `From<B>` differ.
fn trait_name(path: &Path) -> String {
    let Some(seg) = path.segments.last() else { return "_".into() };
    let mut s = seg.ident.to_string();
    if let PathArguments::AngleBracketed(a) = &seg.arguments {
        let args: Vec<String> = a
            .args
            .iter()
            .filter_map(|g| match g {
                GenericArgument::Type(t) => Some(arg_name(t)),
                _ => None,
            })
            .collect();
        if !args.is_empty() {
            s.push('<');
            s.push_str(&args.join(","));
            s.push('>');
        }
    }
    s
}

fn arg_name(ty: &Type) -> String {
    match ty {
        Type::Path(p) => {
            let Some(seg) = p.path.segments.last() else { return "_".into() };
            let mut s = seg.ident.to_string();
            if let PathArguments::AngleBracketed(a) = &seg.arguments {
                let args: Vec<String> = a
                    .args
                    .iter()
                    .filter_map(|g| match g {
                        GenericArgument::Type(t) => Some(arg_name(t)),
                        _ => None,
                    })
                    .collect();
                if !args.is_empty() {
                    s.push('<');
                    s.push_str(&args.join(","));
                    s.push('>');
                }
            }
            s
        }
        other => self_type_name(other),
    }
}
