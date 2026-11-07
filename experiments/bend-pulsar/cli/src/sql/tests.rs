use super::model::*;
use super::*;

fn run(sql: &str) -> (Out, Stats) {
    analyze(vec![Text { file: 0, fn_id: NONE, node: 0, line: 1, sql: Some(sql.to_string()) }], Dialect::Sqlite)
}

fn nm(o: &Out, id: u32) -> String {
    if id == NONE { "-".into() } else { o.names[id as usize].clone() }
}

/// Rows of `QU` as `table.col:role`, sorted, for one site.
fn uses(o: &Out, site: u32) -> Vec<String> {
    let mut v: Vec<String> =
        o.qu.iter().filter(|r| r[0] == site).map(|r| format!("{}.{}:{}", nm(o, r[1]), nm(o, r[2]), r[3])).collect();
    v.sort();
    v
}

fn defeats(o: &Out, site: u32) -> Vec<String> {
    let mut v: Vec<String> =
        o.qd.iter().filter(|r| r[0] == site).map(|r| format!("{}.{}:{}", nm(o, r[1]), nm(o, r[2]), r[3])).collect();
    v.sort();
    v
}

#[test]
fn split_respects_strings_comments_and_trigger_bodies() {
    let sql = "SELECT 'a;b';\n-- x; y\nSELECT 2; /* ; */ SELECT 3;\nCREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE b SET c = CASE WHEN 1 THEN 2 END;\n  DELETE FROM d;\nEND;\nSELECT 4";
    let parts = split(sql);
    let texts: Vec<&str> = parts.iter().map(|p| p.1.trim()).collect();
    assert_eq!(texts.len(), 5, "{texts:?}");
    assert!(texts[3].starts_with("CREATE TRIGGER") && texts[3].ends_with("END;"));
    // Lines are 0-based offsets of the first non-blank character.
    assert_eq!(parts.iter().map(|p| p.0).collect::<Vec<_>>(), [0, 1, 2, 3, 7]);
}

#[test]
fn schema_replay_keeps_final_state_and_names_are_sorted_ids() {
    let (o, st) = run(
        "CREATE TABLE \"Users\" (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, org INTEGER REFERENCES orgs(id), note TEXT DEFAULT '');\n\
         CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT) WITHOUT ROWID;\n\
         CREATE INDEX users_org ON users (org) WHERE org IS NOT NULL;\n\
         ALTER TABLE users ADD COLUMN age INTEGER;\n\
         ALTER TABLE users RENAME COLUMN note TO memo;",
    );
    assert_eq!((st.ddl_ok, st.ddl_skipped, st.failed), (5, 0, 0));
    assert!(o.names.windows(2).all(|w| w[0] < w[1]), "names sorted and unique: {:?}", o.names);
    let cols: Vec<String> = o.dc.iter().filter(|r| nm(&o, r[0]) == "users").map(|r| format!("{}@{}:{}", nm(&o, r[1]), r[2], r[3])).collect();
    // id: pk + rowid alias; email: not null + unique; org; memo (renamed, default); age
    assert_eq!(cols, ["id@0:33", "email@1:6", "org@2:0", "memo@3:16", "age@4:0"]);
    let tables: Vec<(String, u32)> = o.dt.iter().map(|r| (nm(&o, r[0]), r[2])).collect();
    assert!(tables.contains(&("orgs".into(), T_WITHOUT_ROWID)) && tables.contains(&("users".into(), 0)));
    // users: implied unique on email, declared partial index on org. orgs: implied PK index (no rowid alias)
    let mut idx: Vec<(String, u32, Vec<String>)> = o
        .di
        .iter()
        .map(|d| {
            let cols = o.dx.iter().filter(|x| x[0] == d[0]).map(|x| nm(&o, x[2])).collect();
            (nm(&o, d[1]), d[2], cols)
        })
        .collect();
    idx.sort();
    assert_eq!(
        idx,
        vec![
            ("orgs".to_string(), I_UNIQUE | I_IMPLIED, vec!["id".to_string()]),
            ("users".to_string(), I_PARTIAL, vec!["org".to_string()]),
            ("users".to_string(), I_UNIQUE | I_IMPLIED, vec!["email".to_string()]),
        ]
    );
    assert_eq!(o.index_names.iter().flatten().collect::<Vec<_>>(), ["users_org"]);
    // FK users.org -> orgs.id
    assert_eq!(o.df.len(), 1);
    assert_eq!((nm(&o, o.df[0][1]), nm(&o, o.df[0][2])), ("users".into(), "orgs".into()));
    assert_eq!((nm(&o, o.dg[0][2]), nm(&o, o.dg[0][3])), ("org".into(), "id".into()));
}

