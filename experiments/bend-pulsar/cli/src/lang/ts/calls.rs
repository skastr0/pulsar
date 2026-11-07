//! Catalog data the TS walker needs to turn calls into `SY`, `CL`, `CS` and `HD` facts.
//!
//! The index is built from parsed catalogs (`crate::catalog`). A callee is named by the module
//! and export path it resolves to through the file's imports (`effect#Effect.orDie`), or by
//! `global#<path>` when its root is an undeclared global (`global#console.log`). Nothing here
//! names a technology: the entries are data, and which catalogs are on is decided by evidence.

use crate::catalog::{Arg, Catalog, Shape, Via};
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
    /// `run = "awaited"`: a site only where the use runs in place.
    pub run: bool,
}

/// What a wrapper call does to the functions it takes.
#[derive(Debug, Clone, Copy)]
pub struct Wrap {
    pub ctx: u8,
}

/// A catalog entry point (`entries`), as the walker uses it.
#[derive(Debug, Clone)]
pub struct EntrySpec {
    pub sym: String,
    pub shape: Shape,
    pub kind: u8,
    pub names: Option<Vec<String>>,
}

#[derive(Debug, Default)]
pub struct CatalogIndex {
    entries: Vec<EntrySpec>,
    /// Longest prefix first.
    aliases: Vec<(String, String)>,
    syms: HashMap<String, Vec<Entry>>,
    handlers: HashMap<String, Arg>,
    wrappers: HashMap<String, Wrap>,
    /// Active rules as (class id, ctx_any, ctx_none).
    rules: Vec<(u32, u8, u8)>,
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
                    run: s.run.is_some(),
                });
            }
            for h in &c.handlers {
                ix.handlers.insert(h.sym.clone(), h.arg);
            }
            for e in &c.entries {
                ix.entries.push(EntrySpec { sym: e.sym.clone(), shape: e.shape, kind: e.kind as u8, names: e.names.clone() });
            }
            for r in &c.rules {
                if let Some(&class) = class_id.get(r.class.as_str()) {
                    // Bits above 7 never occur in CS.ctx: dropping them from ctx_any (when it is
                    // then 0, "any context") or from ctx_none only lets more sites through.
                    ix.rules.push((class, r.ctx_any as u8, r.ctx_none as u8));
                }
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

    /// The entry kind for member `name` of a class extending `sym` (or of the default export,
    /// with an empty `sym`): an entry that names the member beats one that names none.
    pub fn entry_kind(&self, shape: Shape, sym: &str, name: &str) -> Option<u8> {
        let mut general = None;
        for e in self.entries.iter().filter(|e| e.shape == shape && e.sym == sym) {
            match &e.names {
                Some(n) if n.iter().any(|x| x == name) => return Some(e.kind),
                None => general = general.or(Some(e.kind)),
                _ => {}
            }
        }
        general
    }

    /// The entry kind of the function arguments of calls to `sym` (`callback-args`).
    pub fn callback_entry(&self, sym: &str) -> Option<u8> {
        self.entries.iter().find(|e| e.shape == Shape::CallbackArgs && e.sym == sym).map(|e| e.kind)
    }

    pub fn has_entries(&self) -> bool {
        !self.entries.is_empty()
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

    /// Whether some rule of an active catalog fires on a call of `sym` in context `ctx`
    /// (FACTS.md `RL`: some bit of ctx_any, or ctx_any 0, and no bit of ctx_none).
    pub fn may_fire(&self, sym: &str, ctx: u8) -> bool {
        let ks = self.classes(sym);
        self.rules.iter().any(|&(k, any, none)| ks.contains(&k) && (any == 0 || ctx & any != 0) && ctx & none == 0)
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
        let ex = extract(&alloc, rel, Path::new(rel), src, &ix, 0, None);
        let f = ex.functions;
        let mut out = String::new();
        for s in &f.sites {
            let chain = &f.fns[s.fn_local as usize].chain;
            match &s.kind {
                SiteKind::Call { sym, loop_depth, ctx, .. } => {
                    out += &format!("CS {chain} {} loops={loop_depth} ctx={ctx}\n", f.syms[*sym as usize]);
                }
                SiteKind::Handler { shape } => out += &format!("HD {chain} shape={shape}\n"),
                SiteKind::Edge { .. } => {}
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
        let ex = extract(&alloc, "q.ts", Path::new("q.ts"), src, &all_index(), 0, None);
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

    /// Entry points come from catalog entries only: subclass methods (a named member beats the
    /// general entry, a constructor is never one) and the default export's function properties.
    #[test]
    fn entry_points_follow_the_catalog() {
        let src = "import { DurableObject, WorkerEntrypoint } from \"cloudflare:workers\";\nexport class Room extends DurableObject {\n  constructor(ctx: any, env: any) { super(ctx, env); }\n  async fetch(req: Request) {}\n  async alarm() {}\n  join() {}\n}\nexport class Rpc extends WorkerEntrypoint {\n  async fetch() {}\n  ping() {}\n}\nclass Plain {\n  fetch() {}\n}\nexport default {\n  async fetch(request: Request) {},\n  scheduled() {},\n  helper() {},\n};\n";
        let alloc = Allocator::default();
        let ex = extract(&alloc, "e.ts", Path::new("e.ts"), src, &all_index(), 0, None);
        let f = ex.functions;
        let got: Vec<String> =
            f.entries.iter().map(|(l, k)| format!("{}:{k}", f.fns[*l as usize].chain)).collect();
        assert_eq!(
            got,
            ["Room>fetch:1", "Room>alarm:4", "Room>join:2", "Rpc>fetch:1", "Rpc>ping:3", "default>fetch:1", "default>scheduled:4"]
        );
    }

    /// `AL`: which arguments of a classed call are constants (literal, plain template, a name
    /// bound once to a literal), and none for a computed, interpolated or reassigned one.
    #[test]
    fn constant_arguments_of_classed_calls() {
        let src = "import { SqlClient } from \"@effect/sql\";\nconst fixed = \"a\";\nlet moved = \"b\";\nmoved = \"c\";\nexport const q = (sql: SqlClient.SqlClient, x: string) => {\n  sql.unsafe(\"s\", 5);\n  sql.unsafe(`t`);\n  sql.unsafe(fixed);\n  sql.unsafe(moved);\n  sql.unsafe(`u${x}`);\n  sql.unsafe(x, true);\n};\n";
        let alloc = Allocator::default();
        let f = extract(&alloc, "al.ts", Path::new("al.ts"), src, &all_index(), 0, None).functions;
        let got: Vec<Vec<(u8, u8)>> = f
            .sites
            .iter()
            .filter_map(|s| match &s.kind {
                SiteKind::Call { consts, .. } => Some(consts.to_vec()),
                _ => None,
            })
            .collect();
        assert_eq!(got, [vec![(0, 1), (1, 1)], vec![(0, 2)], vec![(0, 3)], vec![], vec![], vec![(1, 1)]]);
    }
}
