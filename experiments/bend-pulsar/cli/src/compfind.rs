//! Fan-out, constant-argument and hot-path findings: the engine's `pulsar-fanout 0`,
//! `pulsar-konst 0` and `pulsar-hot 0` sections (FACTS.md "Fan-out rules", "Constant-argument
//! rules", "Hot-path composites") as findings.
//!
//! Site and function ids are per run, so a finding is keyed by what they stand for: the rule, the
//! function's `FK` key and the callee symbol (or the reached function, or the query's table and
//! column), never a site id or a line. Several sites of one rule on the same function and callee are
//! one finding with a count, as in the class-in-context findings.

use crate::engine::{Findings, Kx, Nx, SqlKind};
use crate::facts::SideTables;
use crate::finding::{catalog_rule, Finding, Subject};
use crate::lang::functions::fnv_parts;
use crate::policy::Composites;
use crate::sql::NONE;
use serde_json::json;
use std::collections::BTreeMap;

/// The findings, and how many engine lines named a rule, function, symbol or base finding the CLI
/// could not resolve (reported as degraded input, never dropped silently).
pub fn findings(found: &Findings, tables: &SideTables, files: &[String], keys: &[u64], comp: &Composites) -> (Vec<Finding>, usize) {
    let cx = Cx { tables, files, keys };
    let (mut out, mut dropped) = (Vec::new(), 0);
    let mut push = |r: Option<Finding>| match r {
        Some(f) => out.push(f),
        None => dropped += 1,
    };
    // One finding per (rule, function, what it reached), with the number of sites.
    let mut fan: BTreeMap<(u32, u32, u32, u32), usize> = BTreeMap::new();
    for x in &found.nx {
        *fan.entry((x.rule, x.fn_id, x.via, x.kind)).or_default() += 1;
    }
    for ((rule, fn_id, via, kind), sites) in fan {
        push(fanout(&cx, comp, rule, fn_id, via, kind, sites));
    }
    let mut konst: BTreeMap<(u32, u32, u32, u32), usize> = BTreeMap::new();
    for x in &found.kx {
        *konst.entry((x.rule, x.fn_id, x.callee, x.pos)).or_default() += 1;
    }
    for ((rule, fn_id, callee, pos), sites) in konst {
        push(constant(&cx, comp, rule, fn_id, callee, pos, sites));
    }
    let mut hot: BTreeMap<(u32, u32, Detail), usize> = BTreeMap::new();
    let mut unjoined = 0;
    for x in &found.hx {
        match detail(&cx, found, comp, x.lane, x.base, x.site) {
            Some(d) => *hot.entry((x.rule, x.fn_id, d)).or_default() += 1,
            None => unjoined += 1,
        }
    }
    for ((rule, fn_id, d), sites) in hot {
        push(hot_path(&cx, comp, rule, fn_id, d, sites));
    }
    (out, dropped + unjoined)
}

struct Cx<'a> {
    tables: &'a SideTables,
    files: &'a [String],
    keys: &'a [u64],
}

/// A function as a finding subject, with where to point.
struct Place {
    subject: Subject,
    path: String,
    chain: String,
    line: u32,
}

impl Cx<'_> {
    fn place(&self, fn_id: u32) -> Option<Place> {
        let entry = self.tables.fns.get(fn_id as usize)?;
        let (key, path) = (*self.keys.get(fn_id as usize)?, self.files.get(entry.file as usize)?.clone());
        Some(Place { subject: Subject::Function { key, path: path.clone(), chain: entry.chain.clone() }, path, chain: entry.chain.clone(), line: entry.start_line })
    }
    fn symbol(&self, id: u32) -> Option<Subject> {
        let name = self.tables.syms.get(id as usize)?;
        Some(Subject::Symbol { key: fnv_parts(&[name.as_bytes()]), name: name.clone() })
    }
}

fn name_of(s: &Subject) -> String {
    match s {
        Subject::Symbol { name, .. } => name.clone(),
        Subject::Function { chain, .. } => chain.clone(),
        Subject::File { path, .. } => path.clone(),
    }
}

fn fanout(cx: &Cx, comp: &Composites, rule: u32, fn_id: u32, via: u32, kind: u32, sites: usize) -> Option<Finding> {
    let r = comp.fanouts.get(rule as usize)?;
    let at = cx.place(fn_id)?;
    // kind 0 calls a symbol of the class; kind 1 calls a repo function that reaches one.
    let (reached, what) = match kind {
        0 => (cx.symbol(via)?, "loop call of"),
        _ => (cx.place(via)?.subject, "loop call of the function"),
    };
    let tail = if kind == 0 { String::new() } else { ", which reaches a call of the rule's class".to_string() };
    let text = format!("{}: {what} {}{tail} (x{sites})", r.says, name_of(&reached));
    let evidence = json!({ "via": name_of(&reached), "kind": kind, "sites": sites, "edges": r.edges, "says": r.says });
    let f = Finding::new(catalog_rule(&r.id, r.version), vec![at.subject, reached], at.path, Some(at.chain), text, evidence);
    Some(f.at_line(at.line))
}

