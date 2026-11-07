//! Function and control-tree facts for one file (FACTS.md `FN`, `FK`, `CT`, and the `.fns` row).
//!
//! One walk over the AST the import pass already parsed. The walk reports what the syntax says:
//! which functions exist, how their control structure nests, and each function's stable name.
//! Which nodes count toward a metric is decided by the engine, never here.
//!
//! Naming is syntactic and never depends on a pack: a declaration's own id, `const x = <fn>`,
//! a property or method key, a class name, `export default`, and the first function-valued
//! argument of a call that is itself a declarator initialiser or property value (so `memo(fn)`,
//! `debounce(fn)` and any wrapper alike name `fn` after the declarator). Anything else is
//! anonymous and is named by its ordinal within the parent.

use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_span::{GetSpan, Span};
use oxc_syntax::scope::ScopeFlags;

use super::calls::{join, CatalogIndex, Use};
use crate::catalog::{Arg, Shape, Via};
use crate::lang::functions::{
    ct, ctx, fk, fnv_parts, op, shape, unres, Callee, CoRec, CtRec, FileFns, FnRec, Reexport, Site, SiteKind,
    SqlTextKind, SqlTextRec,
};
use oxc_semantic::Scoping;
use oxc_syntax::reference::ReferenceId;
use oxc_syntax::symbol::SymbolId;
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

/// Line starts and a non-blank-line prefix count, for spans and `loc`.
struct Lines {
    starts: Vec<u32>,
    /// `nonblank[k]` = non-blank lines among the first `k` lines.
    nonblank: Vec<u32>,
}

impl Lines {
    fn new(src: &str) -> Lines {
        let mut starts = vec![0u32];
        let mut nonblank = vec![0u32];
        let mut count = 0u32;
        let mut line_start = 0usize;
        let bytes = src.as_bytes();
        let mut i = 0usize;
        while i <= bytes.len() {
            if i == bytes.len() || bytes[i] == b'\n' {
                if !src[line_start..i].trim().is_empty() {
                    count += 1;
                }
                nonblank.push(count);
                if i < bytes.len() {
                    starts.push((i + 1) as u32);
                }
                line_start = i + 1;
            }
            i += 1;
        }
        Lines { starts, nonblank }
    }

    /// 1-based line of a byte offset.
    fn line(&self, off: u32) -> u32 {
        self.starts.partition_point(|&s| s <= off) as u32
    }

    /// First line, last line and non-blank line count of a span.
    fn measure(&self, span: Span) -> (u32, u32, u32) {
        let start = self.line(span.start);
        let end = self.line(span.end.saturating_sub(1).max(span.start));
        (start, end, self.nonblank[end as usize] - self.nonblank[start as usize - 1])
    }
}

/// Hasher for keys that are already 64-bit hashes.
#[derive(Default)]
struct IdHasher(u64);

impl Hasher for IdHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 = (self.0 ^ *b as u64).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    fn write_u64(&mut self, v: u64) {
        self.0 = v;
    }
}

type Counters = HashMap<u64, u32, BuildHasherDefault<IdHasher>>;

/// Decimal digits of `n` in `buf`, without allocating.
fn dec(mut n: u32, buf: &mut [u8; 10]) -> &[u8] {
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    &buf[i..]
}

/// A name the next function (or class, or object literal) starting at `start` takes.
struct Pending {
    start: u32,
    name: String,
    /// `FK` kind override for methods, getters and setters; `None` keeps the node's own kind.
    kind: Option<u8>,
}

/// What a pack sees at the walker's four call points. A pack keeps its own per-file state in
/// the hook and the driver reads it after the file is done, so the pack never re-parses and
/// never numbers functions itself. Every method runs before the walker's own handling of the
/// node, and the default does nothing.
pub trait PackHook {
    fn on_call(&mut self, _cx: &HookCx<'_>, _call: &CallExpression<'_>) {}
    /// The operand of a `yield*`.
    fn on_yield_star(&mut self, _cx: &HookCx<'_>, _arg: &Expression<'_>) {}
    fn on_class(&mut self, _cx: &HookCx<'_>, _class: &Class<'_>) {}
    fn on_declarator(&mut self, _cx: &HookCx<'_>, _d: &VariableDeclarator<'_>) {}
}

/// Context for a hook call: the enclosing function (a local index, `None` at module level),
/// the `CS.ctx` bits in force, and the walker's name resolution, with bindings.
pub struct HookCx<'a> {
    pub fn_local: Option<u32>,
    pub ctx: u8,
    pub resolve: &'a dyn Fn(&Expression<'_>) -> Option<String>,
    /// The same resolution for a type name (`Layer.Layer`, `SqlClient`): the catalog-style
    /// symbol an imported or global type reference stands for.
    pub resolve_type: &'a dyn Fn(&TSTypeName<'_>) -> Option<String>,
}

/// An `ident.a.b` expression: the root identifier (with its reference, once the semantic pass
/// ran) and the members after it.
struct Chain {
    root: String,
    rid: Option<ReferenceId>,
    path: Vec<String>,
}

/// A callee the walker named but has not linked.
enum Named {
    Local(String),
    Import { spec: u32, path: String },
}

enum Target {
    /// A catalog-style symbol: through an import, or `global#...` for an undeclared root.
    Sym(String),
    /// A binding recorded as holding a catalog symbol's value.
    Bound(SymbolId),
    /// A `this.<path>` chain whose receiver is an instance of a catalog symbol: the enclosing
    /// class extends it (`this.ctx` of a subclass) or declares the field with its type. `rest`
    /// is the path from that value.
    Held { sym: String, via: Via, rest: Vec<String> },
    None,
}

/// What `this.<field>` can be known to hold inside one class body.
#[derive(Default)]
struct ClassCtx {
    /// The class's `.fns` chain, for `this.method()` edges.
    chain: String,
    /// The catalog symbol of an imported base class.
    base: Option<String>,
    /// Typed fields and constructor parameter properties: field name to the type's symbol.
    props: HashMap<String, String>,
}

mod blocks;
use blocks::BlockAcc;

struct Frame {
    local: u32,
    /// Decision-block bookkeeping (`BL`, `BW`, `BR`, `BC`).
    blocks: BlockAcc,
    next_node: u32,
    /// `CS.ctx` bits in force: inherited lexically, plus this function's own.
    ctx: u8,
    /// Enclosing loop nodes in this function.
    loops: u32,
    /// Control parents, innermost last; 0 is the function body.
    stack: Vec<u32>,
}

/// A `const` (or typed parameter) known to hold the value of a catalog symbol.
struct Bound {
    sym: String,
    via: Via,
}

pub struct Walker<'s> {
    rel: &'s str,
    src: &'s str,
    lines: Lines,
    out: FileFns,
    frames: Vec<Frame>,
    /// Enclosing container names (classes, object literals, functions) outermost first, joined
    /// by `>` (for the chain) and by 0x1f (for the key), with the lengths to undo each push.
    prefix: String,
    key_prefix: Vec<u8>,
    marks: Vec<(usize, usize)>,
    pending: Vec<Pending>,
    /// Ordinals by hash of (container chain, name, kind); anonymous ones by (chain) alone.
    counters: Counters,
    /// Statements that are not early exits: a final top-level `return`/`throw`, a case-ending `break`.
    not_exit: HashSet<u32>,
    /// Calls and handlers need name resolution and a catalog; without them only functions and
    /// control trees are produced.
    scoping: Option<&'s Scoping>,
    index: Option<&'s CatalogIndex>,
    /// `CS.ctx` bits of the whole file (4 = a test file, 8 and 16 from repo policy).
    file_ctx: u8,
    imports: HashMap<SymbolId, String>,
    bound: HashMap<SymbolId, Bound>,
    sym_ids: HashMap<String, u32>,
    /// Wrapper ctx bits for the function starting at the given offset.
    pending_ctx: Vec<(u32, u8)>,
    hook: Option<&'s mut dyn PackHook>,
    classes: Vec<ClassCtx>,
    /// Value import bindings: module specifier index and imported name (`None` = namespace).
    import_binds: HashMap<SymbolId, (u32, Option<String>)>,
    spec_ids: HashMap<String, u32>,
    name_ids: HashMap<String, u32>,
    /// Entry kind for the function starting at the given offset (callback arguments).
    pending_entry: Vec<(u32, u8)>,
    /// Symbols bound once to a literal: a constant when passed as an argument (`AL` kind 3).
    lit_consts: HashSet<SymbolId>,
}

