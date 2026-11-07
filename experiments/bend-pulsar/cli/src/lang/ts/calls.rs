//! Catalog data the TS walker needs to turn calls into `SY`, `CL`, `CS` and `HD` facts.
//!
//! The index is built from parsed catalogs (`crate::catalog`). A callee is named by the module
//! and export path it resolves to through the file's imports (`effect#Effect.orDie`), or by
//! `global#<path>` when its root is an undeclared global (`global#console.log`). Nothing here
//! names a technology: the entries are data, and which catalogs are on is decided by evidence.

use crate::catalog::{Arg, Catalog, Via};
use std::collections::HashMap;

/// Which use of a bound value counts (the catalog's `use`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Use {
    /// No `use`: the event itself (a call, a reference, a read) counts.
    Event,
    Tag,
    Call,
    /// `member:<name>`: a call of that method on the value.
    Member(String),
    /// `member:*`: a call of any method on the value.
    AnyMember,
    /// `noargs`, with `new`: zero arguments only.
    NoArgs,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub class: u32,
    pub via: Via,
    pub use_: Use,
}

/// What a wrapper call does to the functions it takes.
#[derive(Debug, Clone, Copy)]
pub struct Wrap {
    pub ctx: u8,
}

#[derive(Debug, Default)]
pub struct CatalogIndex {
    /// Longest prefix first.
    aliases: Vec<(String, String)>,
    syms: HashMap<String, Vec<Entry>>,
    handlers: HashMap<String, Arg>,
    wrappers: HashMap<String, Wrap>,
}

fn parse_use(s: Option<&str>) -> Use {
    match s {
        None => Use::Event,
        Some("tag") => Use::Tag,
        Some("call") => Use::Call,
        Some("noargs") => Use::NoArgs,
        Some("member:*") => Use::AnyMember,
        Some(m) => match m.strip_prefix("member:") {
            Some(name) => Use::Member(name.to_string()),
            // The catalog parser is strict about values it knows; an unknown one never matches.
            None => Use::Member(format!("\0{m}")),
        },
    }
}

impl CatalogIndex {
    pub fn is_empty(&self) -> bool {
        self.syms.is_empty() && self.handlers.is_empty() && self.wrappers.is_empty()
    }

    pub fn from_catalogs(catalogs: &[&Catalog]) -> CatalogIndex {
        let mut ix = CatalogIndex::default();
        for c in catalogs {
            let class_id: HashMap<&str, u32> = c.classes.iter().map(|k| (k.class.as_str(), k.id)).collect();
            for a in &c.aliases {
                ix.aliases.push((a.from.clone(), a.to.clone()));
            }
            for s in &c.symbols {
                let Some(&class) = class_id.get(s.class.as_str()) else { continue };
                ix.syms.entry(s.sym.clone()).or_default().push(Entry {
                    class,
                    via: s.via.unwrap_or(Via::Call),
                    use_: parse_use(s.use_.as_deref()),
                });
            }
            for h in &c.handlers {
                ix.handlers.insert(h.sym.clone(), h.arg);
            }
            for w in &c.wrappers {
                let slot = ix.wrappers.entry(w.sym.clone()).or_insert(Wrap { ctx: 0 });
                slot.ctx |= w.ctx as u8;
            }
        }
        ix.aliases.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
        ix.aliases.dedup();
        ix
    }

    pub fn entries(&self, sym: &str) -> &[Entry] {
        self.syms.get(sym).map_or(&[], Vec::as_slice)
    }

    pub fn handler(&self, sym: &str) -> Option<Arg> {
        self.handlers.get(sym).copied()
    }

    pub fn wrapper(&self, sym: &str) -> Option<Wrap> {
        self.wrappers.get(sym).copied()
    }

    /// Every class a symbol belongs to, ascending and unique (for `CL`).
    pub fn classes(&self, sym: &str) -> Vec<u32> {
        let mut v: Vec<u32> = self.entries(sym).iter().map(|e| e.class).collect();
        v.sort_unstable();
        v.dedup();
        v
    }

    /// The symbol a module specifier opens: the longest alias prefix is rewritten, and a
    /// specifier with no `#` yet gets one, so members join as `module#export.path`.
    pub fn module_base(&self, spec: &str) -> String {
        // A specifier that is exactly an alias without its trailing slash is that module itself
        // (`effect/sql` for the alias `effect/sql/`), not a member of a shorter alias.
        for (from, to) in &self.aliases {
            if from.strip_suffix('/') == Some(spec) {
                return to.clone();
            }
        }
        for (from, to) in &self.aliases {
            if let Some(rest) = spec.strip_prefix(from.as_str()) {
                return format!("{to}{rest}");
            }
        }
        if spec.contains('#') {
            spec.to_string()
        } else {
            format!("{spec}#")
        }
    }
}