fn constant(cx: &Cx, comp: &Composites, rule: u32, fn_id: u32, callee: u32, pos: u32, sites: usize) -> Option<Finding> {
    let r = comp.konsts.get(rule as usize)?;
    let at = cx.place(fn_id)?;
    let sym = cx.symbol(callee)?;
    let text = format!("{}: {} with a constant argument {pos} (x{sites})", r.says, name_of(&sym));
    let evidence = json!({ "callee": name_of(&sym), "pos": pos, "sites": sites, "says": r.says });
    let f = Finding::new(catalog_rule(&r.id, r.version), vec![at.subject, sym], at.path, Some(at.chain), text, evidence);
    Some(f.at_line(at.line))
}

/// What a hot base finding is about, comparable so equal findings group: the base rule, and the
/// symbol, function or query place it names.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Detail {
    /// An SQL finding: `table.column`, or empty.
    Query(String),
    /// A symbol of a class, or the function a loop call reached.
    Symbol(u32),
    Reached(u32),
}

/// Join a hot finding's base site back to the base finding's own line (`SQX`, `NX` or `KX`).
fn detail(cx: &Cx, found: &Findings, comp: &Composites, lane: u32, base: u32, site: u32) -> Option<Detail> {
    match lane {
        1 => {
            let s = found.sql.as_ref()?;
            let base_id = crate::finding::SQL_RULES.get(base.checked_sub(1)? as usize)?.id;
            let x = s.xs.iter().find(|x| x.kind == SqlKind::Site && x.id == site && x.rule == base_id)?;
            let name = |id: u32| (id != NONE).then(|| cx.tables.sql_names.get(id as usize).cloned()).flatten();
            let place: Vec<String> = [name(x.table), name(x.col)].into_iter().flatten().collect();
            Some(Detail::Query(place.join(".")))
        }
        2 => {
            comp.fanouts.get(base as usize)?;
            let Nx { via, kind, .. } = found.nx.iter().find(|x| x.rule == base && x.site == site)?;
            Some(if *kind == 0 { Detail::Symbol(*via) } else { Detail::Reached(*via) })
        }
        3 => {
            comp.konsts.get(base as usize)?;
            let Kx { callee, .. } = found.kx.iter().find(|x| x.rule == base && x.site == site)?;
            Some(Detail::Symbol(*callee))
        }
        _ => None,
    }
}

