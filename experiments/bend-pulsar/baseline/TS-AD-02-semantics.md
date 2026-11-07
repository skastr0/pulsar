# TS-AD-02 (`TS-AD-02-circular-dependencies`) graph semantics at HEAD c173944 (v0.3.0)

Paths below are relative to `/Users/guilhermecastro/Projects/pulsar/packages/ts-pack/src` unless prefixed `core/`
(= `packages/core/src`). Line numbers are from the files as read at HEAD. Everything here comes from reading source;
behaviour that was also observed in runs is marked (observed).

## Pipeline in one paragraph

tsgo/Quartz is used only as a **parser and file enumerator**, never as a type checker or module resolver. The derived
tsconfig pins `noResolve: true, noLib: true, noEmit: true, types: []` (`analysis-config.ts:26-31`). The signal
receives `SourceFile` ASTs for the files Pulsar selects (`signals/ts-ad-02-circular-deps.ts:88`), filters them by
`exclude_globs`, builds an import/export graph with Pulsar's own syntactic resolver (`graph/module-graph.ts`), and runs
iterative Tarjan SCC (`graph/tarjan.ts:8-100`). A cycle is an SCC with >= 2 nodes, or a 1-node SCC with a self edge
(`signals/ts-ad-02-cycle-graph.ts:71-86`, doc comment `ts-ad-02-circular-deps.ts:28-35`).

## 1. Which files are nodes

Two filters stack: the session's file selection (before the signal), then the signal's `exclude_globs`.

### 1a. Session selection (`productionOnly: true` is what every scoring entry point uses)

`productionOnly: true` is passed by single-signal mode (`cli/src/runtime.ts:142`), full score (`cli/src/score.ts:133`),
agent assess (`cli/src/agent-runtime.ts:88`).

- File must appear in `program.getSourceFileNames()` of a discovered package tsconfig (derived config keeps the
  original `include`/`files`/`exclude`, adding `.tsx` twin for every `*.ts` include pattern; `analysis-config.ts:84-92,293-302`).
  Files not covered by any tsconfig are never seen. If no tsconfig exists, a fallback config includes `<root>/**/*.ts` and
  `**/*.tsx` (`analysis-config.ts:243-281`). Project references are dropped (`references: []`, line 93).
  Package/tsconfig discovery: `discovery.ts:37-59`.
- Extension: `.ts .tsx .mts .cts` pass `isAnalyzableTypeScriptPath` (`source-membership.ts:61,68-71`), but the production
  list below only admits `.ts`/`.tsx` (`source-membership.ts:78-106,151-156`). `.js/.jsx/.mjs/.cjs` are never nodes.
- Hidden path segments (any `.x` dir) and `_generated` are dropped (`source-membership.ts:73-76`).
- Must be in `git ls-files --cached --others --exclude-standard` and exist on disk (`source-membership.ts:78-99`), so
  `.gitignore`d files are out, untracked-but-not-ignored are in.
- Production-path rules on the repo-**relative** path (`source-membership.ts:13-59,151-176` and
  `core/src/file-taxonomy.ts:110-205`): drops files ending `.gen.ts(x)`, `.generated.ts(x)`, `sst-env.d.ts`, `happydom.ts`,
  `.test/.spec/.stories.ts(x)`, `test-support|test-utils|test-helpers|test-mocks|test-harness.ts(x)`; and any path
  containing a segment in {node_modules, dist, build, .next, .nuxt, .output, coverage, .turbo, .cache, vendor, gen,
  _generated, __tests__, test, tests, test-support, test-utils} (`source-membership.ts:41-59`); and the classifier also
  rejects segments {example(s), demo(s), private-demos, sample(s), sdk-samples, google_samples, fixture(s), spec(s),
  docs, documentation}, `.storybook`, `.d.ts`, and tooling suffixes `vite.config.ts`, `next.config.ts`, `eslint.config.ts`,
  `tailwind.config.ts`, etc. (`core/src/file-taxonomy.ts:110-205`). Calibration slot `taxonomy.file-classifier` can
  add categories, but project modules were not loaded in this baseline.
- Net effect (observed): pulsar snapshot 700 TS files -> 505 nodes; junto snapshot 3,758 TS files -> 1,976 nodes.

### 1b. Signal `exclude_globs` (default config, `signals/ts-ad-02-circular-deps.ts:57-80`)

`**/*.test.ts(x)`, `**/*.spec.ts(x)`, `**/*.d.ts`, `**/*.gen.ts(x)`, `**/gen/**`, `**/generated/**`, `**/vendor/**`,
`**/node_modules/**`, `**/dist/**`, `**/.turbo/**`, `**/example(s)/**`, `**/demo(s)/**`, `**/private-demos/**`,
`**/sample(s)/**`, `**/sdk-samples/**`, `**/google_samples/**`. Applied twice (`ts-ad-02-cycle-graph.ts:49-51`,
`graph/module-graph.ts:54`) via `core/src/globs.ts:1-31`.

