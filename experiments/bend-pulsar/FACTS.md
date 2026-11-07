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

## Engine output (v0, one stream)

```
pulsar-findings 0
CYC <size> <file> <file> ...     one cycle, members ascending; cycles ordered by smallest member
CERT <0|1>                       1 when the completeness and partition certificates passed
S <files> <edges> <cycles>
FM <fn> <cyclomatic> <nesting> <npath> <length>   every function, function-id order
FX <rule-id> <fn> <value> <threshold> [<evidence>...]   one finding: value strictly over threshold
```

`FM` and `FX` come from `engine/Metrics.bend`. `FX` lines follow all `FM` lines,
grouped by function, with rules in the order cyclomatic, nesting, npath, length.
Rule ids and default thresholds: `core.cyclomatic` 10, `core.nesting` 3,
`core.npath` 200, `core.length` 60 (`research/thresholds.md`, `Metrics.defaults()`).
Thresholds are an explicit `Rules` argument. Every value is a decimal natural number. NPath
saturates at the cap 16777215 (2^24 - 1): a printed NPath equal to the cap means
"at least the cap". The laws prove that printed NPath = min(Nejmeh NPath, cap).
A function with a `TF` row still gets its `FM` line, but no `FX`. Invalid FN/CT/TF facts
make the engine refuse the run and print no `FM` lines. Invalid means a wrong field count,
a tree the CT rules reject, or a `TF` id that is not a function, or is out of order.

**CRAP and composites** (`engine/Crap.bend`, `engine/Hotspot.bend`, wired in `engine/MetricsIn.bend`).
After the Metrics `FX` lines come the `core.crap` findings, then `core.hotspot`, then `core.risky-change`,
each in function-id order. Each line carries an evidence tail of `key=value` tokens that names its input
facts. A reader that takes the first four fields only stays correct.

```
FX core.crap <fn> <crap> <thr> cyclomatic=<c> covered=<covered> coverable=<coverable>
FX core.hotspot <fn> <churn> <thr> churn=CFN <base-rule>=<value>/<thr> ...
FX core.risky-change <fn> <churn> <thr> churn=CFN core.crap=<crap>/<thr>
```

- `core.crap` (default 30): `floor(c² × (coverable − covered)³ / coverable³) + c`, exact in integers.
  A function with no `CV` row, or `coverable` 0 or over 32768, has no data and no finding. That is
  different from 0% coverage (`covered` 0, CRAP = c² + c). `covered > coverable`, a `CV` row without
  3 fields, or a `CV` id that is not a function in id order refuses the run.
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
join, the churn count and the evidence tail are unproven, like the decoders, and are checked
by hand in `*-CHECK.bend`.

**Pack sections.** After the Metrics lines, `pulsar-engine` prints one section per active pack, in this order. A pack is active when its facts are present, and the CLI writes them only for packs that are on.
- **Effect layer graph** (an `E` row is present): `pulsar-layers 0`, then the `LCYC` … `LS` lines of "Effect pack" below.
- **Class-in-context** (an `RL` row is present): `pulsar-classctx 0`, then `RCX rule site fn callee`, one per (rule, site), sorted, then `RCXS n`.

If any detector refuses its facts (the graph, Metrics, or an active pack), the engine exits 2 with nothing on stdout. engine/LAWS.bend P5-P14 state the order and the switches; `engine/fixtures/packs.expected` shows all four sections.

The CLI renders file ids to paths, maps them to stable keys, and prints the human and JSON forms.

## Relations v1 (draft, first cut)

This draft supports the first-cut detectors in `PLAN.md`: complexity, NPath, churn, hotspots, CRAP and the Effect pack. Seats may refine the encoding. Any change to tags or fields is made here first, in the same commit as the code.

Function ids are `0..m-1`, in the order (file id, start offset). Ids are per run. Identity across shas comes from `FK`.

### Functions and control structure (TS, Rust, Bend)