impl<'s> Walker<'s> {
    pub fn new(rel: &'s str, src: &'s str) -> Self {
        Walker {
            rel,
            src,
            lines: Lines::new(src),
            out: FileFns::default(),
            frames: Vec::new(),
            prefix: String::new(),
            key_prefix: Vec::new(),
            marks: Vec::new(),
            pending: Vec::new(),
            counters: Counters::default(),
            not_exit: HashSet::new(),
            scoping: None,
            index: None,
            file_ctx: 0,
            imports: HashMap::new(),
            bound: HashMap::new(),
            sym_ids: HashMap::new(),
            pending_ctx: Vec::new(),
            hook: None,
            classes: Vec::new(),
            import_binds: HashMap::new(),
            spec_ids: HashMap::new(),
            name_ids: HashMap::new(),
            pending_entry: Vec::new(),
            lit_consts: HashSet::new(),
        }
    }

    /// Let a pack observe calls, `yield*`, classes and declarators as the walk passes them.
    pub fn with_hook(mut self, hook: &'s mut dyn PackHook) -> Self {
        self.hook = Some(hook);
        self
    }

    /// Run `f` on the hook, if any, with a context built from the walker's current state.
    fn hooked(&mut self, f: impl FnOnce(&mut dyn PackHook, &HookCx<'_>)) {
        let Some(hook) = self.hook.take() else { return };
        let (fn_local, ctx) = match self.frames.last() {
            Some(fr) => (Some(fr.local), fr.ctx),
            None => (None, self.file_ctx),
        };
        let resolve = |e: &Expression<'_>| self.sym_of(e);
        let resolve_type = |t: &TSTypeName<'_>| match self.resolve(&self.type_chain(t)?) {
            Target::Sym(s) => Some(s),
            _ => None,
        };
        f(&mut *hook, &HookCx { fn_local, ctx, resolve: &resolve, resolve_type: &resolve_type });
        self.hook = Some(hook);
    }

    /// Turn on call-site, binding and handler facts for this file.
    pub fn with_calls(mut self, scoping: &'s Scoping, index: &'s CatalogIndex, file_ctx: u8) -> Self {
        self.scoping = Some(scoping);
        self.index = Some(index);
        self.file_ctx = file_ctx;
        self
    }

    pub fn run(mut self, program: &Program<'_>) -> FileFns {
        if self.scoping.is_some() {
            self.scan_imports(program);
        }
        self.visit_program(program);
        self.out
    }

    /// Index of `name` in the file's name table (each distinct chain or export path once).
    fn name_id(&mut self, name: &str) -> u32 {
        if let Some(&i) = self.name_ids.get(name) {
            return i;
        }
        let i = self.out.names.len() as u32;
        self.out.names.push(name.to_string());
        self.name_ids.insert(name.to_string(), i);
        i
    }

    fn spec_id(&mut self, spec: &str) -> u32 {
        if let Some(&i) = self.spec_ids.get(spec) {
            return i;
        }
        let i = self.out.specs.len() as u32;
        self.out.specs.push(spec.to_string());
        self.spec_ids.insert(spec.to_string(), i);
        i
    }

    /// Map each value import binding to the symbol it names (`effect#Effect.orDie` is a member
    /// of the binding for `import { Effect } from "effect"`) and to its module and imported
    /// name, for call edges. Type-only imports are skipped. Also reads the file's exports.
    fn scan_imports(&mut self, program: &Program<'_>) {
        let decls = program.body.iter().filter_map(|s| match s {
            Statement::ImportDeclaration(d) if !d.import_kind.is_type() => Some(d),
            _ => None,
        });
        for d in decls {
            let spec_text = d.source.value.display().to_string();
            let spec = self.spec_id(&spec_text);
            let base = self.index.map(|ix| ix.module_base(&spec_text));
            for sp in d.specifiers.iter().flatten() {
                let Some((sid, member)) = import_binding(sp) else { continue };
                if let Some(base) = &base {
                    let sym = member.as_ref().map_or_else(|| base.clone(), |m| join(base, m));
                    self.imports.insert(sid, sym);
                }
                self.import_binds.insert(sid, (spec, member));
            }
        }
        self.scan_exports(program);
    }

    /// The file's exported functions, classes and objects (by local chain) and its re-exports.
    fn scan_exports(&mut self, program: &Program<'_>) {
        for stmt in &program.body {
            match stmt {
                Statement::ExportDeclaration(d) => self.export_declaration(&d.declaration),
                Statement::ExportNamedDeclaration(d) if !d.export_kind.is_type() => self.export_specifiers(d),
                Statement::ExportFromDeclaration(d) if !d.export_kind.is_type() => self.export_from(d),
                Statement::ExportDefaultDeclaration(d) => self.export_default(d),
                Statement::ExportAllDeclaration(d) if d.exported.is_none() && !d.export_kind.is_type() => {
                    let spec = self.spec_id(&d.source.value.display().to_string());
                    self.out.reexports.push(Reexport { spec, imported: None, exported: String::new() });
                }
                _ => {}
            }
        }
    }

    /// `export { a, b as c }`.
    fn export_specifiers(&mut self, d: &ExportNamedDeclaration<'_>) {
        for sp in d.specifiers.iter().filter(|sp| !sp.export_kind.is_type()) {
            self.out.exports.push((sp.exported.name().to_string(), sp.local.name().to_string()));
        }
    }

    /// `export { a as b } from "./m"`.
    fn export_from(&mut self, d: &ExportFromDeclaration<'_>) {
        let spec = self.spec_id(&d.source.value.display().to_string());
        for sp in d.specifiers.iter().filter(|sp| !sp.export_kind.is_type()) {
            self.out.reexports.push(Reexport {
                spec,
                imported: Some(sp.local.name().to_string()),
                exported: sp.exported.name().to_string(),
            });
        }
    }

