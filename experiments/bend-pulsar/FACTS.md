# Fact format v0

This file is the contract between the Rust CLI (the adapter) and the Bend engine. The engine never sees text: every value is a decimal U32. The CLI keeps a side table from ids to strings and uses it to render findings. Design notes: `research/fact-stores.md` and `research/fact-extraction.md`.

## Rules

- **Lines:** one fact per line, with fields separated by single spaces. The first token is the relation tag, and every following field is a decimal U32. Lines starting with `#` are comments, and the engine ignores them.
- **File ids:** `0..n-1`, assigned in byte-wise sorted order of repo-relative path, so ids are deterministic for a given file set.
- **Sorting:** every relation is emitted sorted by its fields, left to right, with duplicates removed. Canonical order makes the facts diffable and makes the output deterministic.
- **Decisions live in the engine.** The adapter reports what the syntax says: binding flags and statement form. Whether an import is a graph edge, a cycle member or a finding is decided by proven rules in the engine. The adapter must not pre-filter anything those rules decide.
- **Stable keys:** each file has a 64-bit stable key: two U32 halves of a hash of its repo-relative path. Later entities (functions, symbols) key on path, container chain, name, kind and ordinal, never on line or column. The engine never computes or compares keys; it reports entity ids. The CLI maps ids to keys for deltas.

## Header

```
pulsar-facts 0
N <file_count>
```

`N` comes before any relation that refers to file ids.

## Relations v0 (enough for import-graph detectors)

| Tag | Fields | Meaning |
|---|---|---|
| `F` | `file prod` | File `file`. `prod` is 1 if it is production code under repo scope, else 0. The adapter decides scope from `.pulsar` scope config and its defaults. |
| `K` | `file hi lo` | Stable key of file `file` |
| `I` | `src dst form hv ht` | An import-like statement in `src` that resolves to repo file `dst` |
| `U` | `src reason` | An import-like statement in `src` that resolves to no repo file |

**`I` fields:**
- `form`: 0 = `import ... from`, 1 = `import "x"` (side effect), 2 = `export ... from` / `export * from`. Dynamic `import()` and `require()` are not `I` facts in v0.
- `hv`: 1 if the statement brings in at least one binding used in a value position (the adapter's semantic analysis decides use, as with Pulsar's usage-based elision). A bare side-effect import or `export *` has `hv = 1`.
- `ht`: 1 if the statement has at least one type-only binding, or a binding used only in type positions.
- An `import type` / `export type` statement is emitted with `hv = 0` and `ht = 1`. An empty clause such as `import {} from "x"` is emitted with `hv = 0` and `ht = 0`.
- The engine's proven rule (`Extract.value_kind`, laws A to C) decides whether the statement is an edge. Self-edge handling follows laws D and E.

**`U` reasons:** 0 = bare package, 1 = relative path with no target file, 2 = alias that did not resolve, 3 = dynamic or unresolvable form.

## Side tables

Strings the engine never sees. The CLI writes them next to the facts file (`<facts>.paths`, `<facts>.fns`) when `-o` is given. Every lane gets them from `SideTables` in `cli/src/facts.rs`, and facts come only from `FactWriter` in the same file, which sorts and dedups every relation.

- **`.paths`:** one repo-relative path per line, in file-id order.
- **`.syms`:** one symbol name per line, in `SY` id order, so line N (0-based) is symbol N. Written only when there are symbols.
- **`.fns`:** one line per function, in function-id order, so line N (0-based) is function N. Fields are separated by a single TAB, because paths may contain spaces: `fn path start_line end_line parent kind chain`.
  - `fn`: the numeric `FN` id.
  - `path`: repo-relative, equal to the `.paths` line for the function's file.
  - `start_line`, `end_line`: 1-based, inclusive, the whole function span.
  - `parent`: enclosing function id, or `-` at top level.
  - `kind`: the `FK` kind number (0-7).
  - `chain`: container names outermost first, ending with the function itself, joined by `>`. Anonymous functions are `#<ordinal within parent>`. Never empty.
  - To assign a line to a function, take the function in the same file with the largest `start_line` whose span contains the line. A nested arrow that starts on its parent's line owns that line.
- **`.laws`:** one line per law, in law-id order: `law path line name`, TAB-separated (see "Laws").
- **`.deployables`:** one line per `ID` id, TAB-separated: `id path line name`. `path` and `line` are the declaration the lane read (line 0 when the dialect has no position); `name` is what findings call the deployable. Written only when the infra lane found a deployable.
- **`.bindings`:** one binding name per line, in `IB`/`IU` id order, so line N (0-based) is binding N. Written only when there is a declared or read binding.
- **`.effect`:** written when the Effect pack found services, layers or roots. It names them for finding subjects, TAB-separated: `S svc path line name` for each service in `SV` id order, then `L layer path line name` for each layer in id order. `name` is the binding and tag string for a repo service (`Users (app/Users)`), the catalog symbol for a catalog service or layer, the name bound to a repo layer (`MailerLive`, `Users.layer`; `-` when the expression is unnamed), or the unresolved name for an opaque one. `path` is `-` and `line` 0 for catalog entries; `line` is 0 for an unresolved name.

## Engine output (v0, one stream)

```
pulsar-findings 0
CYC <size> <file> <file> ...     one cycle, members ascending; cycles ordered by smallest member
CERT <0|1>                       1 when the completeness and partition certificates passed
S <files> <edges> <cycles>
FM <fn> <cyclomatic> <nesting> <npath> <length> <cognitive>   every function, function-id order
FX <rule-id> <fn> <value> <threshold> [<evidence>...]   one finding: value strictly over threshold
```

`FM` and `FX` come from `engine/Metrics.bend`; the fifth `FM` measure, cognitive, from
`engine/Cognitive.bend` over the same tree (Cognitive-LAWS `cog_fms_aligned`). `FX` lines follow all `FM` lines,
grouped by function, with rules in the order cyclomatic, nesting, npath, length.
Rule ids and default thresholds: `core.cyclomatic` 10, `core.nesting` 3,
`core.npath` 200, `core.length` 60 (`research/thresholds.md`, `Metrics.defaults()`).
A decision for cyclomatic, and a short-circuit for NPath, is any `CT` kind-6 node: `&&`, `||`, `??`,
their assignment forms, optional chaining `?.` (CO op 7) and default values (CO op 8: parameter and
destructuring defaults, as ESLint counts `AssignmentPattern`). That made `core.cyclomatic` rule version 2
(`?.`) and now version 3 (defaults); cognitive counts neither.
`core.npath` is rule version 2 and 3 for the same reasons. The CLI keys all three changed rules (cyclomatic,
npath, length) as v2 or later; delta matches v1 base findings to them and reports `rule_version_changed`.
`core.length` (rule version 2) has two tiers. A body is linear when its cyclomatic is at most 2
and its nesting at most 1, and structured otherwise. A structured body is flagged above the `Rules`
length threshold (60), a linear one above 300. The `FX core.length` line ends with `shape=structured`
or `shape=linear`, and its threshold is the tier's. Metrics-LAWS F1, F5 and F5' prove that core.length
fires exactly when length > (linear ? 300 : 60). `FM` keeps the raw length.
Thresholds are an explicit `Rules` argument. Every value is a decimal natural number. NPath
saturates at the cap 16777215 (2^24 - 1): a printed NPath equal to the cap means
"at least the cap". The laws prove that printed NPath = min(Nejmeh NPath, cap).
A function with a `TF` row still gets its `FM` line, but no `FX`. Invalid FN/CT/TF facts
make the engine refuse the run and print no `FM` lines. Invalid means a wrong field count,
a tree the CT rules reject, or a `TF` id that is not a function, or is out of order.

**Cognitive complexity** (`engine/Cognitive.bend`, rule `core.cognitive`, default 15, strictly greater).
It follows the SonarSource white paper (G. Ann Campbell) from `CT` and `CO`:
- +1 + level for a branch, a multi-branch (once, whatever its arms), a loop and each catch;
- +1 and no level for an `else if`;
- +1 per run of the same `&&` or `||` among sibling short-circuits.

The level rises inside an arm, a loop and a catch; a try body and a finally keep it.
Where `CT` cannot tell what the paper needs, the count leans low, so it never exceeds the
paper's count:
- `else` adds nothing (CT cannot tell `if/else` from a ternary);
- `??`, the assignment operators, optional chaining `?.`, default values, recursion and labelled jumps add nothing
  (the paper scores none of them; Cognitive-LAWS `cog_unscored_op_free`);
