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
- **`.fns`:** one line per function, in function-id order, so line N (0-based) is function N. Fields are separated by a single TAB, because paths may contain spaces: `fn path start_line end_line parent kind chain`.
  - `fn`: the numeric `FN` id.
  - `path`: repo-relative, equal to the `.paths` line for the function's file.
  - `start_line`, `end_line`: 1-based, inclusive, the whole function span.
  - `parent`: enclosing function id, or `-` at top level.
  - `kind`: the `FK` kind number (0-7).
  - `chain`: container names outermost first, ending with the function itself, joined by `>`. Anonymous functions are `#<ordinal within parent>`. Never empty.
  - To assign a line to a function, take the function in the same file with the largest `start_line` whose span contains the line. A nested arrow that starts on its parent's line owns that line.

## Engine output (v0)

```
pulsar-findings 0
CYC <size> <file> <file> ...     one cycle, members ascending; cycles ordered by smallest member
CERT <0|1>                       1 when the completeness and partition certificates passed
S <files> <edges> <cycles>
FM <fn> <cyclomatic> <nesting> <npath> <length>   every function, function-id order
FX <rule-id> <fn> <value> <threshold>              one metric finding: value strictly over threshold
```

`FM` and `FX` come from `engine/Metrics.bend`. `FX` lines follow all `FM` lines,
grouped by function, with rules in the order cyclomatic, nesting, npath, length.
Rule ids and default thresholds: `core.cyclomatic` 10, `core.nesting` 3,
`core.npath` 200, `core.length` 60 (`research/thresholds.md`, `Metrics.defaults()`).
Thresholds are an explicit `Rules` argument. Every value is a decimal natural number. NPath
saturates at the cap 16777215 (2^24 - 1): a printed NPath equal to the cap means
"at least the cap". The laws prove that printed NPath = min(Nejmeh NPath, cap).
Invalid FN/CT facts make the engine refuse the run and print no `FM` lines.

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

### Git history

| Tag | Fields | Meaning |
|---|---|---|
| `H` | `commit_count author_count` | Header line, for the analysed window. The window (default: 12 months or 2,000 commits) is in `.pulsar/policy.toml`. |
| `C` | `commit author day` | `day` = days since the Unix epoch. Commit ids follow commit order, oldest first. |
| `A` | `author bot` | `bot` = 1 when the author matches the bot patterns in the catalog. The CLI matches strings and the rule id is reported with the finding. |
| `CF` | `commit file added deleted` | Line counts for a file that still exists at head. Renames are followed. |
| `CFN` | `commit fn touched` | Lines that the commit touched inside head function `fn`. It's matched through `FK` on the commit's version of the file. Functions whose key changed count from the commit that introduced the current key. |

### Coverage

| Tag | Fields | Meaning |
|---|---|---|
| `CV` | `fn covered coverable` | Line coverage for one function. The CLI reads the repo's own report: Vitest's `coverage-final.json` (Istanbul format, written by the default `json` reporter with either the v8 or istanbul provider), lcov (`lcov.info`, also from `cargo llvm-cov --lcov`), or Cobertura. A function with no coverage data gets no `CV`. The engine treats "no data" separately from 0%. |

CRAP (Savoia and Evans) is computed in integers: `c² × (coverable − covered)³ / coverable³ + c`, with `c` being cyclomatic complexity. The threshold (default 30) is in the rule. The finding reports `c`, `covered` and `coverable`.

### Symbols, calls and catalogs (mechanism for packs and repo data)

| Tag | Fields | Meaning |
|---|---|---|
| `SY` | `sym` | An external or repo symbol that call sites refer to (for example `effect` `Effect.orDie`). Its name lives in the CLI side table. |
| `CL` | `sym class` | Symbol `sym` belongs to catalog class `class`. Classes come from packs and from `.pulsar/catalogs/*.toml`. The CLI matches names to classes, and each class id maps to a catalog rule id in the side table. |
| `CS` | `site fn callee loop_depth ctx` | A call site in function `fn` calling `sym`. `loop_depth` is the number of enclosing loop nodes. `ctx` flags (a bit set): 1 = inside an async function, 2 = inside an Effect generator or `Effect.fn`, 4 = inside a test. |
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

### Later

- `EX`, `RF`: exports and references, for unused exports and API churn.
- Schema facts from migrations, for SQL detectors.
- Type-lane facts.
