//! Catalogs: class data for symbols, handlers, wrappers, services, layers and rules.
//!
//! Format `pulsar-catalog 0` (TOML). One entry per line, sorted, so diffs are reviewable. The
//! parser is strict: an unknown key, an unknown enum value, a class that is not declared, or a
//! rule that names an undeclared class is an error, never a silent drop. A catalog is data;
//! only a *rule* turns a class into a finding. The fingerprint of a catalog is the SHA-256 of
//! its bytes as committed (line endings normalised), cites included, so a regenerated cite
//! changes the fingerprint on purpose.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const FORMAT: &str = "pulsar-catalog 0";

/// Catalog help text, printed by `pulsar catalog --help`. Keep in step with the structs below.
pub const HELP: &str = include_str!("catalog-help.txt");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Scope {
    /// Always on, for one language lane. Class data only.
    Lane,
    /// Switched on by evidence (`activate`). Named as framework-specific.
    Pack,
    /// A repository's own catalog under `.pulsar/catalogs/`. Always on for that repo.
    Repo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Via {
    Call,
    Ref,
    Yield,
    Result,
    YieldResult,
    Read,
    New,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Arg {
    LastFn,
    ObjectFns,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Label {
    None,
    FirstString,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Alias {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Class {
    pub class: String,
    pub id: u32,
    pub rule: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Symbol {
    pub sym: String,
    pub class: String,
    pub via: Option<Via>,
    #[serde(rename = "use")]
    pub use_: Option<String>,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Handler {
    pub sym: String,
    pub arg: Arg,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// Which functions an entry names as entry points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Shape {
    /// Every method of a class that extends `sym` (`names` narrows to those method names).
    SubclassMethods,
    /// The default export, or its function-valued properties (`names` narrows); `sym` is empty.
    DefaultExportFns,
    /// The function arguments of calls to `sym` (a handler registration).
    CallbackArgs,
}

/// A catalog entry point: functions the platform or framework calls from outside. `kind` is
/// FACTS.md's `EP` kind: 1 request handler, 2 object method, 3 RPC method, 4 alarm or
/// scheduled, 5 queue consumer, 6 HTTP API handler.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntryPoint {
    pub sym: String,
    pub shape: Shape,
    pub kind: u32,
    pub names: Option<Vec<String>>,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wrapper {
    pub sym: String,
    pub ctx: u32,
    pub label: Label,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Service {
    pub sym: String,
    pub default: bool,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layer {
    pub sym: String,
    pub builds: Vec<String>,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// A rule: a call site whose callee is in `class`, in a context matching the masks, is a finding.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub id: String,
    pub class: String,
    pub ctx_any: u32,
    pub ctx_none: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// A fan-out rule (FACTS.md `RF`): a call at loop depth > 0, with no ctx bit of `none`, that reaches
/// a call of a symbol of `class` within `edges` call edges (0 = the site itself).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fanout {
    pub id: String,
    pub class: String,
    pub edges: u32,
    pub none: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// A constant-argument rule (FACTS.md `RK`): a call of a symbol of `class` whose argument `pos`
/// (0-based) is a constant.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Konst {
    pub id: String,
    pub class: String,
    pub pos: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// An unbounded-growth rule (FACTS.md `RG`): a read with no row bound on a table that code an entry
/// point reaches within `depth` call edges inserts into.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Growth {
    pub id: String,
    pub depth: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// What kind of finding a hot-path rule is about (FACTS.md `RH` lanes 1 to 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HotLane {
    /// An SQL rule; `base` is the id of a `sql.*` rule.
    Sql,
    /// A fan-out rule; `base` is a `fanouts` id.
    Fanout,
    /// A constant-argument rule; `base` is a `konsts` id.
    Konst,
}

impl HotLane {
    /// The `RH` lane number.
    pub fn number(self) -> u32 {
        match self {
            HotLane::Sql => 1,
            HotLane::Fanout => 2,
            HotLane::Konst => 3,
        }
    }
}

/// A hot-path composite rule (FACTS.md `RH`): a finding of rule `base` whose function an entry point
/// reaches within `depth` call edges.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hot {
    pub id: String,
    pub lane: HotLane,
    pub base: String,
    pub depth: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// A call-edge rule (FACTS.md `RE`): a call to a repo function from a site whose ctx has every bit of
/// `all` and none of `none`, where the callee's own ctx (`FC`) has every bit of `target_all` and none
/// of `target_none`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeRule {
    pub id: String,
    pub all: u32,
    pub none: u32,
    pub target_all: u32,
    pub target_none: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

/// A module rule (FACTS.md `RM`): a file holding a function whose ctx (`FC`) has every bit of `all`
/// and none of `none`, and a function whose ctx has every bit of `also_all` and none of `also_none`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleRule {
    pub id: String,
    pub all: u32,
    pub none: u32,
    pub also_all: u32,
    pub also_none: u32,
    pub says: String,
    pub ver: String,
    pub at: String,
    pub doc: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub format: String,
    pub id: String,
    pub scope: Scope,
    pub activate: Option<Vec<String>>,
    pub sources: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<Alias>,
    pub classes: Vec<Class>,
    #[serde(default)]
    pub symbols: Vec<Symbol>,
    #[serde(default)]
    pub handlers: Vec<Handler>,
    #[serde(default)]
    pub wrappers: Vec<Wrapper>,
    #[serde(default)]
    pub entries: Vec<EntryPoint>,
    #[serde(default)]
    pub services: Vec<Service>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub fanouts: Vec<Fanout>,
    #[serde(default)]
    pub konsts: Vec<Konst>,
    #[serde(default)]
    pub hots: Vec<Hot>,
    #[serde(default)]
    pub growths: Vec<Growth>,
    #[serde(default)]
    pub edges: Vec<EdgeRule>,
    #[serde(default)]
    pub modules: Vec<ModuleRule>,
}

/// A parsed, validated catalog and its fingerprint.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub catalog: Catalog,
    /// Hex SHA-256 of the file bytes, `\r\n` normalised to `\n`.
    pub sha256: String,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Normalise line endings so a checkout with CRLF fingerprints like one with LF.
pub fn normalise(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Parse and validate. `name` labels errors (a file path or an embedded catalog id).
pub fn load(name: &str, text: &str) -> Result<Loaded, String> {
    let text = normalise(text);
    let catalog: Catalog = toml::from_str(&text).map_err(|e| format!("{name}: {e}"))?;
    validate(&catalog, &text).map_err(|e| format!("{name}: {e}"))?;
    Ok(Loaded { sha256: sha256_hex(text.as_bytes()), catalog })
}

fn validate(c: &Catalog, text: &str) -> Result<(), String> {
    check_header(c)?;
    check_activate(c)?;
    let names = check_classes(c)?;
    check_declared(c, &names)?;
    check_order(c)?;
    check_one_entry_per_line(c, text)
}

fn check_header(c: &Catalog) -> Result<(), String> {
    if c.format != FORMAT {
        return Err(format!("format is {:?}, expected {FORMAT:?}", c.format));
    }
    if c.id.is_empty() || !c.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(format!("id {:?} must be lowercase letters, digits and dashes", c.id));
    }
    Ok(())
}

/// Only scope "pack" takes `activate`, and every activator is `dep:` or `import:` with a value.
fn check_activate(c: &Catalog) -> Result<(), String> {
    match (c.scope, &c.activate) {
        (Scope::Pack, None) => return Err("scope \"pack\" requires `activate`".into()),
        (Scope::Pack, Some(a)) if a.is_empty() => return Err("`activate` is empty".into()),
        (Scope::Lane | Scope::Repo, Some(_)) => return Err("only scope \"pack\" takes `activate`".into()),
        _ => {}
    }
    for a in c.activate.iter().flatten() {
        let known = a.starts_with("dep:") || a.starts_with("import:") || a.starts_with("file:");
        if !known || a.split_once(':').is_some_and(|(_, v)| v.is_empty()) {
            return Err(format!("activate {a:?} must be dep:<package>, import:<specifier glob> or file:<base name>"));
        }
    }
    Ok(())
}

/// Classes: fixed ids 1-15 or repo ids >= 1000; names and ids unique. Returns the declared names.
fn check_classes(c: &Catalog) -> Result<BTreeSet<&str>, String> {
    let mut names = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for k in &c.classes {
        if !((1..=15).contains(&k.id) || k.id >= 1000) {
            return Err(format!("class {:?} has id {}: use 1-15 (FACTS.md fixed ids) or >= 1000", k.class, k.id));
        }
        if !names.insert(k.class.as_str()) {
            return Err(format!("class {:?} declared twice", k.class));
        }
        if !ids.insert(k.id) {
            return Err(format!("class id {} declared twice", k.id));
        }
        if k.rule.is_empty() {
            return Err(format!("class {:?} has an empty rule id", k.class));
        }
    }
    Ok(names)
}

/// Every symbol and rule names a declared class, and every `use` is well formed.
fn check_declared(c: &Catalog, names: &BTreeSet<&str>) -> Result<(), String> {
    let declared = |class: &str, what: &str| -> Result<(), String> {
        if names.contains(class) { Ok(()) } else { Err(format!("{what} uses class {class:?}, which `classes` does not declare")) }
    };
    for s in &c.symbols {
        declared(&s.class, &format!("symbol {:?}", s.sym))?;
        if let Some(u) = &s.use_ {
            valid_use(u).map_err(|e| format!("symbol {:?}: {e}", s.sym))?;
        }
    }
    check_entries(c)?;
    c.rules.iter().try_for_each(|r| declared(&r.class, &format!("rule {:?}", r.id)))?;
    c.fanouts.iter().try_for_each(|r| declared(&r.class, &format!("fan-out rule {:?}", r.id)))?;
    c.konsts.iter().try_for_each(|r| declared(&r.class, &format!("constant-argument rule {:?}", r.id)))?;
    check_composites(c)
}

/// Fan-out, constant-argument and hot-path rules: ids unique across every rule kind of the catalog
/// (policy names a rule by id alone), `none` a ctx mask, and a hot rule's base a rule of its lane
/// (an `sql.*` id, or a rule of this catalog: a repo catalog may build on a pack's rule instead, and
/// policy resolves that when both are active).
fn check_composites(c: &Catalog) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    let all = c.rules.iter().map(|r| &r.id).chain(c.fanouts.iter().map(|r| &r.id)).chain(c.konsts.iter().map(|r| &r.id)).chain(c.hots.iter().map(|r| &r.id)).chain(c.growths.iter().map(|r| &r.id));
    let all = all.chain(c.edges.iter().map(|r| &r.id)).chain(c.modules.iter().map(|r| &r.id));
    for id in all {
        if id.is_empty() || !ids.insert(id.as_str()) {
            return Err(format!("rule id {id:?} is empty or declared twice in this catalog"));
        }
    }
    for f in &c.fanouts {
        if f.none > 255 {
            return Err(format!("fan-out rule {:?}: none {} is not a ctx mask (0-255)", f.id, f.none));
        }
    }
    let masks = c.edges.iter().map(|r| (&r.id, [r.all, r.none, r.target_all, r.target_none])).chain(c.modules.iter().map(|r| (&r.id, [r.all, r.none, r.also_all, r.also_none])));
    for (id, m) in masks {
        if m.iter().any(|&b| b > 255) {
            return Err(format!("rule {id:?}: a mask is not a ctx mask (0-255)"));
        }
    }
    for h in &c.hots {
        if h.base.is_empty() {
            return Err(format!("hot-path rule {:?} names no base rule", h.id));
        }
        if h.lane == HotLane::Sql && !crate::finding::SQL_RULES.iter().any(|r| r.id == h.base) {
            return Err(format!("hot-path rule {:?}: base {:?} is not an sql.* rule", h.id, h.base));
        }
    }
    Ok(())
}

/// Entry points: a kind FACTS.md defines, a symbol exactly where the shape needs one, and
/// `names` only where it narrows something.
fn check_entries(c: &Catalog) -> Result<(), String> {
    for e in &c.entries {
        let what = format!("entry {:?} ({:?})", e.sym, e.shape);
        if !(1..=6).contains(&e.kind) {
            return Err(format!("{what} has kind {}: use 1-6 (FACTS.md EP kinds)", e.kind));
        }
        match (e.shape, e.sym.is_empty()) {
            (Shape::DefaultExportFns, false) => return Err(format!("{what}: default-export-fns takes an empty sym")),
            (Shape::SubclassMethods | Shape::CallbackArgs, true) => return Err(format!("{what} needs a sym")),
            _ => {}
        }
        match (&e.names, e.shape) {
            (Some(_), Shape::CallbackArgs) => return Err(format!("{what}: names does not apply to callback-args")),
            (Some(n), _) if n.is_empty() || n.iter().any(|x| x.is_empty()) => {
                return Err(format!("{what}: names is empty or has an empty name"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Sorted and unique, so a diff shows only what changed.
fn check_order(c: &Catalog) -> Result<(), String> {
    // Aliases are longest-prefix-first, so an alias must not be shadowed by an earlier prefix of it.
    for (j, b) in c.aliases.iter().enumerate() {
        if let Some(a) = c.aliases[..j].iter().find(|a| b.from.starts_with(a.from.as_str())) {
            return Err(format!("aliases: {:?} is shadowed by the earlier prefix {:?}; list longer prefixes first", b.from, a.from));
        }
    }
    // Classes are listed by id, so the fixed classes read 1 to 8 and repo classes follow.
    sorted_unique("classes", c.classes.iter().map(|k| format!("{:010}", k.id)))?;
    sorted_unique(
        "symbols",
        c.symbols.iter().map(|s| {
            let via = s.via.map(|v| format!("{v:?}")).unwrap_or_default();
            format!("{}\0{}\0{}\0{}", s.sym, via, s.use_.clone().unwrap_or_default(), s.ver)
        }),
    )?;
    sorted_unique("handlers", c.handlers.iter().map(|h| format!("{}\0{}", h.sym, h.ver)))?;
    sorted_unique("wrappers", c.wrappers.iter().map(|w| format!("{}\0{}", w.sym, w.ver)))?;
    sorted_unique("entries", c.entries.iter().map(|e| format!("{}\0{:?}\0{:02}\0{}", e.sym, e.shape, e.kind, e.ver)))?;
    sorted_unique("services", c.services.iter().map(|s| format!("{}\0{}", s.sym, s.ver)))?;
    sorted_unique("layers", c.layers.iter().map(|l| format!("{}\0{}", l.sym, l.ver)))?;
    sorted_unique("rules", c.rules.iter().map(|r| r.id.clone()))?;
    sorted_unique("fanouts", c.fanouts.iter().map(|r| r.id.clone()))?;
    sorted_unique("konsts", c.konsts.iter().map(|r| r.id.clone()))?;
    sorted_unique("hots", c.hots.iter().map(|r| r.id.clone()))?;
    sorted_unique("growths", c.growths.iter().map(|r| r.id.clone()))?;
    sorted_unique("edges", c.edges.iter().map(|r| r.id.clone()))?;
    sorted_unique("modules", c.modules.iter().map(|r| r.id.clone()))
}

/// One entry per line: every array entry is an inline table that starts its own line.
fn check_one_entry_per_line(c: &Catalog, text: &str) -> Result<(), String> {
    let entries = c.aliases.len()
        + c.classes.len()
        + c.symbols.len()
        + c.handlers.len()
        + c.wrappers.len()
        + c.entries.len()
        + c.services.len()
        + c.layers.len()
        + c.rules.len()
        + c.fanouts.len()
        + c.konsts.len()
        + c.hots.len()
        + c.growths.len()
        + c.edges.len()
        + c.modules.len();
    let starts = text.lines().filter(|l| l.trim_start().starts_with("{ ")).count();
    if starts != entries {
        return Err(format!("{entries} entries but {starts} lines start an inline table: one entry per line"));
    }
    Ok(())
}

fn valid_use(u: &str) -> Result<(), String> {
    match u {
        "tag" | "call" | "noargs" | "member:*" => Ok(()),
        m if m.strip_prefix("member:").is_some_and(|n| !n.is_empty()) => Ok(()),
        _ => Err(format!("use {u:?} is not tag, call, noargs, member:<name> or member:*")),
    }
}

fn sorted_unique(what: &str, keys: impl Iterator<Item = String>) -> Result<(), String> {
    let mut prev: Option<String> = None;
    for k in keys {
        if let Some(p) = &prev {
            if &k == p {
                return Err(format!("{what}: duplicate key {:?}", k.replace('\0', " | ")));
            }
            if &k < p {
                return Err(format!("{what}: {:?} is out of order (after {:?})", k.replace('\0', " | "), p.replace('\0', " | ")));
            }
        }
        prev = Some(k);
    }
    Ok(())
}

/// Catalogs shipped in the binary, by id. Pack catalogs name their framework; the lane catalog
/// is always on.
pub const EMBEDDED: &[(&str, &str)] = &[
    ("cloudflare-workers", include_str!("packs/cloudflare/catalog/cloudflare-workers.toml")),
    ("effect", include_str!("packs/effect/catalog/effect.toml")),
    ("js-globals", include_str!("packs/effect/catalog/js-globals.toml")),
    ("platform-node", include_str!("packs/effect/catalog/platform-node.toml")),
];

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"format = "pulsar-catalog 0"
id = "demo"
scope = "pack"
activate = ["dep:demo"]
sources = ["demo@1"]
classes = [
  { class = "log", id = 3, rule = "demo/log" },
  { class = "mine", id = 1000, rule = "demo/mine" },
]
symbols = [
  { sym = "demo#a", class = "log", ver = "1", at = "x:1", doc = "d" },
  { sym = "demo#b", class = "mine", via = "yield", use = "member:run", ver = "1", at = "x:2", doc = "d" },
]
"#;

    fn err(text: &str) -> String {
        load("t", text).unwrap_err()
    }

    #[test]
    fn a_good_catalog_loads_and_fingerprints_stably() {
        let a = load("t", GOOD).unwrap();
        assert_eq!(a.sha256, load("t", &GOOD.replace('\n', "\r\n")).unwrap().sha256, "CRLF must not change it");
        assert_eq!(a.sha256.len(), 64);
        assert_ne!(a.sha256, load("t", &GOOD.replace("doc = \"d\" },\n]", "doc = \"e\" },\n]")).unwrap().sha256);
    }

    #[test]
    fn unknown_keys_and_values_are_errors() {
        assert!(err(&GOOD.replace("ver = \"1\", at = \"x:1\"", "ver = \"1\", typo = 1, at = \"x:1\"")).contains("typo"));
        assert!(err(&GOOD.replace("yield", "yeild")).contains("yeild"));
        assert!(err(&GOOD.replace("pulsar-catalog 0", "pulsar-catalog 1")).contains("format"));
    }

    #[test]
    fn classes_must_be_declared_and_ids_valid() {
        assert!(err(&GOOD.replace("sym = \"demo#a\", class = \"log\"", "sym = \"demo#a\", class = \"nope\"")).contains("nope"));
        assert!(err(&GOOD.replace("id = 1000", "id = 99")).contains("id 99"));
    }

    #[test]
    fn scope_and_activate_must_agree() {
        assert!(err(&GOOD.replace("activate = [\"dep:demo\"]\n", "")).contains("requires `activate`"));
        assert!(err(&GOOD.replace("scope = \"pack\"", "scope = \"lane\"")).contains("only scope"));
        assert!(err(&GOOD.replace("dep:demo", "demo")).contains("dep:<package>"));
    }

    #[test]
    fn order_and_one_entry_per_line_are_enforced() {
        let swapped = GOOD.replace("demo#a", "demo#z");
        assert!(err(&swapped).contains("out of order"));
        let dup = GOOD.replace("demo#b", "demo#a").replace("via = \"yield\", use = \"member:run\", ", "");
        assert!(err(&dup).contains("duplicate"));
        let shadow = GOOD.replace("symbols = [", "aliases = [\n  { from = \"a/\", to = \"x#\" },\n  { from = \"a/b/\", to = \"y#\" },\n]\nsymbols = [");
        assert!(err(&shadow).contains("shadowed"));
        let joined = GOOD.replace("},\n  { sym = \"demo#b\"", "}, { sym = \"demo#b\"");
        assert!(err(&joined).contains("one entry per line"));
    }

    #[test]
    fn entry_points_are_strict_about_shape_kind_and_names() {
        let with = |entries: &str| format!("{GOOD}entries = [\n{entries}]\n");
        let ok = with("  { sym = \"\", shape = \"default-export-fns\", kind = 1, names = [\"fetch\"], ver = \"1\", at = \"x:3\", doc = \"d\" },\n  { sym = \"demo#Base\", shape = \"subclass-methods\", kind = 2, ver = \"1\", at = \"x:4\", doc = \"d\" },\n");
        let l = load("t", &ok).unwrap();
        assert_eq!(l.catalog.entries.len(), 2);
        let e = |s: &str| err(&with(s));
        assert!(e("  { sym = \"demo#B\", shape = \"subclasses\", kind = 2, ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("subclasses"));
        assert!(e("  { sym = \"demo#B\", shape = \"subclass-methods\", kind = 7, ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("kind 7"));
        assert!(e("  { sym = \"demo#B\", shape = \"callback-args\", kind = 6, names = [\"a\"], ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("names does not apply"));
        assert!(e("  { sym = \"demo#B\", shape = \"default-export-fns\", kind = 1, ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("empty sym"));
        assert!(e("  { sym = \"\", shape = \"subclass-methods\", kind = 2, ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("needs a sym"));
        assert!(e("  { sym = \"demo#B\", shape = \"subclass-methods\", kind = 2, ver = \"1\", at = \"x\", doc = \"d\" },\n  { sym = \"demo#A\", shape = \"subclass-methods\", kind = 2, ver = \"1\", at = \"x\", doc = \"d\" },\n").contains("out of order"));
    }

    #[test]
    fn the_shipped_catalogs_all_load() {
        for (id, text) in EMBEDDED {
            let l = load(id, text).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(&l.catalog.id, id);
        }
    }
}
