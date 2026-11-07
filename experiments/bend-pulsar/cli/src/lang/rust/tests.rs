//! The Rust lane against the hand-checked fixtures (`fixtures/rust-fn`, written by pulsar-cov)
//! and against a throwaway crate for `use` resolution.

use super::*;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/rust-fn")
}

fn render_fns(f: &parse::RustFile) -> String {
    let mut s = String::new();
    for r in &f.fns.fns {
        let parent = r.parent.map_or("-".to_string(), |p| p.to_string());
        s.push_str(&format!("{}\t{}\t{}\t{}\t{}\n", r.start_line, r.end_line, parent, r.kind, r.chain));
    }
    s
}

fn render_ct(f: &parse::RustFile) -> String {
    let mut s = String::new();
    for c in &f.fns.ct {
        s.push_str(&format!("{}\t{}\t{}\t{}\n", c.fn_local, c.node, c.parent, c.kind));
    }
    s
}

#[test]
fn fixture_functions_and_control_trees_match_the_hand_counts() {
    let dir = fixture_dir();
    let mut checked = 0;
    let mut diffs: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(dir.join("src")).unwrap() {
        let path = entry.unwrap().path();
        let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
        let src = std::fs::read_to_string(&path).unwrap();
        let f = parse::extract(&format!("src/{stem}.rs"), &src, false);
        assert!(!f.failed, "{stem}.rs did not parse");
        let want_fns = std::fs::read_to_string(dir.join(format!("expected/{stem}.fns"))).unwrap();
        let want_ct = std::fs::read_to_string(dir.join(format!("expected/{stem}.ct"))).unwrap();
        if render_fns(&f) != want_fns {
            diffs.push(format!("{stem}.fns\n  got:\n{}  want:\n{want_fns}", render_fns(&f)));
        }
        if render_ct(&f) != want_ct {
            diffs.push(format!("{stem}.ct\n  got:\n{}  want:\n{want_ct}", render_ct(&f)));
        }
        checked += 1;
    }
    assert!(diffs.is_empty(), "{}", diffs.join("\n"));
    assert!(checked >= 8, "expected the eight fixture files, saw {checked}");
}

#[test]
fn test_code_is_flagged_not_dropped() {
    let src = std::fs::read_to_string(fixture_dir().join("src/skipped.rs")).unwrap();
    let f = parse::extract("src/skipped.rs", &src, false);
    let names: Vec<&str> = f.fns.fns.iter().map(|r| r.chain.as_str()).collect();
    assert_eq!(names, ["macro_hides_if", "test_only_helper", "tests>runs_only_under_test"]);
    assert_eq!(f.tests, [1, 2]);
}

#[test]
fn keys_do_not_depend_on_line_numbers() {
    let a = parse::extract("src/x.rs", "fn f() {}\nimpl A { fn m(&self) {} }\n", false);
    let b = parse::extract("src/x.rs", "\n\n// moved\nfn f() {}\n\nimpl A {\n    fn m(&self) {}\n}\n", false);
    let keys = |f: &parse::RustFile| f.fns.fns.iter().map(|r| r.key).collect::<Vec<_>>();
    assert_eq!(keys(&a), keys(&b));
    assert_eq!(a.fns.fns.len(), 2);
}

#[test]
fn same_method_name_in_two_trait_impls_gets_two_keys() {
    let src = "struct Foo;\nimpl From<A> for Foo { fn from(_: A) -> Foo { Foo } }\nimpl From<B> for Foo { fn from(_: B) -> Foo { Foo } }\n";
    let f = parse::extract("src/x.rs", src, false);
    let chains: Vec<&str> = f.fns.fns.iter().map(|r| r.chain.as_str()).collect();
    assert_eq!(chains, ["Foo as From<A>>from", "Foo as From<B>>from"]);
    assert_ne!(f.fns.fns[0].key, f.fns.fns[1].key);
}

fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

