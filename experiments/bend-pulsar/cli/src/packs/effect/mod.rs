//! Effect pack: services, layers and the layer graph (FACTS.md, "Effect pack").
//!
//! [`Hook`] watches one file's walk through the TS lane's [`PackHook`] and records what the file
//! says, with names left unresolved: service classes, layer expressions, the names they are bound
//! to, `yield*` of a name, and provider roots. [`link`] then resolves names across files through
//! the lane's own import resolution (so `./x` and `../x` reach the same file), numbers services,
//! layers and roots densely, and returns the rows. The syntactic lane only loses findings when it
//! cannot see something: a name it cannot resolve makes the layer opaque (`LO`), never a guess.
//!
//! Which Effect calls build, compose and provide layers is this pack's knowledge, named here;
//! which external services and layers exist is catalog data (`catalog/effect.toml`).

use crate::lang::ts::calls::CatalogIndex;
use crate::lang::ts::functions::{HookCx, PackHook};
use oxc_ast::ast::*;
use oxc_span::GetSpan;
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// The runtime-escape class (FACTS.md): a call that runs an effect. An `Effect.provide` is a
/// provider root only when its result flows into one.
const RUNTIME_ESCAPE: u32 = 5;
const NONE: u32 = u32::MAX;

/// A name as the file wrote it: a same-file binding path (`X`, `C.layer`), or a symbol the
/// walker resolved through an import (`./x#X.layer`, `effect/sql#SqlClient.SqlClient`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ref {
    Local(String),
    Sym(String),
}

#[derive(Debug, Clone)]
enum Operand {
    Node(u32),
    Ref(Ref),
}

/// What a layer's constructor is.
#[derive(Debug, Clone)]
enum Ctor {
    /// Takes no effect (`Layer.succeed`, `Layer.sync`): requires nothing.
    Nothing,
    /// An `Effect.gen` generator: its byte span during the walk, its first and last line after
    /// [`Hook::finish`]; [`link`] maps the lines to a function.
    Gen(u32, u32),
    /// A name bound to a constructor (`this.make`).
    Ref(Ref),
    /// Anything else: requirements unknown.
    Opaque,
}

#[derive(Debug, Clone)]
struct Node {
    builds: Vec<Ref>,
    ctor: Ctor,
    parts: Vec<(Operand, u8)>,
    opaque: bool,
    /// Byte offset of the expression during the walk, its line after [`Hook::finish`].
    at: u32,
}

#[derive(Debug, Clone)]
enum Bind {
    Node(u32),
    Alias(Ref),
    Ctor(Ctor),
}

#[derive(Debug, Clone)]
struct SvcDef {
    name: String,
    key: String,
    kind: u8,
    /// Offset during the walk, line after [`Hook::finish`].
    at: u32,
}

/// What the `.effect` side table says about a service or a layer: its file (`NONE` for a catalog
/// one), line (0 when unknown) and name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Named {
    pub file: u32,
    pub line: u32,
    pub name: String,
}

#[derive(Debug, Clone)]
struct Root {
    fn_local: Option<u32>,
    layers: Vec<Operand>,
}

/// One file's Effect facts, names unresolved.
#[derive(Debug, Default)]
pub struct FileGraph {
    services: Vec<SvcDef>,
    nodes: Vec<Node>,
    binds: Vec<(String, Bind)>,
    roots: Vec<Root>,
    /// `(fn_local, name)` for each `yield*` of a name inside a function.
    uses: Vec<(u32, Ref)>,
}

impl FileGraph {
    fn is_empty(&self) -> bool {
        self.services.is_empty() && self.nodes.is_empty() && self.roots.is_empty() && self.uses.is_empty()
    }
}

/// Per-file hook state.
pub struct Hook<'i> {
    index: &'i CatalogIndex,
    g: FileGraph,
    /// Names waiting for the expression starting at this offset (a declarator's initialiser, a
    /// static field's value, an arrow's expression body).
    pending: HashMap<u32, String>,
    /// Calls already read as part of an enclosing expression, by start offset and end offset.
    seen: HashMap<(u32, u32), Option<u32>>,
    /// Classes seen so far: span and name, for `this`.
    classes: Vec<(u32, u32, Option<String>)>,
    /// Start of the expression being read, for the nodes it creates.
    at: u32,
}

fn gen_ctor(c: &CallExpression<'_>) -> Ctor {
    match args(c).last().map(|a| a.get_inner_expression()) {
        Some(Expression::FunctionExpression(f)) if f.generator => Ctor::Gen(f.span.start, f.span.end),
        _ => Ctor::Opaque,
    }
}

/// The member expression of `X.pipe(…)`.
fn pipe_member<'b, 'a>(c: &'b CallExpression<'a>) -> Option<&'b StaticMemberExpression<'a>> {
    match c.callee.get_inner_expression() {
        Expression::StaticMemberExpression(m) if m.property.name == "pipe" => Some(m),
        _ => None,
    }
}

fn is_pipe_fn(sym: Option<&str>) -> bool {
    matches!(sym, Some("effect#pipe") | Some("effect#Function.pipe"))
}

/// What a pipe step calls: the callee of a call, or the step itself.
fn step_callee<'b, 'a>(st: &'b Expression<'a>) -> &'b Expression<'a> {
    match st.get_inner_expression() {
        Expression::CallExpression(sc) => &sc.callee,
        other => other,
    }
}

/// A symbol in the `effect` package itself, never a repo binding.
fn r_is_lib(r: &Ref) -> bool {
    matches!(r, Ref::Sym(s) if s.starts_with("effect#") || s.starts_with("effect/"))
}

fn sym_rest<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    s.strip_prefix(prefix)
}

fn args<'b, 'a>(c: &'b CallExpression<'a>) -> Vec<&'b Expression<'a>> {
    c.arguments.iter().filter_map(|a| a.as_expression()).collect()
}

fn string_lit(e: &Expression<'_>) -> Option<String> {
    match e.get_inner_expression() {
        Expression::StringLiteral(l) => Some(l.value.display().to_string()),
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
            t.quasis.first().and_then(|q| q.value.cooked.as_ref()).map(|c| c.display().to_string())
        }
        _ => None,
    }
}

/// `Layer.effect` and friends: whether the second argument is an effect (true) or a value or
/// thunk that can require nothing (false).
fn builder(name: &str) -> Option<bool> {
    match name {
        "effect" | "scoped" => Some(true),
        "succeed" | "sync" => Some(false),
        _ => None,
    }
}