#[test]
fn selects_report_tables_roles_and_defeating_predicates() {
    let (o, _) = run(
        "CREATE TABLE t (a INT, b INT, c TEXT);\n\
         SELECT a, count(b) FROM t WHERE a = ? AND b > 3 AND c LIKE '%x' AND lower(c) = 'y' ORDER BY b LIMIT 10 OFFSET ?;",
    );
    assert_eq!(o.qs.len(), 1);
    let qs = o.qs[0];
    assert_eq!((qs[4], qs[5]), (K_SELECT, Q_LIMIT | Q_OFFSET_PARAM));
    assert_eq!(o.qt.iter().map(|r| (nm(&o, r[1]), r[2])).collect::<Vec<_>>(), [("t".to_string(), M_READ as u32)]);
    assert_eq!(uses(&o, 0), ["t.a:1", "t.a:8", "t.b:2", "t.b:6", "t.b:8", "t.c:4"]);
    assert_eq!(defeats(&o, 0), ["t.c:1", "t.c:2"]);
}

#[test]
fn or_across_columns_and_joins_and_unqualified_resolution() {
    let (o, _) = run(
        "CREATE TABLE u (id INT, name TEXT); CREATE TABLE p (id INT, uid INT, title TEXT);\n\
         SELECT u.name, title FROM u JOIN p ON p.uid = u.id WHERE u.name = 'x' OR title = 'y';",
    );
    let u = uses(&o, 0);
    assert!(u.contains(&"p.uid:7".to_string()) && u.contains(&"u.id:7".to_string()), "{u:?}");
    // `title` is only in p, so the unqualified reference resolves; `name` is qualified.
    assert!(u.contains(&"p.title:8".to_string()) && u.contains(&"p.title:1".to_string()), "{u:?}");
    assert_eq!(defeats(&o, 0), ["p.title:3", "u.name:3"]);
}

#[test]
fn insert_update_delete_and_subqueries() {
    let (o, _) = run(
        "CREATE TABLE t (a INT, b INT);\n\
         INSERT INTO t (a, b) VALUES (1, 2);\n\
         UPDATE t SET b = 0 WHERE a IN (SELECT a FROM t WHERE b = 1);\n\
         DELETE FROM t WHERE a = 5 LIMIT 1;",
    );
    assert_eq!(o.qs.iter().map(|r| r[4]).collect::<Vec<_>>(), [K_INSERT, K_UPDATE, K_DELETE]);
    assert_eq!(uses(&o, 0), ["t.a:11", "t.b:11"]);
    // SET b, the IN lhs a, the subquery projects a and filters on b.
    assert_eq!(uses(&o, 1), ["t.a:3", "t.a:8", "t.b:1", "t.b:10"]);
    assert_eq!(o.qs[2][5], Q_LIMIT | Q_LIMIT_ONE);
    let modes: Vec<(u32, u32)> = o.qt.iter().map(|r| (r[0], r[2])).collect();
    assert!(modes.contains(&(1, M_UPDATE as u32)) && modes.contains(&(1, M_READ as u32)) && modes.contains(&(2, M_DELETE as u32)));
}

#[test]
fn failures_and_dynamic_texts_are_sites_and_unparsed_ddl_marks_the_schema_incomplete() {
    let texts = vec![
        Text { file: 0, fn_id: 7, node: 2, line: 10, sql: Some("SELEC nope; CREATE TABLE ok (a INT); CREATE TABLE bad (;".into()) },
        Text { file: 0, fn_id: 7, node: 2, line: 20, sql: None },
    ];
    let (o, st) = analyze(texts, Dialect::Sqlite);
    assert_eq!((st.statements, st.failed, st.dynamic, st.ddl_ok, st.ddl_skipped), (3, 2, 1, 1, 1));
    assert_eq!(o.ds, [1, 1]);
    assert_eq!(o.qs.iter().map(|r| (r[2], r[3], r[5])).collect::<Vec<_>>(), [(7, 2, Q_FAILED), (7, 2, Q_FAILED), (7, 2, Q_DYNAMIC)]);
    assert_eq!(o.site_pos, [(0, 10), (0, 10), (0, 20)]);
}