- a nested function counts in its own tree;
- a missing `CO` row reads as an operator that adds nothing.

A `CO` row that names no kind-6 node, or is out of order, refuses the run. The evidence is
weak (`research/cognitive-complexity.md`), so the CLI shows the rule only when `.pulsar/policy.toml`
enables it. `Cognitive-LAWS.bend` proves the increments above for the shipped `Cog.seq`, and that
findings are sound and complete. Its `FX` lines follow the Metrics ones:
`FX core.cognitive <fn> <cognitive> <thr>`.

**CRAP and composites** (`engine/Crap.bend`, `engine/Hotspot.bend`, wired in `engine/MetricsIn.bend`).
After the Metrics and cognitive `FX` lines come the `core.crap` findings, then `core.hotspot`, then `core.risky-change`,
each in function-id order. Each line carries an evidence tail of `key=value` tokens that names its input
facts. A reader that takes the first four fields only stays correct.

```
FX core.crap <fn> <crap> <thr> cyclomatic=<c> covered=<covered> coverable=<coverable> cause=<complexity-only|coverage>
FX core.hotspot <fn> <churn> <thr> churn=CFN <base-rule>=<value>/<thr> ...
FX core.risky-change <fn> <churn> <thr> churn=CFN core.crap=<crap>/<thr>
```

- `core.crap` (default 30): `floor(c² × (coverable − covered)³ / coverable³) + c`, exact in integers.
  A function with no `CV` row, or `coverable` 0 or over 32768, has no data and no finding. That is
  different from 0% coverage (`covered` 0, CRAP = c² + c). `covered > coverable`, a `CV` row without
  3 fields, or a `CV` id that is not a function in id order refuses the run.
  `cause` says which term drives the score: `complexity-only` when the coverage term is at most c,
  exactly `c × u³ ≤ coverable³` in integers with `u = coverable − covered`, and `coverage` otherwise.
  There are only these two values, and a function without coverage data has no line and so no cause
  (Crap-LAWS C1-C5). Delta lists complexity-only CRAP under the function's cyclomatic finding, not
  on the test-priority list.
- `core.hotspot` (churn default 2, so at least 3 commits): a `core.cyclomatic`, `core.nesting` or `core.npath`
  finding AND churn over the threshold. `core.length` is not a base.
- `core.risky-change` (same threshold): a `core.crap` finding AND churn over the threshold.
- Churn of a function: the number of `CFN` rows for it with `touched > 0` whose commit's author is not a
  bot (`A` bot 0), in the window of `H`.
- Test functions (`TF`) get none of these: their base findings are already skipped.

`Crap-LAWS.bend` proves that the term is floor division, that more coverage never raises CRAP, that
CRAP is at least c and equals c at full coverage, and that findings are sound and complete.
`Hotspot-LAWS.bend` proves that every composite has churn over the threshold and an accepted base
finding for the same function, and the converse. `MetricsIn-LAWS.bend` ties the output to both. The `CV`
join and the evidence tail are unproven, like the decoders, and are checked by hand in
`*-CHECK.bend`. The churn count is proven: `Churn-LAWS.bend` CH1-CH2 say each reported count is
the number of counted `CFN` rows, and every counted function is reported.

**Pack sections.** After the Metrics lines, `pulsar-engine` prints one section per active pack, in this order. A pack is active when its facts are present, and the CLI writes them only for packs that are on.
- **Effect layer graph** (an `E` row is present): `pulsar-layers 0`, then the `LCYC` … `LS` lines of "Effect pack" below.
- **Class-in-context** (an `RL` row is present): `pulsar-classctx 0`, then `RCX rule site fn callee`, one per (rule, site), sorted, then `RCXS n`.
- **SQL** (an `SR` row is present): `pulsar-sql 0`, see "SQL rules" below.
- **Fan-out** (an `RF` row is present): `pulsar-fanout 0`, see "Fan-out rules" below.
- **Constant argument** (an `RK` row is present): `pulsar-konst 0`, see "Constant-argument rules" below.
- **Hot path** (an `RH` row is present): `pulsar-hot 0`, see "Hot-path composites" below.
- **Unbounded growth** (an `RG` row is present): `pulsar-grow 0`, the `SQD` schema line, then `GX` lines and `GXS n`; see "Unbounded growth".
- **Delta** (a `KD` row is present): `pulsar-delta 0`, see "Delta" below.
- **History** (an `HR` row is present): `pulsar-history 0`, then:
  - `CHF file k`, one per production file with churn: k counted `CF` rows (human commit, production file);
  - `CHX k nf top total ws...` (history.churn-concentration): the k files ws, at most `top`% of the nf churned files, hold `top` of the `total` counted rows, and that is at least `share`%;
  - `CHP a b sup na nb ws...` (history.co-change), with a < b: files a and b changed together in the sup human, non-bulk commits ws, where sup >= `sup` and 100·sup >= `conf`·min(na, nb), na and nb being each file's mined rows; no import edge joins them in either direction;
  - then `CHS nfiles ncx ncp sup conf bulk top share`.

  The searches are untrusted, and each finding is kept only when a checker accepts it. History-LAWS.bend F1, X1 and C1-C4 state what a kept finding means, and E1-E3 cover the entry point and the lines. LAWS.bend P17-P18 state the switch.

If any detector refuses its facts (the graph, Metrics, or an active pack), the engine exits 2 with nothing on stdout. engine/LAWS.bend P5-P14 state the order and the switches; `engine/fixtures/packs.expected` shows all four sections.

**Rows the engine reads.** Besides the graph facts read by `Parse.bend`, `pulsar-engine` keeps only rows with these tags and skips every other line unread. engine/LAWS.bend P15 pins the list. Each tag is its ASCII letters packed big-endian, as `Rows.bend` reads them:

| Tags | Read by |
|---|---|
| `FN` 17998, `CT` 17236, `TF` 21574 | MetricsIn |
| `E` 69, `SV` 21334, `LY` 19545, `LQ` 19537, `LP` 19536, `LR` 19538, `LC` 19523, `LO` 19535, `US` 21843 | Layers |
| `CS` 17235, `CL` 17228, `RL` 21068 | ClassCtx |
| `CV` 17238 | Crap |
| `A` 65, `C` 67, `CFN` 4408910 | Churn |
| `CO` 17231 | Cognitive |
| `H` 72, `C` 67, `A` 65, `CF` 17222, `HR` 18514 | History |
| `DS` 17491, `DT` 17492, `DC` 17475, `DI` 17481, `DX` 17496, `DF` 17478, `DG` 17479, `QS` 20819, `QT` 20820, `QU` 20821, `QD` 20804, `SR` 21330 | SqlIn (SQL rules) |
| `CE` 17221, `RF` 21062 (with `CS`, `CL`) | FanoutIn |
| `AL` 16716, `RK` 21067 (with `CS`, `CL`) | KonstIn |
| `EP` 17744, `RH` 21064 (with `CE`, `QS`, and the SQL, fan-out and constant-argument rows) | HotIn |
| `RU` 21077 (with `QS`, `FN`, `CT`, `TF`, `CV`) | MetricsIn (Untested) |
| `RG` 21063 (with the schema rows, `QS`, `QT`, `QU`, `EP`, `CE`) | GrowIn |
| `KD` 19268, `KB` 19266, `KH` 19272, `MB` 19778, `MH` 19784 | Delta |

A new relation reaches a detector only once its tag is added here and to `Engine.row_tags`, in the same commit.

The CLI renders file ids to paths, maps them to stable keys, and prints the human and JSON forms.

### Delta

After evaluating both shas, `pulsar delta` runs the engine twice more, each time on a file holding an empty graph and the two shas' finding keys. The engine decides what is printed (`engine/Delta.bend`). The first run has the raw keys, and its added, allowed and removed lines are the only candidates for git's rename matching (and for the rule-version matching, which uses the same identity). The second run writes each matched base finding under its head key, adds the `MB`/`MH` rows, and is where everything `pulsar delta` prints comes from. The CLI keeps the matching, the choice of trend functions, the grouping of `KDW`/`KDI` rows into one trend line per function (worsened if any measure rose), degraded notices and rendering.