/// Composition mode (FACTS.md `LP`): 1 provide, 2 provideMerge, 3 merge.
fn compose(name: &str) -> Option<u8> {
    match name {
        "provide" => Some(1),
        "provideMerge" => Some(2),
        "merge" | "mergeAll" => Some(3),
        _ => None,
    }
}

/// Layer combinators that keep what a layer builds and requires.
fn transparent(name: &str) -> bool {
    matches!(
        name,
        "orDie" | "fresh" | "tap" | "tapError" | "tapErrorCause" | "withSpan" | "annotateLogs" | "annotateSpans" | "memoize"
    )
}

impl<'i> Hook<'i> {
    pub fn new(index: &'i CatalogIndex) -> Self {
        Hook { index, g: FileGraph::default(), pending: HashMap::new(), seen: HashMap::new(), classes: Vec::new(), at: 0 }
    }

    /// The file's facts, with generator spans turned into lines of `src` (the file's text).
    pub fn finish(mut self, src: &str) -> Option<FileGraph> {
        if self.g.is_empty() {
            return None;
        }
        let starts: Vec<u32> = std::iter::once(0)
            .chain(src.bytes().enumerate().filter(|(_, b)| *b == b'\n').map(|(i, _)| i as u32 + 1))
            .collect();
        let line = |off: u32| starts.partition_point(|&s| s <= off) as u32;
        let fix = |c: &mut Ctor| {
            if let Ctor::Gen(s, e) = *c {
                *c = Ctor::Gen(line(s), line(e.saturating_sub(1).max(s)));
            }
        };
        for n in &mut self.g.nodes {
            fix(&mut n.ctor);
            n.at = line(n.at);
        }
        for d in &mut self.g.services {
            d.at = line(d.at);
        }
        for (_, b) in &mut self.g.binds {
            if let Bind::Ctor(c) = b {
                fix(c);
            }
        }
        Some(self.g)
    }

    fn class_at(&self, off: u32) -> Option<String> {
        self.classes.iter().filter(|(s, e, _)| *s <= off && off < *e).max_by_key(|(s, _, _)| *s).and_then(|c| c.2.clone())
    }

    /// The name an expression is, if it is one: an imported symbol, or a same-file path rooted at
    /// an identifier or at `this` (the enclosing class).
    fn ref_of(&self, cx: &HookCx<'_>, e: &Expression<'_>) -> Option<Ref> {
        let e = e.get_inner_expression();
        if let Some(s) = (cx.resolve)(e) {
            if !s.starts_with("global#") {
                return Some(Ref::Sym(s));
            }
        }
        let mut path = Vec::new();
        let mut cur = e;
        loop {
            match cur {
                Expression::Identifier(id) => {
                    path.push(id.name.to_string());
                    break;
                }
                Expression::ThisExpression(t) => {
                    path.push(self.class_at(t.span.start)?);
                    break;
                }
                Expression::StaticMemberExpression(m) => {
                    path.push(m.property.name.to_string());
                    cur = m.object.get_inner_expression();
                }
                _ => return None,
            }
        }
        path.reverse();
        Some(Ref::Local(path.join(".")))
    }

    fn sym(&self, cx: &HookCx<'_>, e: &Expression<'_>) -> Option<String> {
        (cx.resolve)(e.get_inner_expression())
    }

    fn layer_name(&self, cx: &HookCx<'_>, e: &Expression<'_>) -> Option<String> {
        self.sym(cx, e).and_then(|s| sym_rest(&s, "effect#Layer.").map(str::to_string))
    }

    fn node(&mut self, mut n: Node) -> u32 {
        n.at = self.at;
        self.g.nodes.push(n);
        (self.g.nodes.len() - 1) as u32
    }

    fn opaque(&mut self) -> u32 {
        self.node(Node { builds: Vec::new(), ctor: Ctor::Nothing, parts: Vec::new(), opaque: true, at: 0 })
    }

    fn ctor_of(&self, cx: &HookCx<'_>, e: &Expression<'_>) -> Ctor {
        let Expression::CallExpression(c) = e.get_inner_expression() else {
            return self.ref_of(cx, e).map_or(Ctor::Opaque, Ctor::Ref);
        };
        if self.sym(cx, &c.callee).as_deref() == Some("effect#Effect.gen") {
            return gen_ctor(c);
        }
        if let Some(m) = pipe_member(c) {
            return self.piped_ctor(cx, m, c);
        }
        // `makeRepo(deps)`: the generator `makeRepo` returns, when it is a named one.
        match self.ref_of(cx, &c.callee) {
            Some(r) if !r_is_lib(&r) => Ctor::Ref(r),
            _ => Ctor::Opaque,
        }
    }

    /// `Effect.gen(…).pipe(…)`: a step that provides would hide requirements.
    fn piped_ctor(&self, cx: &HookCx<'_>, m: &StaticMemberExpression<'_>, c: &CallExpression<'_>) -> Ctor {
        let provides = args(c).iter().any(|st| self.sym(cx, step_callee(st)).is_none_or(|n| n.contains("provide")));
        if provides {
            Ctor::Opaque
        } else {
            self.ctor_of(cx, &m.object)
        }
    }

    fn operands(&mut self, cx: &HookCx<'_>, e: &Expression<'_>) -> Vec<Operand> {
        match e.get_inner_expression() {
            Expression::ArrayExpression(a) => {
                let els: Vec<&Expression<'_>> = a.elements.iter().filter_map(|x| x.as_expression()).collect();
                els.into_iter().map(|x| self.operand(cx, x)).collect()
            }
            other => vec![self.operand(cx, other)],
        }
    }

    fn operand(&mut self, cx: &HookCx<'_>, e: &Expression<'_>) -> Operand {
        let e = e.get_inner_expression();
        if self.layer_name(cx, e).as_deref() == Some("empty") {
            return Operand::Node(self.node(Node { builds: Vec::new(), ctor: Ctor::Nothing, parts: Vec::new(), opaque: false, at: 0 }));
        }
        if let Expression::CallExpression(c) = e {
            if let Some(n) = self.layer_call(cx, c, true) {
                return Operand::Node(n);
            }
            // `makeLive()`, `PgClient.layerConfig(…)`: the callee's name stands for the layer.
            return match self.ref_of(cx, &c.callee) {
                Some(r) => Operand::Ref(r),
                None => Operand::Node(self.opaque()),
            };
        }
        match self.ref_of(cx, e) {
            Some(r) => Operand::Ref(r),
            None => Operand::Node(self.opaque()),
        }
    }