fn hot_path(cx: &Cx, comp: &Composites, rule: u32, fn_id: u32, d: Detail, sites: usize) -> Option<Finding> {
    let r = comp.hots.get(rule as usize)?;
    let at = cx.place(fn_id)?;
    let (about, subject) = match d {
        Detail::Query(place) => {
            let s = (!place.is_empty()).then(|| Subject::Symbol { key: fnv_parts(&[b"sql", place.as_bytes()]), name: place.clone() });
            (if place.is_empty() { "a query".to_string() } else { place }, s)
        }
        Detail::Symbol(id) => {
            let s = cx.symbol(id)?;
            (name_of(&s), Some(s))
        }
        Detail::Reached(id) => {
            let s = cx.place(id)?.subject;
            (name_of(&s), Some(s))
        }
    };
    let text = format!("{}: {} on {about} (x{sites})", r.says, r.base_id);
    let evidence = json!({ "base": r.base_id, "lane": r.lane, "about": about, "sites": sites, "depth": r.depth, "says": r.says });
    let mut subjects = vec![at.subject];
    subjects.extend(subject);
    let f = Finding::new(catalog_rule(&r.id, r.version), subjects, at.path, Some(at.chain), text, evidence);
    Some(f.at_line(at.line))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Hx, Sql, Sqx};
    use crate::facts::FnEntry;
    use crate::policy::{ActiveFanout, ActiveHot, ActiveKonst};

    fn tables() -> SideTables {
        let f = |file, chain: &str| FnEntry { file, start_line: 3, end_line: 9, parent: None, kind: 0, chain: chain.into() };
        SideTables {
            fns: vec![f(0, "handler"), f(0, "load"), f(1, "other")],
            syms: vec!["db#query".into()],
            sql_names: vec!["users".into(), "name".into()],
            ..SideTables::default()
        }
    }
    fn comp() -> Composites {
        Composites {
            fanouts: vec![ActiveFanout { id: "t.n-plus-one".into(), version: 1, class_id: 1, edges: 2, none: 4, says: "queries in a loop".into() }],
            konsts: vec![ActiveKonst { id: "t.const-key".into(), version: 1, class_id: 1, pos: 0, says: "constant key".into() }],
            hots: vec![
                ActiveHot { id: "t.hot-fanout".into(), version: 1, lane: 2, base: 0, base_id: "t.n-plus-one".into(), depth: 3, says: "fan-out on a hot path".into() },
                ActiveHot { id: "t.hot-unindexed".into(), version: 1, lane: 1, base: 4, base_id: "sql.unindexed-filter".into(), depth: 3, says: "unindexed query on a hot path".into() },
            ],
            inert: vec![],
        }
    }
    fn found() -> Findings {
        Findings {
            nx: vec![Nx { rule: 0, site: 7, fn_id: 0, via: 0, kind: 0 }, Nx { rule: 0, site: 8, fn_id: 0, via: 0, kind: 0 }, Nx { rule: 0, site: 9, fn_id: 1, via: 2, kind: 1 }],
            kx: vec![Kx { rule: 0, site: 7, fn_id: 0, callee: 0, pos: 0 }],
            hx: vec![Hx { rule: 0, lane: 2, base: 0, site: 7, fn_id: 0 }, Hx { rule: 1, lane: 1, base: 4, site: 20, fn_id: 1 }],
            sql: Some(Sql { ok: 1, skipped: 0, complete: true, xs: vec![Sqx { rule: "sql.unindexed-filter".into(), kind: SqlKind::Site, id: 20, table: 0, col: 1, detail: 0 }] }),
            ..Findings::default()
        }
    }
    fn run(f: &Findings) -> (Vec<Finding>, usize) {
        findings(f, &tables(), &["a.ts".to_string(), "b.ts".to_string()], &[11, 12, 13], &comp())
    }

    #[test]
    fn sites_of_one_rule_function_and_callee_are_one_finding_with_a_count() {
        let (out, dropped) = run(&found());
        assert_eq!(dropped, 0);
        let texts: Vec<String> = out.iter().map(|f| format!("{} {}", f.rule.id, f.evidence_text)).collect();
        assert!(texts.contains(&"t.n-plus-one queries in a loop: loop call of db#query (x2)".to_string()), "{texts:?}");
        assert!(texts.contains(&"t.n-plus-one queries in a loop: loop call of the function other, which reaches a call of the rule's class (x1)".to_string()), "{texts:?}");
        assert!(texts.contains(&"t.const-key constant key: db#query with a constant argument 0 (x1)".to_string()), "{texts:?}");
        assert!(texts.contains(&"t.hot-fanout fan-out on a hot path: t.n-plus-one on db#query (x1)".to_string()), "{texts:?}");
        assert!(texts.contains(&"t.hot-unindexed unindexed query on a hot path: sql.unindexed-filter on users.name (x1)".to_string()), "{texts:?}");
        assert_eq!(out.len(), 5);
    }

    #[test]
    fn keys_do_not_depend_on_site_or_function_ids() {
        let a = run(&found()).0;
        let mut g = found();
        for x in &mut g.nx {
            x.site += 100;
        }
        for x in &mut g.hx {
            x.site += 100;
        }
        for x in &mut g.kx {
            x.site += 100;
        }
        // The join runs on sites, so move the SQL site and the NX/KX sites together.
        g.hx[0].site = g.nx[0].site;
        g.hx[1].site = 120;
        g.sql.as_mut().unwrap().xs[0].id = 120;
        let b = run(&g).0;
        let keys = |v: &[Finding]| {
            let mut k: Vec<u64> = v.iter().map(|f| f.key()).collect();
            k.sort_unstable();
            k
        };
        assert_eq!(keys(&a), keys(&b));
    }

    #[test]
    fn a_line_the_cli_cannot_resolve_is_counted_not_dropped_silently() {
        let mut f = found();
        f.nx.push(Nx { rule: 9, site: 1, fn_id: 0, via: 0, kind: 0 });
        f.hx.push(Hx { rule: 0, lane: 2, base: 0, site: 999, fn_id: 0 });
        f.kx.push(Kx { rule: 0, site: 1, fn_id: 77, callee: 0, pos: 0 });
        let (out, dropped) = run(&f);
        assert_eq!(out.len(), 5);
        assert_eq!(dropped, 3);
    }
}