| Tag | Fields | Meaning |
|---|---|---|
| `M` | `fn_count` | Header line, before any function relation |
| `FN` | `fn file parent loc` | A function, method, closure or arrow function. `parent` is the enclosing function, or `4294967295` at top level. `loc` is the number of non-blank lines in its span, nested functions included (only `CT` excludes them). |
| `FK` | `fn hi lo` | Stable key: a 64-bit hash of path, container chain, name, kind and ordinal, never a line. See "`FK` key and kinds". |
| `CT` | `fn node parent kind` | One node of the function's control tree. `node` ids are exactly `1..k` per function, in preorder, so sibling order is id order; `parent = 0` is the function body, and a parent id is always smaller than its child's. Sorted by `(fn, node)`. |
| `CO` | `fn node op` | The operator of a kind-6 (short-circuit) `CT` node: 1 `&&`, 2 `\|\|`, 3 `??`, 4 `&&=`, 5 `\|\|=`, 6 `??=`. One row per kind-6 node, sorted by `(fn, node)`, written after `CT`. Rust emits 1 and 2 only. Cognitive complexity uses it: a run of the same operator counts once. |
| `TF` | `fn` | Function `fn` is test code. Rust: an item under `#[cfg(test)]` (also `cfg(all(test, ..))`, not under `not(..)`), a function with `#[test]`, `#[tokio::test]` or any attribute ending in `test`, `#[rstest]`, `#[test_case]` or `#[bench]`, and every function in a file reachable only through `#[cfg(test)] mod x;`. TS: a function in a test file (`.test.*`, `.spec.*`, `__tests__/`, `tests/`). Absence means production code. Detectors for complexity, size, NPath, CRAP and hotspots skip a function that has a `TF` row. One row per test function, none for a repo without tests. Sorted by `fn`. |

**`FK` key and kinds.**
- **Kind** (hashed, and the `kind` column of `.fns`): 0 = declaration, 1 = function expression (`function` keyword, named or not), 2 = arrow function or closure (TS arrow, Rust closure), 3 = method, 4 = getter, 5 = setter, 6 = constructor, 7 = static block.
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

**Window.** The date range is anchored to the head commit's committer time, not wall clock, so a sha always yields the same facts. Merges are excluded (`--no-merges`): each commit is one diff. The newest `commit_count` commits inside the range are kept, then emitted oldest first.

**Authors.** Identity is the lowercased email, or the name when the email is empty. Author ids are `0..author_count-1` in first-appearance order over the oldest-first commits, and `bot` is 1 for a name ending in `[bot]` (any case) or a name in the built-in bot list; a repo catalog adds patterns later.

**`CF`.** Only rows with `added + deleted > 0` are emitted, so a pure rename is not churn. The `file` id is the head file's id. Renames are followed by walking the window newest to oldest: the old path inherits the head file of the new path, and a file deleted before head drops out.

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
| `CS` | `site fn callee loop_depth ctx` | A call site in function `fn` calling `sym`. `site` ids are one global space shared with `HD`, in (file id, source order). A site outside any function emits nothing. The event can be a call, a tagged template, a `new`, a reference or a property read, per the catalog entry's `via`; a value bound from a catalog symbol (`const sql = yield* S`, a typed parameter `sql: S`) counts as the symbol when used as the entry's `use` says. `loop_depth` is the number of enclosing loop nodes. `ctx` flags (a bit set), inherited by nested functions: 1 = inside an async function, 2 = pack-defined effect context, 4 = inside a test. Bit 2 is set by an active pack's data, never by core; the Effect pack sets it inside the functions its catalog lists as wrappers: `Effect.gen` and `Effect.fn` bodies, so a layer constructor written with them, and the `Layer.sync` thunk. `Layer.succeed` takes a value, not a thunk, so it adds no context. |
| `RL` | `rule class ctx_any ctx_none` | Rule `rule` fires on a call to a symbol of `class` whose `ctx` has some bit of `ctx_any` (or `ctx_any` = 0) and no bit of `ctx_none`. The CLI writes RL rows only for active rules: a pack rule whose pack is active, or a rule the repo's `policy.toml` lists. A rule may have several rows; they are OR-ed. Rule ids, names and versions live in the side table. |
| `HD` | `site fn shape` | An error handler: a `catch` clause, `.catch(...)`, or an Effect `catch*`/`orElse` callback. `shape`: 0 = other, 1 = empty, 2 = only calls class `log`, 3 = returns a constant or void effect, 4 = rethrows or fails with the cause, 5 = rethrows or fails without the cause. |

**Fixed class ids:**
- 1 = query
- 2 = blocking
- 3 = log
- 4 = error-erasing (for example `orDie`, `ignore`, `catchAll` to void)
- 5 = runtime-escape (`runSync`, `runPromise`)
- 6 = fork
- 7 = resource-acquire
- 8 = ambient-read