/// Measurement harness, not a regression test: `PULSAR_SQL_CORPUS=<dir> cargo test --release
/// sql::tests::corpus -- --ignored --nocapture` over every `.sql` file under the directory.
#[test]
#[ignore]
fn corpus() {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "sql") {
                out.push(p);
            }
        }
    }
    let root = std::path::PathBuf::from(std::env::var("PULSAR_SQL_CORPUS").expect("PULSAR_SQL_CORPUS"));
    let mut files = Vec::new();
    walk(&root, &mut files);
    files.sort();
    let texts: Vec<Text> = files
        .iter()
        .enumerate()
        .map(|(i, p)| Text {
            file: i as u32,
            fn_id: NONE,
            node: 0,
            line: 1,
            sql: Some(String::from_utf8_lossy(&std::fs::read(p).unwrap()).into_owned()),
        })
        .collect();
    let t = std::time::Instant::now();
    if std::env::var("PULSAR_SQL_DIALECT").as_deref() == Ok("both") {
        let failed = |d: Dialect| -> std::collections::BTreeSet<u32> {
            let (o, _) = analyze(texts.clone(), d);
            o.qs.iter().filter(|r| r[5] & Q_FAILED != 0).map(|r| r[1]).collect()
        };
        let (a, b) = (failed(Dialect::Sqlite), failed(Dialect::Postgres));
        eprintln!(
            "texts={} fail_sqlite={} fail_postgres={} fail_both={} fail_either_ok={}",
            texts.len(),
            a.len(),
            b.len(),
            a.intersection(&b).count(),
            a.union(&b).count() - a.intersection(&b).count()
        );
        return;
    }
    let dialect = match std::env::var("PULSAR_SQL_DIALECT").as_deref() {
        Ok("postgres") => Dialect::Postgres,
        _ => Dialect::Sqlite,
    };
    let (o, st) = analyze(texts, dialect);
    eprintln!(
        "wall_s={:.4} files={} {:?} tables={} cols={} idx={} fks={} sites={} uses={}",
        t.elapsed().as_secs_f64(),
        files.len(),
        st,
        o.dt.len(),
        o.dc.len(),
        o.di.len(),
        o.df.len(),
        o.qs.len(),
        o.qu.len()
    );
}

fn run_pg(sql: &str) -> (Out, Stats) {
    analyze(vec![Text { file: 0, fn_id: NONE, node: 0, line: 1, sql: Some(sql.to_string()) }], Dialect::Postgres)
}

#[test]
fn postgres_schema_replay() {
    let (o, st) = run_pg(
        "CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, org_id integer REFERENCES orgs(id), note text DEFAULT '');\n\
         CREATE TABLE orgs (id bigint PRIMARY KEY, name text);\n\
         CREATE INDEX users_org ON users (org_id) WHERE org_id IS NOT NULL;\n\
         ALTER TABLE users ADD COLUMN age integer;\n\
         ALTER TABLE users RENAME COLUMN note TO memo;\n\
         CREATE INDEX users_lower_email ON users (lower(email));",
    );
    assert_eq!((st.ddl_ok, st.ddl_skipped, st.failed), (6, 0, 0));
    let cols: Vec<String> = o.dc.iter().filter(|r| nm(&o, r[0]) == "users").map(|r| format!("{}@{}:{}", nm(&o, r[1]), r[2], r[3])).collect();
    // No rowid alias in Postgres: id is pk (1) only.
    assert_eq!(cols, ["id@0:1", "email@1:6", "org_id@2:0", "memo@3:16", "age@4:0"]);
    let mut idx: Vec<(u32, Vec<String>)> = o
        .di
        .iter()
        .filter(|d| nm(&o, d[1]) == "users")
        .map(|d| (d[2], o.dx.iter().filter(|x| x[0] == d[0]).map(|x| nm(&o, x[2])).collect()))
        .collect();
    idx.sort();
    assert_eq!(
        idx,
        vec![
            (I_PARTIAL, vec!["org_id".to_string()]),
            (I_EXPR, vec!["-".to_string()]),
            (I_UNIQUE | I_IMPLIED, vec!["email".to_string()]),
            (I_UNIQUE | I_IMPLIED, vec!["id".to_string()]),
        ]
    );
    assert_eq!(o.df.len(), 1);
    assert_eq!((nm(&o, o.dg[0][2]), nm(&o, o.dg[0][3])), ("org_id".into(), "id".into()));
}

