//! Call sites of the Rust lane (`SY`, `CL`, `CS`): the syntactic part of the group A error rules
//! and of the query, blocking and panic classes, with no type checker.
//!
//! A callee is a symbol string `<crate>#<path>` (`std#fs::read_to_string`, `sqlx#query`, a macro
//! as `std#panic!`). It is resolved exactly from the call's path through the module's `use`
//! items (aliases included), a fully qualified path, or a `crate::` path; a crate renamed in
//! `Cargo.toml` is mapped back to the package. A method call has no receiver type, so it can only
//! match a name-only symbol `syntax#method.<name>`, and its `CS` row carries the
//! [`NAME_ONLY`] ctx bit: a finding can say it matched by name. Language constructs a rule can
//! name (`let _ = ..`, a dropped `.ok()`) are `syntax#let-underscore` and `syntax#ok-discarded`.
//! A site is emitted only for a symbol some active catalog gives a class.

use super::env::{Body, OpenHandler, NAME_ONLY, PRELUDE_MACROS};
use super::parse::Walker;
use crate::lang::functions::{ctx, shape, Site, SiteKind, SqlTextKind, SqlTextRec};
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Expr, Macro, Pat, Stmt};

/// Segments of a path expression, `None` for a qualified path (`<T as Trait>::f`).
fn path_segs(p: &syn::ExprPath) -> Option<Vec<String>> {
    if p.qself.is_some() {
        return None;
    }
    Some(p.path.segments.iter().map(|s| s.ident.to_string()).collect())
}

