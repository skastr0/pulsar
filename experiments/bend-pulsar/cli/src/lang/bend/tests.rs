use super::*;

fn ct_rows(f: &BendFile, local: u32) -> Vec<(u32, u32, u8)> {
    f.fns.ct.iter().filter(|c| c.fn_local == local).map(|c| (c.node, c.parent, c.kind)).collect()
}

#[test]
fn imports_split_repo_files_from_packages() {
    let f = extract(
        "engine/main.bend",
        "import Base\nimport ./Facts.bend as F\nimport ../Graph.bend as G   # the SCC\nimport 0xabc/main.bend as P\n",
    );
    let t: Vec<(&Target, Option<&str>)> = f.imports.iter().map(|i| (&i.target, i.alias.as_deref())).collect();
    assert_eq!(
        t,
        vec![
            (&Target::Package("Base".into()), None),
            (&Target::Relative("./Facts.bend".into()), Some("F")),
            (&Target::Relative("../Graph.bend".into()), Some("G")),
            (&Target::Package("0xabc/main.bend".into()), Some("P")),
        ]
    );
    let exists = |p: &str| p == "engine/Facts.bend" || p == "Graph.bend";
    assert_eq!(resolve("engine/main.bend", &f.imports[1], &exists), Ok("engine/Facts.bend".into()));
    assert_eq!(resolve("engine/main.bend", &f.imports[2], &exists), Ok("Graph.bend".into()));
    assert_eq!(resolve("engine/main.bend", &f.imports[0], &exists), Err(0));
    let missing = Import { target: Target::Relative("./Nope.bend".into()), alias: None, line: 1 };
    assert_eq!(resolve("engine/main.bend", &missing, &exists), Err(1));
    let above = Import { target: Target::Relative("../../x.bend".into()), alias: None, line: 1 };
    assert_eq!(resolve("engine/main.bend", &above, &exists), Err(1));
}