#[test]
fn postgres_queries_roles_and_placeholders() {
    let (o, st) = run_pg(
        "CREATE TABLE t (a int, b int, c text);\n\
         SELECT a, count(b) FROM t WHERE a = ? AND b > 3 AND c LIKE '%x' AND lower(c) = ? ORDER BY b LIMIT 10 OFFSET ?;\n\
         SELECT u.name FROM t u JOIN t v ON v.a = u.b WHERE u.a = 1 OR v.c = 'y' OR a IN (SELECT a FROM t WHERE b IS NULL);",
    );
    assert_eq!(st.failed, 0, "{st:?}");
    assert_eq!(o.qs.len(), 2);
    assert_eq!((o.qs[0][4], o.qs[0][5]), (K_SELECT, Q_LIMIT | Q_OFFSET_PARAM));
    assert_eq!(uses(&o, 0), ["t.a:1", "t.a:8", "t.b:2", "t.b:6", "t.b:8", "t.c:4"]);
    assert_eq!(defeats(&o, 0), ["t.c:1", "t.c:2"]);
    let u1 = uses(&o, 1);
    assert!(u1.contains(&"t.a:7".to_string()) && u1.contains(&"t.b:7".to_string()), "{u1:?}");
    assert!(defeats(&o, 1).contains(&"t.c:3".to_string()), "{:?}", defeats(&o, 1));
}

#[test]
fn postgres_dml_failures_and_dollar_quotes() {
    let (o, st) = run_pg(
        "CREATE TABLE t (a int, b int);\n\
         INSERT INTO t (a, b) VALUES (1, 2) ON CONFLICT (a) DO UPDATE SET b = 3;\n\
         UPDATE t SET b = 0 WHERE a = 5;\n\
         DELETE FROM t WHERE a = 5;\n\
         CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; SELECT 2; $$ LANGUAGE sql;\n\
         SELEC nope;",
    );
    assert_eq!((st.statements, st.failed), (6, 1), "{st:?}");
    assert_eq!(o.qs.iter().filter(|r| r[5] & Q_FAILED == 0).map(|r| r[4]).collect::<Vec<_>>(), [K_INSERT, K_UPDATE, K_DELETE]);
    assert_eq!(uses(&o, 0), ["t.a:11", "t.b:10", "t.b:11"]);
}

#[test]
fn null_tests_are_null_roles_in_both_spellings_and_both_dialects() {
    let (o, _) = run("CREATE TABLE t (a INT, b INT);\nSELECT a FROM t WHERE b IS NULL;\nSELECT a FROM t WHERE b IS NOT NULL;\nSELECT a FROM t WHERE b ISNULL AND a NOTNULL;\nSELECT a FROM t WHERE b IS a;");
    assert_eq!(uses(&o, 0), ["t.a:8", "t.b:5"]);
    assert_eq!(uses(&o, 1), ["t.a:8", "t.b:5"]);
    assert_eq!(uses(&o, 2), ["t.a:5", "t.a:8", "t.b:5"]);
    // `IS` with a non-NULL operand is null-safe equality.
    assert_eq!(uses(&o, 3), ["t.a:1", "t.a:8", "t.b:1"]);
    let (p, _) = run_pg("CREATE TABLE t (a int, b int);\nSELECT a FROM t WHERE b IS NULL;\nSELECT a FROM t WHERE b IS NOT NULL;");
    assert_eq!(uses(&p, 0), uses(&o, 0));
    assert_eq!(uses(&p, 1), uses(&o, 1));
}

#[test]
fn a_column_of_a_cte_or_derived_table_has_no_table() {
    let (o, _) = run("CREATE TABLE t (a INT);\nWITH r AS (SELECT a FROM t) SELECT r.a FROM r WHERE r.a = 1;");
    let u = uses(&o, 0);
    assert!(u.contains(&"-.a:8".to_string()) && u.contains(&"-.a:1".to_string()), "{u:?}");
}
