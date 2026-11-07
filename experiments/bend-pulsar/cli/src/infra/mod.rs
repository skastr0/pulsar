//! Infra lane: the deployables a repo declares, the bindings each one declares, the files each
//! one runs, and the binding names its code reads (FACTS.md "Infra").
//!
//! The mechanism is generic: a deployable has a name, zero or more entry files and a set of
//! declared binding names, and code reads binding names. Which file syntax declares them is
//! dialect data: the readers below know alchemy's run files and wrangler's config, and a new
//! dialect is a new reader, not a new fact model. Detectors that compare the two sides live in
//! the engine, over `ID`/`IE`/`IB`/`IU` rows.
//!
//! Reads are taken only in the entry closure of some deployable (its entry file and everything
//! it imports, through the `I` edges the TypeScript lane resolved), so a repo whose `env` is a
//! test fixture or an unrelated tool contributes no reads to this lane. `process.env` and
//! `import.meta.env` are never binding reads.

use crate::facts::{FactWriter, Rel, SideTables};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Stats {
    pub deployables: usize,
    pub bindings: usize,
    pub entries: usize,
    pub reads: usize,
    pub config_files: usize,
    pub read_files: usize,
    /// Wall time of the lane alone.
    pub ms: u128,
    pub degraded: Vec<String>,
}

/// One deployable declaration, before ids are assigned.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Deployable {
    /// Repo-relative path of the file that declares it.
    file: String,
    /// 1-based line of the declaration; 0 when the dialect has no position.
    line: u32,
    name: String,
    /// Entry files, repo-relative, resolved against the tracked set.
    entries: BTreeSet<String>,
    /// Declared binding names.
    bindings: BTreeSet<String>,
}