impl Walker<'_> {
    /// Resolve a path written at the current module to `<crate>#<rest>`; `None` when it does not
    /// start at something this lane can name (a local, a glob import, `self`, `super`).
    pub(super) fn resolve_sym(&self, segs: &[String], is_macro: bool) -> Option<String> {
        let env = self.env?;
        let full = self.expand(segs, is_macro)?;
        let head = full.first()?;
        if matches!(head.as_str(), "self" | "super") || full.len() < 2 {
            return None;
        }
        let rest = full[1..].join("::");
        let bang = if is_macro { "!" } else { "" };
        Some(format!("{}#{rest}{bang}", env.canonical(head)))
    }

    /// The path with its first segment replaced by what the module's `use` binds it to; a path
    /// that already starts at a crate stays as written.
    fn expand(&self, segs: &[String], is_macro: bool) -> Option<Vec<String>> {
        let env = self.env?;
        let first = segs.first()?;
        if let Some(prefix) = self.scan.uses.get(&(self.mod_path.clone(), first.clone())) {
            return Some(prefix.iter().cloned().chain(segs[1..].iter().cloned()).collect());
        }
        if env.is_crate(first) || matches!(first.as_str(), "std" | "core" | "alloc" | "crate") {
            return Some(segs.to_vec());
        }
        let prelude = is_macro && segs.len() == 1 && PRELUDE_MACROS.contains(&first.as_str());
        prelude.then(|| vec!["std".to_string(), first.clone()])
    }

    fn ctx_bits(&self) -> u8 {
        let asynchronous = self.frames.last().is_some_and(|f| f.async_depth > 0);
        (if asynchronous { ctx::ASYNC } else { 0 }) | (if self.test_depth > 0 { ctx::TEST } else { 0 })
    }

    /// Emit a call site for `sym` when an active catalog gives it a class, with the constant
    /// arguments (`AL`) and, for a query-class symbol, the SQL text of its first argument.
    pub(super) fn emit_call(&mut self, sym: &str, extra_ctx: u8, args: &[&Expr], line: u32) -> bool {
        let Some(env) = self.env else { return false };
        let Some(classes) = env.classes(sym) else { return false };
        let is_query = classes.contains(&1);
        let Some(frame) = self.frames.last() else { return false };
        let (fn_local, loop_depth) = (frame.local, frame.loop_depth);
        let ctx = self.ctx_bits() | extra_ctx;
        let sym_id = self.sym_id(sym);
        let idx = self.out.sites.len();
        let consts = self.arg_consts(idx, args);
        self.out.sites.push(Site { fn_local, kind: SiteKind::Call { sym: sym_id, loop_depth, ctx, consts } });
        if is_query {
            self.sql_text(fn_local, line, args);
        }
        true
    }

    /// Arguments that are a literal (kind 1) or a name bound once to a literal (kind 3). A local's
    /// binding count is only final at the end of its function, so those are settled in `leave`.
    fn arg_consts(&mut self, site: usize, args: &[&Expr]) -> Box<[(u8, u8)]> {
        let mut out = Vec::new();
        for (pos, a) in args.iter().enumerate().take(255) {
            match a {
                Expr::Lit(_) => out.push((pos as u8, 1)),
                Expr::Path(p) if p.qself.is_none() && p.path.segments.len() == 1 => {
                    let name = p.path.segments[0].ident.to_string();
                    if self.scan.consts.contains(&(self.mod_path.clone(), name.clone())) {
                        out.push((pos as u8, 3));
                    } else if let Some(f) = self.frames.last_mut() {
                        f.pending_consts.push((site, pos as u8, name));
                    }
                }
                _ => {}
            }
        }
        out.into_boxed_slice()
    }

    /// The first argument of a query-class call as SQL text: a string literal is the text, a
    /// `format!` or anything else is dynamic.
    fn sql_text(&mut self, fn_local: u32, line: u32, args: &[&Expr]) {
        let node = self.frames.last().map_or(0, |f| f.stack.last().copied().unwrap_or(0));
        let (text, kind) = match args.first() {
            Some(Expr::Lit(l)) => match &l.lit {
                syn::Lit::Str(s) => (s.value(), SqlTextKind::Literal),
                _ => (String::new(), SqlTextKind::Dynamic),
            },
            _ => (String::new(), SqlTextKind::Dynamic),
        };
        self.out.sql.push(SqlTextRec { fn_local: Some(fn_local), line, ct_node: node, text, kind });
    }

    /// Settle the "bound once to a literal" constants of the function that is ending.
    pub(super) fn settle_consts(&mut self) {
        let Some(f) = self.frames.last_mut() else { return };
        let pending = std::mem::take(&mut f.pending_consts);
        for (site, pos, name) in pending {
            if !f.lit_locals.contains(&name) || f.bs.binding_count(&name) != 1 {
                continue;
            }
            if let SiteKind::Call { consts, .. } = &mut self.out.sites[site].kind {
                let mut v = consts.to_vec();
                v.push((pos, 3));
                v.sort_unstable();
                *consts = v.into_boxed_slice();
            }
        }
    }

    fn sym_id(&mut self, sym: &str) -> u32 {
        if let Some(&i) = self.sym_ids.get(sym) {
            return i;
        }
        let i = self.out.syms.len() as u32;
        self.out.syms.push(sym.to_string());
        self.sym_ids.insert(sym.to_string(), i);
        i
    }

    /// `f(..)` or `a::b::f(..)`: an exact call through a path.
    pub(super) fn path_call(&mut self, call: &syn::ExprCall) {
        let Expr::Path(p) = &*call.func else { return };
        let Some(segs) = path_segs(p) else { return };
        if let Some(sym) = self.resolve_sym(&segs, false) {
            let args: Vec<&Expr> = call.args.iter().collect();
            self.emit_call(&sym, 0, &args, line_of(call.span()));
        }
    }

    /// `x.name(..)`: matches a name-only entry, and says so in the ctx.
    pub(super) fn method_call(&mut self, call: &syn::ExprMethodCall) {
        let args: Vec<&Expr> = call.args.iter().collect();
        self.emit_call(&format!("syntax#method.{}", call.method), NAME_ONLY, &args, line_of(call.span()));
    }

    /// `name!(..)`: exact when the macro's path resolves.
    pub(super) fn macro_call(&mut self, m: &Macro) {
        let segs: Vec<String> = m.path.segments.iter().map(|s| s.ident.to_string()).collect();
        if segs.last().is_some_and(|s| s == "macro_rules") {
            return;
        }
        if let Some(sym) = self.resolve_sym(&segs, true) {
            let args = m.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated).ok();
            let args: Vec<&Expr> = args.iter().flat_map(|a| a.iter()).collect();
            self.emit_call(&sym, 0, &args, line_of(m.span()));
        }
    }

    /// `let _ = expr;` and `expr.ok();`: a result thrown away without a look.
    pub(super) fn discard(&mut self, syntax: &str, line: u32) {
        self.emit_call(&format!("syntax#{syntax}"), NAME_ONLY, &[], line);
    }
}