#[test]
fn use_paths_resolve_to_files_and_leave_the_repo_as_u() {
    let root = std::env::temp_dir().join(format!("pulsar-rs-lane-{}", std::process::id()));
    std::fs::remove_dir_all(&root).ok();
    write(&root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\nserde = \"1\"\n");
    write(&root, "src/lib.rs", "mod a;\nmod b;\npub use a::X;\nuse crate::b::inner::Y;\nuse crate::Own;\nuse self::Own2;\nuse std::fmt;\nuse serde::Serialize;\nuse nothing_here::Z;\n");
    write(&root, "src/a.rs", "use super::b::Z;\nuse crate::missing_mod::Q;\n");
    write(&root, "src/b/mod.rs", "pub mod inner;\n");
    write(&root, "src/b/inner.rs", "use super::super::a::X;\n#[cfg(test)]\nmod tests;\n");
    write(&root, "src/b/inner/tests.rs", "use super::*;\nfn helper() { if true {} }\n");
    let tracked: Vec<String> =
        ["Cargo.toml", "src/a.rs", "src/b/inner.rs", "src/b/inner/tests.rs", "src/b/mod.rs", "src/lib.rs"]
            .map(String::from)
            .to_vec();
    let files: Vec<(u32, String)> =
        tracked.iter().filter(|p| owns(p)).cloned().enumerate().map(|(i, p)| (i as u32, p)).collect();
    // ids: a=0 inner=1 tests=2 b/mod=3 lib=4
    let out = analyze(&root, &files, &tracked).unwrap();
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(out.stats.metadata_fallbacks, 0, "cargo metadata should work offline for this crate");
    assert_eq!(out.stats.failed_parse, 0);
    assert_eq!(
        out.i,
        vec![
            [0, 3, 0, 1, 0], // a: use super::b::Z -> b/mod.rs
            [0, 4, 0, 1, 0], // a: use crate::missing_mod::Q -> the root, Q is taken as an item
            [1, 0, 0, 1, 0], // inner: use super::super::a::X -> a.rs
            [2, 1, 0, 1, 0], // tests: use super::* -> inner.rs
            [4, 0, 2, 1, 0], // lib: pub use a::X -> a.rs, a re-export
            [4, 1, 0, 1, 0], // lib: use crate::b::inner::Y -> b/inner.rs
        ]
    );
    // std and serde leave the repo (reason 0); nothing_here names nothing in scope (reason 3).
    assert_eq!(out.u, vec![[4, 0], [4, 3]]);
    // tests.rs is reached only through #[cfg(test)] mod tests; so all its functions are test code.
    assert_eq!(out.per_file[2].fns.fns.len(), 1);
    assert_eq!(out.per_file[2].tests, vec![0]);
    // ids a=0 inner=1 tests=2 b/mod=3 lib=4: only tests.rs is reachable solely through cfg(test).
    assert_eq!(out.prod, vec![Some(true), Some(true), Some(false), Some(true), Some(true)]);
    assert!(out.per_file[0].tests.is_empty());
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p.is_dir() {
            if name != "target" && name != ".git" && name != "node_modules" {
                walk(&p, root, out);
            }
        } else if name.ends_with(".rs") || name == "Cargo.toml" {
            out.push(p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Measurement harness, not a regression test: `PULSAR_RS_CORPUS=<dir> cargo test --release
/// lang::rust::tests::corpus -- --ignored --nocapture`. `PULSAR_RS_TREES=<file>` also writes each
/// target's module-tree files (`root<TAB>file<TAB>file...`) for the rustc dep-info oracle diff.
#[test]
#[ignore]
fn corpus() {
    let root = PathBuf::from(std::env::var("PULSAR_RS_CORPUS").expect("PULSAR_RS_CORPUS"));
    let mut tracked = Vec::new();
    walk(&root, &root, &mut tracked);
    tracked.sort();
    let files: Vec<(u32, String)> =
        tracked.iter().filter(|p| owns(p)).cloned().enumerate().map(|(i, p)| (i as u32, p)).collect();
    let t = std::time::Instant::now();
    let out = analyze(&root, &files, &tracked).unwrap();
    let fns: usize = out.per_file.iter().map(|f| f.fns.fns.len()).sum();
    let ct: usize = out.per_file.iter().map(|f| f.fns.ct.len()).sum();
    let tf: usize = out.per_file.iter().map(|f| f.tests.len()).sum();
    let (bl, bw, br, bc) = out.per_file.iter().fold((0, 0, 0, 0), |a, f| {
        (a.0 + f.fns.blocks.bl.len(), a.1 + f.fns.blocks.bw.len(), a.2 + f.fns.blocks.br.len(), a.3 + f.fns.blocks.bc.len())
    });
    eprintln!("wall_s={:.3} fns={fns} ct={ct} tf={tf} bl={bl} bw={bw} br={br} bc={bc} {:?}", t.elapsed().as_secs_f64(), out.stats);
    call_report(&out);
    if let Ok(path) = std::env::var("PULSAR_RS_TREES") {
        let mut s = String::new();
        for (r, ids) in &out.trees {
            s.push_str(r);
            for id in ids {
                s.push('\t');
                s.push_str(&files[*id as usize].1);
            }
            s.push('\n');
        }
        std::fs::write(path, s).unwrap();
    }
}

#[test]
fn every_short_circuit_node_has_its_operator_row() {
    let f = parse::extract("src/x.rs", "fn f(a: bool, b: bool, c: bool) -> bool {\n    if a && b || c { return true; }\n    a || b\n}\n", false);
    let kind6: Vec<(u32, u32)> =
        f.fns.ct.iter().filter(|c| c.kind == crate::lang::functions::ct::SHORT_CIRCUIT).map(|c| (c.fn_local, c.node)).collect();
    let ops: Vec<(u32, u32, u8)> = f.fns.ops.iter().map(|o| (o.fn_local, o.node, o.op)).collect();
    // `a && b || c` is `(a && b) || c`: the inner && comes first in source order.
    assert_eq!(ops.iter().map(|o| o.2).collect::<Vec<_>>(), [1, 2, 2]);
    assert_eq!(ops.iter().map(|o| (o.0, o.1)).collect::<Vec<_>>(), kind6);
}

#[test]
fn fixtures_carry_one_operator_row_per_short_circuit_node() {
    for entry in std::fs::read_dir(fixture_dir().join("src")).unwrap() {
        let path = entry.unwrap().path();
        let f = parse::extract("src/x.rs", &std::fs::read_to_string(&path).unwrap(), false);
        let kind6 = f.fns.ct.iter().filter(|c| c.kind == crate::lang::functions::ct::SHORT_CIRCUIT).count();
        assert_eq!(f.fns.ops.len(), kind6, "{}", path.display());
    }
}

#[test]
fn function_spans_match_the_fn_rows_and_survive_a_move() {
    let src = std::fs::read_to_string(fixture_dir().join("src/branch.rs")).unwrap();
    let f = parse::extract("src/branch.rs", &src, false);
    let spans = function_spans("src/branch.rs", &src);
    let want: Vec<(u64, u32, u32)> = f.fns.fns.iter().map(|r| (r.key, r.start_line, r.end_line)).collect();
    assert_eq!(spans.iter().map(|s| (s.key, s.start_line, s.end_line)).collect::<Vec<_>>(), want);
    // The same text under another path is a different key; a file that does not parse is empty.
    assert_ne!(function_spans("src/other.rs", &src)[0].key, spans[0].key);
    assert!(function_spans("src/bad.rs", "fn (").is_empty());
}

#[test]
fn is_prod_follows_the_rust_layout_rule() {
    for p in ["src/lib.rs", "cli/src/lang/rust/mod.rs", "src/bin/tool.rs", "src/testing.rs", "src/attests.rs"] {
        assert!(is_prod(p), "{p} is production code");
    }
    for p in [
        "tests/it.rs",
        "crate/tests/common/mod.rs",
        "benches/b.rs",
        "examples/demo.rs",
        "fixtures/rust-fn/src/lib.rs",
        "x/testdata/a.rs",
        "build.rs",
        "crates/a/build.rs",
    ] {
        assert!(!is_prod(p), "{p} is not production code");
    }
}

#[test]
fn function_facts_carry_the_control_tree_for_a_historical_blob() {
    let src = std::fs::read_to_string(fixture_dir().join("src/branch.rs")).unwrap();
    let live = parse::extract("src/branch.rs", &src, false);
    let facts = function_facts("src/branch.rs", &src);
    assert_eq!(render_ct_of(&facts), render_ct(&live));
    assert_eq!(facts.fns.len(), live.fns.fns.len());
    assert!(function_facts("src/bad.rs", "fn (").fns.is_empty());
}

fn render_ct_of(f: &crate::lang::functions::FileFns) -> String {
    f.ct.iter().map(|c| format!("{}\t{}\t{}\t{}\n", c.fn_local, c.node, c.parent, c.kind)).collect()
}

/// `BL`, `BW`, `BR`, `BC` of one function source, as readable tuples.
fn block_rows(src: &str) -> parse::RustFile {
    parse::extract("src/x.rs", src, false)
}

fn set(rows: &[[u32; 3]], block: u32) -> Vec<u32> {
    let mut v: Vec<u32> = rows.iter().filter(|r| r[1] == block).map(|r| r[2]).collect();
    v.sort_unstable();
    v
}

#[test]
fn independent_checks_are_unlinked_and_an_accumulator_guard_reads_what_they_wrote() {
    let f = block_rows(
        "fn f(a: i32, b: i32) -> i32 {\n    let mut acc = 0;\n    if a > 3 { acc += 1; }\n    if b == 2 { acc += 2; }\n    if acc > 1 { return 1; }\n    0\n}\n",
    );
    let r = &f.fns.blocks;
    // params a=0 b=1, acc=2. Blocks are CT nodes 1, 3, 5.
    assert_eq!(r.bl.iter().map(|x| x[1]).collect::<Vec<_>>(), [1, 3, 5]);
    assert!(r.bl.iter().all(|x| x[2] != 0), "every block has a condition hash");
    assert_eq!((set(&r.br, 1), set(&r.br, 3), set(&r.br, 5)), (vec![0], vec![1], vec![2]));
    assert_eq!((set(&r.bw, 1), set(&r.bw, 3), set(&r.bw, 5)), (vec![2], vec![2], vec![]));
    // `a > 3` is gt (5) against literal 1, `b == 2` is eq (1) against literal 2, `acc > 1` gt against literal 3.
    assert_eq!(r.bc, vec![[0, 1, 0, 5, 1], [0, 3, 1, 1, 2], [0, 5, 2, 5, 3]]);
}

#[test]
fn match_arms_pin_the_scrutinee_and_for_loops_read_the_iterated_expression() {
    let f = block_rows(
        "fn g(n: u32, items: Vec<u32>) -> u32 {\n    let mut total = 0;\n    match n { 0 => total += 1, 1 => total += 2, _ => {} }\n    for x in items { total += x; }\n    total\n}\n",
    );
    let r = &f.fns.blocks;
    // params n=0 items=1, total=2, x=3; blocks: match = CT node 1 (arms 2,3,4 + flag 5), loop = node 6.
    assert_eq!(r.bl.iter().map(|x| (x[1], x[2] == 0)).collect::<Vec<_>>(), [(1, false), (6, true)]);
    assert_eq!(r.bc, vec![[0, 1, 0, 1, 1], [0, 1, 0, 1, 2]]);
    assert_eq!((set(&r.br, 1), set(&r.br, 6)), (vec![0], vec![1]));
    assert_eq!(set(&r.bw, 1), vec![2]);
    assert_eq!(set(&r.bw, 6), vec![2, 3]);
}

#[test]
fn writing_a_root_writes_the_chains_seen_on_it() {
    let f = block_rows(
        "struct S { kind: u32 }\nfn h(c: bool, mut e: S, other: S) {\n    if e.kind == 1 { }\n    if c { e = other; }\n}\n",
    );
    let r = &f.fns.blocks;
    // vars: c=0 e=1 other=2, chain e.kind=3. Block 1 is the first if, block 3 the second.
    assert_eq!(set(&r.br, 1), vec![3]);
    assert_eq!(set(&r.bw, 3), vec![1, 3], "the write to e also writes the chain e.kind");
}

fn core_env() -> env::CallEnv {
    let l = crate::catalog::load("rust-core", include_str!("catalog/rust-core.toml")).unwrap();
    env::CallEnv::new(&[&l.catalog], ["tokio".to_string()].into(), Default::default())
}

/// `(symbol, loop_depth, ctx)` of every call site, in source order.
fn sites_of(src: &str) -> Vec<(String, u32, u8)> {
    let env = core_env();
    let f = parse::extract_with("src/x.rs", src, false, Some(&env));
    f.fns
        .sites
        .iter()
        .filter_map(|s| match &s.kind {
            crate::lang::functions::SiteKind::Call { sym, loop_depth, ctx, .. } => {
                Some((f.fns.syms[*sym as usize].clone(), *loop_depth, *ctx))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn call_paths_resolve_through_use_aliases_and_full_paths_and_unknown_calls_emit_nothing() {
    let sites = sites_of(
        "use std::fs;\nuse std::thread::sleep as nap;\nfn a() {\n    let _s = fs::read_to_string(\"x\");\n    nap(d());\n    std::fs::write(\"a\", \"b\");\n    core::fs::read(\"z\");\n    mine::read_to_string(\"q\");\n    println!(\"hi\");\n    panic!(\"x\");\n}\n",
    );
    let syms: Vec<&str> = sites.iter().map(|s| s.0.as_str()).collect();
    assert_eq!(
        syms,
        ["std#fs::read_to_string", "std#thread::sleep", "std#fs::write", "std#fs::read", "std#println!", "std#panic!"]
    );
    assert!(sites.iter().all(|s| s.2 == 0), "no async, no test, no name-only: {sites:?}");
}

#[test]
fn methods_match_by_name_only_and_say_so() {
    let sites = sites_of("fn f(a: Option<i32>, r: Result<i32, ()>) {\n    a.unwrap();\n    r.expect(\"m\");\n    a.map(|x| x);\n}\n");
    assert_eq!(
        sites,
        vec![
            ("syntax#method.unwrap".to_string(), 0, env::NAME_ONLY),
            ("syntax#method.expect".to_string(), 0, env::NAME_ONLY),
        ]
    );
}

#[test]
fn discarded_results_async_test_and_loop_context_are_in_the_ctx_and_depth() {
    let sites = sites_of(
        "fn c() { let _ = f(); g().ok(); let _x = h(); }\nasync fn b() { std::fs::read(\"f\"); }\nfn l(v: Vec<u8>) { for _x in v { std::thread::sleep(d()); } }\n#[cfg(test)]\nmod tests { fn t(a: Option<u8>) { a.unwrap(); } }\n",
    );
    assert_eq!(
        sites,
        vec![
            ("syntax#let-underscore".to_string(), 0, env::NAME_ONLY),
            ("syntax#ok-discarded".to_string(), 0, env::NAME_ONLY),
            ("std#fs::read".to_string(), 0, 1),
            ("std#thread::sleep".to_string(), 1, 0),
            ("syntax#method.unwrap".to_string(), 0, 4 | env::NAME_ONLY),
        ]
    );
}

#[test]
fn without_an_environment_no_call_site_is_emitted() {
    let f = parse::extract("src/x.rs", "fn f() { std::fs::read(\"f\"); panic!(); }", false);
    assert!(f.fns.sites.is_empty() && f.fns.syms.is_empty());
}

/// `(shape)` of every handler site, in source order.
fn handlers_of(src: &str) -> Vec<u8> {
    let env = core_env();
    let f = parse::extract_with("src/x.rs", src, false, Some(&env));
    f.fns
        .sites
        .iter()
        .filter_map(|s| match &s.kind {
            crate::lang::functions::SiteKind::Handler { shape } => Some(*shape),
            _ => None,
        })
        .collect()
}

#[test]
fn error_handlers_get_a_shape_from_their_body() {
    let shapes = handlers_of(
        "fn h(r: R) {\n\
         match r { Ok(v) => v, Err(_) => {} }\n\
         match r { Ok(v) => v, Err(e) => { println!(\"{e}\"); } }\n\
         match r { Ok(v) => v, Err(_) => 0 }\n\
         match r { Ok(v) => v, Err(e) => return Err(e) }\n\
         match r { Ok(v) => v, Err(_) => return Err(Other) }\n\
         match r { Ok(v) => v, Err(e) => { retry(e); retry2() } }\n\
         if let Err(e) = r { eprintln!(\"{e}\"); }\n\
         r.unwrap_or_else(|e| { println!(\"{e}\"); 0 });\n\
         r.or_else(|e| Err(wrap(e)));\n\
         }\n",
    );
    // empty, only logs, constant, rethrow with cause, rethrow without, other, only logs, constant, rethrow with cause
    assert_eq!(shapes, [1, 2, 3, 4, 5, 0, 2, 3, 4]);
}

#[test]
fn constant_arguments_are_literals_module_constants_and_names_bound_once_to_a_literal() {
    let env = core_env();
    let f = parse::extract_with(
        "src/x.rs",
        "const K: &str = \"k\";\nfn f() {\n    let a = \"x\";\n    let mut b = \"y\";\n    std::fs::write(\"p\", a);\n    std::fs::write(K, b);\n    std::fs::write(a, c());\n}\nfn g(a: &str) { let a = \"z\"; std::fs::read(a); }\n",
        false,
        Some(&env),
    );
    let consts: Vec<Vec<(u8, u8)>> = f
        .fns
        .sites
        .iter()
        .filter_map(|s| match &s.kind {
            crate::lang::functions::SiteKind::Call { consts, .. } => Some(consts.to_vec()),
            _ => None,
        })
        .collect();
    // write("p", a): literal + a bound once; write(K, b): K is a module constant, b is `mut`;
    // write(a, c()): a again; g binds `a` twice (parameter and let), so it is not a constant.
    assert_eq!(consts, vec![vec![(0, 1), (1, 3)], vec![(0, 3)], vec![(0, 3)], vec![]]);
}

#[test]
fn query_call_texts_are_literal_or_dynamic_and_carry_their_control_node() {
    let l = crate::catalog::load(
        "t",
        "format = \"pulsar-catalog 0\"\nid = \"t\"\nscope = \"lane\"\nsources = [\"x\"]\nclasses = [\n  { class = \"query\", id = 1, rule = \"t/query\" },\n]\nsymbols = [\n  { sym = \"sqlx#query\", class = \"query\", ver = \"1\", at = \"x\", doc = \"x\" },\n  { sym = \"syntax#method.execute\", class = \"query\", ver = \"1\", at = \"x\", doc = \"x\" },\n]\n",
    )
    .unwrap();
    let env = env::CallEnv::new(&[&l.catalog], ["sqlx".to_string()].into(), Default::default());
    let f = parse::extract_with(
        "src/x.rs",
        "fn f(conn: C, s: String) {\n    sqlx::query(\"SELECT 1\");\n    for _x in 0..3 {\n        conn.execute(\"INSERT INTO t VALUES (?)\", [1]);\n    }\n    sqlx::query(&s);\n}\n",
        false,
        Some(&env),
    );
    let got: Vec<(u32, u32, String, crate::lang::functions::SqlTextKind)> =
        f.fns.sql.iter().map(|s| (s.line, s.ct_node, s.text.clone(), s.kind)).collect();
    use crate::lang::functions::SqlTextKind::{Dynamic, Literal};
    assert_eq!(got, vec![(2, 0, "SELECT 1".to_string(), Literal), (4, 1, "INSERT INTO t VALUES (?)".to_string(), Literal), (6, 0, String::new(), Dynamic)]);
}

/// Call-site totals for the measurement harness: exact versus name-only, handler shapes, constants.
fn call_report(out: &Analysis) {
    use crate::lang::functions::SiteKind;
    let (mut exact, mut name_only, mut test_sites, mut al, mut hd) = (0usize, 0usize, 0usize, 0usize, [0usize; 6]);
    let mut by_sym: std::collections::BTreeMap<String, usize> = Default::default();
    for f in &out.per_file {
        for s in &f.fns.sites {
            match &s.kind {
                SiteKind::Call { sym, ctx, consts, .. } => {
                    *by_sym.entry(f.fns.syms[*sym as usize].clone()).or_default() += 1;
                    if ctx & env::NAME_ONLY != 0 { name_only += 1 } else { exact += 1 }
                    if ctx & 4 != 0 { test_sites += 1 }
                    al += consts.len();
                }
                SiteKind::Handler { shape } => hd[*shape as usize] += 1,
                SiteKind::Edge { .. } => {}
            }
        }
    }
    let sql = out.sql_texts.len();
    eprintln!("calls: exact={exact} name_only={name_only} in_test={test_sites} al={al} handlers(other,empty,logs,const,cause,nocause)={hd:?} sql_texts={sql} catalogs={:?}", out.catalogs);
    let mut top: Vec<_> = by_sym.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1));
    eprintln!("top symbols: {:?}", &top[..top.len().min(12)]);
}

/// `(caller chain, callee file, callee chain)` of every linked edge, and `(caller chain, reason)`
/// of every unresolved call, sorted.
use crate::lang::functions::{Callee, SiteKind};

fn edges_of(out: &Analysis) -> (Vec<(String, u32, String)>, Vec<(String, u8)>) {
    let (mut linked, mut unres) = (Vec::new(), Vec::new());
    for f in &out.per_file {
        for s in &f.fns.sites {
            if let SiteKind::Edge { to: Callee::Resolved { file, fn_local }, .. } = &s.kind {
                let callee = &out.per_file[*file as usize].fns.fns[*fn_local as usize];
                linked.push((f.fns.fns[s.fn_local as usize].chain.clone(), *file, callee.chain.clone()));
            }
        }
        for (l, r) in &f.fns.unresolved {
            unres.push((f.fns.fns[*l as usize].chain.clone(), *r));
        }
    }
    linked.sort();
    unres.sort();
    (linked, unres)
}

#[test]
fn call_edges_link_path_self_and_type_calls_and_drop_calls_that_leave_the_repo() {
    use crate::lang::functions::unres;
    let root = std::env::temp_dir().join(format!("pulsar-rs-edges-{}", std::process::id()));
    std::fs::remove_dir_all(&root).ok();
    write(&root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\nserde = \"1\"\n");
    write(
        &root,
        "src/lib.rs",
        "mod a;\nmod util;\nuse util::helper as h;\nfn top() {\n    a::run();\n    util::helper();\n    crate::util::helper();\n    h();\n    local();\n    Counter::make();\n    std::mem::drop(1);\n    serde::thing();\n    a::missing();\n    drop(2);\n}\nfn local() {}\nstruct Counter;\nimpl Counter {\n    fn make() -> Counter { Counter }\n    fn bump(&self) { self.read(); Self::make(); self.nowhere(); }\n    fn read(&self) {}\n}\n",
    );
    write(&root, "src/a.rs", "pub fn run() { super::local(); }\n");
    write(&root, "src/util/mod.rs", "pub fn helper() {}\n");
    let tracked: Vec<String> = ["Cargo.toml", "src/a.rs", "src/lib.rs", "src/util/mod.rs"].map(String::from).to_vec();
    let files: Vec<(u32, String)> =
        tracked.iter().filter(|p| owns(p)).cloned().enumerate().map(|(i, p)| (i as u32, p)).collect();
    // ids: a=0 lib=1 util=2
    let out = analyze(&root, &files, &tracked).unwrap();
    std::fs::remove_dir_all(&root).ok();
    let (linked, unresolved) = edges_of(&out);
    let want = |c: &str, f: u32, t: &str| (c.to_string(), f, t.to_string());
    assert_eq!(
        linked,
        vec![
            want("Counter>bump", 1, "Counter>make"),
            want("Counter>bump", 1, "Counter>read"),
            want("run", 1, "local"),
            want("top", 0, "run"),
            want("top", 1, "Counter>make"),
            want("top", 1, "local"),
            want("top", 2, "helper"),
            want("top", 2, "helper"),
            want("top", 2, "helper"),
        ]
    );
    // `a::missing` is a module of the repo without that function; `self.nowhere()` is a method of no
    // impl in the file.
    assert_eq!(
        unresolved,
        vec![("Counter>bump".to_string(), unres::UNKNOWN_MEMBER), ("top".to_string(), unres::NOT_FOUND)]
    );
}

/// The `CO` operator codes and `CB` flavors of `f` (function 0; closures are functions of their own),
/// in node order.
fn co_cb(body: &str) -> (Vec<u8>, Vec<u8>) {
    let f = parse::extract("src/x.rs", &format!("fn f(a: bool, b: bool, c: bool, d: bool, o: Option<u8>) {{\n{body}\n}}\n"), false);
    let (mut ops, mut cb) = (f.fns.ops.clone(), f.fns.branches.clone());
    ops.retain(|o| o.fn_local == 0);
    cb.retain(|b| b.fn_local == 0);
    ops.sort_by_key(|o| (o.fn_local, o.node));
    cb.sort_by_key(|b| (b.fn_local, b.node));
    (ops.iter().map(|o| o.op).collect(), cb.iter().map(|b| b.flavor).collect())
}

#[test]
fn a_run_of_the_same_logical_operator_continues_with_codes_9_and_10() {
    let ops = |b: &str| co_cb(b).0;
    assert_eq!(ops("let _x = a && b && c;"), [1, 9]);
    assert_eq!(ops("let _x = a || b || c || d;"), [2, 10, 10]);
    // A different operator in between starts a new run, in source order.
    assert_eq!(ops("let _x = a && b || c && d;"), [1, 2, 1]);
    assert_eq!(ops("let _x = a || b && c || d;"), [2, 1, 2]);
    // Parentheses do not split the expression: the inner operator is read in source order.
    assert_eq!(ops("let _x = a && (b && c);"), [1, 9]);
    assert_eq!(ops("let _x = a && (b || c) && d;"), [1, 2, 1]);
    // Two statements never share a run.
    assert_eq!(ops("let _x = a && b;\nlet _y = c && d;"), [1, 1]);
    assert_eq!(ops("if a && b { }\nif c && d { }"), [1, 1]);
    // An operand that is not itself logical is an expression of its own: its operators are not
    // part of the outer run, and the outer run goes on after it.
    assert_eq!(ops("let _x = a && g(b || c) && d;"), [1, 2, 9]);
    assert_eq!(ops("let _x = (a || b) && c || d;"), [2, 1, 2]);
    // A closure body is its own function: its operators are in its own tree, not this one's.
    assert_eq!(ops("let _g = || a && b && c;\nlet _x = a && b;"), [1]);
    let f = parse::extract("src/x.rs", "fn f(a: bool, b: bool, c: bool) {\n    let _g = || a && b && c;\n}\n", false);
    let mut closure: Vec<_> = f.fns.ops.iter().filter(|o| o.fn_local == 1).map(|o| (o.node, o.op)).collect();
    closure.sort_unstable();
    assert_eq!(closure, [(1, 1), (2, 9)], "the closure's own run is in its own tree");
}

#[test]
fn let_chains_in_a_condition_are_one_expression() {
    let f = parse::extract("src/x.rs", "fn f(a: bool, b: bool, o: Option<u8>) {\n    if let Some(x) = o && a && b && x > 1 { }\n}\n", false);
    let mut ops = f.fns.ops.clone();
    ops.sort_by_key(|o| o.node);
    assert_eq!(ops.iter().map(|o| o.op).collect::<Vec<_>>(), [1, 9, 9]);
}

#[test]
fn every_branch_node_says_what_it_is() {
    let cb = |b: &str| co_cb(b).1;
    use crate::lang::functions::flavor::{IF, IF_ELIF, IF_ELSE};
    assert_eq!(cb("if a { }"), [IF]);
    assert_eq!(cb("if a { } else { }"), [IF_ELSE]);
    assert_eq!(cb("if a { } else if b { }"), [IF_ELIF, IF]);
    assert_eq!(cb("if a { } else if b { } else { }"), [IF_ELIF, IF_ELSE]);
    assert_eq!(cb("if let Some(_) = o { }"), [IF]);
    assert_eq!(cb("if let Some(_) = o { } else { }"), [IF_ELSE]);
    assert_eq!(cb("if a { if b { } else { } }"), [IF, IF_ELSE]);
    // A `let .. else` is a branch with one arm, the diverging block: counted as an `if` with no `else`.
    assert_eq!(cb("let Some(_x) = o else { return };"), [IF]);
    // One row per kind-1 node: nothing else is a branch.
    let f = parse::extract("src/x.rs", "fn f(a: bool, o: Option<u8>) {\n    if a { }\n    let Some(_x) = o else { return };\n    match o { _ => {} }\n    while a { }\n}\n", false);
    let branches = f.fns.ct.iter().filter(|c| c.kind == crate::lang::functions::ct::BRANCH).count();
    assert_eq!(f.fns.branches.len(), branches);
}