/// Run the lane over one checkout. `files` are the lane file ids the driver assigned (entry files
/// resolve to those ids), and `edges` are the TypeScript lane's `I` rows over the same ids.
pub fn emit(
    root: &Path,
    tracked: &[String],
    files: &[String],
    edges: &[[u32; 5]],
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Stats {
    let started = std::time::Instant::now();
    let mut st = Stats::default();
    let file_ids: HashMap<&str, u32> =
        files.iter().enumerate().map(|(id, p)| (p.as_str(), id as u32)).collect();

    let mut deployments = declarations(root, tracked, &mut st);

    // The read side: every binding read in the closure of some deployable's entry.
    let closure = closure(edges, &deployments, &file_ids, &mut st);
    let reads = reads_in_closure(root, files, &closure, &mut st);

    // Ids: deployables by (file, line, name); binding names in byte order across both sides.
    deployments.sort_by(|a, b| (&a.file, a.line, &a.name).cmp(&(&b.file, b.line, &b.name)));
    let mut names: BTreeSet<&str> = BTreeSet::new();
    for d in &deployments {
        names.extend(d.bindings.iter().map(String::as_str));
    }
    for (_, n) in &reads {
        names.insert(n.as_str());
    }
    let binding_id: BTreeMap<&str, u32> =
        names.iter().enumerate().map(|(i, n)| (*n, i as u32)).collect();

    w.reserve(Rel::Id, deployments.len());
    w.reserve(Rel::Ie, deployments.iter().map(|d| d.entries.len()).sum());
    w.reserve(Rel::Ib, deployments.iter().map(|d| d.bindings.len()).sum());
    w.reserve(Rel::Iu, reads.len());

    let mut table = String::new();
    for (id, d) in deployments.iter().enumerate() {
        w.push(Rel::Id, &[id as u32]);
        table.push_str(&format!("{id}\t{}\t{}\t{}\n", d.file, d.line, d.name));
        for e in &d.entries {
            let Some(&f) = file_ids.get(e.as_str()) else { continue };
            w.push(Rel::Ie, &[id as u32, f]);
            st.entries += 1;
        }
        for b in &d.bindings {
            w.push(Rel::Ib, &[id as u32, binding_id[b.as_str()]]);
            st.bindings += 1;
        }
        if !d.bindings.is_empty() && d.entries.is_empty() {
            st.degraded.push(format!(
                "{}: deployable {} declares bindings but no entry file resolves, so its reads are unknown",
                d.file, d.name
            ));
        }
    }
    for (f, n) in &reads {
        w.push(Rel::Iu, &[*f, binding_id[n.as_str()]]);
        st.reads += 1;
    }
    st.deployables = deployments.len();
    st.ms = started.elapsed().as_millis();
    tables.deployables = table;
    tables.bindings = names.iter().map(|n| (*n).to_string()).collect();
    st
}

// ---------------------------------------------------------------- declarations

/// Every deployable the tracked tree declares, from each dialect's reader.
fn declarations(root: &Path, tracked: &[String], st: &mut Stats) -> Vec<Deployable> {
    let track: HashSet<&str> = tracked.iter().map(String::as_str).collect();
    let mut out: BTreeMap<(String, String), Deployable> = BTreeMap::new();
    for path in tracked {
        // Read only files a reader can use: everything else is some other file type (and often
        // binary), not a declaration this lane skipped.
        if wrangler_kind(path).is_none() && !is_script(path) {
            continue;
        }
        let Some(text) = read(root, path, st) else { continue };
        if let Some(kind) = wrangler_kind(path) {
            st.config_files += 1;
            match wrangler(path, &text, kind, &track) {
                Ok(mut d) => {
                    d.entries = std::mem::take(&mut d.entries).into_iter().filter(|e| track.contains(e.as_str())).collect();
                    merge(&mut out, (d.file.clone(), d.name.clone()), d);
                }
                Err(e) => st.degraded.push(format!("{path}: {e}")),
            }
            continue;
        }
        if is_script(path) && text.contains("alchemy/Cloudflare") {
            st.config_files += 1;
            let mut found = alchemy(path, &text);
            for d in &mut found {
                d.entries = std::mem::take(&mut d.entries).into_iter().filter(|e| track.contains(e.as_str())).collect();
            }
            for d in found {
                merge(&mut out, (d.file.clone(), d.name.clone()), d);
            }
        }
    }
    out.into_values().collect()
}

/// One declaration per (file, name); a second one in the same file merges its entries and
/// bindings (alchemy declares the worker class and its options in separate expressions).
fn merge<K: Ord>(out: &mut BTreeMap<K, Deployable>, key: K, d: Deployable) {
    out.entry(key)
        .and_modify(|a| {
            a.entries.extend(d.entries.iter().cloned());
            a.bindings.extend(d.bindings.iter().cloned());
            if a.line == 0 || (d.line > 0 && d.line < a.line) {
                a.line = d.line;
            }
        })
        .or_insert(d);
}

fn read(root: &Path, path: &str, st: &mut Stats) -> Option<String> {
    match std::fs::read_to_string(root.join(path)) {
        Ok(t) => Some(t),
        // A tracked file that is not valid UTF-8 holds no infra declaration we can read.
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            st.degraded.push(format!("{path}: not UTF-8, skipped"));
            None
        }
        Err(_) => None,
    }
}

fn is_script(path: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts"].iter().any(|e| path.ends_with(e))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ConfigKind {
    Toml,
    Json,
}

/// The dialect's config file names. Data, like the binding fields below: the mechanism (a
/// deployable declares named bindings) is the core's, the schema is the dialect's.
fn wrangler_kind(path: &str) -> Option<ConfigKind> {
    let base = path.rsplit('/').next()?;
    match base {
        "wrangler.toml" => Some(ConfigKind::Toml),
        "wrangler.json" | "wrangler.jsonc" => Some(ConfigKind::Json),
        _ => None,
    }
}

