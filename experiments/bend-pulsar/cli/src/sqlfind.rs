//! SQL findings: the engine's `pulsar-sql 0` section (FACTS.md "SQL rules") as findings.
//!
//! Site and foreign-key ids are per run, so a finding is keyed by what they stand for: the file of
//! the site (or of the table's definition) and the table and column names, never an id or a line.
//! Several sites of one rule on the same file, table and column are one finding with a count.

use crate::engine::{Sql, SqlKind};
use crate::facts::{stable_key, SideTables};
use crate::finding::{Finding, Rule, Subject, SQL_RULES};
use crate::lang::functions::fnv_parts;
use crate::lang::Degraded;
use crate::sql::NONE;
use serde_json::json;
use std::collections::BTreeMap;

fn rule(name: &str) -> Result<Rule, String> {
    SQL_RULES.iter().find(|r| r.id == name).copied().ok_or_else(|| format!("engine reported SQL rule {name:?}, which this CLI does not know"))
}

fn name_of(t: &SideTables, id: u32) -> Result<Option<&str>, String> {
    if id == NONE {
        return Ok(None);
    }
    t.sql_names.get(id as usize).map(|s| Some(s.as_str())).ok_or_else(|| format!("engine names SQL name {id}, but .sqlnames has {}", t.sql_names.len()))
}