/// Every call site of a file that is only compiled under `cfg(test)` is in test code.
pub fn mark_test_sites(f: &mut crate::lang::functions::FileFns) {
    for s in &mut f.sites {
        if let SiteKind::Call { ctx: c, .. } = &mut s.kind {
            *c |= ctx::TEST;
        }
    }
}

fn line_of(s: proc_macro2::Span) -> u32 {
    s.start().line as u32
}

// ---- error handlers (`HD`) -------------------------------------------------------------------

impl Walker<'_> {
    /// Start a handler: its `HD` site goes in now, in source order, with shape 0.
    pub(super) fn handler_open(&mut self, binds: Vec<String>) -> Option<OpenHandler> {
        self.env?;
        let fn_local = self.frames.last()?.local;
        let site = self.out.sites.len();
        self.out.sites.push(Site { fn_local, kind: SiteKind::Handler { shape: shape::OTHER } });
        Some(OpenHandler { site, first: site + 1, binds })
    }

    /// The body is done: classify it and set the shape.
    pub(super) fn handler_close(&mut self, h: OpenHandler, body: Body) {
        let logs = self.log_sites_since(h.first);
        let s = classify(body, &h.binds, logs);
        if let SiteKind::Handler { shape } = &mut self.out.sites[h.site].kind {
            *shape = s;
        }
    }

    /// Call sites emitted since `from` whose callee is in the log class.
    fn log_sites_since(&self, from: usize) -> usize {
        let Some(env) = self.env else { return 0 };
        self.out.sites[from..]
            .iter()
            .filter(|s| match &s.kind {
                SiteKind::Call { sym, .. } => env.classes(&self.out.syms[*sym as usize]).is_some_and(|c| c.contains(&3)),
                _ => false,
            })
            .count()
    }

    /// `r.unwrap_or_else(|e| ..)` and `r.or_else(|e| ..)`: the closure is an error handler.
    pub(super) fn handler_closure_for(&mut self, call: &syn::ExprMethodCall) {
        if !matches!(call.method.to_string().as_str(), "unwrap_or_else" | "or_else") {
            return;
        }
        let Some(Expr::Closure(c)) = call.args.last() else { return };
        let mut binds = Vec::new();
        c.inputs.iter().for_each(|p| super::blocks::bindings(p, &mut binds));
        let Some(h) = self.handler_open(binds) else { return };
        let key = std::ptr::from_ref(c) as usize;
        if let Some(f) = self.frames.last_mut() {
            f.handler_closures.insert(key, h);
        }
    }

    pub(super) fn take_handler_closure(&mut self, c: &syn::ExprClosure) -> Option<OpenHandler> {
        let key = std::ptr::from_ref(c) as usize;
        self.frames.last_mut()?.handler_closures.remove(&key)
    }

    /// `let name = <literal>;` (immutable): the name may later stand for a constant argument.
    pub(super) fn note_literal_local(&mut self, pat: &Pat, init: &Expr) {
        let (Pat::Ident(i), Expr::Lit(_)) = (pat, init) else { return };
        if i.mutability.is_none() && i.by_ref.is_none() {
            if let Some(f) = self.frames.last_mut() {
                f.lit_locals.insert(i.ident.to_string());
            }
        }
    }
}

fn stmts_of<'a>(b: Body<'a>) -> Vec<&'a Expr> {
    match b {
        Body::Expr(Expr::Block(bl)) => bl.block.stmts.iter().filter_map(stmt_expr).collect(),
        Body::Expr(e) => vec![e],
        Body::Stmts(s) => s.iter().filter_map(stmt_expr).collect(),
    }
}

fn stmt_expr(s: &Stmt) -> Option<&Expr> {
    match s {
        Stmt::Expr(e, _) => Some(e),
        Stmt::Macro(_) | Stmt::Local(_) | Stmt::Item(_) => None,
    }
}