| Tag | Fields | Meaning |
|---|---|---|
| `KD` | `0` | The switch. Exactly one; without it there is no delta section. |
| `KB` | `hi lo` | A base finding key, its 64 bits as two U32s. A base finding that git's rename matching pairs with a head finding is written with the head key. |
| `KH` | `hi lo cls` | A head finding key. `cls` 0 is plain, 1 needs coverage (listed apart, never added), and 2 is plain and allowed by a decision committed at head. |
| `MB` | `hi lo m v` | Measure `m` of function key (hi lo) at base, rename-mapped like `KB`. `m`: 0 cyclomatic, 1 nesting, 2 npath, 3 length, 4 cognitive. Higher `v` is worse for every `m`. Only the functions the CLI reports trends for (all of them with `--trend`), five rows each. A value above U32 refuses the run. |
| `MH` | `hi lo m v` | The same at head. |

A key is (hi, lo, m), with m = 0 for `KB` and `KH`. A key repeated within `KB`, `KH`, `MB` or `MH`, a `cls` above 2, or a wrong field count refuses the run.

Output (`pulsar-delta 0`), each kind in key order:
- `KDA hi lo`: added, a plain head key with no base row;
- `KDL hi lo`: allowed, the same with `cls` 2;
- `KDC hi lo`: every head key with `cls` 1;
- `KDR hi lo`: removed, a base key with no head row;
- `KDW hi lo m vb vh` and `KDI hi lo m vb vh`: worsened (vh > vb) and improved (vh < vb), base and head rows with the same key;
- `KDS added allowed coverage removed unchanged worsened improved`, where unchanged counts head keys with `cls` other than 1 that are also in base.

Each side is sorted by an untrusted merge sort, which is proven to keep exactly its rows. The sorted side is checked strictly ascending at run time, and the two sides are compared in one walk. `engine/Delta-LAWS.bend` D1-D6 prove every line sound, and C1-C6 prove every line that should be printed is. Completeness is relative to the run's certificate: both sides strictly ascending and the walk not out of fuel. The engine refuses the run when the certificate fails, so it holds whenever a delta prints. Not proven: decoding the rows, the number formatting, and the meaning of `unchanged` beyond its definition.

## Relations v1 (draft, first cut)

This draft supports the first-cut detectors in `PLAN.md`: complexity, NPath, churn, hotspots, CRAP and the Effect pack. Seats may refine the encoding. Any change to tags or fields is made here first, in the same commit as the code.

Function ids are `0..m-1`, in the order (file id, start offset). Ids are per run. Identity across shas comes from `FK`.

### Functions and control structure (TS, Rust, Bend)

| Tag | Fields | Meaning |
|---|---|---|
| `M` | `fn_count` | Header line, before any function relation |
| `FN` | `fn file parent loc` | A function, method, closure or arrow function. `parent` is the enclosing function, or `4294967295` at top level. `loc` is the number of non-blank lines in its span, nested functions included (only `CT` excludes them). A TS file's module body (`FK` kind 8) is one more row, the last of its file: code outside any function, with `loc` 0, no `CT` and no `.fns` span. |
| `FK` | `fn hi lo` | Stable key: a 64-bit hash of path, container chain, name, kind and ordinal, never a line. See "`FK` key and kinds". |
| `CT` | `fn node parent kind` | One node of the function's control tree. `node` ids are exactly `1..k` per function, in preorder, so sibling order is id order; `parent = 0` is the function body, and a parent id is always smaller than its child's. Sorted by `(fn, node)`. |
| `CO` | `fn node op` | The operator of a kind-6 (short-circuit) `CT` node: 1 `&&`, 2 `\|\|`, 3 `??`, 4 `&&=`, 5 `\|\|=`, 6 `??=`, 7 `?.` (an optional member, call or element access: one node per `?.`, like `??` a short-circuit), 8 a default value (one node per parameter default `x = 1`, binding-pattern default `{ a = 1 }` or `[a = 1]`, or destructuring-assignment default; TS lane only). One row per kind-6 node, sorted by `(fn, node)`, written after `CT`. Rust emits 1 and 2 only. Cognitive complexity uses it: a run of the same operator counts once. |
| `TF` | `fn` | Function `fn` is test code. Rust: an item under `#[cfg(test)]` (also `cfg(all(test, ..))`, not under `not(..)`), a function with `#[test]`, `#[tokio::test]` or any attribute ending in `test`, `#[rstest]`, `#[test_case]` or `#[bench]`, and every function in a file reachable only through `#[cfg(test)] mod x;`. TS: a function in a test file (`.test.*`, `.spec.*`, `__tests__/`, `tests/`). Absence means production code. Detectors for complexity, size, NPath, CRAP and hotspots skip a function that has a `TF` row. One row per test function, none for a repo without tests. Sorted by `fn`. |

