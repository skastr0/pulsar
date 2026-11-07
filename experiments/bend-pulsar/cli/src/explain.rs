//! `pulsar explain <rule>`: what a rule means, its threshold, when it runs, the laws that prove it
//! and an example, from one table. Catalog rules (pack and repo catalogs) are explained from their
//! catalog row, so a new catalog rule never needs an entry here.

use crate::{catalog, version};

/// One built-in rule, as `explain` prints it.
pub struct Entry {
    pub id: &'static str,
    /// What kind of rule it is and where it comes from.
    pub family: &'static str,
    /// When it runs: on by default, opt-in, or what input it needs.
    pub runs: &'static str,
    pub definition: &'static str,
    pub threshold: &'static str,
    /// The engine laws that prove its findings, `file: law, law`.
    pub laws: &'static str,
    pub example: &'static str,
}

const METRIC_LAWS: &str = "engine/Metrics-LAWS.bend: findings_sound (every finding is over its threshold)";

pub const BUILTIN: &[Entry] = &[
    Entry {
        id: "graph.import-cycle",
        family: "core, import graph",
        runs: "on by default, every lane with import facts (TypeScript, Rust modules, Bend)",
        definition: "A set of two or more files (or one file importing itself) that reach each other through value imports: a strongly connected component of the import graph. Type-only imports are not edges.",
        threshold: "none: every cycle is a finding, keyed by its member files",
        laws: "engine/LAWS.bend: pipeline_cycles_are_graph_cycles, fact_type_only_not_edge, fact_value_import_is_edge; the CERT line certifies the cycle list complete",
        example: "a.ts: import { b } from './b'   b.ts: import { a } from './a'   -> one cycle {a.ts, b.ts}",
    },
    Entry {
        id: "core.cyclomatic",
        family: "core, function metric",
        runs: "on by default",
        definition: "McCabe cyclomatic complexity: 1 + the decisions in the function body. A decision is a branch arm, a loop, a catch, a ternary and each short-circuit operator (&&, ||, ??, their assignment forms and optional chaining ?.) and each default value (a parameter default x = 1, a destructuring default { a = 1 }). Nested functions count in their own body.",
        threshold: "flags a value strictly over 10",
        laws: "engine/Metrics-LAWS.bend: findings_sound, findings_complete_cyclomatic",
        example: "function f(a, b) { if (a && b?.c) return 1; for (const x of a) if (x) return 2; return 0 }  -> cyclomatic 6",
    },
    Entry {
        id: "core.nesting",
        family: "core, function metric",
        runs: "on by default",
        definition: "The deepest nesting of control structures (branches, loops, try/catch, switch) in the function body.",
        threshold: "flags a depth strictly over 3",
        laws: "engine/Metrics-LAWS.bend: findings_sound, findings_complete_nesting",
        example: "for (...) { if (...) { while (...) { if (...) { ... } } } }  -> nesting 4",
    },
    Entry {
        id: "core.npath",
        family: "core, function metric",
        runs: "on by default",
        definition: "Nejmeh NPath: the number of acyclic execution paths through the function. Sequential statements multiply, branches add; each short-circuit operator (including ?. and a default value) adds a path. Saturates at 16777215 (2^24 - 1), which reads as 'at least'.",
        threshold: "flags a value strictly over 200",
        laws: "engine/Metrics-LAWS.bend: findings_sound, findings_complete_npath (printed NPath = min(NPath, cap))",
        example: "eight independent `if (x) y()` statements in a row -> NPath 2^8 = 256",
    },
    Entry {
        id: "core.length",
        family: "core, function metric",
        runs: "on by default",
        definition: "Lines of the function body, in two tiers. A body is linear when its cyclomatic is at most 2 and its nesting at most 1 (a table, a builder, a straight sequence), and structured otherwise. The finding says shape=linear or shape=structured.",
        threshold: "structured: strictly over 60 lines; linear: strictly over 300 lines",
        laws: "engine/Metrics-LAWS.bend: findings_sound (with the shape), findings_complete_length, findings_complete_length_linear",
        example: "a 90-line function with three ifs -> core.length 90 > 60 shape=structured; a 200-line literal table -> no finding",
    },
    Entry {
        id: "core.cognitive",
        family: "core, function metric",
        runs: "off unless .pulsar/policy.toml lists it in [rules] enable (the evidence for it is weak)",
        definition: "Cognitive complexity after the SonarSource white paper: +1 plus the nesting level for each branch (if, ternary), multi-branch, loop and catch; +1 and no level for an else-if and for a plain else; +1 per run of the same && or || operator within one expression. else { if } and a ternary in the alternate nest like any branch. ??, ?., defaults and assignment operators add nothing; recursion and labelled jumps are not counted. Where the facts cannot tell, the count leans low.",
        threshold: "flags a value strictly over 15",
        laws: "engine/Cognitive-LAWS.bend: cog_findings_sound, cog_findings_complete, cog_else_plain, cog_else_costs_one, cog_else_if_flat, cog_else_block_if_nests, cog_ternary_else_nests, cog_elif_else, cog_and_each, cog_unscored_op_free",
        example: "if (a) { for (...) { if (b && c) {...} } }  -> 1 + (1+1) + (1+2) + 1 = 7",
    },
    Entry {
        id: "core.crap",
        family: "core, function metric with coverage",
        runs: "only with a coverage report: pulsar delta --coverage <coverage-final.json | lcov.info | dir> (Vitest/Istanbul JSON, lcov, cargo llvm-cov lcov)",
        definition: "CRAP = c^2 x (uncovered share)^3 + c, with c the cyclomatic complexity and the share taken over the function's coverable lines, in exact integers. cause=complexity-only when the coverage term is at most c (more tests would not help much: split the function), cause=coverage otherwise. A function the report does not cover has no data and no finding.",
        threshold: "flags a value strictly over 30",
        laws: "engine/Crap-LAWS.bend: crap_findings_sound, crap_findings_complete (plus floor division, monotone in coverage, and the cause split)",
        example: "cyclomatic 8 at 0% coverage -> CRAP 72 cause=coverage; cyclomatic 31 at 100% -> CRAP 31 cause=complexity-only",
    },
    Entry {
        id: "core.untested-data-access",
        family: "core, coverage composite",
        runs: "only with a coverage report, and unless [rules] disable lists it; it needs the repo's queries to be seen (a .sql file or a query call a pack classifies)",
        definition: "A non-test function that runs a query and either has a core.crap finding (reason 1) or has no coverage data (reason 2: the report has no coverable line in its range). 0% coverage is data, so it is reason 1 or nothing, never reason 2.",
        threshold: "none: every such function is a finding; the CRAP threshold is core.crap's (30)",
        laws: "engine/Untested-LAWS.bend: the lines are exactly the non-test query functions with a CRAP finding or no coverage data (sound and complete)",
        example: "a function with db.prepare(...) and no line in the lcov report -> core.untested-data-access (no coverage data)",
    },
    Entry {
        id: "core.hotspot",
        family: "core, history composite",
        runs: "on by default where git history is available (window: [history] in policy.toml, default 365 days, 2000 commits)",
        definition: "A function with a core.cyclomatic, core.nesting or core.npath finding that also changed often: its churn (commits by non-bot authors that touched it, in the window) is over the threshold. core.length is not a base.",
        threshold: "churn strictly over 2 (at least 3 commits), plus the base finding's own threshold",
        laws: "engine/Hotspot-LAWS.bend: hs_sound, hs_complete, hotspot_bases",
        example: "a function at cyclomatic 14 touched by 5 commits this year -> core.hotspot churn=5",
    },
    Entry {
        id: "core.risky-change",
        family: "core, history and coverage composite",
        runs: "needs both git history and a coverage report",
        definition: "A function with a core.crap finding whose churn is over the threshold: complex, under-tested and changing.",
        threshold: "churn strictly over 2, plus CRAP over 30",
        laws: "engine/Hotspot-LAWS.bend: hs_sound, hs_complete, risky_bases",
        example: "CRAP 72 and 4 commits -> core.risky-change churn=4",
    },
    Entry {
        id: "effect.layer-cycle",
        family: "Effect pack, layer graph (on when the repo depends on effect)",
        runs: "on with the Effect pack",
        definition: "Layers that require each other in a cycle: layer u requires a service that layer w builds, and w (transitively) requires a service u builds.",
        threshold: "none: every requirement cycle is a finding",
        laws: "engine/Layers-LAWS.bend: req_edge_sound, run_is_detectors; cycles via the Graph laws (LCERT certifies completeness)",
        example: "UsersLive = Layer.effect(Users, ...yield* Mailer) and MailerLive = Layer.effect(Mailer, ...yield* Users)",
    },
    Entry {
        id: "effect.unprovided-service",
        family: "Effect pack, layer graph",
        runs: "on with the Effect pack",
        definition: "At a root (a program run with a layer), a layer reachable from the root's layer requires a service that no reachable layer builds and that has no default. Not reported below an opaque layer (one the CLI could not resolve).",
        threshold: "none",
        laws: "engine/Layers-LAWS.bend: unprovided_requires, unprovided_rooted, unprovided_no_builder, unprovided_no_opaque, unprovided_no_default",
        example: "Effect.runPromise(program.pipe(Effect.provide(UsersLive))) where UsersLive needs Mailer and nothing builds it",
    },
    Entry {
        id: "effect.duplicate-builder",
        family: "Effect pack, layer graph",
        runs: "on with the Effect pack",
        definition: "Two different layers both build the same service and are both reachable from one composition, so which one wins depends on ordering.",
        threshold: "none",
        laws: "engine/Layers-LAWS.bend: dup_builders, dup_one_composition",
        example: "Layer.mergeAll(UsersLive, UsersTest) both providing Users",
    },
    Entry {
        id: "effect.hub-service",
        family: "Effect pack, layer graph",
        runs: "on with the Effect pack",
        definition: "A service with high fan-in: the layers that require it plus the functions that use it (outside layer constructors).",
        threshold: "fan-in at or over 10",
        laws: "engine/Layers-LAWS.bend: hub_counts",
        example: "a Db service required by 7 layers and used by 5 functions -> fan-in 12",
    },
    Entry {
        id: "sql.dynamic-text",
        family: "SQL lane (SQLite and Postgres)",
        runs: "opt-in: list it in [rules] enable",
        definition: "A query whose SQL text is built at run time (concatenation or interpolation into the text) instead of being a constant with parameters.",
        threshold: "none: each such query site",
        laws: "engine/Sql-LAWS.bend: sql_sites_sound, sql_dynamic_complete",
        example: "db.prepare(`SELECT * FROM users WHERE name = '${name}'`)",
    },
    Entry {
        id: "sql.offset-param",
        family: "SQL lane",
        runs: "opt-in: list it in [rules] enable",
        definition: "A query paginating with a parameterised OFFSET, which reads and discards every skipped row (keyset pagination avoids it).",
        threshold: "none: each such query site",
        laws: "engine/Sql-LAWS.bend: sql_sites_sound, sql_offset_complete",
        example: "SELECT * FROM events ORDER BY id LIMIT ? OFFSET ?",
    },
    Entry {
        id: "sql.index-defeat",
        family: "SQL lane",
        runs: "opt-in: list it in [rules] enable",
        definition: "A predicate that cannot use an index the column has: a LIKE/GLOB with a leading wildcard, the column wrapped in a function or arithmetic, or an OR across different columns.",
        threshold: "none",
        laws: "engine/Sql-LAWS.bend: sql_defeat_sound, sql_defeat_complete",
        example: "WHERE lower(email) = ?   (email is indexed)",
    },
    Entry {
        id: "sql.unindexed-filter",
        family: "SQL lane",
        runs: "opt-in: list it in [rules] enable",
        definition: "An equality, range, IN or join filter on a column of a known base table where no index leads with that column (and it is not the rowid alias).",
        threshold: "none",
        laws: "engine/Sql-LAWS.bend: sql_unindexed_sound, sql_unindexed_complete, sql_unindexed_means",
        example: "SELECT * FROM orders WHERE customer_id = ?   with no index on orders(customer_id, ...)",
    },
    Entry {
        id: "sql.fk-unindexed",
        family: "SQL lane",
        runs: "opt-in: list it in [rules] enable",
        definition: "A foreign key whose first column leads no index of the child table, so deletes and joins from the parent scan the child.",
        threshold: "none",
        laws: "engine/Sql-LAWS.bend: sql_fk_sound, sql_fk_complete",
        example: "CREATE TABLE orders (customer_id INTEGER REFERENCES customers(id))  with no index on customer_id",
    },
    Entry {
        id: "sql.schema-drift",
        family: "SQL lane",
        runs: "opt-in: list it in [rules] enable; fires only when the whole schema parsed",
        definition: "A query names a table or column that the repo's schema (its .sql files and migrations) does not define.",
        threshold: "none",
        laws: "engine/Sql-LAWS.bend: sql_drift_t_sound, sql_drift_t_complete, sql_drift_c_sound, sql_drift_c_complete",
        example: "SELECT nickname FROM users   where users has no nickname column",
    },
    Entry {
        id: "cloudflare.binding-drift",
        family: "Cloudflare pack, infra facts",
        runs: "opt-in: list it in [rules] enable; [rules] disable turns it off",
        definition: "A binding a deployable declares (wrangler or alchemy config) that no file its entry reaches reads through env.",
        threshold: "unread bindings per deployable, over 0",
        laws: "engine/Binding-LAWS.bend: read_sound, read_complete, unread_sound, unread_complete, rule_off",
        example: "wrangler.toml declares KV SESSIONS; the worker only reads env.DB -> cloudflare.binding-drift on SESSIONS",
    },
];