/// Wrangler config: `name`, `main`, and each binding section's name field.
fn wrangler(path: &str, text: &str, kind: ConfigKind, track: &HashSet<&str>) -> Result<Deployable, String> {
    let v: serde_json::Value = match kind {
        ConfigKind::Toml => {
            let t: toml::Value = toml::from_str(text.trim_start()).map_err(|e| format!("invalid TOML: {e}"))?;
            serde_json::to_value(t).map_err(|e| format!("invalid TOML: {e}"))?
        }
        ConfigKind::Json => serde_json::from_str(&strip_jsonc(text)).map_err(|e| format!("invalid JSONC: {e}"))?,
    };
    let dir = path.rsplit_once('/').map_or("", |(d, _)| d);
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .map(String::from)
        .or_else(|| dir.rsplit('/').next().filter(|d| !d.is_empty()).map(String::from))
        .ok_or("no name and no directory to name it after")?;
    let line = text.find(&format!("\"{name}\"")).map_or(0, |i| line_of(text, i as u32));
    let mut d = Deployable { file: path.to_string(), line, name, entries: BTreeSet::new(), bindings: BTreeSet::new() };
    if let Some(main) = v.get("main").and_then(|m| m.as_str()) {
        d.entries.insert(join(dir, main));
    } else {
        for candidate in ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.mjs"] {
            let p = join(dir, candidate);
            if track.contains(p.as_str()) {
                d.entries.insert(p);
                break;
            }
        }
    }
    d.bindings = wrangler_bindings(&v);
    Ok(d)
}

/// Where each wrangler section keeps its binding name. Data: the Cloudflare config schema, not a
/// core rule. `vars`, `durable_objects.bindings`, `queues.producers` and `assets` are handled
/// separately because they are not a plain array of one field.
const WRANGLER_ARRAYS: &[(&str, &str)] = &[
    ("kv_namespaces", "binding"),
    ("r2_buckets", "binding"),
    ("d1_databases", "binding"),
    ("services", "binding"),
    ("send_email", "name"),
    ("hyperdrive", "binding"),
    ("vectorize", "binding"),
    ("analytics_engine_datasets", "binding"),
    ("mtls_certificates", "binding"),
    ("dispatch_namespaces", "binding"),
    ("artifacts", "binding"),
];

const WRANGLER_OBJECTS: &[(&str, &str)] = &[("ai", "binding"), ("browser", "binding")];

fn wrangler_bindings(v: &serde_json::Value) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    fn add(out: &mut BTreeSet<String>, x: Option<&serde_json::Value>) {
        if let Some(s) = x.and_then(|s| s.as_str()).filter(|s| !s.is_empty()) {
            out.insert(s.to_string());
        }
    }
    for (section, field) in WRANGLER_ARRAYS {
        for item in v.get(*section).and_then(|s| s.as_array()).into_iter().flatten() {
            add(&mut out, item.get(*field));
        }
    }
    for (section, field) in WRANGLER_OBJECTS {
        add(&mut out, v.get(*section).and_then(|s| s.get(*field)));
    }
    for item in v
        .get("durable_objects")
        .and_then(|d| d.get("bindings"))
        .and_then(|b| b.as_array())
        .into_iter()
        .flatten()
    {
        add(&mut out, item.get("name"));
    }
    for item in v
        .get("queues")
        .and_then(|q| q.get("producers"))
        .and_then(|p| p.as_array())
        .into_iter()
        .flatten()
    {
        add(&mut out, item.get("binding"));
    }
    if let Some(vars) = v.get("vars").and_then(|s| s.as_object()) {
        out.extend(vars.keys().filter(|k| !k.is_empty()).cloned());
    }
    add(&mut out, v.get("assets").and_then(|a| a.get("binding")));
    out
}