**`FK` key and kinds.**
- **Kind** (hashed, and the `kind` column of `.fns`): 0 = declaration, 1 = function expression (`function` keyword, named or not), 2 = arrow function or closure (TS arrow, Rust closure), 3 = method, 4 = getter, 5 = setter, 6 = constructor, 7 = static block, 8 = module body (TS only: the pseudo-function that owns call sites outside any function, one per file that has such a site, appended after the file's real functions; its key hashes an empty name and ordinal 0, and its `.fns` chain is `<module>`).
- **Key** = FNV-1a 64 (the `K` constants) over these parts, each followed by a zero byte: the repo-relative path; the container names outermost first, joined by `0x1f`; the function's own name (empty if anonymous); the kind byte; the ordinal in decimal. The `FK` row is the key's high and low U32 halves.
- **Ordinal:** for a named function, its index among functions with the same (container chain, name, kind) in source order. For an anonymous one, its index among the anonymous functions of the same container chain.
- **Containers:** classes, object literals bound to a name, and the enclosing functions, each by the name it has in its own chain.
- **Names are syntactic and never depend on a pack,** so keys do not change when a pack switches on. A function is named by its own id; by `const x = <fn>`; by a property, method or class-field key; by its class (constructor); by `default` for `export default`; and the first function-valued argument of a call that is itself a declarator initialiser, property value or class-field value takes that name (`memo(fn)`, `Effect.fn("n")(function* () {})`). Otherwise it is anonymous and shown as `#<ordinal>` in `.fns`.
- A function with no body (an overload signature, `declare function`) emits nothing.

**`CT` kinds**, all language-neutral. The adapter reports syntax; the engine decides what counts.
- 1 = branch (`if`, `if let`, ternary). Its children are arms. `else if` is an else arm containing a nested branch.
- 2 = arm, one alternative body. A branch with no else arm gets an implicit empty one, added by the engine, not the adapter.
- 3 = multi-branch (`switch`, `match`). One arm per case, empty fall-through cases included. The adapter emits a flag child, kind 9, when there is a default or wildcard arm; the default arm is also emitted.
- 4 = loop (`for`, `while`, `do`, `for of/in`, `loop`, iterator chains are not loops). Its children are the nodes of its condition and body directly, with no arm.
- 5 = try. Its children are arms: the body and each catch are kind 2, and a finally is kind 10.
- 6 = short-circuit operator: one node per `&&`, `||`, `??`, `&&=`, `||=` or `??=` occurrence, wherever it appears in the function. Its parent is the innermost enclosing control node (for a condition: the branch, loop or multi-branch it guards). The operator itself is not encoded.
- 7 = early exit that is not the last statement (`return`, `break`, `continue`, `throw`, Rust `?`). The final top-level `return` or `throw` of a function body, and a `break` that ends a switch case, are not emitted.
- 8 = nested function boundary: a leaf in the parent's tree. The k-th kind-8 node of a function pairs with the k-th function whose `parent` it is, in source order. The nested function has its own tree, starting again at node 1.
- 9 = default or wildcard flag, a leaf child of a multi-branch.
- 10 = finally arm, a body that runs on every path.

The engine rejects a tree whose ids are not `1..k` in order, whose parent is not smaller than its child, whose kind is outside 1 to 10, or whose parent has kind 6, 7, 8 or 9.

The engine computes cyclomatic complexity, cognitive-style nesting, NPath (Nejmeh 1988) and size from the control tree. Its rules state which kinds count. Every threshold sits in the rule, with a rule id.

**Per language** (what each adapter maps onto these kinds):
- **Rust** (`cli/src/lang/rust/`): `fn` items are kind 0 (async, const, unsafe and generic alike), methods in `impl` and `trait` blocks are kind 3, closures are kind 2. A trait method with no body emits nothing. A function's span runs from its signature (visibility and qualifiers included, attributes excluded) to its closing brace; a closure's from its first `|` to the end of its body. Containers are inline modules, traits, impl blocks and enclosing functions. An impl block is named `Type` (the last path segment, no generics) or `Type as Trait` (the trait's last segment with its type arguments, so `From<A>` and `From<B>` do not collide); the file path already names file modules. `if` and `if let` are branches (1) with a then arm and, when present, an else arm; `else if` is a branch inside the else arm; `let .. else` is a branch with one arm, the else block. `match` is a multi-branch (3) with one arm per clause, and a flag (9) after the first unguarded `_` or lowercase binding clause. A guard adds no node; its `&&` and `||` are kind 6 children of the arm. `while`, `for` and `loop` are kind 4 with no arm. Every `?` is kind 7, wherever it sits; `return`, `break` and `continue` are kind 7 except a `return` that ends a function body. Async blocks are not function boundaries. Code inside macro invocations (`assert!`, `matches!`, `select!`) is a token stream and emits nothing. `I` and `U`: see "Rust module graph". The `F` prod flag: a Rust file is not production code when a path segment is `tests`, `test`, `benches`, `examples`, `fixtures` or `testdata`, when it is named `build.rs`, or when it is reachable only through `#[cfg(test)] mod x;`. A repo's `.pulsar/policy.toml` lane globs override this.
- **Bend** (`cli/src/lang/bend/`): `def` is kind 0 and a lambda `x => e` is kind 2. A law is a claim, not a function. `match` is a multi-branch (3) with one arm (2) per `case`, and a flag (9) when every pattern of a case is `_` or a plain binder. `&&` and `||` are short-circuit nodes (6). Bend has no `if` (a `match` on `True{}`/`False{}` stands in for it), no loops, and no early exits. Recursion is a call, not a loop. `I` and `U`: `import ./x.bend as M` (a relative path) is an `I` row to that file with `form` 0, `hv` 1 and `ht` 0. Bend has no type-only import. `import Base`, a hash or a hub name is `U` reason 0, and a relative path with no file is `U` reason 1. A foreign `import "x.c"` inside a def is an `MK` class 3 marker, not an import. Bend files have no `TF`: the language has no test functions.

### Rust module graph

One module tree per cargo target (from `cargo metadata --no-deps --offline`, one call per workspace; if cargo fails the conventional `src/lib.rs`, `src/main.rs`, `src/bin/*.rs`, `tests/`, `examples/`, `benches/` layout stands in and the CLI says so on stderr). `mod x;` is followed to `x.rs`, `x/mod.rs` or its `#[path]`; `mod x { }` is a node in the same file. A `mod` declaration is not an `I` edge: it defines the tree.

- A `use` leaf is an `I` row from its file to the file of the deepest module its path names; the rest of the path is an item inside that file. `form` is 0, or 2 for a re-export (`pub use`, `pub(crate) use`, any visibility other than inherited). `hv` is always 1 and `ht` always 0: telling a value use from a type-only use is a type-checker question, so the adapter does not guess.
- A path starts at `crate`, `self`, `super`, a child module in scope, or the lib name of a workspace member. `use` inside `#[cfg(test)]` code is emitted like any other; the engine's file `prod` flag and `TF` separate it.
- `U` reason 0 for `std`, `core`, `alloc`, `proc_macro`, `test` and every declared dependency; reason 1 for a `super` that leaves the crate; reason 3 for a first segment that names nothing in scope.
- Crate edges: a package's lib and bin roots get an `I` row (form 1, `hv` 1, `ht` 0) to the lib root of each workspace member it depends on, for normal and build dependencies; dev-dependencies are skipped because they may legally form cycles.
- A `use` that resolves to the file it sits in (an item of the same file, `use self::x`, `use crate::m::x` inside `m`) is not an import and gets no row.
- Files reachable from no target (for example an unreferenced `.rs`) get `FN` rows but no `I` or `U` rows.

### Markers

| Tag | Fields | Meaning |
|---|---|---|
| `MK` | `fn class count` | Function `fn` contains `count` markers of class `class`, where `count` is at least 1. A function with no marker of a class gets no row for it: there are no zero rows. |

**Classes**, all language-neutral. Each adapter states which syntax maps to which class.
- 1 = unsafe escape. Bend: `@unsafe def` and its sugar `def f?(..)`. Rust: `unsafe` blocks, fns and impls.
- 2 = open proof hole. Bend: each `?name` term, `?TODO` included.
- 3 = foreign code. Bend: each `import "x.c"` / `import "x.js"` line in a def body.
- 4 = lint suppression. Rust: `#[allow(..)]` and `#[expect(..)]`.
- 5 = type suppression. TS: `@ts-ignore` and `@ts-expect-error`.

### Laws (languages with stated laws: Bend)

| Tag | Fields | Meaning |
|---|---|---|
| `L` | `law_count` | Header line, before `LW` and `LN`. Not emitted when a run has no laws. |
| `LW` | `law file filled` | Law `law` is stated in `file`. `filled` is 1 when some def fills it: `def name(..)` beside the law, or `def A.name(..)` in a file that imports the law's file as `A`. Whether the fill is a valid proof is decided by the proof gate, not by facts. |
| `LN` | `law fn` | The statement of `law` names function `fn`: through an import alias (`F.Facts.add`) or by an exact name in the law's own file. Names from packages (Base) give no row. |

(`LN`, not `LR`: `LR root layer` belongs to the Effect pack.) Law ids are `0..l-1`, in the order (file id, line). The side table `.laws` has one line per law, in law-id order: `law path line name`, TAB-separated.

### Git history

| Tag | Fields | Meaning |
|---|---|---|
| `H` | `commit_count author_count` | Header line, for the analysed window. The window (default: 12 months or 2,000 commits) is in `.pulsar/policy.toml`. |
| `C` | `commit author day` | `day` = committer date in days since the Unix epoch. Commit ids are `0..commit_count-1`, oldest first; every commit in the window gets a row, even with no file rows. |
| `A` | `author bot` | `bot` = 1 when the author matches the bot patterns in the catalog. The CLI matches strings and the rule id is reported with the finding. |
| `CF` | `commit file added deleted` | Line counts for a file that still exists at head. Renames are followed. |
| `CFN` | `commit fn touched` | Lines that the commit touched inside head function `fn`. It's matched through `FK` on the commit's version of the file. Functions whose key changed count from the commit that introduced the current key. |
| `VN` | `commit fn loc` | Size of head function `fn` at that commit's version of the file: `loc` non-blank lines, exactly as `FN loc`. One row for every `(commit, fn)` that has a `CFN` row. |
| `VT` | `commit fn node parent kind` | A control-tree node of head function `fn` at that commit, with `CT`'s node, parent and kind numbering (node ids 1..k within each commit+fn). Together with `VN`, this is the per-commit trajectory the growth rule measures. |
| `HR` | `sup conf bulk top share` | The history rules are on, with these numbers. The CLI writes it, from `.pulsar/policy.toml`, only when a history rule is on. It's one row, and conf, top and share are percentages of at most 100. A commit with more than `bulk` `CF` rows is bulk and not mined for co-change. The defaults (research/thresholds.md) are `3 50 100 20 80`. |

**Window.** The date range is anchored to the head commit's committer time, not wall clock, so a sha always yields the same facts. Merges are excluded (`--no-merges`): each commit is one diff. The newest `commit_count` commits inside the range are kept, then emitted oldest first.

**Authors.** Identity is the lowercased email, or the name when the email is empty. Author ids are `0..author_count-1` in first-appearance order over the oldest-first commits, and `bot` is 1 for a name ending in `[bot]` (any case) or a name in the built-in bot list; a repo catalog adds patterns later.

**`CF`.** Only rows with `added + deleted > 0` are emitted, so a pure rename is not churn. The `file` id is the head file's id. Renames are followed by walking the window newest to oldest: the old path inherits the head file of the new path, and a file deleted before head drops out.

**`VN`/`VT`.** These are the trajectory: the function's size and control tree at each commit that touched it, with `fn` the head function id through `FK` and the same head-path key rule as `CFN`. They exist only for `(commit, fn)` pairs with a `CFN` row, so the engine can measure at each step without a second function namespace.

**`CFN`.** `touched` = added lines plus deleted lines charged to the function, and only rows with `touched > 0` are emitted. Added lines are exact post-image line numbers. A deletion has no post-image position, so its lines are charged to the function span containing the hunk's `new_start` (line 1 when `new_start` is 0, the last line when past EOF). The innermost span wins: the greatest `start_line` containing the line, and the smallest span among equals (the same rule as `.fns` line assignment). `FK` is computed with the file's **head** path even when the parsed blob is an older version, so churn follows a rename. A function with no head key gets no row.

### Coverage

| Tag | Fields | Meaning |
|---|---|---|
| `CV` | `fn covered coverable` | Line coverage for one function. The CLI reads the repo's own report: Vitest's `coverage-final.json` (Istanbul format, written by the default `json` reporter with either the v8 or istanbul provider), lcov (`lcov.info`, also from `cargo llvm-cov --lcov`), or Cobertura. A function with no coverage data gets no `CV`. The engine treats "no data" separately from 0%. |

CRAP (Savoia and Evans) is computed in integers: `c² × (coverable − covered)³ / coverable³ + c`, with `c` being cyclomatic complexity. The threshold (default 30) is in the rule. The finding reports `c`, `covered` and `coverable`.

### Symbols, calls and catalogs (mechanism for packs and repo data)

| Tag | Fields | Meaning |
|---|---|---|
| `SY` | `sym` | An external or repo symbol that call sites refer to (for example `effect` `Effect.orDie`). Its name lives in the `.syms` side table: `<module specifier>#<export path>` for an import (`effect#Effect.orDie`, the specifier after the catalog's aliases), `global#<path>` for an undeclared root (`global#console.log`). Ids follow the byte order of the name, so they do not depend on file order. Only symbols a catalog gives a class are emitted. |
| `CL` | `sym class` | Symbol `sym` belongs to catalog class `class`. Classes come from packs and from `.pulsar/catalogs/*.toml`. The CLI matches names to classes, and each class id maps to a catalog rule id in the side table. |
| `CS` | `site fn callee loop_depth ctx` | A call site in function `fn` calling `sym`. `site` ids are one global space shared with `HD`, in (file id, source order). A site outside any function emits nothing, except in a TS file the repo policy scopes (`ctx` bit 8 or 16): there it belongs to the file's module body (`FN` kind 8), `loop_depth` is 0, and only a site some active rule can match is kept (top-level `await`, `main().catch(..)`, `try` and `throw`, for `effect.promise-style-in-effect-scope`). The event can be a call, a tagged template, a `new`, a reference or a property read, per the catalog entry's `via`; a value bound from a catalog symbol (`const sql = yield* S`, a typed parameter `sql: S`) counts as the symbol when used as the entry's `use` says. `loop_depth` is the number of enclosing loop nodes. `ctx` flags (a bit set), inherited by nested functions: 1 = inside an async function, 2 = pack-defined effect context, 4 = inside a test, 8 = the file is in the repo policy's `[packs.effect] effect_only` scope, 16 = the file is in its `boundary` scope, 32 = inside an interop callback, 64 = the call matched a name-only entry (`syntax#method.<name>`): a method call has no receiver type, so it matches by method name alone and a finding says so. Bits 8 and 16 are set only by committed repo policy, as the file's base ctx before its sites are numbered, so every function in the file inherits them. Bit 32, like bit 2, comes from an active pack's wrappers: the Effect pack gives it to the functions passed to `Effect.try`, `tryPromise`, `promise` and `callback` (v3 `async`), directly or as properties of an options object. A wrapper's bits reach a function argument and the function-valued properties of an object-literal argument. **Syntax symbols** (core, generic): a language construct is a site of the pseudo-symbol `syntax#<name>`, emitted only where some active rule of one of its classes could fire, by the `RL` predicate on the site's `ctx`. Constructs are common (tens of thousands of `await` in a large app), and a site no rule can match makes no finding, so dropping it loses none: `await` (an `await` expression or `for await`), `async-fn` (an async function, as a site in the function itself), `throw`, `try`, and `member.then`, `member.catch`, `member.finally` (a call of that method on a value that does not resolve to an imported symbol, so `Effect.catch(...)` is not one). Bit 2 is set by an active pack's data, never by core; the Effect pack sets it inside the functions its catalog lists as wrappers: `Effect.gen` and `Effect.fn` bodies, so a layer constructor written with them, and the `Layer.sync` thunk. `Layer.succeed` takes a value, not a thunk, so it adds no context. |
| `RL` | `rule class ctx_any ctx_none` | Rule `rule` fires on a call to a symbol of `class` whose `ctx` has some bit of `ctx_any` (or `ctx_any` = 0) and no bit of `ctx_none`. The CLI writes RL rows only for active rules: a pack rule whose pack is active, or a rule the repo's `policy.toml` lists. A rule may have several rows; they are OR-ed. Rule ids, names and versions live in the side table. |
| `RF` | `rule class edges none` | Fan-out rule `rule`: fires on a call site at `loop_depth` > 0 whose `ctx` has no bit of `none` and that reaches a call to a symbol of `class` within `edges` call edges (0 = the site itself calls the class). The CLI writes RF rows only for active rules, one per (rule, class). A catalog's `fanouts` table declares the rules, with `edges` and `none` inline, and the CLI numbers them 0, 1, ... by sorted rule id among the active ones. |
| `RK` | `rule class pos` | Constant-argument rule `rule`: fires on a `CS` call to a symbol of `class` whose argument `pos` (0-based) is a constant, by an `AL site pos kind` row. The CLI writes RK rows only for active rules; which class is a partition lookup and which argument is its key are pack data. A catalog's `konsts` table declares the rules (`pos` inline); the CLI numbers them 0, 1, ... by sorted rule id among the active ones, separately from `RF`. |
| `RU` | `rule` | Untested-data-access rule `rule` is on: a function holding a `QS` query site that has a `core.crap` finding or no coverage data is reported. The CLI writes RU rows only for active rules, normally only when coverage is ingested, since without `CV` rows every query function has no data. |
| `RG` | `rule depth` | Unbounded-growth rule `rule` is on; an insert counts when an `EP` function reaches its function within `depth` `CE` edges. The CLI writes one row per active rule. |
| `RH` | `rule lane base depth` | Hot-path composite rule `rule`: fires on a base finding of lane `lane` and rule `base` whose function an entry point (`EP`) reaches within `depth` call edges (`CE`; 0 = the entry point itself). Lanes: 1 = an SQL rule (`SR`, the finding's query site), 2 = a fan-out rule (`RF`), 3 = a constant-argument rule (`RK`). The CLI writes RH rows only for active rules. A catalog's `hots` table declares them (`lane`, `base` as a rule id and `depth` inline); the CLI numbers them 0, 1, ... by sorted rule id among the active ones, and writes `base` as the `SR` code for lane 1 or the `RF` or `RK` number for lanes 2 and 3. A hot rule whose base rule is off writes no row, and `pulsar policy` says why. |
| `HD` | `site fn shape` | An error handler: a `catch` clause, `.catch(...)`, or an Effect `catch*`/`orElse` callback. `shape`: 0 = other, 1 = empty, 2 = only calls class `log`, 3 = returns a constant or void effect, 4 = rethrows or fails with the cause, 5 = rethrows or fails without the cause. |
| `AL` | `site pos kind` | Argument `pos` (0-based) of `CS` site `site` is a constant. Kinds: 1 = a string, number or boolean literal; 2 = a template with no substitution; 3 = an identifier bound once (never reassigned) to such a literal. Emitted only for sites that are also `CS` rows, so a call whose arguments are all computed has none. |
| `CE` | `site fn target node loop_depth ctx` | A call in function `fn` to repo function `target`. `site` is the same id space as `CS` and `HD`; `loop_depth` and `ctx` are as in `CS`; `node` is the innermost control-tree node of `fn` at the call (0 = the function body), so loop ancestry comes from `CT`. A call inside an iterator callback belongs to the callback's own function id. |
| `CU` | `fn reason count` | Calls in `fn` that could not become an edge, by reason: 1 = callee is not a name path (a call result, an element access, a computed key); 2 = rooted at a parameter or local binding that is not a module-level function, class or object; 3 = a member of a repo object or class whose methods are not known (deeper than one member, or not defined); 4 = an import of a repo file that exports no function by that name. Calls that leave the repo (an external package, a runtime global) are neither an edge nor counted here. |
| `EP` | `fn kind` | Function `fn` is an entry point: something the platform or framework calls from outside the repo. Kinds: 1 = request handler, 2 = object method (a Durable Object-style class), 3 = RPC method, 4 = alarm or scheduled handler, 5 = queue consumer, 6 = HTTP API handler. The functions come from a catalog's `entries` (data, never core): the methods of a class that extends a named symbol (`subclass-methods`, a constructor never counts), the function properties of the default export (`default-export-fns`), or the function arguments of calls to a named symbol (`callback-args`). A member an entry names beats the class's general entry. |
| `BL` | `fn block cond` | A decision block of function `fn`: a control-tree branch (kind 1), multi-branch (3) or loop (4); `block` is its `CT` node id. `cond` is a 32-bit FNV-1a of the normalized condition (variables as their dense ids, literals as their text, `&&` and `\|\|` operands in source order), never 0 for a real condition and 0 when there is none (`for (;;)`, `for ... of/in`, a Rust `loop`). A function with no decision block emits no `B*` row. `try` and the short-circuits inside a condition are not blocks. |
| `BW` | `fn block var` | Variable `var` is written anywhere in the block's region (its arms or body, nested blocks included), one row per block, not per arm. Writes: assignment and compound assignment, `++`/`--`, a declaration with an initialiser, and a method call on a variable's receiver (the accumulator, `xs.push(...)`). A write to a member chain writes the chain and its root; a write to a root writes every chain under it that the function names. An argument is not a write. |
| `BR` | `fn block var` | Variable `var` is read by the block's own condition (test, switch discriminant, while test, iterated expression), member chains whole. |
| `BC` | `fn block var op lit` | One atomic predicate in the block's condition (and one per `case` literal against a switch discriminant): `op` 1 `==`, 2 `!=`, 3 `<`, 4 `<=`, 5 `>`, 6 `>=`, 7 other, seen from the variable's side and flipped under `!`; `lit` is an interned literal id, dense per function and 1-based, 0 when the other side is not a literal. A member of an import (`Kind.A`) counts as a literal. |

**Variables (`BW`, `BR`, `BC`).** Dense per function by first occurrence in source order, shared by the four relations: locals, parameters and free names, with a member chain (`event.type`) as one variable. Imports are constants, not variables. Coarser is the safe direction: it over-links, so a coupled-path count stays at or below NPath. Known undercount: interior mutability (a Rust `RefCell`, a `Mutex`, a `&self` method) and writes through an alias are invisible, so a count can come out low there.

**Rust call sites (`SY`, `CL`, `CS`, `HD`, `AL`).** A callee is a symbol `<crate>#<path>` (`std#fs::read_to_string`, `sqlx#query`, a macro as `std#panic!`), resolved exactly from the call's path through the module's `use` items (aliases included), a fully qualified path or a `crate::` path; a crate renamed in `Cargo.toml` maps back to its package and `core` and `alloc` read as `std`. A method call matches only a name-only symbol `syntax#method.<name>` and its `CS` row carries ctx bit 64; `let _ = ..;` is `syntax#let-underscore` and a dropped `.ok();` is `syntax#ok-discarded`. A site is emitted only for a symbol an active catalog gives a class. Context: ctx bit 1 inside an `async fn`, an async block or an async closure, bit 4 under `#[cfg(test)]`, in a test function or in a file only compiled for tests; `loop_depth` counts enclosing `while`, `for` and `loop`. `HD` sites are `match` arms and `if let` on `Err(..)`, and closure arguments of `unwrap_or_else` and `or_else`; shape 1 empty body, 2 only calls of class log, 3 a constant (a literal, `()`, a constant, `None`, `Ok(..)` of those, `continue`, `break`, a bare `return`), 4 `Err(..)` naming the caught error, 5 `Err(..)` not naming it, 0 anything else. `AL` marks a literal argument (kind 1) and a module `const` or a name bound once to a literal (kind 3). The first argument of a call whose symbol is in the query class is handed to the SQL lane as text: a string literal is the text, anything else is dynamic. The shipped lane catalog (`rust-core`) classes the blocking std calls (2), `println!` and friends (3), a thrown-away result (error-erasing, 4) and the panic family `unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!`, `unreachable!` (exception-style, 15), with three rules (`rust.blocking-in-async`, `rust.discarded-result`, `rust.panic-outside-tests`).

**Rust blocks (`BL`, `BW`, `BR`, `BC`).** Blocks are `if` and `if let` (kind 1), `let .. else` (kind 1, its region is the else block), `match` (kind 3, whose condition is the scrutinee) and `while`, `while let`, `for` and `loop` (kind 4; `for` and `loop` have `cond` 0, and a `for` reads the locals of its iterated expression). A variable is a single lower-case identifier (local, parameter, `self`) or a member chain on one (`self.count`); a constant, a unit variant or a path with more than one segment is a literal, with its text as the literal. Writes are `=` and compound assignment to a place rooted at a variable (`x`, `x.f`, `x[i]`), a `&mut` borrow, any method call whose receiver is rooted at a variable (so `v.push(x)` and `v.len()` both count, uniform with TypeScript and erring toward linking), `let` bindings, and the bindings a block's patterns introduce (`if let Some(x)`, match arms, the `for` pattern). A guard's reads belong to the `match`'s condition. A match arm pins its scrutinee to one `BC` `eq` row per literal pattern (`0`, `None`, `Kind::A`, the variant of `Some(..)`); an arm with a guard gives none. Parameters take the first ids, `self` first. Known undercount: interior mutability through `&self` (`RefCell`, `Mutex`, atomics) is invisible, so a block that mutates only that way looks unlinked. Macro bodies emit nothing, as for `CT`.

**Call edge resolution (`CE`).** Core and syntactic; the adapter never guesses. A callee resolves to a function of the same file (a module-level declaration, `Class.method`, `object.method`, `this.method` in the class), or through an import of a repo file to the function that file exports, following `export { x } from`, `export *` (never a default) and namespace imports, with a cycle guard. Anything else is counted in `CU` or leaves the repo.

**Fixed class ids:**
- 1 = query
- 2 = blocking
- 3 = log
- 4 = error-erasing (for example `orDie`, `ignore`, `catchAll` to void)
- 5 = runtime-escape (`runSync`, `runPromise`)
- 6 = fork
- 7 = resource-acquire
- 8 = ambient-read
- 9 to 13 = reserved for the context mechanisms of #696
- 14 = promise-style (`async`, `await`, `new Promise`, `Promise.all`/`race`/`allSettled`/`any`, `.then`/`.catch`/`.finally` on a non-imported value)
- 15 = exception-style (`throw`, `try`)

Repo classes start at 1000.

**Fan-out rules (N+1 and its kin).** Read by `engine/Fanout.bend` (laws in `engine/Fanout-LAWS.bend`) from `CS`, `CL`, `CE` and `RF`. One mechanism covers a query reached from a loop, a remote call in a loop and repeated calls with a batch form: which class counts is catalog data. Reach sets: R0 is the functions holding a call of the class, and R(k+1) is R(k) plus the callers of an R(k) function by a `CE` edge. A finding is kind 0, a loop `CS` site calling the class, or kind 1, a loop `CE` site whose target is in R(edges - 1). A call inside an iterator callback is the callback's own function at loop depth 0, so it is a finding only once iteration-combinator data marks such callbacks; unresolved calls (`CU`) have no edge. The section runs when there is an `RF` row. Output (`pulsar-fanout 0`): one `NX rule site fn via kind` line per finding, where `via` is the callee symbol (kind 0) or the target function (kind 1). Lines come per `RF` row in row order, kind 0 in `CS` order, then kind 1 in `CE` order, then `NXS n`, the count.

**Constant-argument rules (constant partition key).** Read by `engine/Konst.bend` (laws in `engine/Konst-LAWS.bend`) from `CS`, `CL`, `AL` and `RK`. A finding is a `CS` site whose callee has a `CL` fact for the row's class and whose argument at the row's position has an `AL` row. The section runs when there is an `RK` row. Output (`pulsar-konst 0`): one `KX rule site fn callee pos` line per finding, per `RK` row in row order and then in `CS` order, then `KXS n`, the count.

**Hot-path composites.** Read by `engine/Hot.bend` (laws in `engine/Hot-LAWS.bend`) from `EP`, `CE`, `QS` and `RH`, over the findings the SQL, fan-out and constant-argument sections show. A base finding is an SQL finding of rule `base` on a `QS` site (lane 1), an `NX` fan-out finding (lane 2) or a `KX` constant-argument finding (lane 3), each of rule `base`. The hot set of a row is every function an `EP` function reaches within `depth` `CE` edges, followed caller to callee. A finding is a base finding whose function is in the hot set: "hot unindexed query" is lane 1 with `sql.unindexed-filter` (rule 4), "query fan-out on a hot path" is lane 2 with a fan-out rule. Hot-LAWS proves the hot set is exactly the functions an entry point reaches within `depth` edges, and that the findings are exactly the hot base findings (sound and complete). The churn condition of the hot unindexed query, when history is on, is not part of this section yet. The section runs when there is an `RH` row. Output (`pulsar-hot 0`): one `HX rule lane base site fn` line per finding, per `RH` row in row order and then in base-finding order, then `HXS n`, the count.

**Untested data access.** Read by `engine/Untested.bend` (laws in `engine/Untested-LAWS.bend`) inside the MetricsIn output, from `RU` and the functions of the `QS` rows, over Metrics' records, the `core.crap` findings and the functions with coverage data (a `CV` row with coverable lines in range). Per `RU` row, per function in `FN` order, a non-test function with a query site gets `UX rule fn 1` when it has a `core.crap` finding, and `UX rule fn 2` when it has no coverage data. 0% coverage is data, so it never shows as reason 2. Untested-LAWS proves the lines are exactly those functions (sound and complete). A `QS` or `RU` row with the wrong field count is skipped here (the SQL section refuses it). Output, only with an `RU` row, after the hotspot lines: `pulsar-untested 0`, the `UX` lines, then `UXS n`.

**Unbounded growth.** Read by `engine/Grow.bend` (laws in `engine/Grow-LAWS.bend`) from `RG` and the SQL, `EP` and `CE` rows. Per `RG` row, per `QT` read (mode 1) of a table at site `rs`, then per `QT` insert (mode 2) of the same table at site `ws`, in `QT` order, `GX rule rs table ws` when four things hold. The schema is complete (`ddl_skipped` 0) and the table is a known base table. The `QS` at `rs` is a `SELECT` with no `LIMIT`. The read is not keyed: no key of the table has every column bound at `rs` by an equality or an `IN` list (`QU` role 1 or 3). The keys are a unique index that is not partial, with every term a named column; the primary key (every `DC` flag-1 column); and a column alone `UNIQUE` or the rowid alias. And the `QS` at `ws` is in a function an entry point reaches within `depth` `CE` edges. Grow-LAWS proves the findings are exactly those triples, that a finding's read has no bound key, and that the hot insert is reached (Hot-LAWS `HR`). With an incomplete schema the section prints its `SQD` line (complete 0) and no findings. Not seen: an aggregate (`COUNT(*)`) still counts as unbounded, and a filter on the implicit `rowid` of a table with no alias column does not count as keyed.

**Class-in-context rules.** Read by `engine/ClassCtx.bend` (laws in `engine/ClassCtx-LAWS.bend`). Classification alone never makes a finding: only `RL` rows do. `CS` (by `site`), `CL` and `RL` must each be strictly ascending, or the engine refuses (exit 2). Output (`pulsar-classctx 0`): one `RCX rule site fn callee` line per (rule, site) that some `CS` fact, `CL` fact and `RL` row of that rule justify, sorted by (rule, site), then `RCXS n`, the count.

### Effect pack

Read by `engine/Layers.bend` (layer-graph detectors; laws in `engine/Layers-LAWS.bend`). Ids are dense per kind: layers `0..nl-1`, services `0..ns-1`, roots `0..nr-1`; `fn` and `file` ids are the v0/v1 ones. Every relation is strictly ascending in its fields, and the engine refuses (exit 2) a fact set that is not, or that names an id at or above its header count.

| Tag | Fields | Meaning |
|---|---|---|
| `E` | `nl ns nr` | Header: layer, service and root counts (each at most 2^24). Exactly one. |
| `SV` | `svc file kind` | A service: a class extending, or a `const` initialised by, `Context.Service`, `Context.Tag`, `Context.GenericTag`, `Context.Reference`, `Effect.Tag` or `Effect.Service`; or a catalog `services` entry a repo name resolves to (`file` 4294967295). Definitions with the same tag string are one service. `kind` 1 = the service has a default implementation (`Context.Reference`, or catalog `default = true`), so it is always provided; 0 = not. |
| `LY` | `layer file svc` | A layer that builds service `svc`: the tag of `Layer.effect`, `Layer.scoped`, `Layer.succeed` or `Layer.sync`, a v3 `Effect.Service`'s `Default` layer, or a catalog layer's `builds` (`file` 4294967295). A decorator, a layer whose constructor yields the service it builds, gets neither this row nor the `LQ` for that service: the service comes from the layer it is provided with. |
| `LQ` | `layer svc` | Layer `layer` requires `svc`: a `yield*` of `svc` in its constructor function itself (the `LC` function; nested functions run later and are not counted). |
| `LP` | `outer inner mode` | Layer composition: `outer` is the layer the composition expression denotes, with one row per operand (an array operand gives one per element; each pipe step is its own `outer`). `mode` 1 = provide (also v3 `dependencies`), 2 = provideMerge, 3 = merge or mergeAll. |
| `LR` | `root layer` | Provider root `root` is given `layer`. A root is a `Layer.launch` or `ManagedRuntime.make` site, or a call of a runtime-escape (class 5) symbol whose effect is provided there: `Effect.runPromise(eff.pipe(Effect.provide(L)))`, `Effect.provide(eff, L)` as its argument, or `eff.pipe(Effect.provide(L), Effect.runPromise)`. Every `Effect.provide` in that chain gives a row, and an `Effect.provideService(Tag, …)` there is a layer that builds Tag. An `Effect.provide` whose effect is not run there is no root, because its caller may provide more. |
| `RT` | `root file fn` | Where root `root` is: its file and enclosing function (4294967295 at module level). |
| `LC` | `layer fn` | Function `fn` is layer `layer`'s constructor: the `Effect.gen` generator passed to it, directly or through a name bound to one (`const make = Effect.gen(…)`, a v4 service's `make` option, a call of a function returning one). |
| `LO` | `layer` | Opaque: a layer whose composition the adapter cannot see. That is a layer computed by an effect (`Layer.unwrap…`, `Layer.effectContext`), a constructor that is not a visible generator, a tag or operand name that resolves to nothing in the repo or the catalog (a parameter, a package's layer the catalog does not list), or a pipe step it does not know. A catalog layer is not opaque. |
| `US` | `fn svc` | Function `fn` uses `svc` (`yield*` of the service). |

With the type lane on, `LQ` and `US` become exact: they come from the requirement channel instead of syntax. The pack's catalog covers `effect` and `@effect/sql` (including `@effect/sql-pg`): `sql` tagged templates, `SqlResolver`, `SqlSchema` and `Model.makeRepository`, all as class 1 (query).

**Definitions the detectors use.** `LP` edges are followed from `outer` to `inner`, ignoring `mode` and order; this over-approximates what a root provides, so a reported gap is never a false positive of the walk. A layer is *reachable at root r* if an `LP` walk leads to it from a layer of some `LR r _` fact. Service `s` is *provided at r* if a layer reachable at r builds s (`LY`), or s has `SV` kind 1. A root that reaches an `LO` layer reports nothing missing (it prints `LOPQ` instead).

**Output (`pulsar-layers 0`), one line per finding, sorted:**

| Line | Fields | Rule |
|---|---|---|
| `LCYC n ids…` | a layer requirement cycle: layer u → w when u requires a service w builds | effect.layer-cycle |
| `LCERT 0\|1` | 1 = the cycle list is certified complete (Graph laws H, J) | |
| `LUNP r l s x walk…` | at root r, reachable layer l requires s and s is not provided; `walk` is the `LP` path from r's layer x to l | effect.unprovided-service |
| `LOPQ r l` | root r reaches opaque layer l, so its gaps are not reported | |
| `LDUP s a b w na wa… wb…` | layers a < b both build s and both are reachable from layer w (walks wa, wb) | effect.duplicate-builder |
| `LHUB s k a b` | service s has fan-in k = a `LQ` layers + b `US` functions that are no layer's constructor, with k ≥ the threshold | effect.hub-service |
| `LS nl ns edges cycles unp dups hubs hub_min` | summary; `hub_min` is the threshold in force (default 10) | |

### SQL (schema and queries, SQLite first)

Written by the SQL lane (`cli/src/sql/`). SQL text comes from `.sql` files, from `sql` tagged templates and from string literals passed to a query-class call. It is parsed in the adapter with a SQL parser per dialect (SQLite first: `sqlite3-parser`, `research/sql-parser.md`); placeholders stay parameters. Identifiers are lower-cased (ASCII) and interned: a **name id** is an index into the sorted list of every table, column and index name in the run, shown in the `.sqlnames` side table (one name per line, id order). Tables and columns of one run therefore compare by id. A name with no `DT`/`DC` row is a name the schema does not define.

Schema facts describe the **final state** after replaying the DDL (`CREATE`, `ALTER TABLE .. ADD/RENAME/DROP COLUMN`, `DROP`) in file-id order, statement order within a file. The `.sql` files of a migration folder replay in path order, which is the usual numbering.

| Tag | Fields | Meaning |
|---|---|---|
| `DS` | `ddl_ok ddl_skipped` | Header: DDL statements applied, and DDL statements the lane could not parse or does not model. The schema is **complete** only when `ddl_skipped` is 0; detectors that need a complete schema say so when it is not. |
| `DT` | `table file flags` | Table, view or virtual table `table` (a name id), defined last in `file`. `flags`: 1 = `WITHOUT ROWID`, 2 = `STRICT`, 4 = virtual table, 8 = view. |
| `DC` | `table col pos flags` | Column `col` (a name id) of `table`, at 0-based position `pos`. `flags`: 1 = member of the primary key, 2 = `NOT NULL`, 4 = alone `UNIQUE`, 8 = generated, 16 = has a default, 32 = rowid alias (a single `INTEGER PRIMARY KEY` column of a rowid table). |
| `DP` | `table pos col` | Primary key column number `pos` of `table`, in key order. |
| `DI` | `index table flags` | Index `index` (ids `0..n-1` in (table, creation) order; names in `.sqlindexes`, `-` when anonymous) on `table`. `flags`: 1 = unique, 2 = partial (has `WHERE`), 4 = has an expression term, 8 = implied by a `PRIMARY KEY` or `UNIQUE` constraint, not declared as an index. |
| `DX` | `index pos col` | Term `pos` of `index`; `col` is a name id, or `4294967295` for an expression term. |
| `DF` | `fk table ref_table` | Foreign key `fk` (ids `0..n-1`) from `table` to `ref_table`. |
| `DG` | `fk pos col ref_col` | Column pair `pos` of `fk`; `ref_col` is `4294967295` when the clause names none (it means the referenced primary key). |

Query facts, one per SQL statement text (a **site**). Site ids are `0..q-1` in (file, line) order; the `.sites` side table has `site path line` per site.

| Tag | Fields | Meaning |
|---|---|---|
| `QS` | `site file fn node kind flags` | A query site. `fn` is the enclosing function id, or `4294967295` in a `.sql` file; `node` is the innermost enclosing `CT` node of that function (0 = the function body, and always 0 in a `.sql` file), so the engine decides loop ancestry from `CT` as it does for metrics (an iterator callback is a nested function, covered by `FN` parent links). `kind`: 1 = `SELECT`, 2 = `INSERT`, 3 = `UPDATE`, 4 = `DELETE`, 5 = other statement. `flags`: 1 = has `LIMIT`, 2 = `LIMIT` is the literal 1, 4 = `OFFSET` with a literal, 8 = `OFFSET` with a parameter or expression, 16 = `*` in a projection, 32 = `table.*` in a projection, 64 = dynamic text (not a literal or template, so not parsed), 128 = did not parse (a parse failure). A multi-statement text gives one site per statement. |
| `QT` | `site table mode` | The statement touches `table` (a name id; CTE names are not tables): `mode` 1 = read, 2 = insert, 3 = update, 4 = delete. |
| `QU` | `site table col role` | A column use. `table` is the resolved table, or `4294967295` when an unqualified column is ambiguous across several tables, or when the column belongs to a CTE or a derived table (those columns are not modelled). `role`: 1 = equality (`=`, `IS`), 2 = range (`<`, `>`, `<=`, `>=`, `BETWEEN`), 3 = `IN` list, 4 = `LIKE`, 5 = `IS NULL`, 6 = `ORDER BY`, 7 = join condition (`ON` or `USING`), 8 = projection, 9 = `GROUP BY`, 10 = `UPDATE .. SET` target, 11 = `INSERT` column list. |
| `QD` | `site table col kind` | A predicate that defeats an index on that column: 1 = `LIKE`/`GLOB` with a leading wildcard, 2 = the column wrapped in a function or arithmetic, 3 = `OR` across different columns. |
| `SR` | `rule` | SQL rule `rule` is on: 1 = `sql.dynamic-text`, 2 = `sql.offset-param`, 3 = `sql.index-defeat`, 4 = `sql.unindexed-filter`, 5 = `sql.fk-unindexed`, 6 = `sql.schema-drift`. The CLI writes one row per rule that a pack or the repo policy turns on; with none, the engine prints no SQL section. |

The adapter reports what the text says. Whether a column is "unindexed", whether an `OFFSET` is a finding or whether the schema is complete enough to call a name "unknown" is decided by the engine's rules over these rows. Dialect and entry points: the lane is selected by the catalog (a `.sql` file extension, the `sql` tag, query-class calls); platform names (SQLite, D1, Durable Objects) appear only as catalog data.

**SQL rules.** Read by `engine/Sql.bend` (laws in `engine/Sql-LAWS.bend`); every rule is a filter over the rows above:
- `sql.dynamic-text`: a site with flag 64.
- `sql.offset-param`: a site with flag 8.
- `sql.index-defeat`: a `QD` row on a column that some index of its table has as a term.
- `sql.unindexed-filter`: a `QU` use with role 1, 2, 3 or 7 on a known column of a known base table (not a view or virtual table), where no index of the table leads with the column and the column is not the rowid alias.
- `sql.fk-unindexed`: a foreign key whose first column leads no index of the child table.
- `sql.schema-drift`: a `QT` table with no `DT` row, or a resolved `QU` column with no `DC` row. It fires only when `DS` reports `ddl_skipped` = 0.

The rules are per column, not per query plan. Output (`pulsar-sql 0`), only for rules with an `SR` row:
- `SQD ok skipped complete` (complete is 0 or 1);
- `SQX <rule-name> site <site> <table> <col> <detail>` (table and col are `4294967295` when none);
- `SQX sql.fk-unindexed fk <fk> <table> <col> <ref_table>`;
- `SQS n`, the count.

### Infra: deployables, bindings and reads

Written by the infra lane (`cli/src/infra/`). A **deployable** is one unit the repo declares to run somewhere: an alchemy worker or container, or a wrangler config. The lane reads the dialect's declaration (alchemy's `Cloudflare.Worker`/`Cloudflare.Container` calls, wrangler's `wrangler.toml`/`wrangler.json`/`wrangler.jsonc`) and emits the same facts for both: a name, its entry files and its declared binding names. Which keys a dialect uses for those is the reader's data, not the fact model; a detector never names a dialect.

| Tag | Fields | Meaning |
|---|---|---|
| `ID` | `dep` | Deployable `dep` is declared. Ids are `0..n-1` in (declaration file, line, name) order; `.deployables` names each one. |
| `IE` | `dep file` | Deployable `dep` runs `file` (its entry). |
| `IB` | `dep binding` | Deployable `dep` declares binding `binding` (a `.bindings` id). |
| `IU` | `file binding` | `file` reads binding `binding`. |

`IE`: alchemy's `main` is a path relative to the declaring module, or `import.meta.url`, which is that module itself. Wrangler's `main` is a path relative to the config; without one, the tracked `src/index.ts`, `.tsx`, `.js` or `.mjs` is the entry. An entry that is not a tracked file gets no row.

`IB`: the names the declaration makes available to code — the keys of an alchemy `env` object, and wrangler's binding fields (`binding` for KV, R2, D1, services, Hyperdrive, Vectorize, analytics datasets, mTLS certificates and queues producers; `name` for Durable Objects and send-email; `assets.binding`, `ai.binding`, `browser.binding`) plus the keys of `vars`. The resource a binding points at is not a fact: a drift rule compares names.

`IU`: a binding read **by name**: `env.X`, `this.env.X`, `ctx.env.X`, `alias.env.X`, `env["X"]`, and object destructuring from any of those (`const { DB } = env`). An identifier `env` counts only when it is a function parameter or an import from `cloudflare:workers`; a local `env` object does not. `process.env.X` and `import.meta.env.X` are never binding reads. Reads are taken only in the entry closure of some deployable — the `IE` file plus every file its `I` edges reach — so a repo's unrelated `env` variables contribute no rows. A read is not attributed to a deployable: the engine limits the files to the closure it computes from `IE`, which compares per deployable in a repo with several.

The lane is inert without a config it reads: no `ID` row means no infra facts and no infra finding. A deployable whose bindings resolve but whose entry does not is reported as degraded input, because its reads are unknown.

### Later

- `EX`, `RF`: exports and references, for unused exports and API churn.
- Schema facts from migrations, for SQL detectors.
- Type-lane facts.