/// Number of statements (a `let` or a macro statement counts, an item does not).
fn statement_count(b: Body) -> usize {
    match b {
        Body::Expr(Expr::Block(bl)) => bl.block.stmts.iter().filter(|s| !matches!(s, Stmt::Item(_))).count(),
        Body::Expr(Expr::Tuple(t)) if t.elems.is_empty() => 0,
        Body::Expr(_) => 1,
        Body::Stmts(s) => s.iter().filter(|s| !matches!(s, Stmt::Item(_))).count(),
    }
}

/// The shape of a handler body (FACTS.md `HD`): empty, only logs, a constant, a rethrow with or
/// without the caught error, or something else.
fn classify(body: Body, binds: &[String], log_sites: usize) -> u8 {
    let n = statement_count(body);
    if n == 0 {
        return shape::EMPTY;
    }
    let exprs = stmts_of(body);
    if let Some(last) = exprs.last() {
        if let Some(arg) = err_arg(last) {
            return if mentions(arg, binds) { shape::RETHROW_CAUSE } else { shape::RETHROW_NO_CAUSE };
        }
    }
    if let Some(s) = returned_err(&exprs, binds) {
        return s;
    }
    if log_sites >= n && all_call_statements(body) {
        return shape::ONLY_LOGS;
    }
    match exprs.last() {
        Some(last) if is_constant(last) => shape::CONSTANT,
        _ => shape::OTHER,
    }
}

/// A `return Err(..)` anywhere among the statements.
fn returned_err(exprs: &[&Expr], binds: &[String]) -> Option<u8> {
    exprs.iter().find_map(|e| match e {
        Expr::Return(r) => r.expr.as_deref().and_then(err_arg).map(|a| {
            if mentions(a, binds) { shape::RETHROW_CAUSE } else { shape::RETHROW_NO_CAUSE }
        }),
        _ => None,
    })
}

/// The argument of `Err(arg)`, also behind a `return`.
fn err_arg(e: &Expr) -> Option<&Expr> {
    let e = match e {
        Expr::Return(r) => r.expr.as_deref()?,
        other => other,
    };
    let Expr::Call(c) = e else { return None };
    let Expr::Path(p) = &*c.func else { return None };
    (p.path.segments.last()?.ident == "Err" && c.args.len() == 1).then(|| &c.args[0])
}

/// Does `e` name one of `binds` anywhere?
fn mentions(e: &Expr, binds: &[String]) -> bool {
    struct M<'b> {
        binds: &'b [String],
        hit: bool,
    }
    impl<'a> Visit<'a> for M<'_> {
        fn visit_expr_path(&mut self, p: &'a syn::ExprPath) {
            if p.path.segments.len() == 1 && self.binds.iter().any(|b| p.path.segments[0].ident == b) {
                self.hit = true;
            }
        }
    }
    let mut m = M { binds, hit: false };
    m.visit_expr(e);
    m.hit
}

/// A value that tells nothing of the failure: a literal, `()`, a constant, `None`, `Ok(..)` of
/// one of those, or leaving the loop or function without a value.
fn is_constant(e: &Expr) -> bool {
    match e {
        Expr::Lit(_) | Expr::Continue(_) | Expr::Break(_) => true,
        Expr::Tuple(t) => t.elems.is_empty(),
        Expr::Path(p) => p.path.segments.last().is_some_and(|s| s.ident == "None" || s.ident.to_string().chars().next().is_some_and(char::is_uppercase)),
        Expr::Return(r) => r.expr.as_deref().is_none_or(is_constant),
        Expr::Call(c) => matches!(&*c.func, Expr::Path(p) if p.path.segments.last().is_some_and(|s| s.ident == "Ok")) && c.args.iter().all(is_constant),
        Expr::Paren(p) => is_constant(&p.expr),
        _ => false,
    }
}