    /// `export default`: the local declaration it names, or the anonymous `default`.
    fn export_default(&mut self, d: &ExportDefaultDeclaration<'_>) {
        let local = match &d.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => f.id.as_ref().map(|i| i.name.to_string()),
            ExportDefaultDeclarationKind::ClassDeclaration(c) => c.id.as_ref().map(|i| i.name.to_string()),
            other => match other.as_expression().map(|e| e.get_inner_expression()) {
                Some(Expression::Identifier(i)) => Some(i.name.to_string()),
                _ => None,
            },
        };
        self.out.exports.push(("default".to_string(), local.unwrap_or_else(|| "default".to_string())));
    }

    /// `export function f`, `export class C`, `export const a = ..., b = ...`.
    fn export_declaration(&mut self, decl: &Declaration<'_>) {
        let names: Vec<String> = match decl {
            Declaration::FunctionDeclaration(f) => f.id.iter().map(|i| i.name.to_string()).collect(),
            Declaration::ClassDeclaration(c) => c.id.iter().map(|i| i.name.to_string()).collect(),
            Declaration::VariableDeclaration(v) => v
                .declarations
                .iter()
                .filter_map(|x| match &x.id {
                    BindingPattern::BindingIdentifier(b) => Some(b.name.to_string()),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        };
        for n in names {
            self.out.exports.push((n.clone(), n));
        }
    }

    fn take_pending(&mut self, start: u32) -> Option<Pending> {
        let i = self.pending.iter().position(|p| p.start == start)?;
        Some(self.pending.swap_remove(i))
    }

    fn text(&self, span: Span) -> &'s str {
        self.src.get(span.start as usize..span.end as usize).unwrap_or("")
    }

    fn key_name(&self, key: &PropertyKey<'_>) -> String {
        match key.static_name() {
            Some(n) => n.as_str().map_or_else(|| n.display().to_string(), str::to_string),
            None => format!("[{}]", self.text(key.span())),
        }
    }

    /// Give the function starting at the (unwrapped) initialiser the declarator's name. A call
    /// passes the name to its first function-valued argument.
    fn hint(&mut self, init: &Expression<'_>, name: &str, kind: Option<u8>) {
        let e = init.get_inner_expression();
        let start = match e {
            Expression::FunctionExpression(f) => Some(f.span.start),
            Expression::ArrowFunctionExpression(a) => Some(a.span.start),
            Expression::ClassExpression(c) => Some(c.span.start),
            Expression::ObjectExpression(o) => Some(o.span.start),
            Expression::CallExpression(c) => c.arguments.iter().find_map(|a| {
                match a.as_expression()?.get_inner_expression() {
                    Expression::FunctionExpression(f) => Some(f.span.start),
                    Expression::ArrowFunctionExpression(f) => Some(f.span.start),
                    _ => None,
                }
            }),
            _ => None,
        };
        if let Some(start) = start {
            self.pending.push(Pending { start, name: name.to_string(), kind });
        }
    }

    /// Open a control node under the current parent and make it the parent of what follows.
    /// Returns false (and does nothing) outside any function.
    fn open(&mut self, kind: u8) -> bool {
        let Some(id) = self.leaf(kind) else { return false };
        self.frames.last_mut().unwrap().stack.push(id);
        true
    }

    /// Open a decision block (a branch, multi-branch or loop): a control node plus its
    /// condition's facts. Returns false outside any function.
    fn open_decision(
        &mut self,
        kind: u8,
        test: Option<&Expression<'_>>,
        iter: Option<&Expression<'_>>,
        predicates: bool,
    ) -> bool {
        let Some(id) = self.leaf(kind) else { return false };
        self.frames.last_mut().unwrap().stack.push(id);
        self.begin_block(id, test, iter, predicates);
        true
    }

    fn close_decision(&mut self, opened: bool) {
        if opened {
            self.end_block();
        }
        self.close(opened);
    }

    fn open_loop(&mut self, test: Option<&Expression<'_>>, iter: Option<&Expression<'_>>) -> bool {
        let opened = self.open_decision(ct::LOOP, test, iter, true);
        if opened {
            self.frames.last_mut().unwrap().loops += 1;
        }
        opened
    }

    fn close_loop(&mut self, opened: bool) {
        if opened {
            self.frames.last_mut().unwrap().loops -= 1;
        }
        self.close_decision(opened);
    }

    fn close(&mut self, opened: bool) {
        if opened {
            self.frames.last_mut().unwrap().stack.pop();
        }
    }

    /// Add a control node that is not a parent of anything.
    fn leaf(&mut self, kind: u8) -> Option<u32> {
        let f = self.frames.last_mut()?;
        let id = f.next_node;
        f.next_node += 1;
        let parent = *f.stack.last().unwrap();
        self.out.ct.push(CtRec { fn_local: f.local, node: id, parent, kind });
        Some(id)
    }

    /// One short-circuit node per `?.` in a pure member chain that the walk will not descend into.
    fn optional_in_chain(&mut self, e: &Expression<'_>) {
        let mut cur = e.get_inner_expression();
        loop {
            cur = match cur {
                Expression::StaticMemberExpression(m) => {
                    if m.optional {
                        self.short_circuit(op::OPTIONAL);
                    }
                    m.object.get_inner_expression()
                }
                Expression::ComputedMemberExpression(m) => {
                    if m.optional {
                        self.short_circuit(op::OPTIONAL);
                    }
                    m.object.get_inner_expression()
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        if m.optional {
                            self.short_circuit(op::OPTIONAL);
                        }
                        m.object.get_inner_expression()
                    }
                    _ => return,
                },
                _ => return,
            };
        }
    }

    /// A kind-6 node, and the operator behind it.
    fn short_circuit(&mut self, code: u8) {
        let Some(node) = self.leaf(ct::SHORT_CIRCUIT) else { return };
        let fn_local = self.frames.last().map_or(0, |f| f.local);
        self.out.ops.push(CoRec { fn_local, node, op: code });
    }

    fn exit(&mut self, start: u32) {
        if !self.not_exit.contains(&start) {
            self.leaf(ct::EXIT);
        }
    }

    /// Register a function and make it the current one.
    fn enter(&mut self, span: Span, own: Option<&str>, default_kind: u8, is_async: bool) {
        let pend = self.take_pending(span.start);
        let kind = pend.as_ref().and_then(|p| p.kind).unwrap_or(default_kind);
        let name = own.map(str::to_string).or_else(|| pend.map(|p| p.name));
        let (element, ordinal, anonymous) = self.element_of(name.as_deref(), kind);
        let chain = if self.prefix.is_empty() { element.clone() } else { format!("{}>{element}", self.prefix) };
        let key = self.fn_key(&element, anonymous, kind, ordinal);
        let (start_line, end_line, loc) = self.lines.measure(span);
        let parent = self.frames.last().map(|f| f.local);
        // The boundary marker belongs to the parent's tree.
        self.leaf(ct::NESTED_FN);
        let local = self.out.fns.len() as u32;
        self.out.fns.push(FnRec { start_line, end_line, parent, loc, kind, chain, key });
        if let Some(i) = self.pending_entry.iter().position(|p| p.0 == span.start) {
            let kind = self.pending_entry.swap_remove(i).1;
            self.out.entries.push((local, kind));
        }
        let frame_ctx = self.frame_ctx(span.start, is_async);
        self.frames.push(Frame { local, blocks: BlockAcc::default(), next_node: 1, ctx: frame_ctx, loops: 0, stack: vec![0] });
        if is_async {
            self.syntax_site("async-fn");
        }
        self.push_container(&element);
    }

    /// The chain element of a function, its ordinal, and whether it is anonymous.
    fn element_of(&mut self, name: Option<&str>, kind: u8) -> (String, u32, bool) {
        match name {
            Some(n) => (n.to_string(), self.ordinal(n.as_bytes(), kind, false), false),
            None => {
                let ord = self.ordinal(b"", kind, true);
                (format!("#{ord}"), ord, true)
            }
        }
    }

    fn fn_key(&self, element: &str, anonymous: bool, kind: u8, ordinal: u32) -> u64 {
        let mut digits = [0u8; 10];
        let key_name: &[u8] = if anonymous { b"" } else { element.as_bytes() };
        fnv_parts(&[self.rel.as_bytes(), &self.key_prefix, key_name, &[kind], dec(ordinal, &mut digits)])
    }

    /// `CS.ctx` bits for a function: the enclosing function's, the test-file bit at the top,
    /// its own async, and any wrapper call's bits for the function starting at `start`.
    fn frame_ctx(&mut self, start: u32, is_async: bool) -> u8 {
        let inherited = match self.frames.last() {
            Some(f) => f.ctx,
            None => self.file_ctx,
        };
        let wrapped = self
            .pending_ctx
            .iter()
            .position(|p| p.0 == start)
            .map_or(0, |i| self.pending_ctx.swap_remove(i).1);
        inherited | wrapped | if is_async { ctx::ASYNC } else { 0 }
    }

    fn leave(&mut self) {
        if let Some(f) = self.frames.pop() {
            self.finish_blocks(f.local, f.blocks);
        }
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

    /// Next ordinal for this (container chain, name, kind); anonymous functions count per chain
    /// regardless of kind.
    fn ordinal(&mut self, name: &[u8], kind: u8, anonymous: bool) -> u32 {
        let tag: &[u8] = if anonymous { &[1] } else { &[0, kind] };
        let h = fnv_parts(&[self.prefix.as_bytes(), name, tag]);
        let slot = self.counters.entry(h).or_insert(0);
        let ord = *slot;
        *slot += 1;
        ord
    }


    // ---- calls, bindings and handlers (need scoping and a catalog) ----------------------------

    fn intern(&mut self, sym: &str) -> u32 {
        if let Some(&i) = self.sym_ids.get(sym) {
            return i;
        }
        let i = self.out.syms.len() as u32;
        self.out.syms.push(sym.to_string());
        self.sym_ids.insert(sym.to_string(), i);
        i
    }

    /// A `CS` site for `sym` in the current function. Outside any function there is no `fn` to
    /// attribute it to, so nothing is emitted.
    fn call_site(&mut self, sym: &str) -> bool {
        let Some(f) = self.frames.last() else { return false };
        let (fn_local, loop_depth, c) = (f.local, f.loops, f.ctx);
        let id = self.intern(sym);
        let kind = SiteKind::Call { sym: id, loop_depth, ctx: c, consts: Box::default() };
        self.out.sites.push(Site { fn_local, kind });
        true
    }

    /// `call_site` for a call with arguments: also records which arguments are constants (`AL`).
    fn call_site_args(&mut self, sym: &str, args: &[Argument<'_>]) {
        if !self.call_site(sym) {
            return;
        }
        let consts: Vec<(u8, u8)> = args
            .iter()
            .enumerate()
            .filter_map(|(i, a)| Some((u8::try_from(i).ok()?, self.const_kind(a.as_expression()?)?)))
            .collect();
        if let Some(Site { kind: SiteKind::Call { consts: c, .. }, .. }) = self.out.sites.last_mut() {
            *c = consts.into();
        }
    }

    /// `AL` kind of an argument: 1 a string, number or boolean literal, 2 a template with no
    /// substitution, 3 an identifier bound once to such a literal.
    fn const_kind(&self, e: &Expression<'_>) -> Option<u8> {
        match e.get_inner_expression() {
            Expression::StringLiteral(_) | Expression::NumericLiteral(_) | Expression::BooleanLiteral(_) => Some(1),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() => Some(2),
            Expression::Identifier(i) => {
                let sid = i.reference_id.get().and_then(|r| self.scoping?.get_reference(r).symbol_id())?;
                self.lit_consts.contains(&sid).then_some(3)
            }
            _ => None,
        }
    }

    /// A `CS` site for the language construct `name`, as the symbol `syntax#<name>`, when an
    /// active rule could fire on it here. Core names the constructs; only catalog data gives them
    /// a class and a rule. Constructs are common (`await` alone is tens of thousands of sites in a
    /// large app), so a site no active rule can match is not emitted: that loses no finding.
    fn syntax_site(&mut self, name: &str) {
        let Some(ctx) = self.frames.last().map(|f| f.ctx) else { return };
        let sym = format!("syntax#{name}");
        if self.index.is_some_and(|ix| ix.may_fire(&sym, ctx)) {
            self.call_site(&sym);
        }
    }

    fn is_query(&self, sym: &str) -> bool {
        self.index.is_some_and(|ix| ix.classes(sym).contains(&1))
    }

    /// The SQL text of a query-class call: its first argument.
    fn sql_call(&mut self, sym: &str, args: &[Argument<'_>], span: Span) {
        if !self.is_query(sym) {
            return;
        }
        let (kind, text) = match args.first().and_then(|a| a.as_expression()).map(|e| e.get_inner_expression()) {
            Some(Expression::StringLiteral(l)) => (SqlTextKind::Literal, l.value.display().to_string()),
            Some(Expression::TemplateLiteral(t)) => template_text(t),
            _ => (SqlTextKind::Dynamic, String::new()),
        };
        self.push_sql(span, kind, text);
    }

    fn push_sql(&mut self, span: Span, kind: SqlTextKind, text: String) {
        let fn_local = self.frames.last().map(|f| f.local);
        let ct_node = self.frames.last().and_then(|f| f.stack.last().copied()).unwrap_or(0);
        let line = self.lines.line(span.start);
        self.out.sql.push(SqlTextRec { fn_local, line, ct_node, text, kind });
    }

    fn handler_site(&mut self, shape: u8) {
        let Some(f) = self.frames.last() else { return };
        let fn_local = f.local;
        self.out.sites.push(Site { fn_local, kind: SiteKind::Handler { shape } });
    }

    fn chain_static(&self, m: &StaticMemberExpression<'_>) -> Option<Chain> {
        let mut c = self.chain(&m.object)?;
        c.path.push(m.property.name.to_string());
        Some(c)
    }

    /// A pure `ident.a.b` (or `ident["a"]`) chain: its root and the members after it.
    fn chain(&self, e: &Expression<'_>) -> Option<Chain> {
        match e.get_inner_expression() {
            Expression::Identifier(id) => {
                Some(Chain { root: id.name.to_string(), rid: id.reference_id.get(), path: Vec::new() })
            }
            Expression::ThisExpression(_) => Some(Chain { root: "this".to_string(), rid: None, path: Vec::new() }),
            Expression::StaticMemberExpression(m) => self.chain_static(m),
            Expression::ComputedMemberExpression(m) => {
                let Expression::StringLiteral(l) = m.expression.get_inner_expression() else { return None };
                let mut c = self.chain(&m.object)?;
                c.path.push(l.value.display().to_string());
                Some(c)
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => self.chain_static(m),
                _ => None,
            },
            _ => None,
        }
    }

    fn type_chain(&self, t: &TSTypeName<'_>) -> Option<Chain> {
        match t {
            TSTypeName::IdentifierReference(id) => {
                Some(Chain { root: id.name.to_string(), rid: id.reference_id.get(), path: Vec::new() })
            }
            TSTypeName::QualifiedName(q) => {
                let mut c = self.type_chain(&q.left)?;
                c.path.push(q.right.name.to_string());
                Some(c)
            }
            TSTypeName::ThisExpression(_) => None,
        }
    }

    fn resolve(&self, c: &Chain) -> Target {
        let Some(sc) = self.scoping else { return Target::None };
        if c.root == "this" && c.rid.is_none() {
            return self.resolve_this(c);
        }
        match c.rid.and_then(|r| sc.get_reference(r).symbol_id()) {
            Some(sid) => {
                if let Some(base) = self.imports.get(&sid) {
                    Target::Sym(c.path.iter().fold(base.clone(), |b, seg| join(&b, seg)))
                } else if self.bound.contains_key(&sid) {
                    Target::Bound(sid)
                } else {
                    Target::None
                }
            }
            None => {
                let mut s = format!("global#{}", c.root);
                for seg in &c.path {
                    s.push('.');
                    s.push_str(seg);
                }
                Target::Sym(s)
            }
        }
    }

    /// The catalog symbol a type annotation names, when the annotation is a plain type reference.
    fn type_sym(&self, ann: &TSTypeAnnotation<'_>) -> Option<String> {
        let TSType::TSTypeReference(r) = &ann.type_annotation else { return None };
        match self.resolve(&self.type_chain(&r.type_name)?) {
            Target::Sym(s) => Some(s),
            _ => None,
        }
    }

    /// What `this.<field>` can hold in `class`: its imported base class and its typed fields,
    /// including constructor parameter properties (`constructor(private ctx: T)`).
    fn class_ctx(&self, class: &Class<'_>) -> ClassCtx {
        let mut cx = ClassCtx { chain: self.prefix.clone(), ..ClassCtx::default() };
        if self.index.is_none() {
            return cx;
        }
        cx.base = class.heritage.as_ref().and_then(|h| self.sym_of(&h.expression));
        for el in &class.body.body {
            match el {
                ClassElement::PropertyDefinition(p) if !p.r#static => self.add_field(&mut cx, p),
                ClassElement::MethodDefinition(m) if m.kind == MethodDefinitionKind::Constructor => {
                    self.add_promoted(&mut cx, &m.value.params)
                }
                _ => {}
            }
        }
        cx
    }

    fn add_field(&self, cx: &mut ClassCtx, p: &PropertyDefinition<'_>) {
        let (Some(ann), Some(name)) = (&p.type_annotation, p.key.static_name()) else { return };
        let (Some(sym), Some(n)) = (self.type_sym(ann), name.as_str()) else { return };
        cx.props.insert(n.to_string(), sym);
    }

    /// `constructor(private ctx: T)` declares a field `ctx` of type `T`.
    fn add_promoted(&self, cx: &mut ClassCtx, params: &FormalParameters<'_>) {
        for item in &params.items {
            if item.accessibility.is_none() && !item.readonly {
                continue;
            }
            let (BindingPattern::BindingIdentifier(b), Some(ann)) = (&item.pattern, &item.type_annotation) else {
                continue;
            };
            if let Some(sym) = self.type_sym(ann) {
                cx.props.insert(b.name.to_string(), sym);
            }
        }
    }

    /// `this.<field>...` inside a class: a typed field first, then the imported base class.
    fn resolve_this(&self, c: &Chain) -> Target {
        let (Some(cls), Some((first, rest))) = (self.classes.last(), c.path.split_first()) else {
            return Target::None;
        };
        if let Some(ty) = cls.props.get(first) {
            return Target::Held { sym: ty.clone(), via: Via::Yield, rest: rest.to_vec() };
        }
        match &cls.base {
            Some(b) => Target::Held { sym: b.clone(), via: Via::Yield, rest: c.path.clone() },
            None => Target::None,
        }
    }

    fn sym_of(&self, e: &Expression<'_>) -> Option<String> {
        match self.resolve(&self.chain(e)?) {
            Target::Sym(s) => Some(s),
            _ => None,
        }
    }

    fn has_via(&self, sym: &str, via: Via) -> bool {
        self.index.is_some_and(|ix| ix.entries(sym).iter().any(|e| e.via == via))
    }

    /// Record `symbol` as bound to catalog symbol `sym` when the catalog has a matching entry.
    fn bind(&mut self, sid: Option<SymbolId>, sym: String, via: Via) {
        if let Some(sid) = sid {
            if self.has_via(&sym, via) {
                self.bound.insert(sid, Bound { sym, via });
            }
        }
    }

    /// What a declarator initialiser binds: `yield* S` and `await S` (via Yield), `yield* S(..)`
    /// and `await S(..)` (YieldResult), and a plain `S(..)` (Result).
    fn classify_init(&self, init: &Expression<'_>) -> Option<(String, Via)> {
        let target = |x: &Expression<'_>, ident: Via, call: Via| -> Option<(String, Via)> {
            match x.get_inner_expression() {
                Expression::CallExpression(c) => Some((self.sym_of(&c.callee)?, call)),
                other => Some((self.sym_of(other)?, ident)),
            }
        };
        match init.get_inner_expression() {
            Expression::YieldExpression(y) if y.delegate => {
                target(y.argument.as_ref()?, Via::Yield, Via::YieldResult)
            }
            Expression::AwaitExpression(a) => target(&a.argument, Via::Yield, Via::YieldResult),
            Expression::CallExpression(c) => Some((self.sym_of(&c.callee)?, Via::Result)),
            _ => None,
        }
    }

    fn bind_annotation(&mut self, sid: Option<SymbolId>, ann: &TSTypeAnnotation<'_>) {
        let TSType::TSTypeReference(r) = &ann.type_annotation else { return };
        let Some(c) = self.type_chain(&r.type_name) else { return };
        if let Target::Sym(sym) = self.resolve(&c) {
            self.bind(sid, sym, Via::Yield);
        }
    }

    fn function_arg<'e, 'a>(&self, a: &'e Argument<'a>) -> Option<&'e Expression<'a>> {
        let e = a.as_expression()?.get_inner_expression();
        matches!(e, Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)).then_some(e)
    }

    /// A wrapper call hands its ctx bits to every function it takes: a function argument, or a
    /// function-valued property of an object-literal argument (`Effect.tryPromise({ try, catch })`).
    fn wrap_args(&mut self, args: &[Argument<'_>], bits: u8) {
        for a in args {
            match a.as_expression().map(|e| e.get_inner_expression()) {
                Some(Expression::ObjectExpression(o)) => {
                    for p in &o.properties {
                        if let ObjectPropertyKind::ObjectProperty(p) = p {
                            self.wrap_fn(&p.value, bits);
                        }
                    }
                }
                Some(e) => self.wrap_fn(e, bits),
                None => {}
            }
        }
    }

    fn wrap_fn(&mut self, e: &Expression<'_>, bits: u8) {
        let start = match e.get_inner_expression() {
            Expression::FunctionExpression(f) => f.span.start,
            Expression::ArrowFunctionExpression(f) => f.span.start,
            _ => return,
        };
        self.pending_ctx.push((start, bits));
    }

    fn handler_args(&mut self, args: &[Argument<'_>], arg: Arg) {
        let shapes: Vec<u8> = match arg {
            Arg::LastFn => args
                .iter()
                .rev()
                .find_map(|a| self.function_arg(a))
                .map(|e| self.fn_shape(e))
                .into_iter()
                .collect(),
            Arg::ObjectFns => args.iter().flat_map(|a| self.object_fn_shapes(a)).collect(),
        };
        for sh in shapes {
            self.handler_site(sh);
        }
    }

    /// Shapes of the function-valued properties of an object-literal argument (`catchTags`).
    fn object_fn_shapes(&self, a: &Argument<'_>) -> Vec<u8> {
        let Some(Expression::ObjectExpression(o)) = a.as_expression().map(|e| e.get_inner_expression()) else {
            return Vec::new();
        };
        o.properties
            .iter()
            .filter_map(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => Some(p.value.get_inner_expression()),
                _ => None,
            })
            .filter(|v| matches!(v, Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)))
            .map(|v| self.fn_shape(v))
            .collect()
    }

    fn fn_shape(&self, e: &Expression<'_>) -> u8 {
        let param_name = |p: &FormalParameters<'_>| match p.items.first().map(|i| &i.pattern) {
            Some(BindingPattern::BindingIdentifier(b)) => Some(b.name.to_string()),
            _ => None,
        };
        match e {
            Expression::ArrowFunctionExpression(f) => {
                let param = param_name(&f.params);
                match &f.body {
                    ArrowFunctionBody::FunctionBody(b) => self.stmts_shape(&b.statements, param.as_deref()),
                    other => other.as_expression().map_or(shape::OTHER, |e| self.expr_shape(e)),
                }
            }
            Expression::FunctionExpression(f) => {
                let param = param_name(&f.params);
                match &f.body {
                    Some(b) => self.stmts_shape(&b.statements, param.as_deref()),
                    None => shape::OTHER,
                }
            }
            _ => shape::OTHER,
        }
    }

    fn is_constant(&self, e: &Expression<'_>) -> bool {
        match e.get_inner_expression() {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_) => true,
            Expression::TemplateLiteral(t) => t.expressions.is_empty(),
            Expression::Identifier(i) => i.name == "undefined",
            Expression::UnaryExpression(u) => u.operator == UnaryOperator::Void,
            Expression::ArrayExpression(a) => a.elements.is_empty(),
            Expression::ObjectExpression(o) => o.properties.is_empty(),
            _ => false,
        }
    }

    /// A call of a symbol the catalog puts in class 3 (log), awaiting allowed.
    fn is_log_call(&self, e: &Expression<'_>) -> bool {
        let e = match e.get_inner_expression() {
            Expression::AwaitExpression(a) => a.argument.get_inner_expression(),
            other => other,
        };
        let Expression::CallExpression(c) = e else { return false };
        self.sym_of(&c.callee)
            .is_some_and(|s| self.index.is_some_and(|ix| ix.entries(&s).iter().any(|x| x.class == 3 && x.via == Via::Call)))
    }

    fn expr_shape(&self, e: &Expression<'_>) -> u8 {
        if self.is_constant(e) {
            shape::CONSTANT
        } else if self.is_log_call(e) {
            shape::ONLY_LOGS
        } else {
            shape::OTHER
        }
    }

    fn throw_shape(&self, e: &Expression<'_>, param: Option<&str>) -> u8 {
        let is_param = |x: &Expression<'_>| matches!(x.get_inner_expression(), Expression::Identifier(i) if Some(i.name.as_str()) == param);
        let carries = |args: &[Argument<'_>]| {
            args.iter().any(|a| match a.as_expression().map(|x| x.get_inner_expression()) {
                Some(x) if is_param(x) => true,
                Some(Expression::ObjectExpression(o)) => o.properties.iter().any(|p| {
                    matches!(p, ObjectPropertyKind::ObjectProperty(p)
                        if !p.computed && p.key.static_name().is_some_and(|n| n.as_str() == Some("cause")))
                }),
                _ => false,
            })
        };
        let with_cause = match e.get_inner_expression() {
            x if is_param(x) => true,
            Expression::NewExpression(n) => carries(&n.arguments),
            Expression::CallExpression(c) => carries(&c.arguments),
            _ => false,
        };
        if with_cause { shape::RETHROW_CAUSE } else { shape::RETHROW_NO_CAUSE }
    }

    fn stmts_shape(&self, stmts: &[Statement<'_>], param: Option<&str>) -> u8 {
        if stmts.is_empty() {
            return shape::EMPTY;
        }
        if let Some(Statement::ThrowStatement(t)) = stmts.last() {
            return self.throw_shape(&t.argument, param);
        }
        // A trailing `return <constant>` does not stop a handler from being "only logs".
        let (body, returned) = match stmts.last() {
            Some(Statement::ReturnStatement(r)) if r.argument.as_ref().map_or(true, |a| self.is_constant(a)) => {
                (&stmts[..stmts.len() - 1], true)
            }
            _ => (stmts, false),
        };
        if body.is_empty() {
            return if returned { shape::CONSTANT } else { shape::EMPTY };
        }
        let all_logs = body.iter().all(|s| matches!(s, Statement::ExpressionStatement(x) if self.is_log_call(&x.expression)));
        if all_logs { shape::ONLY_LOGS } else { shape::OTHER }
    }

    /// Does the value bound to `sid` count for this use?
    fn bound_use(&self, sid: SymbolId, path: &[String], tag: bool) -> Option<String> {
        let b = self.bound.get(&sid)?;
        self.use_of(&b.sym, b.via, path, tag)
    }

    /// Does a use of a value held for catalog symbol `sym` (a method path, a call or a tag)
    /// match one of its entries? Returns the symbol when it does.
    fn use_of(&self, sym: &str, via: Via, path: &[String], tag: bool) -> Option<String> {
        let ix = self.index?;
        let hit = ix.entries(sym).iter().any(|e| {
            e.via == via
                && match (&e.use_, tag, path) {
                    (Use::Tag, true, []) => true,
                    (Use::Call, false, []) => true,
                    (Use::Member(m), false, p) if !p.is_empty() => *m == p.join("."),
                    (Use::AnyMember, false, [_]) => true,
                    _ => false,
                }
        });
        hit.then(|| sym.to_string())
    }

    /// A call of a repo function (`CE`), or why it could not be one (`CU`). Calls that leave the
    /// repo (an external package, a runtime global) are neither.
    fn edge_site(&mut self, it: &CallExpression<'_>) {
        let (Some(sc), Some(f)) = (self.scoping, self.frames.last()) else { return };
        let (fn_local, node, loop_depth, cx) = (f.local, f.stack.last().copied().unwrap_or(0), f.loops, f.ctx);
        let outcome = match self.chain(it.callee.get_inner_expression()) {
            Some(c) => self.callee_of(sc, &c),
            None => Err(unres::DYNAMIC),
        };
        let to = match outcome {
            Ok(Some(Named::Local(chain))) => Callee::Local(self.name_id(&chain)),
            Ok(Some(Named::Import { spec, path })) => Callee::Import { spec, path: self.name_id(&path) },
            Ok(None) => return,
            Err(reason) => {
                self.out.unresolved.push((fn_local, reason));
                return;
            }
        };
        self.out.sites.push(Site { fn_local, kind: SiteKind::Edge { to, node, loop_depth, ctx: cx } });
    }

    /// What a pure name-path callee refers to: an import, a module-level declaration of this file,
    /// a method of the enclosing class, or nothing in the repo.
    fn callee_of(&self, sc: &Scoping, c: &Chain) -> Result<Option<Named>, u8> {
        if c.root == "this" && c.rid.is_none() {
            let class = self.classes.last().map(|k| k.chain.as_str()).filter(|k| !k.is_empty());
            return match (class, c.path.as_slice()) {
                (Some(k), [m]) => Ok(Some(Named::Local(format!("{k}>{m}")))),
                _ => Err(unres::UNKNOWN_MEMBER),
            };
        }
        let Some(sid) = c.rid.and_then(|r| sc.get_reference(r).symbol_id()) else { return Ok(None) };
        if let Some((spec, imported)) = self.import_binds.get(&sid) {
            let path: Vec<&str> = imported.iter().map(String::as_str).chain(c.path.iter().map(String::as_str)).collect();
            if path.is_empty() {
                return Err(unres::DYNAMIC);
            }
            return Ok(Some(Named::Import { spec: *spec, path: path.join(".") }));
        }
        if sc.symbol_scope_id(sid) != sc.root_scope_id() {
            return Err(unres::LOCAL_BINDING);
        }
        match c.path.as_slice() {
            [] => Ok(Some(Named::Local(c.root.clone()))),
            [m] => Ok(Some(Named::Local(format!("{}>{m}", c.root)))),
            _ => Err(unres::UNKNOWN_MEMBER),
        }
    }

    fn on_call(&mut self, it: &CallExpression<'_>) {
        if self.index.is_none() {
            return;
        }
        self.promise_catch(it);
        self.promise_member(it);
        match it.callee.get_inner_expression() {
            Expression::CallExpression(inner) => self.on_applied_call(inner, it),
            callee => self.on_named_call(callee, it),
        }
    }

    /// `.catch(cb)` on anything: a promise rejection handler.
    fn promise_catch(&mut self, it: &CallExpression<'_>) {
        let Expression::StaticMemberExpression(m) = it.callee.get_inner_expression() else { return };
        if m.property.name != "catch" {
            return;
        }
        let shape = it.arguments.iter().rev().find_map(|a| self.function_arg(a)).map(|e| self.fn_shape(e));
        if let Some(sh) = shape {
            self.handler_site(sh);
        }
    }

    /// `x.then(…)`, `x.catch(…)`, `x.finally(…)` where `x` is not an imported symbol, so
    /// `Effect.catch(…)` is not one: the `syntax#member.<name>` site.
    fn promise_member(&mut self, it: &CallExpression<'_>) {
        let Expression::StaticMemberExpression(m) = it.callee.get_inner_expression() else { return };
        let name = m.property.name.as_str();
        if !matches!(name, "then" | "catch" | "finally") {
            return;
        }
        if self.sym_of(&m.object).is_some_and(|s| !s.starts_with("global#")) {
            return;
        }
        self.syntax_site(&format!("member.{name}"));
    }

    /// `S(...)(...)`: a wrapper applied in two steps, or the result of S called at once.
    fn on_applied_call(&mut self, inner: &CallExpression<'_>, it: &CallExpression<'_>) {
        let (Some(ix), Some(sym)) = (self.index, self.sym_of(&inner.callee)) else { return };
        if let Some(w) = ix.wrapper(&sym) {
            self.wrap_args(&it.arguments, w.ctx);
        }
        if ix.entries(&sym).iter().any(|e| e.via == Via::Result && e.use_ == Use::Call) {
            self.call_site_args(&sym, &it.arguments);
            self.sql_call(&sym, &it.arguments, it.span);
        }
    }

    /// A call whose callee is an `ident.a.b` chain: a catalog symbol, or a bound value's method.
    fn on_named_call(&mut self, callee: &Expression<'_>, it: &CallExpression<'_>) {
        let Some(c) = self.chain(callee) else { return };
        match self.resolve(&c) {
            Target::Sym(sym) => self.on_symbol_call(&sym, it),
            Target::Bound(sid) => {
                if let Some(sym) = self.bound_use(sid, &c.path, false) {
                    self.call_site_args(&sym, &it.arguments);
                    self.sql_call(&sym, &it.arguments, it.span);
                }
            }
            Target::Held { sym, via, rest } => {
                if let Some(sym) = self.use_of(&sym, via, &rest, false) {
                    self.call_site_args(&sym, &it.arguments);
                    self.sql_call(&sym, &it.arguments, it.span);
                }
            }
            Target::None => {}
        }
    }

    fn on_symbol_call(&mut self, sym: &str, it: &CallExpression<'_>) {
        let Some(ix) = self.index else { return };
        if self.has_via(sym, Via::Call) {
            self.call_site_args(sym, &it.arguments);
            self.sql_call(sym, &it.arguments, it.span);
        }
        if let Some(w) = ix.wrapper(sym) {
            self.wrap_args(&it.arguments, w.ctx);
        }
        if let Some(arg) = ix.handler(sym) {
            self.handler_args(&it.arguments, arg);
        }
        if let Some(kind) = ix.callback_entry(sym) {
            self.entry_args(&it.arguments, kind);
        }
    }

    /// The function arguments of a registration call are entry points of this kind.
    fn entry_args(&mut self, args: &[Argument<'_>], kind: u8) {
        for a in args {
            let start = match a.as_expression().map(|e| e.get_inner_expression()) {
                Some(Expression::FunctionExpression(f)) => f.span.start,
                Some(Expression::ArrowFunctionExpression(f)) => f.span.start,
                _ => continue,
            };
            self.pending_entry.push((start, kind));
        }
    }

    /// Mark the one-level members `container>member` of the functions registered since
    /// `first` as entry points, by the catalog's kind for that member.
    fn mark_members(&mut self, first: usize, container: &str, kind_of: impl Fn(&str) -> Option<u8>) {
        let prefix = format!("{container}>");
        let found: Vec<(u32, u8)> = self.out.fns[first..]
            .iter()
            .enumerate()
            .filter_map(|(i, f)| {
                let member = f.chain.strip_prefix(&prefix).filter(|m| !m.contains('>'))?;
                Some(((first + i) as u32, kind_of(member)?))
            })
            .collect();
        self.out.entries.extend(found);
    }

    /// The catalog symbol a tagged template's tag stands for, when the tag is a bound value.
    fn tag_use(&self, tag: &Expression<'_>) -> Option<String> {
        self.index?;
        let c = self.chain(tag)?;
        match self.resolve(&c) {
            Target::Bound(sid) => self.bound_use(sid, &c.path, true),
            Target::Held { sym, via, rest } => self.use_of(&sym, via, &rest, true),
            _ => None,
        }
    }

    /// `ref` and `read` events on a maximal chain: the longest prefix the catalog knows.
    fn on_chain_ref(&mut self, c: &Chain) {
        let Target::Sym(full) = self.resolve(c) else { return };
        let mut sym = full;
        loop {
            if self.has_via(&sym, Via::Ref) || self.has_via(&sym, Via::Read) {
                self.call_site(&sym);
                return;
            }
            match sym.rfind('.') {
                Some(i) if sym[..i].contains('#') => sym.truncate(i),
                _ => return,
            }
        }
    }

    /// Mark the final top-level `return`/`throw` of a body as not an early exit.
    fn mark_terminal(&mut self, body: &[Statement<'_>]) {
        match body.last() {
            Some(Statement::ReturnStatement(r)) => {
                self.not_exit.insert(r.span.start);
            }
            Some(Statement::ThrowStatement(t)) => {
                self.not_exit.insert(t.span.start);
            }
            _ => {}
        }
    }
}

/// The symbol and imported member (`None` for a namespace import) of a value import specifier.
fn import_binding(sp: &ImportDeclarationSpecifier<'_>) -> Option<(SymbolId, Option<String>)> {
    match sp {
        ImportDeclarationSpecifier::ImportSpecifier(i) if i.import_kind.is_type() => None,
        ImportDeclarationSpecifier::ImportSpecifier(i) => {
            Some((i.local.symbol_id.get()?, Some(i.imported.name().to_string())))
        }
        ImportDeclarationSpecifier::ImportDefaultSpecifier(i) => {
            Some((i.local.symbol_id.get()?, Some("default".to_string())))
        }
        ImportDeclarationSpecifier::ImportNamespaceSpecifier(i) => Some((i.local.symbol_id.get()?, None)),
    }
}

/// A template literal as SQL: quasis joined with `?` for each `${expr}`.
fn template_text(t: &TemplateLiteral<'_>) -> (SqlTextKind, String) {
    let mut text = String::new();
    for (i, q) in t.quasis.iter().enumerate() {
        if i > 0 {
            text.push('?');
        }
        text.push_str(q.value.raw.as_str());
    }
    let kind = if t.expressions.is_empty() { SqlTextKind::Literal } else { SqlTextKind::Template };
    (kind, text)
}

/// The unlabelled `break` that ends a switch case, looking through one level of block.
fn case_ending_break(body: &[Statement<'_>]) -> Option<u32> {
    match body.last()? {
        Statement::BreakStatement(b) if b.label.is_none() => Some(b.span.start),
        Statement::BlockStatement(b) => case_ending_break(&b.body),
        _ => None,
    }
}

impl<'a> Visit<'a> for Walker<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if it.body.is_none() {
            return; // overload signature or `declare function`: no code
        }
        let default_kind =
            if matches!(it.r#type, FunctionType::FunctionDeclaration) { fk::DECL } else { fk::FN_EXPR };
        self.enter(it.span, it.id.as_ref().map(|i| i.name.as_str()), default_kind, it.r#async);
        walk::walk_function(self, it, flags);
        self.leave();
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.enter(it.span, None, fk::ARROW, it.r#async);
        walk::walk_arrow_function_expression(self, it);
        self.leave();
    }

    fn visit_static_block(&mut self, it: &StaticBlock<'a>) {
        self.enter(it.span, Some("static"), fk::STATIC_BLOCK, false);
        self.mark_terminal(&it.body);
        walk::walk_static_block(self, it);
        self.leave();
    }

    fn visit_function_body(&mut self, it: &FunctionBody<'a>) {
        self.mark_terminal(&it.statements);
        walk::walk_function_body(self, it);
    }

    // ---- naming -------------------------------------------------------------------------

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        self.hooked(|h, cx| h.on_declarator(cx, it));
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            self.hint(init, id.name.as_str(), None);
        }
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            if let Some(sid) = id.symbol_id.get() {
                self.note_write(&format!("{sid:?}"));
                let literal = matches!(
                    init.get_inner_expression(),
                    Expression::StringLiteral(_) | Expression::NumericLiteral(_) | Expression::BooleanLiteral(_)
                ) || matches!(init.get_inner_expression(), Expression::TemplateLiteral(t) if t.expressions.is_empty());
                if literal && self.scoping.is_some_and(|sc| !sc.symbol_is_mutated(sid)) {
                    self.lit_consts.insert(sid);
                }
            }
        }
        if let BindingPattern::BindingIdentifier(id) = &it.id {
            if self.index.is_some() {
                if let Some((sym, via)) = it.init.as_ref().and_then(|i| self.classify_init(i)) {
                    self.bind(id.symbol_id.get(), sym, via);
                } else if let Some(ann) = &it.type_annotation {
                    self.bind_annotation(id.symbol_id.get(), ann);
                }
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        let name = self.key_name(&it.key);
        let kind = match it.kind {
            PropertyKind::Get => Some(fk::GETTER),
            PropertyKind::Set => Some(fk::SETTER),
            PropertyKind::Init if it.method => Some(fk::METHOD),
            PropertyKind::Init => None,
        };
        self.hint(&it.value, &name, kind);
        walk::walk_object_property(self, it);
    }

    fn visit_property_definition(&mut self, it: &PropertyDefinition<'a>) {
        if let Some(v) = &it.value {
            let name = self.key_name(&it.key);
            self.hint(v, &name, None);
        }
        walk::walk_property_definition(self, it);
    }

    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        let kind = match it.kind {
            MethodDefinitionKind::Constructor => fk::CTOR,
            MethodDefinitionKind::Method => fk::METHOD,
            MethodDefinitionKind::Get => fk::GETTER,
            MethodDefinitionKind::Set => fk::SETTER,
        };
        let name = if kind == fk::CTOR { "constructor".to_string() } else { self.key_name(&it.key) };
        self.pending.push(Pending { start: it.value.span.start, name, kind: Some(kind) });
        walk::walk_method_definition(self, it);
    }

    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        match &it.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) if f.id.is_none() => {
                self.pending.push(Pending { start: f.span.start, name: "default".into(), kind: None });
            }
            ExportDefaultDeclarationKind::ClassDeclaration(c) if c.id.is_none() => {
                self.pending.push(Pending { start: c.span.start, name: "default".into(), kind: None });
            }
            other => {
                if let Some(e) = other.as_expression() {
                    self.hint(e, "default", None);
                }
            }
        }
        let first = self.out.fns.len();
        walk::walk_export_default_declaration(self, it);
        let is_object = matches!(
            it.declaration.as_expression().map(|e| e.get_inner_expression()),
            Some(Expression::ObjectExpression(_))
        );
        if let (Some(ix), true) = (self.index, is_object) {
            if ix.has_entries() {
                self.mark_members(first, "default", |m| ix.entry_kind(Shape::DefaultExportFns, "", m));
            }
        }
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        self.hooked(|h, cx| h.on_class(cx, it));
        let name = match &it.id {
            Some(id) => id.name.to_string(),
            None => self.take_pending(it.span.start).map_or_else(|| "#".to_string(), |p| p.name),
        };
        self.push_container(&name);
        let ctx = self.class_ctx(it);
        let (chain, base) = (ctx.chain.clone(), ctx.base.clone());
        self.classes.push(ctx);
        let first = self.out.fns.len();
        walk::walk_class(self, it);
        self.classes.pop();
        if let (Some(ix), Some(base)) = (self.index, base) {
            if ix.has_entries() {
                self.mark_members(first, &chain, |m| {
                    // A constructor runs inside the platform's own call, it is not an entry.
                    (m != "constructor").then(|| ix.entry_kind(Shape::SubclassMethods, &base, m)).flatten()
                });
            }
        }
        self.pop_container();
    }

    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        let named = self.take_pending(it.span.start);
        if let Some(p) = &named {
            self.push_container(&p.name);
        }
        walk::walk_object_expression(self, it);
        if named.is_some() {
            self.pop_container();
        }
    }

    // ---- control tree -------------------------------------------------------------------

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        let b = self.open_decision(ct::BRANCH, Some(&it.test), None, true);
        self.visit_expression(&it.test);
        let arm = self.open(ct::ARM);
        self.visit_statement(&it.consequent);
        self.close(arm);
        if let Some(alt) = &it.alternate {
            let arm = self.open(ct::ARM);
            self.visit_statement(alt);
            self.close(arm);
        }
        self.close_decision(b);
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        let b = self.open_decision(ct::BRANCH, Some(&it.test), None, true);
        self.visit_expression(&it.test);
        let arm = self.open(ct::ARM);
        self.visit_expression(&it.consequent);
        self.close(arm);
        let arm = self.open(ct::ARM);
        self.visit_expression(&it.alternate);
        self.close(arm);
        self.close_decision(b);
    }

    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        let m = self.open_decision(ct::MULTI, Some(&it.discriminant), None, false);
        let node = self.frames.last().and_then(|f| f.stack.last().copied()).unwrap_or(0);
        self.visit_expression(&it.discriminant);
        for case in &it.cases {
            if case.test.is_none() {
                self.leaf(ct::DEFAULT_FLAG);
            }
            if let Some(b) = case_ending_break(&case.consequent) {
                self.not_exit.insert(b);
            }
            let arm = self.open(ct::ARM);
            if let Some(t) = &case.test {
                if m {
                    self.case_atom(node, &it.discriminant, t);
                }
                self.visit_expression(t);
            }
            for s in &case.consequent {
                self.visit_statement(s);
            }
            self.close(arm);
        }
        self.close_decision(m);
    }

    fn visit_for_statement(&mut self, it: &ForStatement<'a>) {
        let l = self.open_loop(it.test.as_ref(), None);
        walk::walk_for_statement(self, it);
        self.close_loop(l);
    }

    fn visit_for_in_statement(&mut self, it: &ForInStatement<'a>) {
        let l = self.open_loop(None, Some(&it.right));
        walk::walk_for_in_statement(self, it);
        self.close_loop(l);
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        if it.r#await {
            self.syntax_site("await");
        }
        let l = self.open_loop(None, Some(&it.right));
        walk::walk_for_of_statement(self, it);
        self.close_loop(l);
    }

    fn visit_while_statement(&mut self, it: &WhileStatement<'a>) {
        let l = self.open_loop(Some(&it.test), None);
        walk::walk_while_statement(self, it);
        self.close_loop(l);
    }

    fn visit_do_while_statement(&mut self, it: &DoWhileStatement<'a>) {
        let l = self.open_loop(Some(&it.test), None);
        walk::walk_do_while_statement(self, it);
        self.close_loop(l);
    }

    fn visit_try_statement(&mut self, it: &TryStatement<'a>) {
        self.syntax_site("try");
        let t = self.open(ct::TRY);
        let arm = self.open(ct::ARM);
        self.visit_block_statement(&it.block);
        self.close(arm);
        if let Some(h) = &it.handler {
            if self.index.is_some() {
                let param = match h.param.as_ref().map(|p| &p.pattern) {
                    Some(BindingPattern::BindingIdentifier(b)) => Some(b.name.to_string()),
                    _ => None,
                };
                let sh = self.stmts_shape(&h.body.body, param.as_deref());
                self.handler_site(sh);
            }
            let arm = self.open(ct::ARM);
            self.visit_catch_clause(h);
            self.close(arm);
        }
        if let Some(f) = &it.finalizer {
            let arm = self.open(ct::FINALLY);
            self.visit_block_statement(f);
            self.close(arm);
        }
        self.close(t);
    }

    fn visit_logical_expression(&mut self, it: &LogicalExpression<'a>) {
        let code = match it.operator {
            LogicalOperator::And => op::AND,
            LogicalOperator::Or => op::OR,
            LogicalOperator::Coalesce => op::NULLISH,
        };
        self.short_circuit(code);
        walk::walk_logical_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if let Some(k) = self.target_key(&it.left) {
            self.note_write(&k);
        }
        match it.operator {
            AssignmentOperator::LogicalAnd => self.short_circuit(op::AND_ASSIGN),
            AssignmentOperator::LogicalOr => self.short_circuit(op::OR_ASSIGN),
            AssignmentOperator::LogicalNullish => self.short_circuit(op::NULLISH_ASSIGN),
            _ => {}
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_update_expression(&mut self, it: &UpdateExpression<'a>) {
        if let Some(k) = self.simple_key(&it.argument) {
            self.note_write(&k);
        }
        walk::walk_update_expression(self, it);
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        self.exit(it.span.start);
        walk::walk_return_statement(self, it);
    }

    fn visit_throw_statement(&mut self, it: &ThrowStatement<'a>) {
        self.syntax_site("throw");
        self.exit(it.span.start);
        walk::walk_throw_statement(self, it);
    }

    fn visit_break_statement(&mut self, it: &BreakStatement<'a>) {
        self.exit(it.span.start);
        walk::walk_break_statement(self, it);
    }

    fn visit_continue_statement(&mut self, it: &ContinueStatement<'a>) {
        self.exit(it.span.start);
        walk::walk_continue_statement(self, it);
    }

    // ---- call sites and handlers ---------------------------------------------------------

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        self.hooked(|h, cx| h.on_call(cx, it));
        self.note_call_write(it);
        self.edge_site(it);
        self.on_call(it);
        if it.optional {
            self.short_circuit(op::OPTIONAL);
        }
        if self.index.is_some() && self.chain(&it.callee).is_some() {
            // A pure chain holds nothing else to visit, but its `?.` still count.
            self.optional_in_chain(&it.callee);
            for a in &it.arguments {
                self.visit_argument(a);
            }
        } else {
            walk::walk_call_expression(self, it);
        }
    }

    fn visit_await_expression(&mut self, it: &AwaitExpression<'a>) {
        self.syntax_site("await");
        walk::walk_await_expression(self, it);
    }

    fn visit_yield_expression(&mut self, it: &YieldExpression<'a>) {
        if let (true, Some(arg)) = (it.delegate, &it.argument) {
            self.hooked(|h, cx| h.on_yield_star(cx, arg));
        }
        walk::walk_yield_expression(self, it);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        if let (Some(ix), Some(sym)) = (self.index, self.sym_of(&it.callee)) {
            let hit = ix.entries(&sym).iter().any(|e| {
                e.via == Via::New && (e.use_ != Use::NoArgs || it.arguments.is_empty())
            });
            if hit {
                self.call_site_args(&sym, &it.arguments);
            }
        }
        walk::walk_new_expression(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if let Some(sym) = self.tag_use(&it.tag) {
            self.call_site(&sym);
            if self.is_query(&sym) {
                let (kind, text) = template_text(&it.quasi);
                self.push_sql(it.span, kind, text);
            }
        }
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if self.index.is_some() {
            if let Some(c) = self.chain_static(it) {
                // A pure chain is not walked, so its `?.` are counted here, all at once.
                self.optional_in_chain(&it.object);
                if it.optional {
                    self.short_circuit(op::OPTIONAL);
                }
                self.on_chain_ref(&c);
                return;
            }
        }
        if it.optional {
            self.short_circuit(op::OPTIONAL);
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        if it.optional {
            self.short_circuit(op::OPTIONAL);
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_private_field_expression(&mut self, it: &PrivateFieldExpression<'a>) {
        if it.optional {
            self.short_circuit(op::OPTIONAL);
        }
        walk::walk_private_field_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        let (Some(sc), Some(rid)) = (self.scoping, it.reference_id.get()) else { return };
        if let Some(sid) = sc.get_reference(rid).symbol_id() {
            if self.imports.contains_key(&sid) {
                let c = Chain { root: it.name.to_string(), rid: Some(rid), path: Vec::new() };
                self.on_chain_ref(&c);
            }
        }
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        if let (Some(ann), BindingPattern::BindingIdentifier(b)) = (&it.type_annotation, &it.pattern) {
            self.bind_annotation(b.symbol_id.get(), ann);
        }
        walk::walk_formal_parameter(self, it);
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    fn render(rel: &str, src: &str) -> String {
        let alloc = Allocator::default();
        let st = SourceType::from_path(rel).unwrap();
        let ret = Parser::new(&alloc, src, st).parse();
        assert!(!ret.fatal_error, "{rel}: fatal parse error");
        let out = Walker::new(rel, src).run(&ret.program);
        let mut s = String::new();
        for (i, f) in out.fns.iter().enumerate() {
            let parent = f.parent.map_or("-".to_string(), |p| p.to_string());
            s += &format!(
                "FN {i} parent={parent} kind={} loc={} lines={}-{} chain={}\n",
                f.kind, f.loc, f.start_line, f.end_line, f.chain
            );
        }
        let mut ct = out.ct.clone();
        ct.sort_by_key(|c| (c.fn_local, c.node));
        for c in ct {
            s += &format!("CT {} {} {} {}\n", c.fn_local, c.node, c.parent, c.kind);
        }
        let mut ops = out.ops.clone();
        ops.sort_by_key(|o| (o.fn_local, o.node));
        for o in ops {
            s += &format!("CO {} {} {}\n", o.fn_local, o.node, o.op);
        }
        s
    }

    /// Every fixture under `fixtures/ts-fns`: `<name>.ts[x]` against `<name>.expected`, which is
    /// derived by hand from the syntax, never copied from this walker's output.
    #[test]
    fn fixtures_match_hand_checked_expectations() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/ts-fns");
        let mut seen = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "ts" && ext != "tsx" {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let want = std::fs::read_to_string(path.with_extension("expected")).unwrap();
            let rel = path.file_name().unwrap().to_str().unwrap();
            assert_eq!(render(rel, &src), want, "fixture {rel}");
            seen += 1;
        }
        assert!(seen >= 5, "fixtures missing: saw {seen}");
    }

    /// Each `?.` is one short-circuit node (kind 6) with CO op 7: an optional member, a chain, a
    /// call and an element access. A plain member chain adds none.
    #[test]
    fn each_optional_chain_link_is_a_short_circuit_with_op_7() {
        let src = "function f(o: any, k: string) {\n  o?.a?.b;\n  o.f?.(1);\n  o?.[k];\n  return o.x.y;\n}\n";
        let alloc = Allocator::default();
        let ret = Parser::new(&alloc, src, SourceType::ts()).parse();
        let out = Walker::new("m.ts", src).run(&ret.program);
        let short: Vec<u32> = out.ct.iter().filter(|c| c.kind == ct::SHORT_CIRCUIT).map(|c| c.node).collect();
        assert_eq!(short.len(), 4, "o?.a, ?.b, ?.(), ?.[k]");
        assert_eq!(out.ops.len(), 4);
        assert!(out.ops.iter().all(|o| o.op == op::OPTIONAL));
    }

    #[test]
    fn keys_do_not_depend_on_lines() {
        let a = "function f() {}\nfunction g() {}\n";
        let b = "\n\n// moved down\nfunction f() {}\n\nfunction g() {}\n";
        let keys = |src: &str| {
            let alloc = Allocator::default();
            let ret = Parser::new(&alloc, src, SourceType::ts()).parse();
            Walker::new("m.ts", src).run(&ret.program).fns.iter().map(|f| f.key).collect::<Vec<_>>()
        };
        assert_eq!(keys(a), keys(b));
        assert_ne!(keys(a)[0], keys(a)[1]);
    }

    #[test]
    fn a_name_comes_from_the_declarator_for_any_wrapper_call() {
        let src = "const a = memo(() => 1);\nconst b = pipe(1, (x) => x);\nconst c = outer(inner(() => 1));\n";
        let alloc = Allocator::default();
        let ret = Parser::new(&alloc, src, SourceType::ts()).parse();
        let fns = Walker::new("m.ts", src).run(&ret.program).fns;
        let chains: Vec<&str> = fns.iter().map(|f| f.chain.as_str()).collect();
        assert_eq!(chains, ["a", "b", "#0"]);
    }
}