    /// The layer a call expression is, if it is one. `operand` is true when the call sits where a
    /// layer is expected, so an unknown `Layer.*` call there is an opaque layer.
    fn layer_call(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>, operand: bool) -> Option<u32> {
        let key = (c.span.start, c.span.end);
        if let Some(r) = self.seen.get(&key) {
            return *r;
        }
        let r = self.layer_call_new(cx, c, operand);
        self.seen.insert(key, r);
        r
    }

    fn layer_call_new(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>, operand: bool) -> Option<u32> {
        let outer = self.at;
        self.at = c.span.start;
        let r = self.layer_call_at(cx, c, operand);
        self.at = outer;
        r
    }

    fn layer_call_at(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>, operand: bool) -> Option<u32> {
        let a = args(c);
        // `X.pipe(…)` and `pipe(X, …)`.
        if let Some(m) = pipe_member(c) {
            return self.layer_pipe(cx, &m.object, &a);
        }
        let callee_sym = self.sym(cx, &c.callee);
        if is_pipe_fn(callee_sym.as_deref()) {
            return a.split_first().and_then(|(o, steps)| self.layer_pipe(cx, o, steps));
        }
        if let Expression::CallExpression(inner) = c.callee.get_inner_expression() {
            return self.curried_builder(cx, inner, &a);
        }
        let name = callee_sym.as_deref().and_then(|s| sym_rest(s, "effect#Layer."))?.to_string();
        self.layer_fn(cx, &name, &a, operand)
    }

    /// `Layer.effect(Tag)(eff)`.
    fn curried_builder(&mut self, cx: &HookCx<'_>, inner: &CallExpression<'_>, a: &[&Expression<'_>]) -> Option<u32> {
        let takes_effect = builder(&self.layer_name(cx, &inner.callee)?)?;
        match (args(inner).as_slice(), a) {
            ([tag], [eff]) => Some(self.built(cx, tag, takes_effect.then_some(*eff))),
            _ => None,
        }
    }

    /// A call of `Layer.<name>` with arguments `a`.
    fn layer_fn(&mut self, cx: &HookCx<'_>, name: &str, a: &[&Expression<'_>], operand: bool) -> Option<u32> {
        if let Some(takes_effect) = builder(name) {
            return match a {
                [tag, eff, ..] => Some(self.built(cx, tag, takes_effect.then_some(*eff))),
                _ => None,
            };
        }
        if let Some(mode) = compose(name) {
            return (name == "mergeAll" || a.len() >= 2).then(|| self.composed(cx, a, mode));
        }
        if matches!(name, "effectDiscard" | "scopedDiscard") {
            let ctor = a.first().map_or(Ctor::Opaque, |e| self.ctor_of(cx, e));
            return Some(self.node(Node { builds: Vec::new(), ctor, parts: Vec::new(), opaque: false, at: 0 }));
        }
        // `Layer.unwrap…`, `Layer.effectContext` and the rest: what they build is computed.
        (operand && !transparent(name)).then(|| self.opaque())
    }