/// JSON with comments and trailing commas, as wrangler's `jsonc` accepts it.
fn strip_jsonc(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let mut string = false;
    while i < b.len() {
        let c = b[i];
        if string {
            out.push(c as char);
            if c == b'\\' && i + 1 < b.len() {
                out.push(b[i + 1] as char);
                i += 2;
                continue;
            }
            if c == b'"' {
                string = false;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' => {
                string = true;
                out.push('"');
                i += 1;
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'/' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(b.len());
            }
            b',' => {
                let mut j = i + 1;
                while j < b.len() && (b[j] as char).is_whitespace() {
                    j += 1;
                }
                if j < b.len() && (b[j] == b'}' || b[j] == b']') {
                    i += 1;
                } else {
                    out.push(',');
                    i += 1;
                }
            }
            _ => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    out
}

// ---------------------------------------------------------------- alchemy

/// Walk one alchemy module: a worker or container is declared by a call whose callee is
/// `Cloudflare.Worker` (or `Container`) from `alchemy/Cloudflare`, directly or as the curried
/// form a class extends, with the deployable's name first and its options second. A container's
/// options arrive later, in `Class.make(...)`; the class name links the two.
fn alchemy(path: &str, text: &str) -> Vec<Deployable> {
    let alloc = Allocator::default();
    let st = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
    let ret = Parser::new(&alloc, text, st).parse();
    if ret.fatal_error {
        return Vec::new();
    }
    let mut w = Decls {
        src: text,
        file: path,
        ns: HashSet::new(),
        named: HashMap::new(),
        classes: HashMap::new(),
        out: Vec::new(),
    };
    w.visit_program(&ret.program);
    // One deployable per name in a file: the class call and its `.make(...)` options meet here.
    let mut by_name: BTreeMap<String, Deployable> = BTreeMap::new();
    for d in w.out {
        merge(&mut by_name, d.name.clone(), d);
    }
    by_name.into_values().collect()
}

struct Decls<'a> {
    src: &'a str,
    file: &'a str,
    /// Local names of `import * as X from "alchemy/Cloudflare"`.
    ns: HashSet<&'a str>,
    /// Local name of an imported Worker or Container -> its imported name.
    named: HashMap<&'a str, &'static str>,
    /// Class name -> deployable name, for the `.make(...)` half of a container.
    classes: HashMap<&'a str, String>,
    out: Vec<Deployable>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Decl {
    Worker,
    Container,
}

impl Decls<'_> {
    /// The deployable a callee declares, looking through the `()` of the curried class form.
    fn decl_of(&self, e: &Expression<'_>) -> Option<Decl> {
        match e.get_inner_expression() {
            Expression::StaticMemberExpression(m) => {
                let Expression::Identifier(o) = m.object.get_inner_expression() else { return None };
                if !self.ns.contains(o.name.as_str()) {
                    return None;
                }
                match m.property.name.as_str() {
                    "Worker" => Some(Decl::Worker),
                    "Container" => Some(Decl::Container),
                    _ => None,
                }
            }
            Expression::Identifier(i) => match self.named.get(i.name.as_str()) {
                Some(&"Worker") => Some(Decl::Worker),
                Some(&"Container") => Some(Decl::Container),
                _ => None,
            },
            // `Cloudflare.Worker<X>()` before the options call.
            Expression::CallExpression(c) if c.arguments.is_empty() => self.decl_of(&c.callee),
            _ => None,
        }
    }

    fn add(&mut self, span_start: u32, name: &str, opts: Option<&ObjectExpression<'_>>) {
        let mut d = Deployable {
            file: self.file.to_string(),
            line: line_of(self.src, span_start),
            name: name.to_string(),
            entries: BTreeSet::new(),
            bindings: BTreeSet::new(),
        };
        if let Some(o) = opts {
            self.options(o, &mut d);
        }
        self.out.push(d);
    }

    /// `main` and `env` from an options object.
    fn options(&self, o: &ObjectExpression<'_>, d: &mut Deployable) {
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else { continue };
            let Some(k) = p.key.static_name() else { continue };
            match k.as_str() {
                Some("main") => {
                    if let Some(entry) = self.entry(&p.value, d) {
                        d.entries.insert(entry);
                    }
                }
                // Alchemy's assets option always exposes the `ASSETS` binding; it is not in `env`.
                Some("assets") => {
                    d.bindings.insert("ASSETS".to_string());
                }
                Some("env") => {
                    if let Expression::ObjectExpression(env) = p.value.get_inner_expression() {
                        for b in &env.properties {
                            if let ObjectPropertyKind::ObjectProperty(b) = b {
                                if let Some(n) = static_key(&b.key) {
                                    d.bindings.insert(n);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// `main` as a path relative to this file, or `import.meta.url` as this file.
    fn entry(&self, e: &Expression<'_>, d: &Deployable) -> Option<String> {
        match e.get_inner_expression() {
            Expression::StringLiteral(s) => s.value.as_str().map(|v| join(dir_of(&d.file), v)),
            // `main: import.meta.url` is the file that declares the deployable.
            Expression::ImportMeta(_) => Some(d.file.clone()),
            Expression::StaticMemberExpression(m)
                if matches!(m.object.get_inner_expression(), Expression::ImportMeta(_)) && m.property.name.as_str() == "url" =>
            {
                Some(d.file.clone())
            }
            _ => None,
        }
    }

    /// The first object literal in an expression that carries `env` or `main`, for `.make(...)`
    /// options that a dialect wraps in a callback.
    fn options_object<'b>(&self, e: &'b Expression<'b>) -> Option<&'b ObjectExpression<'b>> {
        match e.get_inner_expression() {
            Expression::ObjectExpression(o) => {
                let hit = o.properties.iter().any(|p| {
                    matches!(p, ObjectPropertyKind::ObjectProperty(p)
                        if static_key(&p.key).is_some_and(|n| n == "env" || n == "main"))
                });
                hit.then_some(o)
            }
            Expression::CallExpression(c) => {
                c.arguments.iter().find_map(|a| a.as_expression().and_then(|e| self.options_object(e)))
            }
            Expression::ArrowFunctionExpression(a) => match &a.body {
                ArrowFunctionBody::FunctionBody(b) => b.statements.iter().find_map(|s| match s {
                    Statement::ExpressionStatement(s) => self.options_object(&s.expression),
                    Statement::ReturnStatement(r) => r.argument.as_ref().and_then(|e| self.options_object(e)),
                    _ => None,
                }),
                body => body.as_expression().and_then(|e| self.options_object(e)),
            },
            Expression::ParenthesizedExpression(p) => self.options_object(&p.expression),
            _ => None,
        }
    }
}

impl<'a> Visit<'a> for Decls<'a> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        if it.source.value.as_str() != Some("alchemy/Cloudflare") {
            return;
        }
        for s in it.specifiers.iter().flatten() {
            match s {
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(n) => {
                    self.ns.insert(n.local.name.as_str());
                }
                ImportDeclarationSpecifier::ImportSpecifier(s) => match s.imported.name().as_str() {
                    "Worker" => {
                        self.named.insert(s.local.name.as_str(), "Worker");
                    }
                    "Container" => {
                        self.named.insert(s.local.name.as_str(), "Container");
                    }
                    _ => {}
                },
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
            }
        }
    }

    fn visit_class(&mut self, it: &Class<'a>) {
        if let (Some(id), Some(heritage)) = (&it.id, &it.heritage) {
            if let Expression::CallExpression(c) = heritage.expression.get_inner_expression() {
                if self.decl_of(&c.callee).is_some() {
                    if let Some(Argument::StringLiteral(name)) = c.arguments.first() {
                        if let Some(n) = name.value.as_str() {
                            self.classes.insert(id.name.as_str(), n.to_string());
                        }
                    }
                }
            }
        }
        walk::walk_class(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(kind) = self.decl_of(&it.callee) {
            // The curried `Cloudflare.Worker<X>()` has no arguments of its own.
            if let Some(Argument::StringLiteral(name)) = it.arguments.first() {
                let Some(name) = name.value.as_str() else { return };
                let opts = it.arguments.get(1).and_then(|a| a.as_expression()).and_then(|e| match e.get_inner_expression() {
                    Expression::ObjectExpression(o) => Some(&**o),
                    _ => None,
                });
                let _ = kind;
                let name = name.to_string();
                self.add(it.span.start, &name, opts);
            }
        } else if let Expression::StaticMemberExpression(m) = it.callee.get_inner_expression() {
            // `Class.make(...)`: a container's options, wrapped in a callback by the dialect.
            if m.property.name.as_str() == "make" {
                if let Expression::Identifier(o) = m.object.get_inner_expression() {
                    if let Some(name) = self.classes.get(o.name.as_str()).cloned() {
                        let opts = it.arguments.iter().find_map(|a| a.as_expression().and_then(|e| self.options_object(e)));
                        let mut d = Deployable {
                            file: self.file.to_string(),
                            line: line_of(self.src, it.span.start),
                            name,
                            entries: BTreeSet::new(),
                            bindings: BTreeSet::new(),
                        };
                        if let Some(o) = opts {
                            self.options(o, &mut d);
                        }
                        if !d.bindings.is_empty() || !d.entries.is_empty() {
                            self.out.push(d);
                        }
                    }
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}

// ---------------------------------------------------------------- reads

/// The entry closure of every deployable: the entry files and every file their `I` edges reach.
fn closure(
    edges: &[[u32; 5]],
    deployments: &[Deployable],
    file_ids: &HashMap<&str, u32>,
    st: &mut Stats,
) -> BTreeSet<u32> {
    let mut adj: HashMap<u32, Vec<u32>> = HashMap::new();
    for e in edges {
        adj.entry(e[0]).or_default().push(e[1]);
    }
    let mut seen = BTreeSet::new();
    let mut queue = VecDeque::new();
    for d in deployments {
        for e in &d.entries {
            match file_ids.get(e.as_str()) {
                Some(&id) => {
                    if seen.insert(id) {
                        queue.push_back(id);
                    }
                }
                None => st.degraded.push(format!(
                    "{}: entry {} is not in a lane's file set, so its reads are unknown",
                    d.file, e
                )),
            }
        }
    }
    while let Some(f) = queue.pop_front() {
        for &n in adj.get(&f).into_iter().flatten() {
            if seen.insert(n) {
                queue.push_back(n);
            }
        }
    }
    seen
}

/// Binding names read in one file of the entry closure, in file-id order.
fn reads_in_closure(
    root: &Path,
    files: &[String],
    closure: &BTreeSet<u32>,
    st: &mut Stats,
) -> Vec<(u32, String)> {
    let mut out = BTreeSet::new();
    for &file in closure {
        let Some(path) = files.get(file as usize) else { continue };
        if !is_script(path) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(root.join(path)) else { continue };
        // A file with no `env` in it reads no binding by name; skip the parse it does not need.
        if !text.contains("env") {
            continue;
        }
        st.read_files += 1;
        let alloc = Allocator::default();
        let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
        let ret = Parser::new(&alloc, &text, source_type).parse();
        if ret.fatal_error {
            st.degraded.push(format!("{path}: parse failed, its binding reads are unknown"));
            continue;
        }
        let mut r = Reads { env: HashSet::new(), out: BTreeSet::new() };
        r.visit_program(&ret.program);
        out.extend(r.out.into_iter().map(|n| (file, n)));
    }
    out.into_iter().collect()
}

struct Reads<'a> {
    /// Local names bound to `env` from `cloudflare:workers`.
    env: HashSet<&'a str>,
    out: BTreeSet<String>,
}

/// `env`, `this.env`, `ctx.env` and `alias.env`: the Workers `Env` conventions, by name.
fn is_env_object(e: &Expression<'_>, aliases: &HashSet<&str>) -> bool {
    match e.get_inner_expression() {
        Expression::Identifier(i) => i.name.as_str() == "env" || aliases.contains(i.name.as_str()),
        Expression::StaticMemberExpression(m) => {
            if m.property.name.as_str() != "env" {
                return false;
            }
            match m.object.get_inner_expression() {
                Expression::Identifier(o) => o.name.as_str() != "process",
                // `import.meta.env` is the bundler's, not a binding.
                Expression::ImportMeta(_) => false,
                _ => true,
            }
        }
        _ => false,
    }
}

impl<'a> Visit<'a> for Reads<'a> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        if it.source.value.as_str() != Some("cloudflare:workers") {
            return;
        }
        for s in it.specifiers.iter().flatten() {
            if let ImportDeclarationSpecifier::ImportSpecifier(s) = s {
                if s.imported.name().as_str() == "env" {
                    self.env.insert(s.local.name.as_str());
                }
            }
        }
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if is_env_object(&it.object, &self.env) {
            self.out.insert(it.property.name.to_string());
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        if is_env_object(&it.object, &self.env) {
            if let Expression::StringLiteral(s) = it.expression.get_inner_expression() {
                if let Some(v) = s.value.as_str().filter(|v| !v.is_empty()) {
                    self.out.insert(v.to_string());
                }
            }
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::ObjectPattern(p), Some(init)) = (&it.id, &it.init) {
            if is_env_object(init, &self.env) {
                for b in &p.properties {
                    if let Some(n) = static_key(&b.key) {
                        self.out.insert(n);
                    }
                }
            }
        }
        walk::walk_variable_declarator(self, it);
    }
}

// ---------------------------------------------------------------- paths

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// A path relative to `dir`, lexically normalised (`./`, `..`, repeated slashes).
fn join(dir: &str, raw: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for p in dir.split('/').chain(raw.split('/')) {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(p),
        }
    }
    parts.join("/")
}

/// A property key as a UTF-8 name; a lone surrogate gives none.
fn static_key(k: &PropertyKey<'_>) -> Option<String> {
    k.static_name().and_then(|n| n.as_str().map(str::to_string))
}

fn line_of(src: &str, offset: u32) -> u32 {
    let end = (offset as usize).min(src.len());
    src.as_bytes()[..end].iter().filter(|b| **b == b'\n').count() as u32 + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decls(path: &str, text: &str) -> Vec<Deployable> {
        let mut out = alchemy(path, text);
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    #[test]
    fn a_direct_worker_call_declares_its_env_and_main() {
        let src = r#"
import * as Cloudflare from "alchemy/Cloudflare";
const w = Cloudflare.Worker("Api", {
  main: "./src/api.ts",
  env: { DB: db, BUCKET: bucket, "PLAIN": "x" },
});
"#;
        let d = decls("alchemy.run.ts", src);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].name, "Api");
        assert_eq!(d[0].entries.iter().collect::<Vec<_>>(), ["src/api.ts"]);
        assert_eq!(d[0].bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["BUCKET", "DB", "PLAIN"]);
    }

    #[test]
    fn a_curried_class_worker_declares_itself_at_the_options_call() {
        let src = r#"
import * as Cloudflare from "alchemy/Cloudflare";
export default class Api extends Cloudflare.Worker<Api>()("Api", {
  main: import.meta.url,
  env: { DB: db },
}) {}
"#;
        let d = decls("src/Api.ts", src);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].name, "Api");
        assert_eq!(d[0].entries.iter().collect::<Vec<_>>(), ["src/Api.ts"]);
        assert_eq!(d[0].bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["DB"]);
    }

    #[test]
    fn an_alias_or_named_import_is_followed() {
        let src = r#"
import { Worker } from "alchemy/Cloudflare";
export const w = Worker("Queue", { main: "./src/q.ts", env: { Q: q } });
"#;
        let d = decls("alchemy.run.ts", src);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].name, "Queue");
    }

    #[test]
    fn a_container_takes_its_options_from_make() {
        let src = r#"
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
export class Box extends Cloudflare.Container<Box, {}>()("Box") {}
export const Live = Box.make(
  Stack.useSync((stack) => ({ main: import.meta.url, env: { GREETING: "hi" } })),
  Effect.gen(function* () {}),
);
"#;
        let d = decls("src/Box.ts", src);
        let all: Vec<&Deployable> = d.iter().collect();
        assert_eq!(all.len(), 1, "{d:?}");
        assert_eq!(all[0].name, "Box");
        assert_eq!(all[0].bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["GREETING"]);
        assert_eq!(all[0].entries.iter().collect::<Vec<_>>(), ["src/Box.ts"]);
    }

    #[test]
    fn wrangler_toml_reads_each_section_field() {
        let text = r#"
name = "api"
main = "worker/index.ts"
kv_namespaces = [{ binding = "KV" }]
d1_databases = [{ binding = "DB", database_name = "api" }]
vars = { MODE = "prod" }
[durable_objects]
bindings = [{ name = "ROOM", class_name = "Room" }]
[[queues.producers]]
binding = "JOBS"
queue = "jobs"
[[queues.consumers]]
queue = "jobs"
"#;
        let track: HashSet<&str> = ["worker/index.ts"].into_iter().collect();
        let d = wrangler("apps/api/wrangler.toml", text, ConfigKind::Toml, &track).unwrap();
        assert_eq!(d.name, "api");
        assert_eq!(d.entries.iter().collect::<Vec<_>>(), ["apps/api/worker/index.ts"]);
        assert_eq!(d.bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["DB", "JOBS", "KV", "MODE", "ROOM"]);
    }

    #[test]
    fn alchemy_assets_expose_the_assets_binding() {
        let src = r#"
import * as Cloudflare from "alchemy/Cloudflare";
export const w = Cloudflare.Worker("Site", { assets: { directory: "./out" } });
"#;
        let d = decls("alchemy.run.ts", src);
        assert_eq!(d[0].bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["ASSETS"]);
    }

    #[test]
    fn wrangler_jsonc_accepts_comments_and_trailing_commas() {
        let text = r#"{
  // the schema is local
  "name": "ui",
  /* assets site */ "assets": { "directory": "./out", "binding": "ASSETS" },
  "browser": { "binding": "BROWSER" },
  "vars": { "MODE": "prod", },
}"#;
        let track: HashSet<&str> = HashSet::new();
        let d = wrangler("apps/ui/wrangler.jsonc", text, ConfigKind::Json, &track).unwrap();
        assert_eq!(d.name, "ui");
        assert_eq!(d.bindings.iter().map(String::as_str).collect::<Vec<_>>(), ["ASSETS", "BROWSER", "MODE"]);
        assert_eq!(d.line, 3);
    }

    #[test]
    fn reads_are_env_members_and_destructuring_but_never_process_or_import_meta() {
        let src = r#"
import { env } from "cloudflare:workers";
import * as CF from "cloudflare:workers";
export function f(request: Request, env: Env) {
  const db = env.DB;
  const key = env["KEY"];
  const { QUEUE, BUCKET: b } = env;
  const mode = process.env.MODE;
  const vite = import.meta.env.VITE;
  const alias = CF.env.ALIAS;
  return [db, key, QUEUE, b, mode, vite, alias];
}
class C { fetch() { return this.env.ROOM; } }
"#;
        let alloc = Allocator::default();
        let ret = Parser::new(&alloc, src, SourceType::ts()).parse();
        let mut r = Reads { env: HashSet::new(), out: BTreeSet::new() };
        r.visit_program(&ret.program);
        let got: Vec<&str> = r.out.iter().map(String::as_str).collect();
        assert_eq!(got, ["ALIAS", "BUCKET", "DB", "KEY", "QUEUE", "ROOM"]);
    }
}