/// The ctx bit names of FACTS.md (`CS.ctx`), for catalog rule conditions.
const CTX_BITS: [(u32, &str); 8] = [
    (1, "inside an async function"),
    (2, "inside Effect code"),
    (4, "inside a test"),
    (8, "in the [packs.effect] effect_only scope"),
    (16, "in the [packs.effect] boundary scope"),
    (32, "inside an interop callback"),
    (64, "matched by method name only"),
    (128, "directly in a pack wrapper's function body (not in a function nested in it)"),
];

fn bits(mask: u32) -> String {
    let names: Vec<&str> = CTX_BITS.iter().filter(|(b, _)| mask & b != 0).map(|(_, n)| *n).collect();
    names.join(", or ")
}

fn render_builtin(e: &Entry, version: u32) -> String {
    format!(
        "{} v{version}\n  family:     {}\n  runs:       {}\n  definition: {}\n  threshold:  {}\n  laws:       {}\n  example:    {}\n",
        e.id, e.family, e.runs, e.definition, e.threshold, e.laws, e.example
    )
}

fn render_catalog(cat: &catalog::Catalog, r: &catalog::Rule) -> String {
    let when = if r.ctx_any == 0 { String::new() } else { format!(", when the site is {}", bits(r.ctx_any)) };
    let unless = if r.ctx_none == 0 { String::new() } else { format!(", and not when it is {}", bits(r.ctx_none)) };
    let examples: Vec<&str> = cat.symbols.iter().filter(|s| s.class == r.class).take(3).map(|s| s.sym.as_str()).collect();
    let activate = cat.activate.as_ref().map(|a| a.join(", ")).unwrap_or_else(|| "always (lane catalog)".into());
    format!(
        "{} v{}\n  family:     catalog {} (scope {:?}, on by evidence: {})\n  runs:       on with its catalog; [rules] disable turns it off\n  definition: Code that {}.\n  threshold:  none: a finding per call site that calls a symbol of class {:?}{when}{unless}\n  laws:       engine/Rules-LAWS.bend: join_sound, join_complete; engine/ClassCtx-LAWS.bend: classctx_sound, classctx_complete\n  example:    a call to {}\n  source:     {} ({})\n",
        r.id,
        r.ver,
        cat.id,
        cat.scope,
        activate,
        r.says,
        r.class,
        if examples.is_empty() { "a symbol of that class".to_string() } else { examples.join(" or ") },
        r.at,
        r.doc
    )
}

