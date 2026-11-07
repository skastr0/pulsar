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
    eprintln!("wall_s={:.3} fns={fns} ct={ct} tf={tf} {:?}", t.elapsed().as_secs_f64(), out.stats);
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
