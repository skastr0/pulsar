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
    let (o, st) = analyze(texts, Dialect::Sqlite);
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