    /// A composition of every operand of `xs` in one mode.
    fn composed(&mut self, cx: &HookCx<'_>, xs: &[&Expression<'_>], mode: u8) -> u32 {
        let mut parts = Vec::new();
        for x in xs {
            parts.extend(self.operands(cx, x).into_iter().map(|o| (o, mode)));
        }
        self.node(Node { builds: Vec::new(), ctor: Ctor::Nothing, parts, opaque: false, at: 0 })
    }

    fn built(&mut self, cx: &HookCx<'_>, tag: &Expression<'_>, eff: Option<&Expression<'_>>) -> u32 {
        let builds = self.ref_of(cx, tag).into_iter().collect::<Vec<_>>();
        let opaque = builds.is_empty();
        let ctor = eff.map_or(Ctor::Nothing, |e| self.ctor_of(cx, e));
        self.node(Node { builds, ctor, parts: Vec::new(), opaque, at: 0 })
    }

    /// A pipe is a layer pipe when one of its steps is a `Layer` function.
    fn layer_pipe(&mut self, cx: &HookCx<'_>, obj: &Expression<'_>, steps: &[&Expression<'_>]) -> Option<u32> {
        if !steps.iter().any(|st| self.layer_name(cx, step_callee(st)).is_some()) {
            return None;
        }
        let mut cur: Option<Operand> = None;
        for (i, st) in steps.iter().enumerate() {
            cur = Some(self.pipe_step(cx, obj, cur, i == 0, st));
            if let Expression::CallExpression(sc) = st.get_inner_expression() {
                self.seen.insert((sc.span.start, sc.span.end), None);
            }
        }
        match cur {
            Some(Operand::Node(n)) => Some(n),
            _ => None,
        }
    }

    /// One step of a layer pipe over `obj`, given the layer so far (`None` before any step).
    fn pipe_step(&mut self, cx: &HookCx<'_>, obj: &Expression<'_>, cur: Option<Operand>, first: bool, st: &Expression<'_>) -> Operand {
        let name = self.layer_name(cx, step_callee(st));
        let sargs = match st.get_inner_expression() {
            Expression::CallExpression(sc) => args(sc),
            _ => Vec::new(),
        };
        match (name.as_deref(), sargs.as_slice()) {
            (Some(n), [tag]) if first && builder(n).is_some() => {
                let takes_effect = builder(n) == Some(true);
                Operand::Node(self.built(cx, tag, takes_effect.then_some(obj)))
            }
            (Some(n), [that]) if compose(n).is_some() => {
                let mode = compose(n).unwrap_or(1);
                let this = cur.unwrap_or_else(|| self.operand(cx, obj));
                let mut parts = vec![(this, mode)];
                parts.extend(self.operands(cx, that).into_iter().map(|o| (o, mode)));
                Operand::Node(self.node(Node { builds: Vec::new(), ctor: Ctor::Nothing, parts, opaque: false, at: 0 }))
            }
            (Some(n), _) if transparent(n) => cur.unwrap_or_else(|| self.operand(cx, obj)),
            _ => Operand::Node(self.opaque()),
        }
    }

    /// The layers an effect expression is given: `Effect.provide` (data-first, or as a pipe step,
    /// with a layer or an array), and `Effect.provideService(Tag, …)` as a layer that builds Tag.
    fn provides(&mut self, cx: &HookCx<'_>, e: &Expression<'_>, out: &mut Vec<Operand>) {
        let Expression::CallExpression(c) = e.get_inner_expression() else { return };
        let a = args(c);
        if let Expression::StaticMemberExpression(m) = c.callee.get_inner_expression() {
            if m.property.name == "pipe" {
                self.provides(cx, &m.object, out);
                for s in &a {
                    self.provide_step(cx, s, out);
                }
                return;
            }
        }
        match self.sym(cx, &c.callee).as_deref() {
            Some("effect#pipe") | Some("effect#Function.pipe") => {
                if let Some((o, steps)) = a.split_first() {
                    self.provides(cx, o, out);
                    for s in steps {
                        self.provide_step(cx, s, out);
                    }
                }
            }
            Some("effect#Effect.provide") if a.len() == 2 => {
                self.provides(cx, a[0], out);
                out.extend(self.operands(cx, a[1]));
            }
            Some("effect#Effect.provideService") if a.len() == 3 => {
                self.provides(cx, a[0], out);
                out.push(Operand::Node(self.built(cx, a[1], None)));
            }
            _ => {}
        }
    }

    fn provide_step(&mut self, cx: &HookCx<'_>, s: &Expression<'_>, out: &mut Vec<Operand>) {
        let Expression::CallExpression(sc) = s.get_inner_expression() else { return };
        let a = args(sc);
        match (self.sym(cx, &sc.callee).as_deref(), a.as_slice()) {
            (Some("effect#Effect.provide"), [l]) => out.extend(self.operands(cx, l)),
            (Some("effect#Effect.provideService"), [tag, _]) => out.push(Operand::Node(self.built(cx, tag, None))),
            _ => {}
        }
    }

    fn runs(&self, cx: &HookCx<'_>, e: &Expression<'_>) -> bool {
        self.sym(cx, e).is_some_and(|s| self.index.classes(&s).contains(&RUNTIME_ESCAPE))
    }

    fn root(&mut self, cx: &HookCx<'_>, layers: Vec<Operand>) {
        if !layers.is_empty() {
            self.g.roots.push(Root { fn_local: cx.fn_local, layers });
        }
    }

    fn roots_at(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>) {
        self.at = c.span.start;
        let a = args(c);
        let launch = matches!(self.sym(cx, &c.callee).as_deref(), Some("effect#Layer.launch") | Some("effect#ManagedRuntime.make"));
        let ls = if launch {
            a.first().map(|l| self.operands(cx, l)).unwrap_or_default()
        } else if self.runs(cx, &c.callee) {
            // `Effect.runPromise(eff)` (any runtime-escape symbol).
            let mut ls = Vec::new();
            if let Some(eff) = a.first() {
                self.provides(cx, eff, &mut ls);
            }
            ls
        } else {
            self.piped_root(cx, c, &a)
        };
        self.root(cx, ls);
    }

    /// `eff.pipe(…, Effect.provide(L), Effect.runPromise)`: the layers provided before the run.
    fn piped_root(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>, a: &[&Expression<'_>]) -> Vec<Operand> {
        let mut ls = Vec::new();
        let Some(m) = pipe_member(c) else { return ls };
        let Some(k) = a.iter().position(|st| self.runs(cx, st)) else { return ls };
        self.provides(cx, &m.object, &mut ls);
        for st in &a[..k] {
            self.provide_step(cx, st, &mut ls);
        }
        ls
    }

    fn bind(&mut self, name: String, b: Bind) {
        self.g.binds.push((name, b));
    }
}

impl PackHook for Hook<'_> {
    fn on_call(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>) {
        self.roots_at(cx, c);
        if self.seen.contains_key(&(c.span.start, c.span.end)) {
            return;
        }
        // The outermost call at an offset takes the name waiting there, layer or not.
        let name = self.pending.remove(&c.span.start);
        match (self.layer_call(cx, c, name.is_some()), name) {
            (Some(n), Some(name)) => self.bind(name, Bind::Node(n)),
            // `X = makeLive()`, `X = PgClient.layerConfig(…)`: X is whatever the callee names.
            (None, Some(name)) => {
                if let Some(r) = self.ref_of(cx, &c.callee).filter(|r| !r_is_lib(r)) {
                    self.bind(name, Bind::Alias(r));
                }
            }
            _ => {}
        }
    }

    fn on_yield_star(&mut self, cx: &HookCx<'_>, arg: &Expression<'_>) {
        if let (Some(f), Some(r)) = (cx.fn_local, self.ref_of(cx, arg)) {
            self.g.uses.push((f, r));
        }
    }

    fn on_declarator(&mut self, cx: &HookCx<'_>, d: &VariableDeclarator<'_>) {
        let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) else { return };
        self.pend(cx, id.name.to_string(), init);
    }

    fn on_class(&mut self, cx: &HookCx<'_>, class: &Class<'_>) {
        let name = class.id.as_ref().map(|i| i.name.to_string());
        self.classes.push((class.span.start, class.span.end, name.clone()));
        let Some(name) = name else { return };
        if let Some(sup) = class.heritage.as_ref().map(|h| &h.expression) {
            self.service_expr(cx, &name, sup);
        }
        for el in &class.body.body {
            if let ClassElement::PropertyDefinition(p) = el {
                let k = p.key.static_name().and_then(|n| n.as_str().map(str::to_string));
                if let (true, Some(v), Some(k)) = (p.r#static, &p.value, k) {
                    self.pend(cx, format!("{name}.{k}"), v);
                }
            }
        }
    }
}