/// `defs[table name id] = file id` of the table's definition (`DT` rows), for foreign-key findings.
pub fn findings(
    s: &Sql,
    t: &SideTables,
    files: &[String],
    defs: &BTreeMap<u32, u32>,
    disabled: &[String],
) -> Result<(Vec<Finding>, Vec<Degraded>), String> {
    // (rule, file, table, col) -> (first line, sites, detail, ref table)
    let mut groups: BTreeMap<(String, String, Option<String>, Option<String>), (u32, usize, u32, Option<String>)> = BTreeMap::new();
    for x in &s.xs {
        let r = rule(&x.rule)?;
        if disabled.iter().any(|d| d == r.id) {
            continue;
        }
        let (table, col) = (name_of(t, x.table)?.map(String::from), name_of(t, x.col)?.map(String::from));
        let (path, line, ref_table) = match x.kind {
            SqlKind::Site => {
                let (file, line) = *t.sql_sites.get(x.id as usize).ok_or_else(|| format!("engine names SQL site {}, but .sites has {}", x.id, t.sql_sites.len()))?;
                (files.get(file as usize).cloned().ok_or("a SQL site names a file that does not exist")?, line, None)
            }
            SqlKind::Fk => {
                let file = defs.get(&x.table).copied();
                let path = file.and_then(|f| files.get(f as usize).cloned()).unwrap_or_default();
                (path, 0, name_of(t, x.detail)?.map(String::from))
            }
        };
        let e = groups.entry((x.rule.clone(), path, table, col)).or_insert((line, 0, x.detail, ref_table));
        if line > 0 && (e.0 == 0 || line < e.0) {
            e.0 = line;
        }
        e.1 += 1;
    }
    let mut out = Vec::new();
    for ((rule_name, path, table, col), (line, sites, detail, ref_table)) in groups {
        let r = rule(&rule_name)?;
        let place = [table.as_deref(), col.as_deref()].iter().flatten().copied().collect::<Vec<_>>().join(".");
        let mut subjects = vec![Subject::File { key: stable_key(&path), path: path.clone() }];
        if !place.is_empty() {
            subjects.push(Subject::Symbol { key: fnv_parts(&[b"sql", place.as_bytes()]), name: place.clone() });
        }
        if let Some(rt) = &ref_table {
            subjects.push(Subject::Symbol { key: fnv_parts(&[b"sql", b"ref", rt.as_bytes()]), name: format!("-> {rt}") });
        }
        let text = format!(
            "{}{}{} ({} site{}{})",
            r.id.trim_start_matches("sql."),
            if place.is_empty() { String::new() } else { format!(" on {place}") },
            ref_table.as_ref().map(|rt| format!(" referencing {rt}")).unwrap_or_default(),
            sites,
            if sites == 1 { "" } else { "s" },
            if detail != NONE && detail != 0 { format!(", detail {detail}") } else { String::new() }
        );
        let f = Finding::new(r, subjects, path, None, text, json!({"table": table, "column": col, "ref_table": ref_table, "sites": sites, "detail": detail}));
        out.push(if line > 0 { f.at_line(line) } else { f });
    }
    // Some rules are silent on an incomplete schema: say so rather than imply a clean bill.
    let notice = (s.skipped > 0).then(|| Degraded {
        lane: "sql",
        cause: format!("{} DDL statement(s) could not be parsed or are not modelled, so the schema is incomplete; schema-dependent rules (sql.schema-drift and name resolution) stay silent", s.skipped),
    });
    Ok((out, notice.into_iter().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Sqx;

    fn tables() -> SideTables {
        SideTables {
            sql_names: vec!["name".into(), "users".into()],
            sql_sites: vec![(0, 3), (0, 9), (1, 2)],
            ..SideTables::default()
        }
    }
    fn site(rule: &str, id: u32, table: u32, col: u32) -> Sqx {
        Sqx { rule: rule.into(), kind: SqlKind::Site, id, table, col, detail: 0 }
    }

    #[test]
    fn sites_on_one_column_are_one_finding_with_a_count_named_by_file_and_column() {
        let s = Sql { ok: 2, skipped: 0, complete: true, xs: vec![site("sql.unindexed-filter", 0, 1, 0), site("sql.unindexed-filter", 1, 1, 0), site("sql.unindexed-filter", 2, 1, 0)] };
        let files = vec!["a.ts".to_string(), "b.sql".to_string()];
        let (f, degraded) = findings(&s, &tables(), &files, &BTreeMap::new(), &[]).unwrap();
        assert_eq!(f.len(), 2, "a.ts and b.sql each have a finding");
        assert!(f[0].text().contains("unindexed-filter on users.name (2 sites)"), "{}", f[0].text());
        assert_eq!(f[0].line, Some(3));
        assert!(degraded.is_empty());
        let (g, _) = findings(&s, &tables(), &files, &BTreeMap::new(), &["sql.unindexed-filter".into()]).unwrap();
        assert!(g.is_empty(), "rules.disable turns a rule off");
    }

    #[test]
    fn a_foreign_key_finding_is_named_by_the_definition_file_and_the_referenced_table() {
        let t = tables();
        let x = Sqx { rule: "sql.fk-unindexed".into(), kind: SqlKind::Fk, id: 0, table: 1, col: 0, detail: 1 };
        let s = Sql { ok: 1, skipped: 0, complete: true, xs: vec![x] };
        let defs: BTreeMap<u32, u32> = [(1u32, 1u32)].into_iter().collect();
        let (f, _) = findings(&s, &t, &["a.ts".into(), "schema.sql".into()], &defs, &[]).unwrap();
        assert_eq!(f[0].file, "schema.sql");
        assert!(f[0].text().contains("fk-unindexed on users.name referencing users"), "{}", f[0].text());
    }

    #[test]
    fn an_unknown_rule_or_id_is_an_error_and_an_incomplete_schema_is_degraded_input() {
        let bad = Sql { xs: vec![site("sql.bogus", 0, NONE, NONE)], ..Sql::default() };
        assert!(findings(&bad, &tables(), &["a.ts".into()], &BTreeMap::new(), &[]).unwrap_err().contains("does not know"));
        let past = Sql { xs: vec![site("sql.offset-param", 9, NONE, NONE)], ..Sql::default() };
        assert!(findings(&past, &tables(), &["a.ts".into()], &BTreeMap::new(), &[]).unwrap_err().contains("names SQL site 9"));
        let skipped = Sql { skipped: 2, ..Sql::default() };
        let (_, d) = findings(&skipped, &tables(), &[], &BTreeMap::new(), &[]).unwrap();
        assert_eq!(d.len(), 1);
        assert!(d[0].cause.contains("2 DDL statement(s)"));
    }
}