Glob dialect (`core/src/globs.ts:14-31`): regex `^...$`; `.` -> `\.`; `**` -> `.*`; `*` -> `[^/]*`; no `?`, `{}`, `[]`.
**The match runs on the absolute `sourceFile.fileName`**, not the repo-relative path. A repo living under a directory
named `example`, `dist`, `vendor`, etc. would be wholly excluded. The two snapshot paths do not trigger this.

Bypass comments: `// pulsar-allow <ticket> until:<date> <reason>` (`core/src/bypass.ts:14`) never change the graph or
`cycleCount`; they only drop that cycle from *diagnostics* (`ts-ad-02-diagnostics.ts:16-18`). Raw output keeps all
cycles. No bypass comments exist in the non-test sources of either corpus (grep).

## 2. Which statements create edges (`graph/module-graph.ts:94-136`)

The AST is walked with `walkDescendants` over the whole file (`ast.ts:18-25`), so declarations nested in
namespaces/`declare module` blocks are included.

| Form | Edge? | Receipt |
| --- | --- | --- |
| `import x from "./a"`, `import {a} from`, `import * as ns from` | yes, unless judged type-only (below) | `module-graph.ts:111-117` |
| `import "./a"` (side-effect, no clause) | **yes** | `shared-module-usage.ts:97-98` (no clause -> not type-only) |
| `import type ...` / `import { type A, type B } from` (all specifiers `type`) | **no** | `shared-module-usage.ts:29,99,114` |
| `import { A, type B }` where A is only ever referenced in type positions in the file | **no** (usage-based elision) | `shared-module-usage.ts:116-120,43-71` |
| `import { A }` where A is never referenced at all | **yes** (unused import still counts) | `shared-module-usage.ts:118` (`undefined !== "type-only"`) |
| `export * from "./a"`, `export * as ns from "./a"`, `export { a } from "./a"` | yes (export edges enabled for AD-02) | `module-graph.ts:119-133`, `ts-ad-02-cycle-graph.ts:61` |
| `export type {..} from`, `export { type A } from`, or all named specifiers type-only | **no** | `shared-module-usage.ts:34-40,164-165` |
| `export { A } from "./a"` where `A` is only an `interface`/`type` alias declared in the target file (syntactic lookup in target) | **no** | `shared-module-usage.ts:123-158`, `module-graph.ts:124-130` |
| `import x = require("./a")`, `require()`, dynamic `import("./a")` | **no** (only `ImportDeclaration`/`ExportDeclaration` nodes are collected) | `module-graph.ts:326-340` |
| `/// <reference path>` and `import.meta` forms | no | same |
| Import of the file itself | **yes**: self edge allowed (`includeSelfEdges: true`) -> reported as a one-file cycle | `module-graph.ts:115`, `ts-ad-02-cycle-graph.ts:62,74-85` |
| Export of the file itself | no (always skipped) | `module-graph.ts:123` |
| Specifier is not a string literal / no-substitution template | no | `module-graph.ts:342-347` |

Type-position test (`shared-module-usage.ts:43-71`): name-based, not scope-aware. An identifier counts as a "value" use
if any occurrence with that name sits outside a `TypeNode` subtree (excluding import declarations themselves). `typeof X`
in a type annotation is a `TypeQuery` (a type node), so it counts as type-only. Shadowed local names with the same
identifier text can therefore make a type-only import look value-used.

Edges are `Set<string>` per node: duplicates collapse, edge multiplicity is not kept.

## 3. How specifiers resolve (`graph/module-graph.ts:145-324`)

Resolution only ever returns files in the **selected node set** (`buildPathLookup`, lines 261-276); anything resolving
outside it (external packages, excluded files, JS files, JSON) yields no edge.

1. **Relative or absolute** (`startsWith(".")` or `"/"`, line 191): `normalize(resolve(dirname(source), spec))`
   (lines 278-285), then `lookupResolvedPath` (line 319-322): exact path, else with a trailing `.js/.jsx/.mjs/.cjs`
   stripped. The lookup table (lines 261-276) holds, per node: the full path, the path with `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`
   stripped (`shared-path-extensions.ts:1-5`), and for `.../index.<ext>` also the bare directory path. Consequences:
   - `./a.js` -> `a.ts`/`a.tsx` works (`.js`->`.ts`); `./a` -> `a.ts|tsx`; `./dir` -> `dir/index.ts|tsx`.
   - `./a.json`, `./a.css`, etc. do not resolve.
   - No `package.json` `exports`/`imports`, no `moduleResolution` modes, no extension priority order. If several nodes
     map to the same key (`a.ts` and `a.tsx`, or `a.ts` and `a/index.ts`) the **last inserted wins** (`Map.set` overwrite,
     lines 267-272); insertion order is the order of the source-file list (unverified exactly which, sorted per project by
     `localeCompare`, `ts-analysis.ts:271,305-306`). Treat collisions as an edge case.
