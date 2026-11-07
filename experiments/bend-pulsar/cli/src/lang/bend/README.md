# lang/bend

The Bend 2 adapter. Owner: pulsar-bend. It is a small parser written from `bend guide`, clean room: the guide and the language docs, never Bend's parser source.

- **Why its own parser:** the `bend` CLI has no syntax-tree dump. `-o x.bendtt` writes the elaborated kernel term instead. That term has no source positions, inlines Base (3.3 MB for `Select.bend`), and lowers `match` to eliminators.
- **What it emits, per file** (`extract`):
  - module imports, which become `I`/`U` once the driver assigns file ids;
  - functions and control trees, in the shared `lang::functions` types: `def` is kind 0, a lambda is kind 2, `match`/`case` are 3/2 with a 9 flag, and `&&`/`||` are 6;
  - `MK` markers: 1 for unsafe, 2 for each proof hole, 3 for each foreign import line;
  - laws, with the names in their statements.
- **Across files** (`link_laws`): laws are linked to the defs they name, through import aliases, and to the defs that fill them. The mapping onto FACTS kinds is in `FACTS.md`, under "Per language", "Markers" and "Laws".
- **The driver's side** (`lane.rs`): `owns(path)` is `*.bend`. `analyze(root, files)` returns `I`/`U` over global file ids and per-file `FileOut`s, which the driver numbers like every lane's. `Extra::push_rows(w, &fn_bases(&per))` writes `MK`/`L`/`LW`/`LN` with global `FN` ids, and `Extra::laws_table` is the `.laws` side table.
- **Production and test code:** a file is production when an entry point (a non-test file defining `main`) reaches it through imports, which is the `prod` flag cycles use. Every function in a `*-LAWS`, `*-PROOF`, `*-CHECK` or `*-TEST` file, or under `fixtures/`, is a test function (`TF`), so the metric rules skip it. A proof is checked by the kernel; its size is not a code-health finding.
- **Known limit:** a lambda whose statement block is written inside brackets is read as tokens, so a `match` in it is not a control node. Indented lambda blocks are handled.

## Evidence

On `experiments/bend-pulsar` (34 `.bend` files outside `scratch/`), `PULSAR_BEND_CORPUS=<dir> cargo test corpus -- --ignored --nocapture` reports:
- 1,333 functions and 3,562 `CT` rows. Every tree passes the engine's validity rule, and each nested-function leaf pairs with a child function.
- Every relative import resolves.
- 95 laws, all filled, which matches `bend PROOF.bend --verdict` passing. 91 of them name a repo def; the other 4 are laws about Base functions only (`Lemmas.bend`).
- 0 markers, which matches a gate that forbids `@unsafe` and `?TODO`. The unit tests cover each marker class.