impl Hook<'_> {
    /// `name = init`: a layer expression starting there gets the name when its call is reached;
    /// a plain name is an alias; an arrow's expression body counts as the value (`makeLive()`).
    fn pend(&mut self, cx: &HookCx<'_>, name: String, init: &Expression<'_>) {
        match init.get_inner_expression() {
            Expression::CallExpression(c) => {
                // `const X = Context.Service<X, …>("key")`: a service, not a layer.
                if self.service_expr(cx, &name, init) {
                    return;
                }
                // `const make = Effect.gen(…)`: a constructor other layers can name.
                if let ctor @ Ctor::Gen(..) = self.ctor_of(cx, init) {
                    self.bind(name.clone(), Bind::Ctor(ctor));
                }
                self.pending.insert(c.span.start, name);
            }
            Expression::ArrowFunctionExpression(a) => match &a.body {
                // `(…) => { …; return <expr> }`: the last top-level return is the value.
                ArrowFunctionBody::FunctionBody(b) => {
                    let ret = b.statements.iter().rev().find_map(|st| match st {
                        Statement::ReturnStatement(r) => r.argument.as_ref(),
                        _ => None,
                    });
                    if let Some(e) = ret {
                        self.pend(cx, name, e);
                    }
                }
                other => {
                    if let Some(body) = other.as_expression() {
                        self.pend(cx, name, body);
                    }
                }
            },
            other => {
                if let Some(r) = self.ref_of(cx, other) {
                    self.bind(name, Bind::Alias(r));
                }
            }
        }
    }

    /// `class X extends Context.Service<…>()("key", …)`, `const X = Context.Service<…>("key")`
    /// and the other service forms. Returns whether `sup` is one.
    fn service_expr(&mut self, cx: &HookCx<'_>, name: &str, sup: &Expression<'_>) -> bool {
        self.at = sup.span().start;
        let mut all_args: Vec<&Expression<'_>> = Vec::new();
        let mut e = sup.get_inner_expression();
        while let Expression::CallExpression(c) = e {
            all_args.extend(args(c));
            e = c.callee.get_inner_expression();
        }
        let Some(base) = self.sym(cx, e) else { return false };
        let kind = match base.as_str() {
            "effect#Context.Service"
            | "effect#Context.Tag"
            | "effect#Context.GenericTag"
            | "effect#Effect.Tag"
            | "effect#Effect.Service" => 0,
            "effect#Context.Reference" => 1,
            _ => return false,
        };
        let key = all_args.iter().find_map(|a| string_lit(a)).unwrap_or_else(|| name.to_string());
        self.g.services.push(SvcDef { name: name.to_string(), key, kind, at: self.at });
        let opts = all_args.iter().find_map(|a| match a.get_inner_expression() {
            Expression::ObjectExpression(o) => Some(o),
            _ => None,
        });
        let field = |k: &str| {
            opts.and_then(|o| {
                o.properties.iter().find_map(|p| match p {
                    ObjectPropertyKind::ObjectProperty(p) if p.key.static_name().is_some_and(|n| n.as_str() == Some(k)) => Some(&p.value),
                    _ => None,
                })
            })
        };
        if base == "effect#Effect.Service" {
            // v3: `.Default` builds the service with its `dependencies` provided.
            let ctor = if let Some(v) = field("effect").or_else(|| field("scoped")) {
                self.ctor_of(cx, v)
            } else if field("succeed").is_some() || field("sync").is_some() {
                Ctor::Nothing
            } else {
                Ctor::Opaque
            };
            let deps = field("dependencies").map(|d| self.operands(cx, d)).unwrap_or_default();
            let own = Ref::Local(name.to_string());
            let bare = self.node(Node { builds: vec![own.clone()], ctor: ctor.clone(), parts: Vec::new(), opaque: false, at: 0 });
            let parts = deps.into_iter().map(|o| (o, 1)).collect();
            let full = self.node(Node { builds: vec![own], ctor, parts, opaque: false, at: 0 });
            self.bind(format!("{name}.Default"), Bind::Node(full));
            self.bind(format!("{name}.DefaultWithoutDependencies"), Bind::Node(bare));
        } else if let Some(v) = field("make") {
            let ctor = self.ctor_of(cx, v);
            self.bind(format!("{name}.make"), Bind::Ctor(ctor));
        }
        true
    }
}

// ---- linking ----------------------------------------------------------------------------------

/// The external services and layers of the active catalogs.
#[derive(Default)]
pub struct External {
    /// Symbol and whether it has a default (always provided).
    pub services: BTreeMap<String, bool>,
    /// Symbol and the service symbols it builds.
    pub layers: BTreeMap<String, Vec<String>>,
}

/// One TS file as the linker sees it.
pub struct LinkFile<'a> {
    /// Global file id.
    pub id: u32,
    pub rel: &'a str,
    pub graph: Option<&'a FileGraph>,
    /// `(start_line, end_line)` per local function.
    pub fn_lines: Vec<(u32, u32)>,
}

/// A function by `(global file id, local index)`; the driver numbers it.
pub type FnAt = (u32, u32);

/// The pack's rows. Service, layer and root ids are dense and final; functions are `FnAt`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Rows {
    pub nl: u32,
    pub ns: u32,
    pub nr: u32,
    pub sv: Vec<[u32; 3]>,
    pub ly: Vec<[u32; 3]>,
    pub lq: Vec<[u32; 2]>,
    pub lp: Vec<[u32; 3]>,
    pub lr: Vec<[u32; 2]>,
    pub rt: Vec<(u32, u32, Option<FnAt>)>,
    pub lc: Vec<(u32, FnAt)>,
    pub lo: Vec<u32>,
    pub us: Vec<(FnAt, u32)>,
    /// By service id: where it is defined and its name (`Users (app/Users)`, or a catalog symbol).
    pub svc_names: Vec<Named>,
    /// By layer id: where its expression is and the name bound to it (`-` when none).
    pub layer_names: Vec<Named>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum SvcKey {
    Repo(String),
    Ext(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum LayerKey {
    Repo(usize, u32),
    Cat(String),
    Unresolved(usize, Ref),
}

const DEPTH: u32 = 8;

struct Linker<'a> {
    files: &'a [LinkFile<'a>],
    ext: &'a External,
    resolve: &'a dyn Fn(&str, &str) -> Option<usize>,
}