/// `base` + `seg`: no dot right after the `#` that opens the export path.
pub fn join(base: &str, seg: &str) -> String {
    if base.ends_with('#') {
        format!("{base}{seg}")
    } else {
        format!("{base}.{seg}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::load;

    const CAT: &str = r#"
format = "pulsar-catalog 0"
id = "t"
scope = "lane"
sources = ["t"]
aliases = [
  { from = "effect/sql/", to = "effect/sql#" },
  { from = "effect/", to = "effect#" },
]
classes = [
  { class = "query", id = 1, rule = "t/query" },
  { class = "log", id = 3, rule = "t/log" },
]
symbols = [
  { sym = "effect#Effect.orDie", class = "log", ver = "4", at = "x:1", doc = "d" },
]
"#;

    #[test]
    fn aliases_rewrite_the_longest_prefix_and_members_join_after_the_hash() {
        let l = load("t", CAT).unwrap();
        let ix = CatalogIndex::from_catalogs(&[&l.catalog]);
        assert_eq!(ix.module_base("effect/Effect"), "effect#Effect");
        assert_eq!(ix.module_base("effect"), "effect#");
        assert_eq!(join(&ix.module_base("effect/Effect"), "orDie"), "effect#Effect.orDie");
        assert_eq!(join(&ix.module_base("effect"), "Effect"), "effect#Effect");
        assert_eq!(ix.classes("effect#Effect.orDie"), vec![3]);
        // The bare subpath is the module, not a member of the shorter `effect/` alias.
        assert_eq!(ix.module_base("effect/sql"), "effect/sql#");
        assert_eq!(ix.module_base("effect/sql/SqlClient"), "effect/sql#SqlClient");
    }
}

#[cfg(test)]
mod fixtures {
    use super::super::builtin::all_index;
    use super::super::extract::extract;
    use crate::lang::functions::SiteKind;
    use oxc_allocator::Allocator;
    use std::path::Path;

    fn render(rel: &str, src: &str) -> String {
        let alloc = Allocator::default();
        let ix = all_index();
        let ex = extract(&alloc, rel, Path::new(rel), src, &ix, false, None);
        let f = ex.functions;
        let mut out = String::new();
        for s in &f.sites {
            let chain = &f.fns[s.fn_local as usize].chain;
            match s.kind {
                SiteKind::Call { sym, loop_depth, ctx } => {
                    out += &format!("CS {chain} {} loops={loop_depth} ctx={ctx}\n", f.syms[sym as usize]);
                }
                SiteKind::Handler { shape } => out += &format!("HD {chain} shape={shape}\n"),
            }
        }
        out
    }

    /// `<name>.ts` against `<name>.expected`, derived by hand from the syntax and the shipped
    /// catalogs, never copied from this walker's output.
    #[test]
    fn call_site_fixtures_match_hand_checked_expectations() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/ts-calls");
        let mut seen = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("ts") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let want = std::fs::read_to_string(path.with_extension("expected")).unwrap();
            let rel = path.file_name().unwrap().to_str().unwrap();
            assert_eq!(render(rel, &src), want, "fixture {rel}");
            seen += 1;
        }
        assert!(seen >= 4, "fixtures missing: saw {seen}");
    }

    /// The SQL text the SQL lane receives: literal, template with `?` for each hole, or dynamic.
    #[test]
    fn query_call_texts_are_literal_template_or_dynamic() {
        use crate::lang::functions::SqlTextKind::{Dynamic, Literal, Template};
        let src = "import { SqlClient } from \"@effect/sql\";\nexport const q = (sql: SqlClient.SqlClient) => {\n  sql`select * from t where id = ${1} and k = ${2}`;\n  sql`select 1`;\n  sql.unsafe(\"select 2\");\n  sql.unsafe(build());\n  sql.unsafe(`select ${x}`);\n  for (const i of [1]) {\n    sql.unsafe(\"select 3\");\n  }\n  other(\"not sql\");\n};\n";
        let alloc = Allocator::default();
        let ex = extract(&alloc, "q.ts", Path::new("q.ts"), src, &all_index(), false, None);
        let got: Vec<(_, u32, u32, &str)> =
            ex.functions.sql.iter().map(|r| (r.kind, r.line, r.ct_node, r.text.as_str())).collect();
        assert_eq!(
            got,
            [
                (Template, 3, 0, "select * from t where id = ? and k = ?"),
                (Literal, 4, 0, "select 1"),
                (Literal, 5, 0, "select 2"),
                (Dynamic, 6, 0, ""),
                (Template, 7, 0, "select ?"),
                // inside the loop: CT node 1 (the loop; the function body is 0)
                (Literal, 9, 1, "select 3"),
            ]
        );
        assert!(ex.functions.sql.iter().all(|r| r.fn_local == Some(0)));
    }
}