Repo classes start at 1000.

**Class-in-context rules.** Read by `engine/ClassCtx.bend` (laws in `engine/ClassCtx-LAWS.bend`). Classification alone never makes a finding: only `RL` rows do. `CS` (by `site`), `CL` and `RL` must each be strictly ascending, or the engine refuses (exit 2). Output (`pulsar-classctx 0`): one `RCX rule site fn callee` line per (rule, site) that some `CS` fact, `CL` fact and `RL` row of that rule justify, sorted by (rule, site), then `RCXS n`, the count.

### Effect pack

Read by `engine/Layers.bend` (layer-graph detectors; laws in `engine/Layers-LAWS.bend`). Ids are dense per kind: layers `0..nl-1`, services `0..ns-1`, roots `0..nr-1`; `fn` and `file` ids are the v0/v1 ones. Every relation is strictly ascending in its fields, and the engine refuses (exit 2) a fact set that is not, or that names an id at or above its header count.

| Tag | Fields | Meaning |
|---|---|---|
| `E` | `nl ns nr` | Header: layer, service and root counts (each at most 2^24). Exactly one. |
| `SV` | `svc file kind` | A service definition (`Context.Service`, `Context.Tag`, `Effect.Service`); its key is the service's tag string, hashed. `kind` 1 = the service has a default implementation (always provided), 0 = not. |
| `LY` | `layer file svc` | A layer that builds service `svc`. |
| `LQ` | `layer svc` | Layer `layer` requires `svc` (a `yield*` in its constructor, or a listed dependency). |
| `LP` | `outer inner mode` | Layer composition: `mode` 1 = provide (also v3 `dependencies`), 2 = provideMerge, 3 = merge. |
| `LR` | `root layer` | Provider root `root` (a `Layer.launch`, `Effect.provide(…, layer)` or `ManagedRuntime.make` site) is given `layer`. |
| `RT` | `root file fn` | Where root `root` is: its file and enclosing function. |
| `LC` | `layer fn` | Function `fn` is layer `layer`'s constructor body. |
| `LO` | `layer` | Opaque: a layer whose composition the adapter cannot see (built from a computed value, or imported from outside the repo). |
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
| `QS` | `site file fn kind flags` | A query site. `fn` is the enclosing function id, or `4294967295` in a `.sql` file. `kind`: 1 = `SELECT`, 2 = `INSERT`, 3 = `UPDATE`, 4 = `DELETE`, 5 = other statement. `flags`: 1 = has `LIMIT`, 2 = `LIMIT` is the literal 1, 4 = `OFFSET` with a literal, 8 = `OFFSET` with a parameter or expression, 16 = `*` in a projection, 32 = `table.*` in a projection, 64 = dynamic text (not a literal or template, so not parsed), 128 = did not parse (a parse failure), 256 = text built from a template with an interpolation that is not a value placeholder. A multi-statement text gives one site per statement. |
| `QT` | `site table mode` | The statement touches `table` (a name id; CTE names are not tables): `mode` 1 = read, 2 = insert, 3 = update, 4 = delete. |
| `QU` | `site table col role` | A column use. `table` is the resolved table, or `4294967295` when an unqualified column is ambiguous across several tables. `role`: 1 = equality (`=`, `IS`), 2 = range (`<`, `>`, `<=`, `>=`, `BETWEEN`), 3 = `IN` list, 4 = `LIKE`, 5 = `IS NULL`, 6 = `ORDER BY`, 7 = join condition (`ON` or `USING`), 8 = projection, 9 = `GROUP BY`, 10 = `UPDATE .. SET` target, 11 = `INSERT` column list. |
| `QD` | `site table col kind` | A predicate that defeats an index on that column: 1 = `LIKE`/`GLOB` with a leading wildcard, 2 = the column wrapped in a function or arithmetic, 3 = `OR` across different columns. |

The adapter reports what the text says. Whether a column is "unindexed", whether an `OFFSET` is a finding or whether the schema is complete enough to call a name "unknown" is decided by the engine's rules over these rows. Dialect and entry points: the lane is selected by the catalog (a `.sql` file extension, the `sql` tag, query-class calls); platform names (SQLite, D1, Durable Objects) appear only as catalog data.

### Later

- `EX`, `RF`: exports and references, for unused exports and API churn.
- Schema facts from migrations, for SQL detectors.
- Type-lane facts.