impl Linker<'_> {
    fn graph(&self, i: usize) -> Option<&FileGraph> {
        self.files[i].graph
    }

    /// A `Sym` that names a repo file's binding: `(file index, path)`.
    fn cross(&self, i: usize, s: &str) -> Option<(usize, String)> {
        let (spec, path) = s.split_once('#')?;
        if path.is_empty() {
            return None;
        }
        Some(((self.resolve)(self.files[i].rel, spec)?, path.to_string()))
    }

    /// The single binding of `name` in file `i`; two bindings of one name resolve to nothing.
    fn bind(&self, i: usize, name: &str) -> Option<&Bind> {
        let g = self.graph(i)?;
        let mut it = g.binds.iter().filter(|(n, _)| n == name);
        let first = it.next().map(|(_, b)| b);
        if it.next().is_some() {
            return None;
        }
        first
    }

    fn svc(&self, i: usize, r: &Ref, depth: u32) -> Option<SvcKey> {
        if depth == 0 {
            return None;
        }
        match r {
            Ref::Sym(s) => {
                if self.ext.services.contains_key(s) {
                    return Some(SvcKey::Ext(s.clone()));
                }
                let (j, path) = self.cross(i, s)?;
                self.svc(j, &Ref::Local(path), depth - 1)
            }
            Ref::Local(name) => {
                if let Some(d) = self.graph(i)?.services.iter().find(|d| &d.name == name) {
                    return Some(SvcKey::Repo(d.key.clone()));
                }
                match self.bind(i, name)? {
                    Bind::Alias(r2) => self.svc(i, &r2.clone(), depth - 1),
                    _ => None,
                }
            }
        }
    }

    fn layer(&self, i: usize, o: &Operand, depth: u32) -> LayerKey {
        match o {
            Operand::Node(n) => LayerKey::Repo(i, *n),
            Operand::Ref(r) => self.layer_ref(i, r, depth).unwrap_or_else(|| LayerKey::Unresolved(i, r.clone())),
        }
    }

    fn layer_ref(&self, i: usize, r: &Ref, depth: u32) -> Option<LayerKey> {
        if depth == 0 {
            return None;
        }
        match r {
            Ref::Sym(s) => {
                if self.ext.layers.contains_key(s) {
                    return Some(LayerKey::Cat(s.clone()));
                }
                let (j, path) = self.cross(i, s)?;
                self.layer_ref(j, &Ref::Local(path), depth - 1)
            }
            Ref::Local(name) => match self.bind(i, name)? {
                Bind::Node(n) => Some(LayerKey::Repo(i, *n)),
                Bind::Alias(r2) => self.layer_ref(i, &r2.clone(), depth - 1),
                Bind::Ctor(_) => None,
            },
        }
    }

    /// The function a constructor runs: `None` when it requires nothing, `Err` when unknown.
    fn ctor(&self, i: usize, c: &Ctor, depth: u32) -> Result<Option<FnAt>, ()> {
        match c {
            Ctor::Nothing => Ok(None),
            Ctor::Opaque => Err(()),
            Ctor::Gen(s, e) => {
                let f = &self.files[i];
                let (ls, le) = (*s, *e);
                // Functions are numbered by start offset, so of the functions spanning exactly
                // these lines the generator is the innermost, the last.
                let local = f.fn_lines.iter().rposition(|&(a, b)| a == ls && b == le).ok_or(())?;
                Ok(Some((f.id, local as u32)))
            }
            Ctor::Ref(r) if depth > 0 => {
                let (j, name) = match r {
                    Ref::Local(n) => (i, n.clone()),
                    Ref::Sym(s) => self.cross(i, s).ok_or(())?,
                };
                match self.bind(j, &name) {
                    Some(Bind::Ctor(c2)) => self.ctor(j, &c2.clone(), depth - 1),
                    Some(Bind::Alias(r2)) => self.ctor(j, &Ctor::Ref(r2.clone()), depth - 1),
                    _ => Err(()),
                }
            }
            Ctor::Ref(_) => Err(()),
        }
    }
}

/// The linked graph, with services and layers named by key, before numbering.
#[derive(Default)]
struct Keyed {
    svcs: BTreeMap<SvcKey, (u32, u32)>,
    layers: BTreeSet<LayerKey>,
    ly: Vec<(LayerKey, u32, SvcKey)>,
    lp: Vec<(LayerKey, LayerKey, u32)>,
    lc: Vec<(LayerKey, FnAt)>,
    lo: Vec<LayerKey>,
    us: Vec<(FnAt, SvcKey)>,
    roots: Vec<(u32, Option<FnAt>, Vec<LayerKey>)>,
}

impl Keyed {
    /// A service key, registering a catalog service the first time it is named.
    fn svc(&mut self, ext: &External, k: SvcKey) -> SvcKey {
        if let SvcKey::Ext(s) = &k {
            self.svcs.entry(k.clone()).or_insert((NONE, ext.services[s] as u32));
        }
        k
    }

    fn file(&mut self, lk: &Linker<'_>, i: usize, g: &FileGraph) {
        let id = lk.files[i].id;
        for (n, node) in g.nodes.iter().enumerate() {
            self.node(lk, i, n as u32, node);
        }
        for (fl, r) in &g.uses {
            if let Some(k) = lk.svc(i, r, DEPTH) {
                let k = self.svc(lk.ext, k);
                self.us.push(((id, *fl), k));
            }
        }
        for root in &g.roots {
            let ls: Vec<LayerKey> = root.layers.iter().map(|o| lk.layer(i, o, DEPTH)).collect();
            self.layers.extend(ls.iter().cloned());
            self.roots.push((id, root.fn_local.map(|l| (id, l)), ls));
        }
    }

    fn node(&mut self, lk: &Linker<'_>, i: usize, n: u32, node: &Node) {
        let me = LayerKey::Repo(i, n);
        self.layers.insert(me.clone());
        let mut opaque = node.opaque;
        for b in &node.builds {
            match lk.svc(i, b, DEPTH) {
                Some(k) => {
                    let k = self.svc(lk.ext, k);
                    self.ly.push((me.clone(), lk.files[i].id, k));
                }
                None => opaque = true,
            }
        }
        match lk.ctor(i, &node.ctor, DEPTH) {
            Ok(Some(fa)) => self.lc.push((me.clone(), fa)),
            Ok(None) => {}
            Err(()) => opaque = true,
        }
        for (o, mode) in &node.parts {
            let inner = lk.layer(i, o, DEPTH);
            self.layers.insert(inner.clone());
            self.lp.push((me.clone(), inner, *mode as u32));
        }
        if opaque {
            self.lo.push(me);
        }
    }

    /// Catalog layers build their listed services; unresolved names are opaque.
    fn leaves(&mut self, ext: &External) {
        for l in self.layers.clone() {
            match &l {
                LayerKey::Cat(s) => self.catalog_layer(ext, &l, s),
                LayerKey::Unresolved(..) => self.lo.push(l.clone()),
                LayerKey::Repo(..) => {}
            }
        }
    }

    fn catalog_layer(&mut self, ext: &External, l: &LayerKey, sym: &str) {
        for b in &ext.layers[sym] {
            if ext.services.contains_key(b) {
                let k = self.svc(ext, SvcKey::Ext(b.clone()));
                self.ly.push((l.clone(), NONE, k));
            } else {
                self.lo.push(l.clone());
            }
        }
    }
}