2. **Non-relative**, tried in order:
   1. **tsconfig `paths` / `baseUrl`** (lines 195-203, 223-259): aliases come from the **nearest `tsconfig.json` walking up from
      the importing file's directory** (`nearestTsconfigDir`, 251-259), read with a JSONC reader (`ts-de-04-path-aliases.ts:59-62,
      149-173,265-319`), following `extends` (only the last entry of an array wins, `ts-de-04-path-aliases.ts:175-189`) and `baseUrl`. With `baseUrl`,
      every non-hidden entry in the base dir becomes an implicit alias (`implicitBaseUrlAliasesSync`, `ts-de-04-path-aliases.ts:205-235`). Pattern match
      is one `*` prefix/suffix (`resolvePathAliasTargets`, `ts-de-04-path-aliases.ts:237-255`). Replacements are tried in order; the first that lands on a
      selected node wins. Alias targets are looked up with the same extension-stripping lookup (`lookupResolvedPath`).
   2. `normalizePackageSpecifier` (`shared-workspace.ts:89-110`): returns `undefined` (no edge) for `#subpath` imports, `@/`
      specifiers, and any specifier with a protocol other than `bun:`, `node:`, `npm:`; builtins (`node:*`, `bun:*`, Node builtin names)
      never resolve (`module-graph.ts:206-208`).
   3. **Workspace package name** (lines 210-218, 287-317): if the specifier equals or is prefixed by the `name` of a discovered
      workspace package, it resolves to `<pkg>/src/index`, `<pkg>/index`, or for subpaths `<pkg>/src/<sub>`, `<pkg>/<sub>`
      (first hit in the node set). `package.json` `main`/`exports` are **not** consulted. `dist` outputs are not nodes, so
      cross-package imports through `dist` do not produce edges.
   4. Otherwise: no edge (npm dependencies are not graph nodes).

Note: the file's `fileName` and all resolved keys are `normalize()`d with `\` -> `/` (`module-graph.ts:324`).

## 4. Cycle extraction and reporting

- Graph: `Map<file, Set<file>>`, one entry per node (`ts-ad-02-cycle-graph.ts:65-67`).
- SCC: iterative Tarjan, deterministic order (`tarjan.ts:20-100`); each component sorted by `localeCompare` (line 47).
- Reported cycles: SCCs with >= 2 members (`ts-ad-02-cycle-graph.ts:72-73`) plus self-looped singletons (74-85); sorted by size
  descending (88-90). `cycleCount`, `largestCycleSize` derive from this list (91-94, 101-106).
- Output cycles include `modules` (sorted), a DFS-found `architecturalSpan`, `minBreakEdge` and a content hash (`:109-212`);
  the Bend comparison only needs `modules`.
- Score: `1` if no cycles, else `max(0.05, 1 - min(0.45, 0.05*count) - sizePenalty(largest))` (`ts-ad-02-circular-deps.ts:119-138`).
- Diagnostics are capped at `top_n_diagnostics = 10` (`ts-ad-02-diagnostics.ts:18`, config line 81); the raw output (and the baseline cycle files in this
  directory) contain every cycle. Severity: `block` if cycle size >= 20 or count >= 10, else `warn` (`ts-ad-02-diagnostics.ts:55-62`).
- Cache identity: `cacheVersion: "semantic-type-only-imports-v4-tsconfig-aliases"` (`ts-ad-02-circular-deps.ts:51`).

## 5. How the cycle files in this directory were produced

`<corpus>-cycles.txt` = for each reported cycle, repo-relative file paths sorted, space-separated; lines sorted; final line
`# files=<graph nodes> cycles=<n>`. Produced by calling Pulsar's own `analyzeCircularDependencies` and
`buildModuleGraphFromFiles` over the same `TsAnalysis` source files a single-signal run uses (driver kept in the baseline
run scratchpad, not in the Pulsar repo), and cross-checked against `pulsar score --signal TS-AD-02-circular-dependencies`
(cycle diagnostics count matched: 2 and 6; junto's 6 is below the 10-diagnostic cap). `files` = nodes after both
filters (505 and 1,976), which equals `analysis.files.length` in both runs.
Corpora were scored with no `.pulsar/` directory (no vector, no project modules) in scratch copies; see the report for details.