/// Every bit of `all` and none of `none`, in words.
fn all_none(all: u32, none: u32) -> String {
    let names = |m: u32| CTX_BITS.iter().filter(|(b, _)| m & b != 0).map(|(_, n)| *n).collect::<Vec<_>>().join(" and ");
    let text = match (all, none) {
        (0, 0) => "anywhere".into(),
        (a, 0) => names(a),
        (0, n) => format!("never {}", bits(n)),
        (a, n) => format!("{}; never {}", names(a), bits(n)),
    };
    format!("[{text}]")
}

/// A fan-out, constant-argument, hot-path, call-edge or module rule of a catalog: what it is and
/// every threshold in it.
fn render_composite(cat: &catalog::Catalog, id: &str) -> Option<String> {
    let (ver, says, at, doc, kind, threshold, laws, example) = if let Some(r) = cat.fanouts.iter().find(|r| r.id == id) {
        let none = if r.none == 0 { String::new() } else { format!(", never when the site is {}", bits(r.none)) };
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "fan-out",
            format!("edges = {} (a call at loop depth > 0 reaches a call of class {:?} within {} call edge{}){none}", r.edges, r.class, r.edges, if r.edges == 1 { "" } else { "s" }),
            "engine/Fanout-LAWS.bend",
            format!("a call of a class {:?} symbol inside a loop, or a loop call of a function that reaches one", r.class),
        )
    } else if let Some(r) = cat.konsts.iter().find(|r| r.id == id) {
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "constant-argument",
            format!("pos = {} (argument {} of a call of class {:?} is a constant)", r.pos, r.pos, r.class),
            "engine/Konst-LAWS.bend",
            format!("a call of a class {:?} symbol whose argument {} is a literal", r.class, r.pos),
        )
    } else if let Some(r) = cat.growths.iter().find(|r| r.id == id) {
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "unbounded-growth",
            format!("depth = {} (an entry point reaches the inserting function within {} call edge{}); the read is a SELECT with no LIMIT and no key of the table bound by equality or IN", r.depth, r.depth, if r.depth == 1 { "" } else { "s" }),
            "engine/Grow-LAWS.bend: the findings are exactly the (read, insert) triples, and the insert is reached from an entry point",
            "SELECT * FROM events with no LIMIT, in code that also runs INSERT INTO events from a request handler".to_string(),
        )
    } else if let Some(r) = cat.edges.iter().find(|r| r.id == id) {
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "call-edge",
            format!("a call from a site {} to a repo function {}", all_none(r.all, r.none), all_none(r.target_all, r.target_none)),
            "engine/FnCtx-LAWS.bend: nc_erule_sound, nc_erule_complete",
            "such a call, reported once per (caller, callee) with its site count".to_string(),
        )
    } else if let Some(r) = cat.modules.iter().find(|r| r.id == id) {
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "module",
            format!("a file holding a function {} and a function {}", all_none(r.all, r.none), all_none(r.also_all, r.also_none)),
            "engine/FnCtx-LAWS.bend: nc_mrule_sound, nc_mrule_complete",
            "one file holding both kinds of function".to_string(),
        )
    } else if let Some(r) = cat.hots.iter().find(|r| r.id == id) {
        (
            r.ver.as_str(), r.says.as_str(), r.at.as_str(), r.doc.as_str(), "hot-path",
            format!("depth = {} (an entry point reaches the function within {} call edge{}); base rule {} ({:?} lane)", r.depth, r.depth, if r.depth == 1 { "" } else { "s" }, r.base, r.lane),
            "engine/Hot-LAWS.bend: ho_reach_sound, ho_reach_complete, ho_findings_sound, ho_findings_complete",
            format!("a {} finding in a function reachable from a request, alarm or queue entry point", r.base),
        )
    } else {
        return None;
    };
    let runs = if kind == "unbounded-growth" {
        "on with its catalog; it reports nothing, and says so, while the schema is partial; [rules] disable turns it off"
    } else if kind == "hot-path" {
        "on with its catalog while its base rule is on (an sql.* base needs [rules] enable); [rules] disable turns it off"
    } else {
        "on with its catalog; [rules] disable turns it off"
    };
    Some(format!(
        "{id} v{ver}\n  family:     catalog {} {kind} rule (scope {:?}, on by evidence: {})\n  runs:       {runs}\n  definition: Code that {says}.\n  threshold:  {threshold}\n  laws:       {laws}\n  example:    {example}\n  source:     {at} ({doc})\n",
        cat.id,
        cat.scope,
        cat.activate.as_ref().map(|a| a.join(", ")).unwrap_or_else(|| "always (lane catalog)".into()),
    ))
}