/// Resolve every file's names and number services, layers and roots. `resolve(rel, spec)` is the
/// TS lane's import resolution, giving an index into `files`.
pub fn link(files: &[LinkFile<'_>], ext: &External, resolve: &dyn Fn(&str, &str) -> Option<usize>) -> Rows {
    let lk = Linker { files, ext, resolve };
    let mut k = Keyed::default();
    for f in files {
        for d in f.graph.iter().flat_map(|g| &g.services) {
            k.svcs.entry(SvcKey::Repo(d.key.clone())).or_insert((f.id, d.kind as u32));
        }
    }
    for (i, f) in files.iter().enumerate() {
        if let Some(g) = f.graph {
            k.file(&lk, i, g);
        }
    }
    k.leaves(ext);
    let mut rows = number(&k, files);
    requirements(&mut rows);
    sort_rows(&mut rows);
    rows
}

/// Dense ids: layers and services in key order, roots in file order.
fn number(k: &Keyed, files: &[LinkFile<'_>]) -> Rows {
    let lid: BTreeMap<&LayerKey, u32> = k.layers.iter().enumerate().map(|(n, l)| (l, n as u32)).collect();
    let sid: BTreeMap<&SvcKey, u32> = k.svcs.keys().enumerate().map(|(n, s)| (s, n as u32)).collect();
    let mut rows = Rows { nl: lid.len() as u32, ns: sid.len() as u32, nr: k.roots.len() as u32, ..Rows::default() };
    rows.sv = k.svcs.iter().map(|(s, (file, kind))| [sid[s], *file, *kind]).collect();
    rows.ly = k.ly.iter().map(|(l, f, s)| [lid[l], *f, sid[s]]).collect();
    rows.lp = k.lp.iter().filter(|(a, b, _)| a != b).map(|(a, b, m)| [lid[a], lid[b], *m]).collect();
    rows.lc = k.lc.iter().map(|(l, fa)| (lid[l], *fa)).collect();
    rows.lo = k.lo.iter().map(|l| lid[l]).collect();
    rows.us = k.us.iter().map(|(fa, s)| (*fa, sid[s])).collect();
    for (r, (file, fa, ls)) in k.roots.iter().enumerate() {
        rows.rt.push((r as u32, *file, *fa));
        rows.lr.extend(ls.iter().map(|l| [r as u32, lid[l]]));
    }
    rows.layer_names = k.layers.iter().map(|l| layer_name(l, files)).collect();
    rows.svc_names = k.svcs.iter().map(|(s, (file, _))| svc_name(s, *file, files)).collect();
    rows
}

fn layer_name(k: &LayerKey, files: &[LinkFile<'_>]) -> Named {
    match k {
        LayerKey::Repo(i, n) => {
            let g = files[*i].graph.unwrap();
            let bound = g.binds.iter().find(|(_, b)| matches!(b, Bind::Node(m) if m == n));
            Named { file: files[*i].id, line: g.nodes[*n as usize].at, name: bound.map_or("-".to_string(), |(x, _)| x.clone()) }
        }
        LayerKey::Cat(s) => Named { file: NONE, line: 0, name: s.clone() },
        LayerKey::Unresolved(i, Ref::Local(r) | Ref::Sym(r)) => Named { file: files[*i].id, line: 0, name: r.clone() },
    }
}

fn svc_name(k: &SvcKey, file: u32, files: &[LinkFile<'_>]) -> Named {
    let key = match k {
        SvcKey::Ext(s) => return Named { file: NONE, line: 0, name: s.clone() },
        SvcKey::Repo(key) => key,
    };
    let def = files.iter().filter(|f| f.id == file).flat_map(|f| f.graph.iter().flat_map(|g| &g.services)).find(|d| &d.key == key);
    let (line, name) = def.map_or((0, key.clone()), |d| (d.at, format!("{} ({key})", d.name)));
    Named { file, line, name }
}

/// A layer requires what its constructor yields. A decorator (a layer whose constructor yields a
/// service it also builds, given the base layer with `Layer.provide`) is transparent for that
/// service: it neither builds nor requires it, since the service comes from the layer below.
/// Emitting both would make the decorator a one-layer cycle, and a duplicate builder beside its
/// base.
fn requirements(rows: &mut Rows) {
    let mut by_fn: BTreeMap<FnAt, Vec<u32>> = BTreeMap::new();
    for (fa, s) in &rows.us {
        by_fn.entry(*fa).or_default().push(*s);
    }
    let builds: BTreeSet<[u32; 2]> = rows.ly.iter().map(|r| [r[0], r[2]]).collect();
    let mut decorated: BTreeSet<[u32; 2]> = BTreeSet::new();
    for (l, fa) in &rows.lc {
        for s in by_fn.get(fa).into_iter().flatten() {
            if builds.contains(&[*l, *s]) {
                decorated.insert([*l, *s]);
            } else {
                rows.lq.push([*l, *s]);
            }
        }
    }
    rows.ly.retain(|r| !decorated.contains(&[r[0], r[2]]));
}

fn sort_rows(rows: &mut Rows) {
    fn canon<T: Ord>(v: &mut Vec<T>) {
        v.sort_unstable();
        v.dedup();
    }
    canon(&mut rows.ly);
    canon(&mut rows.lq);
    canon(&mut rows.lp);
    canon(&mut rows.lr);
    canon(&mut rows.lc);
    canon(&mut rows.lo);
    canon(&mut rows.us);
}

impl Rows {
    pub fn is_empty(&self) -> bool {
        self.nl == 0 && self.ns == 0 && self.nr == 0
    }
}

/// The effect catalog's external services and layers.
pub fn external(c: &crate::catalog::Catalog) -> External {
    let mut e = External::default();
    for s in &c.services {
        *e.services.entry(s.sym.clone()).or_insert(false) |= s.default;
    }
    for l in &c.layers {
        let v = e.layers.entry(l.sym.clone()).or_default();
        v.extend(l.builds.iter().cloned());
        v.sort();
        v.dedup();
    }
    e
}

/// The pack's shipped catalog.
pub fn shipped() -> Result<crate::catalog::Catalog, String> {
    Ok(crate::catalog::load("effect.toml", include_str!("catalog/effect.toml"))?.catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn tree(tag: &str, files: &[(&str, &str)]) -> (PathBuf, Vec<(u32, String)>, Vec<String>) {
        let root = std::env::temp_dir().join(format!("pulsar-effect-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut tracked = vec!["package.json".to_string()];
        let write = |rel: &str, text: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        };
        write("package.json", r#"{"dependencies":{"effect":"4.0.0"}}"#);
        let mut ts = Vec::new();
        for (i, (rel, text)) in files.iter().enumerate() {
            write(rel, text);
            tracked.push(rel.to_string());
            ts.push((i as u32, rel.to_string()));
        }
        tracked.sort();
        (root, ts, tracked)
    }

    /// The local index of the last function starting on `line` (1-based) of file `i`.
    fn fn_at(a: &crate::lang::ts::Analysis, i: usize, line: u32) -> FnAt {
        let fns = &a.per_file[i].fns.fns;
        (i as u32, fns.iter().rposition(|f| f.start_line == line).expect("a function on that line") as u32)
    }

    fn run(root: &Path, ts: &[(u32, String)], tracked: &[String]) -> crate::lang::ts::Analysis {
        crate::lang::ts::analyze(root, ts, tracked).unwrap()
    }

    const DB: &str = r#"import { Context, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
export const Clock = Context.Reference<number>()("app/Clock", { defaultValue: () => 0 })
export class Users extends Context.Service<Users, { readonly n: number }>()("app/Users") {
  static readonly layer = Layer.effect(this, Effect.gen(function* () {
    yield* SqlClient.SqlClient
    return { n: 1 }
  }))
}
"#;

    const MAIL: &str = r#"import { Context, Effect, Layer } from "effect"
import { Users } from "../db"
export const Mailer = Context.Service<Mailer, { send: () => void }>("app/Mailer")
export const MailerLive = Layer.effect(Mailer, Effect.gen(function* () {
  yield* Users
  return { send: () => {} }
}))
const makeAudit = Effect.gen(function* () {
  yield* Mailer
  return {}
})
export class Audit extends Context.Service<Audit, {}>()("app/Audit") {}
export const AuditLive = Layer.effect(Audit, makeAudit)
export const makeAppLive = () => MailerLive.pipe(Layer.provide(Users.layer), Layer.provideMerge(AuditLive))
"#;

    const MAIN: &str = r#"import { Effect, Layer } from "effect"
import { Mailer, makeAppLive } from "./mail/index"
const AppLive = makeAppLive()
const program = Effect.gen(function* () {
  const m = yield* Mailer
  m.send()
})
Effect.runPromise(program.pipe(Effect.provide(AppLive)))
export const Hidden = Layer.unwrap(Effect.succeed(AppLive))
"#;

    #[test]
    fn services_layers_and_roots_link_across_files() {
        let (root, ts, tracked) = tree("graph", &[("src/db.ts", DB), ("src/mail/index.ts", MAIL), ("src/main.ts", MAIN)]);
        let a = run(&root, &ts, &tracked);
        let r = a.effect.as_ref().expect("the pack is on");
        // Services by key, then the catalog's SqlClient: Audit, Clock (a default), Mailer, Users.
        assert_eq!(r.sv, vec![[0, 1, 0], [1, 0, 1], [2, 1, 0], [3, 0, 0], [4, NONE, 0]]);
        // Layers: 0 Users.layer; 1 MailerLive, 2 AuditLive, 3 the provide step, 4 the
        // provideMerge step (makeAppLive); 5 Hidden, whose layer an effect computes.
        assert_eq!((r.nl, r.ns, r.nr), (6, 5, 1));
        assert_eq!(r.ly, vec![[0, 0, 3], [1, 1, 2], [2, 1, 0]]);
        assert_eq!(r.lq, vec![[0, 4], [1, 3], [2, 2]]);
        assert_eq!(r.lp, vec![[3, 0, 1], [3, 1, 1], [4, 2, 2], [4, 3, 2]]);
        assert_eq!(r.lo, vec![5]);
        assert_eq!(r.lc, vec![(0, fn_at(&a, 0, 5)), (1, fn_at(&a, 1, 4)), (2, fn_at(&a, 1, 8))]);
        // The root is the runPromise of a pipe that provides AppLive = makeAppLive().
        assert_eq!(r.lr, vec![[0, 4]]);
        assert_eq!(r.rt, vec![(0, 2, None)]);
        let mut us = vec![(fn_at(&a, 0, 5), 4), (fn_at(&a, 1, 4), 3), (fn_at(&a, 1, 8), 2), (fn_at(&a, 2, 4), 2)];
        us.sort();
        assert_eq!(r.us, us);
        // The `.effect` side table names each id: binding, file and line.
        let names = |v: &[Named]| v.iter().map(|n| (n.file, n.line, n.name.clone())).collect::<Vec<_>>();
        assert_eq!(names(&r.svc_names)[3], (0, 4, "Users (app/Users)".to_string()));
        assert_eq!(names(&r.svc_names)[4], (NONE, 0, "effect/sql#SqlClient.SqlClient".to_string()));
        assert_eq!(names(&r.layer_names)[0], (0, 5, "Users.layer".to_string()));
        assert_eq!(names(&r.layer_names)[4], (1, 14, "makeAppLive".to_string()));
        assert_eq!(names(&r.layer_names)[3], (1, 14, "-".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_decorator_neither_builds_nor_requires_what_it_wraps() {
        let src = r#"import { Context, Effect, Layer, ManagedRuntime } from "effect"
export const Store = Context.Service<Store, { get: () => number }>("app/Store")
export const StoreLive = Layer.succeed(Store, { get: () => 1 })
const Logged = Layer.effect(Store, Effect.gen(function* () {
  const inner = yield* Store
  return { get: () => inner.get() }
}))
export const runtime = ManagedRuntime.make(Layer.provide(Logged, StoreLive))
"#;
        let (root, ts, tracked) = tree("deco", &[("src/store.ts", src)]);
        let a = run(&root, &ts, &tracked);
        let r = a.effect.as_ref().unwrap();
        // 0 StoreLive, 1 Logged, 2 provide(Logged, StoreLive).
        assert_eq!(r.ly, vec![[0, 0, 0]]);
        assert!(r.lq.is_empty());
        assert_eq!(r.lp, vec![[2, 0, 1], [2, 1, 1]]);
        assert_eq!(r.lr, vec![[0, 2]]);
        assert!(r.lo.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unresolved_name_or_a_hidden_constructor_is_opaque() {
        let src = r#"import { Context, Effect, Layer, ManagedRuntime } from "effect"
import { make } from "some-package"
export const A = Context.Service<A, {}>("app/A")
export const ALive = Layer.effect(A, make())
export const run = (extra: Layer.Layer<never>) => ManagedRuntime.make(Layer.merge(ALive, extra))
"#;
        let (root, ts, tracked) = tree("opaque", &[("src/a.ts", src)]);
        let a = run(&root, &ts, &tracked);
        let r = a.effect.as_ref().unwrap();
        // 0 ALive (constructor from a package: requirements unknown), 1 the merge, 2 `extra`.
        assert_eq!(r.ly, vec![[0, 0, 0]]);
        assert_eq!(r.lo, vec![0, 2]);
        assert_eq!(r.lp, vec![[1, 0, 3], [1, 2, 3]]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_pack_is_off_without_effect() {
        let (root, ts, tracked) = tree("off", &[("src/a.ts", "export const x = 1\n")]);
        std::fs::write(root.join("package.json"), "{}").unwrap();
        assert!(run(&root, &ts, &tracked).effect.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