#[test]
fn match_is_a_multi_branch_with_one_arm_per_case_and_recursion_is_no_loop() {
    let src = "\
import Base

# sum a list
def sum(xs: List<U32>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      sum(t, (acc + h : U32))
";
    let f = extract("a.bend", src);
    assert_eq!(f.fns.fns.len(), 1);
    let d = &f.fns.fns[0];
    assert_eq!((d.start_line, d.end_line, d.loc, d.kind, d.parent), (4, 9, 6, fk::DECL, None));
    assert_eq!(d.chain, "sum");
    assert_eq!(ct_rows(&f, 0), vec![(1, 0, ct::MULTI), (2, 1, ct::ARM), (3, 1, ct::ARM)]);
    assert!(f.is_code());
}

#[test]
fn nested_match_wildcard_flag_and_short_circuit() {
    let src = "\
def f(a: Bool, b: Bool, n: Nat) -> Bool:
  match n:
    case 0n:
      match a:
        case True{}:
          b && a
        case _:
          False{}
    case p:
      a || b || a
";
    let f = extract("a.bend", src);
    assert_eq!(
        ct_rows(&f, 0),
        vec![
            (1, 0, ct::MULTI),
            (2, 1, ct::ARM),
            (3, 2, ct::MULTI),
            (4, 3, ct::ARM),
            (5, 4, ct::SHORT_CIRCUIT),
            (6, 3, ct::DEFAULT_FLAG),
            (7, 3, ct::ARM),
            (8, 1, ct::DEFAULT_FLAG),
            (9, 1, ct::ARM),
            (10, 9, ct::SHORT_CIRCUIT),
            (11, 9, ct::SHORT_CIRCUIT),
        ]
    );
}

#[test]
fn constructor_and_literal_patterns_are_not_defaults() {
    let f = extract("a.bend", "def f(x: Nat) -> Nat:\n  match x:\n    case 1n+p:\n      p\n    case 0n:\n      0n\n");
    assert!(!ct_rows(&f, 0).iter().any(|r| r.2 == ct::DEFAULT_FLAG));
}

#[test]
fn lambdas_are_nested_functions_named_by_ordinal() {
    let src = "\
def Main.files(xs: List<String>) -> List<String>:
  ys = List.filter(~String, ~(+p => Main.is_ts(p)), xs)
  List.map(~String, ~(q => (r => r && q)), ys)
";
    let f = extract("main.bend", src);
    let chains: Vec<(&str, Option<u32>, u8)> = f.fns.fns.iter().map(|x| (x.chain.as_str(), x.parent, x.kind)).collect();
    assert_eq!(
        chains,
        vec![
            ("Main.files", None, fk::DECL),
            ("Main.files>#0", Some(0), fk::ARROW),
            ("Main.files>#1", Some(0), fk::ARROW),
            ("Main.files>#1>#0", Some(2), fk::ARROW),
        ]
    );
    assert_eq!(ct_rows(&f, 0), vec![(1, 0, ct::NESTED_FN), (2, 0, ct::NESTED_FN)]);
    assert_eq!(ct_rows(&f, 2), vec![(1, 0, ct::NESTED_FN)]);
    assert_eq!(ct_rows(&f, 3), vec![(1, 0, ct::SHORT_CIRCUIT)]);
    // Keys: path, containers (0x1f-joined), own name, kind byte, ordinal.
    assert_eq!(f.fns.fns[0].key, fnv_parts(&[b"main.bend", b"", b"Main.files", &[fk::DECL], b"0"]));
    assert_eq!(f.fns.fns[3].key, fnv_parts(&[b"main.bend", b"Main.files\x1f#1", b"", &[fk::ARROW], b"0"]));
}

#[test]
fn a_lambda_ending_its_line_owns_the_indented_block() {
    let src = "\
def f(xs: List<Nat>) -> List<Nat>:
  List.map(~Nat, ~g, xs)
  k = x =>
    match x:
      case 0n:
        0n
      case 1n+p:
        p
  k(1n)
";
    let f = extract("a.bend", src);
    assert_eq!(f.fns.fns.len(), 2);
    assert_eq!((f.fns.fns[1].start_line, f.fns.fns[1].end_line), (3, 8));
    assert_eq!(ct_rows(&f, 0), vec![(1, 0, ct::NESTED_FN)]);
    assert_eq!(ct_rows(&f, 1), vec![(1, 0, ct::MULTI), (2, 1, ct::ARM), (3, 1, ct::ARM)]);
}

#[test]
fn signature_lambdas_are_types_not_functions() {
    let f = extract("a.bend", "def Ex(-A: Data, -B: A -> Data) -> Data:\n  Sigma<&2, &2, A, _ => B>\n");
    // The body's `_ => B` is a lambda term; the header's arrows are types.
    assert_eq!(f.fns.fns.len(), 2);
    let g = extract("a.bend", "def T(-A: Data) -> Sigma<&2, &2, A, _ => A>:\n  A\n");
    assert_eq!(g.fns.fns.len(), 1);
}

#[test]
fn markers_unsafe_holes_and_foreign_code() {
    let src = "\
@unsafe def loop(n: U32) -> U32:
  loop(n)

def spin?(n: U32) -> U32:
  spin?(n)

def lemma(x: Nat) -> {x == x : Nat}:
  match x:
    case 0n:
      ?TODO
    case 1n+p:
      ?goal

def e(x: U32) -> IO(U32):
  import \"./e.c\"
  import \"./e.js\"

def ok(s: String) -> String:
  \"# not a comment ?TODO\" ++ s
";
    let f = extract("a.bend", src);
    let names: Vec<&str> = f.defs.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(names, vec!["loop", "spin", "lemma", "e", "ok"]);
    assert_eq!(
        f.markers,
        vec![(0, mk::UNSAFE, 1), (1, mk::UNSAFE, 1), (2, mk::PROOF_HOLE, 2), (3, mk::FOREIGN, 2)]
    );
    assert!(f.defs[2].spec && !f.defs[0].spec);
}

#[test]
fn laws_name_functions_through_aliases_and_fills_are_found() {
    let code = extract(
        "engine/Facts.bend",
        "import Base\n\ndef Facts.add(x: U32) -> U32:\n  x\n\ndef Facts.kind(x: U32) -> U32:\n  x\n",
    );
    let laws = extract(
        "engine/Facts-LAWS.bend",
        "\
import Base
import ./Facts.bend as F

def Helper(-A: Data) -> Data:
  A

law add_is_id:
  for x: U32
  {F.Facts.add(x) == x : U32}

law kind_open:
  for x: U32
  for h: {F.Facts.kind(x) == F.Missing.fn(x) : U32}
  {Helper(U32) == U32 : Data}
",
    );
    let proof = extract(
        "engine/Facts-PROOF.bend",
        "import Base\nimport ./Facts-LAWS.bend as Laws\n\ndef Laws.add_is_id(x):\n  {==}\n",
    );
    assert!(code.is_code() && !laws.is_code() && !proof.is_code());
    let files = vec![
        ("engine/Facts-LAWS.bend".to_string(), laws),
        ("engine/Facts-PROOF.bend".to_string(), proof),
        ("engine/Facts.bend".to_string(), code),
    ];
    let linked = link_laws(&files);
    assert_eq!(
        linked,
        vec![
            LinkedLaw { file: 0, name: "add_is_id".into(), line: 7, fns: vec![(2, 0)], filled: true },
            LinkedLaw { file: 0, name: "kind_open".into(), line: 11, fns: vec![(0, 0), (2, 1)], filled: false },
        ]
    );
}

#[test]
fn a_fill_beside_the_law_counts() {
    let f = extract("LAWS.bend", "law add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  {==}\n");
    let linked = link_laws(&[("LAWS.bend".to_string(), f)]);
    assert!(linked[0].filled);
    assert!(linked[0].fns.is_empty(), "Nat.add is Base, not a repo function");
}

/// Every control tree satisfies the engine's validity rule (FACTS.md `CT`): ids `1..k` in
/// order, parent smaller than child, kinds 1-10, and no child under a leaf kind (6-9).
fn assert_valid_trees(path: &str, f: &BendFile) {
    for local in 0..f.fns.fns.len() as u32 {
        let rows = ct_rows(f, local);
        for (i, &(node, parent, kind)) in rows.iter().enumerate() {
            assert_eq!(node, i as u32 + 1, "{path} fn {local}: ids not 1..k");
            assert!(parent < node, "{path} fn {local}: parent {parent} >= node {node}");
            assert!((1..=10).contains(&kind), "{path} fn {local}: kind {kind}");
            if parent > 0 {
                let pk = rows[parent as usize - 1].2;
                assert!(!(6..=9).contains(&pk), "{path} fn {local}: child of leaf kind {pk}");
            }
        }
        // The k-th nested-function leaf pairs with the k-th child function.
        let leaves = rows.iter().filter(|r| r.2 == ct::NESTED_FN).count();
        let kids = f.fns.fns.iter().filter(|x| x.parent == Some(local)).count();
        assert_eq!(leaves, kids, "{path} fn {local}: {leaves} nested leaves, {kids} child fns");
    }
}

/// `PULSAR_BEND_CORPUS=<dir> cargo test corpus -- --ignored --nocapture`: extract every `.bend`
/// file under `<dir>` (recursively), check the trees, and print one line per file.
#[test]
#[ignore]
fn corpus() {
    let root = std::path::PathBuf::from(std::env::var("PULSAR_BEND_CORPUS").expect("PULSAR_BEND_CORPUS"));
    let mut paths: Vec<String> = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "bend") {
                paths.push(p.strip_prefix(&root).unwrap().to_string_lossy().into_owned());
            }
        }
    }
    paths.sort();
    let files: Vec<(String, BendFile)> =
        paths.iter().map(|p| (p.clone(), extract(p, &std::fs::read_to_string(root.join(p)).unwrap()))).collect();
    let (mut fns, mut cts) = (0, 0);
    for (p, f) in &files {
        assert_valid_trees(p, f);
        fns += f.fns.fns.len();
        cts += f.fns.ct.len();
        let exists = |q: &str| paths.iter().any(|x| x == q);
        let unresolved: Vec<&Import> =
            f.imports.iter().filter(|i| matches!(resolve(p, i, &exists), Err(1))).collect();
        println!(
            "{p}: code={} imports={} unresolved={} defs={} lambdas={} ct={} laws={} markers={:?}",
            f.is_code(),
            f.imports.len(),
            unresolved.len(),
            f.defs.len(),
            f.fns.fns.len() - f.defs.len(),
            f.fns.ct.len(),
            f.laws.len(),
            f.markers
        );
    }
    let laws = link_laws(&files);
    let filled = laws.iter().filter(|l| l.filled).count();
    let named = laws.iter().filter(|l| !l.fns.is_empty()).count();
    println!("TOTAL files={} fns={fns} ct={cts} laws={} filled={filled} naming_a_repo_fn={named}", files.len(), laws.len());
}