/// The explanation of `id`, from the built-in table or the shipped catalogs.
pub fn explain(id: &str) -> Result<String, String> {
    let versions = version::rules();
    let ver = versions.iter().find(|(r, _)| r == id).map(|(_, v)| *v);
    if let Some(e) = BUILTIN.iter().find(|e| e.id == id) {
        return Ok(render_builtin(e, ver.unwrap_or(1)));
    }
    for (name, text) in catalog::EMBEDDED {
        let l = catalog::load(name, text)?;
        if let Some(r) = l.catalog.rules.iter().find(|r| r.id == id) {
            return Ok(render_catalog(&l.catalog, r));
        }
        if let Some(text) = render_composite(&l.catalog, id) {
            return Ok(text);
        }
    }
    Err(format!("no rule {id:?}; `pulsar explain` lists every rule"))
}

/// The family of a catalog rule: its kind, from the shipped catalogs.
fn catalog_family(id: &str) -> String {
    for (name, text) in catalog::EMBEDDED {
        let Ok(l) = catalog::load(name, text) else { continue };
        let c = &l.catalog;
        let kind = if c.fanouts.iter().any(|r| r.id == id) {
            "fan-out"
        } else if c.konsts.iter().any(|r| r.id == id) {
            "constant-argument"
        } else if c.hots.iter().any(|r| r.id == id) {
            "hot-path"
        } else if c.growths.iter().any(|r| r.id == id) {
            "unbounded-growth"
        } else if c.edges.iter().any(|r| r.id == id) {
            "call-edge"
        } else if c.modules.iter().any(|r| r.id == id) {
            "module"
        } else {
            continue;
        };
        return format!("catalog {kind} rule");
    }
    "catalog rule".into()
}

