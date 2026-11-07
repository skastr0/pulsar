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

use crate::lang::functions::{ct, fk, fnv_parts, CtRec, FileFns, FnRec};
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

struct Frame {
    local: u32,
    next_node: u32,
    /// Control parents, innermost last; 0 is the function body.
    stack: Vec<u32>,
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
        }
    }

    pub fn run(mut self, program: &Program<'_>) -> FileFns {
        self.visit_program(program);
        self.out
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

    fn exit(&mut self, start: u32) {
        if !self.not_exit.contains(&start) {
            self.leaf(ct::EXIT);
        }
    }

    /// Register a function and make it the current one. Returns false for nothing to undo.
    fn enter(&mut self, span: Span, own: Option<&str>, default_kind: u8) {
        let pend = self.take_pending(span.start);
        let kind = pend.as_ref().and_then(|p| p.kind).unwrap_or(default_kind);
        let name: Option<String> = match own {
            Some(n) => Some(n.to_string()),
            None => pend.map(|p| p.name),
        };
        let (element, ordinal, anonymous) = match &name {
            Some(n) => (n.clone(), self.ordinal(n.as_bytes(), kind, false), false),
            None => {
                let ord = self.ordinal(b"", kind, true);
                (format!("#{ord}"), ord, true)
            }
        };
        let chain = if self.prefix.is_empty() {
            element.clone()
        } else {
            format!("{}>{element}", self.prefix)
        };
        let mut digits = [0u8; 10];
        let key_name: &[u8] = if anonymous { b"" } else { element.as_bytes() };
        let key = fnv_parts(&[
            self.rel.as_bytes(),
            &self.key_prefix,
            key_name,
            &[kind],
            dec(ordinal, &mut digits),
        ]);
        let start_line = self.lines.line(span.start);
        let end_line = self.lines.line(span.end.saturating_sub(1).max(span.start));
        let loc = self.lines.nonblank[end_line as usize] - self.lines.nonblank[start_line as usize - 1];
        let parent = self.frames.last().map(|f| f.local);
        // The boundary marker belongs to the parent's tree.
        self.leaf(ct::NESTED_FN);
        let local = self.out.fns.len() as u32;
        self.out.fns.push(FnRec { start_line, end_line, parent, loc, kind, chain, key });
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
        self.enter(it.span, it.id.as_ref().map(|i| i.name.as_str()), default_kind);
        walk::walk_function(self, it, flags);
        self.leave();
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.enter(it.span, None, fk::ARROW);
        walk::walk_arrow_function_expression(self, it);
        self.leave();
    }

    fn visit_static_block(&mut self, it: &StaticBlock<'a>) {
        self.enter(it.span, Some("static"), fk::STATIC_BLOCK);
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
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
            self.hint(init, id.name.as_str(), None);
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
        walk::walk_export_default_declaration(self, it);
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        let name = match &it.id {
            Some(id) => id.name.to_string(),
            None => self.take_pending(it.span.start).map_or_else(|| "#".to_string(), |p| p.name),
        };
        self.push_container(&name);
        walk::walk_class(self, it);
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
        let b = self.open(ct::BRANCH);
        self.visit_expression(&it.test);
        let arm = self.open(ct::ARM);
        self.visit_statement(&it.consequent);
        self.close(arm);
        if let Some(alt) = &it.alternate {
            let arm = self.open(ct::ARM);
            self.visit_statement(alt);
            self.close(arm);
        }
        self.close(b);
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        let b = self.open(ct::BRANCH);
        self.visit_expression(&it.test);
        let arm = self.open(ct::ARM);
        self.visit_expression(&it.consequent);
        self.close(arm);
        let arm = self.open(ct::ARM);
        self.visit_expression(&it.alternate);
        self.close(arm);
        self.close(b);
    }

    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        let m = self.open(ct::MULTI);
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
                self.visit_expression(t);
            }
            for s in &case.consequent {
                self.visit_statement(s);
            }
            self.close(arm);
        }
        self.close(m);
    }

    fn visit_for_statement(&mut self, it: &ForStatement<'a>) {
        let l = self.open(ct::LOOP);
        walk::walk_for_statement(self, it);
        self.close(l);
    }

    fn visit_for_in_statement(&mut self, it: &ForInStatement<'a>) {
        let l = self.open(ct::LOOP);
        walk::walk_for_in_statement(self, it);
        self.close(l);
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        let l = self.open(ct::LOOP);
        walk::walk_for_of_statement(self, it);
        self.close(l);
    }

    fn visit_while_statement(&mut self, it: &WhileStatement<'a>) {
        let l = self.open(ct::LOOP);
        walk::walk_while_statement(self, it);
        self.close(l);
    }

    fn visit_do_while_statement(&mut self, it: &DoWhileStatement<'a>) {
        let l = self.open(ct::LOOP);
        walk::walk_do_while_statement(self, it);
        self.close(l);
    }

    fn visit_try_statement(&mut self, it: &TryStatement<'a>) {
        let t = self.open(ct::TRY);
        let arm = self.open(ct::ARM);
        self.visit_block_statement(&it.block);
        self.close(arm);
        if let Some(h) = &it.handler {
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
        self.leaf(ct::SHORT_CIRCUIT);
        walk::walk_logical_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if matches!(
            it.operator,
            AssignmentOperator::LogicalAnd | AssignmentOperator::LogicalOr | AssignmentOperator::LogicalNullish
        ) {
            self.leaf(ct::SHORT_CIRCUIT);
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        self.exit(it.span.start);
        walk::walk_return_statement(self, it);
    }

    fn visit_throw_statement(&mut self, it: &ThrowStatement<'a>) {
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