/// Every statement is a call, a method call or a macro: nothing that computes or decides.
fn all_call_statements(b: Body) -> bool {
    let stmts: Vec<&Stmt> = match b {
        Body::Expr(Expr::Block(bl)) => bl.block.stmts.iter().collect(),
        Body::Stmts(s) => s.iter().collect(),
        Body::Expr(_) => return matches!(b, Body::Expr(Expr::Macro(_) | Expr::Call(_) | Expr::MethodCall(_))),
    };
    stmts.iter().all(|s| match s {
        Stmt::Macro(_) => true,
        Stmt::Expr(e, _) => matches!(e, Expr::Macro(_) | Expr::Call(_) | Expr::MethodCall(_)),
        Stmt::Local(_) | Stmt::Item(_) => false,
    })
}


// ---- call edges (`CE`) -------------------------------------------------------------------------

/// Separates the parts of a call-edge key stored in `FileFns.names`.
pub(super) const KEY_SEP: char = '\u{1f}';
/// Separates path segments inside a key part.
pub(super) const SEG_SEP: char = '\u{1e}';

/// Prelude names that are not calls of a repo function.
const PRELUDE_FNS: [&str; 4] = ["drop", "Some", "Ok", "Err"];

impl Walker<'_> {
    fn edge_site(&mut self, key: String) {
        let Some(frame) = self.frames.last() else { return };
        let (fn_local, loop_depth, node) = (frame.local, frame.loop_depth, frame.stack.last().copied().unwrap_or(0));
        let ctx = self.ctx_bits();
        let n = self.out.names.len() as u32;
        let idx = *self.name_ids.entry(key.clone()).or_insert(n);
        if idx == n {
            self.out.names.push(key);
        }
        self.out.sites.push(Site {
            fn_local,
            kind: SiteKind::Edge { to: crate::lang::functions::Callee::Local(idx), node, loop_depth, ctx },
        });
    }

    /// A call that cannot become an edge, with the reason (`unres` in FACTS.md `CU`).
    fn unresolved(&mut self, reason: u8) {
        if let Some(f) = self.frames.last() {
            self.out.unresolved.push((f.local, reason));
        }
    }

    /// `f(..)`, `a::b::f(..)`, `Type::assoc(..)`, `Self::f(..)`: an edge to a repo function when the
    /// path resolves.
    pub(super) fn edge_call(&mut self, call: &syn::ExprCall) {
        if self.env.is_none() {
            return;
        }
        let Expr::Path(p) = &*call.func else {
            self.unresolved(crate::lang::functions::unres::DYNAMIC);
            return;
        };
        let Some(segs) = path_segs(p) else { return };
        let first = segs[0].as_str();
        if PRELUDE_FNS.contains(&first) || (segs.len() == 1 && first.chars().next().is_some_and(char::is_uppercase)) {
            return;
        }
        if first == "Self" {
            return self.self_edge(segs.get(1).filter(|_| segs.len() == 2));
        }
        if segs.len() == 1 && self.frames.last().is_some_and(|f| f.bs.binding_count(first) > 0) {
            return self.unresolved(crate::lang::functions::unres::LOCAL_BINDING);
        }
        let full = self.expand(&segs, false).unwrap_or_else(|| segs.clone());
        if matches!(full[0].as_str(), "std" | "core" | "alloc") {
            return;
        }
        let key = format!("P{KEY_SEP}{}{KEY_SEP}{}", self.mod_path.join(&SEG_SEP.to_string()), full.join(&SEG_SEP.to_string()));
        self.edge_site(key);
    }

    /// `self.m(..)` is an edge within the impl; any other method call has no receiver type.
    pub(super) fn edge_method(&mut self, call: &syn::ExprMethodCall) {
        if self.env.is_none() {
            return;
        }
        match &*call.receiver {
            Expr::Path(p) if p.path.is_ident("self") => self.self_edge(Some(&call.method.to_string())),
            Expr::Call(_) | Expr::MethodCall(_) | Expr::Macro(_) => self.unresolved(crate::lang::functions::unres::DYNAMIC),
            _ => self.unresolved(crate::lang::functions::unres::LOCAL_BINDING),
        }
    }

    fn self_edge(&mut self, name: Option<&String>) {
        let (Some(name), Some(prefix)) = (name, self.impl_prefix.last()) else {
            return self.unresolved(crate::lang::functions::unres::UNKNOWN_MEMBER);
        };
        let key = format!("S{KEY_SEP}{prefix}{KEY_SEP}{name}");
        self.edge_site(key);
    }
}
