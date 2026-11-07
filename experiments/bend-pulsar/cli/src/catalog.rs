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
    pub services: Vec<Service>,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub rules: Vec<Rule>,
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
    if c.format != FORMAT {
        return Err(format!("format is {:?}, expected {FORMAT:?}", c.format));
    }
    if c.id.is_empty() || !c.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(format!("id {:?} must be lowercase letters, digits and dashes", c.id));
    }
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

    // Classes: fixed ids 1-8 or repo ids >= 1000; names and ids unique.
    let mut names = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for k in &c.classes {
        if !((1..=8).contains(&k.id) || k.id >= 1000) {
            return Err(format!("class {:?} has id {}: use 1-8 (FACTS.md fixed ids) or >= 1000", k.class, k.id));
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
    let declared = |class: &str, what: &str| -> Result<(), String> {
        if names.contains(class) { Ok(()) } else { Err(format!("{what} uses class {class:?}, which `classes` does not declare")) }
    };
    for s in &c.symbols {
        declared(&s.class, &format!("symbol {:?}", s.sym))?;
        if let Some(u) = &s.use_ {
            valid_use(u).map_err(|e| format!("symbol {:?}: {e}", s.sym))?;
        }
    }
    for r in &c.rules {
        declared(&r.class, &format!("rule {:?}", r.id))?;
    }

    // Order: sorted and unique, so a diff shows only what changed.
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
    sorted_unique("services", c.services.iter().map(|s| format!("{}\0{}", s.sym, s.ver)))?;
    sorted_unique("layers", c.layers.iter().map(|l| format!("{}\0{}", l.sym, l.ver)))?;
    sorted_unique("rules", c.rules.iter().map(|r| r.id.clone()))?;

    // One entry per line: every array entry is an inline table that starts its own line.
    let entries = c.aliases.len()
        + c.classes.len()
        + c.symbols.len()
        + c.handlers.len()
        + c.wrappers.len()
        + c.services.len()
        + c.layers.len()
        + c.rules.len();
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
    fn the_shipped_catalogs_all_load() {
        for (id, text) in EMBEDDED {
            let l = load(id, text).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!(&l.catalog.id, id);
        }
    }
}