/// Every rule id with its version and one-line family, for `pulsar explain` with no argument.
pub fn list() -> String {
    let mut out = String::new();
    for (id, v) in version::rules() {
        let family = BUILTIN.iter().find(|e| e.id == id).map(|e| e.family.to_string()).unwrap_or_else(|| catalog_family(&id));
        out.push_str(&format!("{id} v{v}\t{family}\n"));
    }
    out
}

pub fn run(args: &[String]) -> Result<(), String> {
    match args {
        [] => print!("{}", list()),
        [id] => print!("{}", explain(id)?),
        _ => return Err("usage: pulsar explain [<rule-id>]".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The README's rule table is the one place a reader sees every rule; a rule the CLI can report
    /// but the table omits fails here.
    #[test]
    fn every_rule_the_cli_reports_is_in_the_readme_rule_table() {
        let readme = include_str!("../../../../README.md");
        for (id, _) in version::rules() {
            assert!(readme.contains(&format!("`{id}`")), "README.md has no rule table row for {id}");
        }
    }

    #[test]
    fn every_rule_the_cli_reports_has_an_explanation() {
        for (id, _) in version::rules() {
            let text = explain(&id).unwrap_or_else(|e| panic!("{id}: {e}"));
            for field in ["definition:", "threshold:", "laws:", "example:"] {
                assert!(text.contains(field), "{id} lacks {field}:\n{text}");
            }
        }
    }

    #[test]
    fn builtin_entries_are_rules_the_cli_knows() {
        let ids: Vec<String> = version::rules().into_iter().map(|(id, _)| id).collect();
        for e in BUILTIN {
            assert!(ids.iter().any(|i| i == e.id), "{} is explained but not a rule", e.id);
            assert!(e.laws.starts_with("engine/") && e.laws.contains("-LAWS.bend") || e.laws.starts_with("engine/LAWS.bend"), "{}", e.id);
        }
    }

    #[test]
    fn explains_version_threshold_and_catalog_rules() {
        let len = explain("core.length").unwrap();
        assert!(len.starts_with("core.length v2\n") && len.contains("over 300"), "{len}");
        let amb = explain("effect.ambient-read-in-effect").unwrap();
        assert!(amb.contains("catalog effect") && amb.contains("inside Effect code") && amb.contains("join_sound"), "{amb}");
        assert!(explain("core.nope").is_err());
        assert!(METRIC_LAWS.contains("findings_sound"));
    }
}
