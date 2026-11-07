# Complexity oracles (task #669)

Reference tools that score per-function complexity on the validation
corpora, normalized to the `.fns` identity contract so engine metrics can
be diffed against them once `cli/src/lang/*` emits function facts.

## Tooling policy

Oracles must be well-known, documented, runnable tools — the same class
as the ESLint `complexity` rule and `clippy::cognitive_complexity`.
Test oracles are never read for implementation (clean-room rule); only
their documented behavior and output formats are used. Installing any
global tool or package requires a process request to `pulsar-lead`.

Evaluated and rejected:

- **vibelexity 0.5.0** (PyPI, tree-sitter based; claimed NPath +
  cognitive + cyclomatic for TS). Rejected by lead ruling: unvetted
  package, and its CLI only exposes aggregate/top-N output — a per-function
  dump required importing private internals (`_analyze_files`), which
  meant reading its source. Uninstalled; `vibelexity_dump.py` removed.
- **eslintcc** (npm): a thin wrapper over the same ESLint complexity
  rules — adds rank mapping, no new metric. Skipped in favour of calling
  ESLint directly.
- **typhonjs-escomplex**, **escomplex**, **cyclomatic-complexity**,
  **code-multivitals** (npm): abandoned, Babel-era, or cyclomatic-only.
  None publish NPath for JS/TS.
- **npath** (npm/PyPI): name collision — a path-normalization module,
  not complexity.

## Oracle set

### TypeScript

| Metric | Oracle | Coverage |
|---|---|---|
| cyclomatic | ESLint built-in `complexity` rule, `max: 0` (reports every function) | all functions the rule visits |
| cognitive-style nesting | `eslint-plugin-sonarjs` `cognitive-complexity`, threshold 0 | functions with score > 0 only |
| NPath | none published for TS — see fixtures below | hand-computed expected values |
| size | function line span from the inventory | all functions |

`ts_oracle.mjs` walks each file with `@typescript-eslint/parser`,
emits an identity row per function (path, chain, name, kind,
child/name ordinals, line span), then attaches ESLint metrics by
containment join (ESLint anchors reports at the `function` keyword,
method key, `=>` token, or function name depending on node kind).

Environment: `bench/oracle/package.json` + `bun install`
(eslint 9, @typescript-eslint/parser 8, typescript 5.9,
eslint-plugin-sonarjs 4). Local to this directory; `node_modules/` is
gitignored.

### Rust

| Metric | Oracle | Coverage |
|---|---|---|
| cyclomatic (CCN) | `lizard --csv` (igorov/lizard, documented at lizard.readthedocs.io) | all functions lizard parses |
| size | lizard NLOC / token / PARAM / length | same |
| cognitive | `cargo clippy` `clippy::cognitive_complexity` (`--message-format=json`) | needs a crate build — queued via lead |
| NPath | none published for Rust — fixtures | hand-computed expected values |

`lizard_dump.py` normalizes lizard CSV to JSONL. Lizard reports bare
function names without container chains; same-name functions in one
file are disambiguated by line span + ordinal in the diff.

### NPath fixtures

No runnable published NPath tool exists for TypeScript or Rust (searched
npm and PyPI; PMD/Checkstyle NPath checks are JVM-only). Per lead ruling,
NPath oracle coverage is **hand-computed expected values on committed
fixtures** (`fixtures/npath/`), cross-verified with `pulsar-composites`.
Each fixture function's expected NPath is computed by hand from Nejmeh
(1988) and recorded in `expected.json`; `diff_metrics.py` compares the
engine's NPath against them once metrics land.

## Normalization to `.fns` keys

`.fns` rows (FACTS.md side tables) carry: file id, start/end line,
parent fn id, FK kind, and `chain` — container names outermost-first
joined by `>`, ending with the function itself. FK hashes path + chain +
name + kind + ordinal.

The oracle emits the same identity fields (`path`, `chain`, `name`,
`kind`, `child_ordinal`, `name_ordinal`) plus line spans for joining.
Provisional choices pending the adapter's FK kind numbering:

- `kind`: `function`, `arrow`, `method`, `constructor`, `getter`,
  `setter`, `function-expression` (TS); lizard rows carry no kind.
- anonymous functions: `name: null`, chain segment `<anon:N>` where N is
  the ordinal among the parent's function-valued children in source
  order; `child_ordinal` always records that position.
- `name_ordinal`: disambiguates same-(chain, kind, name) siblings
  (overloads, same-name methods in different classes are already
  separated by chain).

## Known systematic differences (to verify once metrics land)

- **Cyclomatic definition.** ESLint `complexity` counts `if`/`else if`
  separately, each `case` including `default`, each `catch`, `&&`, `||`,
  `??`, ternary, and loop heads; it does not count `else` alone. Lizard
  CCN and the engine's CT-based count may treat `switch`/`default`,
  logical operators, and `try` differently — expect per-construct deltas.
- **Cognitive.** sonarjs implements the SonarSource cognitive-complexity
  spec (nesting increments, `else if`/`else` chains, `switch` as one
  increment + nesting, recursion, jumps to labels). The engine's
  "cognitive-style nesting" is CT-derived and will differ on hybrid
  constructs; treat large deltas as definition differences first.
- **NPath.** Engine implements Nejmeh 1988 over the control tree;
  hand-computed fixtures are the only oracle. Multiplicative sequence
  composition and `&&`/`||`/`?:` predicate accounting are the classic
  divergence points.
- **Coverage gaps.** sonarjs reports nothing at cognitive 0; ESLint
  skips unparseable files and TS declare/ambient nodes; lizard misses
  some macro-generated or exotic Rust items. The diff reports
  oracle-missing vs engine-missing separately.
- **Function inventory.** The oracle enumerates all ESTree function
  nodes; the engine's FK set may differ on getters/setters, static
  blocks, decorators, TS overload signatures (no body), and
  `export default` forms.

## Inventory join results (2026-11-07, gate VM bx_89cmcpqp)

All 18 corpora: `pulsar facts` regenerated with function facts
(`FN`/`FK`/`CT`/`M` + `.fns`), 478,419 functions total. Oracle rows
merged per corpus (`*.ts.oracle.jsonl` + `*.rs.oracle.jsonl`), engine
rows via `fns_rows.py`, joined by `diff_metrics.py` (exact key, then
`(path, start_line)` fallback).

| corpus | oracle rows | engine fns | matched | oracle-only |
|---|---|---|---|---|
| alchemy | 108,625 | 110,714 | 108,625 | 0 |
| effect | 80,622 | 80,748 | 80,607 | 15 |
| junto | 68,093 | 78,286 | 67,557 | 536 |
| t3code | 79,385 | 85,730 | 79,385 | 0 |
| opencode | 29,107 | 39,057 | 29,107 | 0 |
| pi | 50,018 | 49,790 | 49,790 | 228 |
| pulsar | 12,196 | 12,277 | 12,194 | 2 |
| phoenix | 1,644 | 5,418 | 1,644 | 0 |
| js-genai | 2,949 | 2,980 | 2,949 | 0 |
| convex-backend | 13,980 | 10,609 | 5,780 | 8,200 |
| codex | 31,155 | 146 | 146 | 31,009 |
| typst | 6,374 | 54 | 54 | 6,320 |
| tantivy | 6,184 | 0 | 0 | 6,184 |
| effect-http | 1,081 | 1,081 | 1,081 | 0 |
| effect-website | 503 | 866 | 503 | 0 |
| effect-app-barake | 357 | 475 | 357 | 0 |
| effect-actualbudged-sync | 111 | 111 | 111 | 0 |
| effect-cluster-via-sst | 77 | 77 | 77 | 0 |

Findings:

- **TS named-function inventory is essentially complete.** Every pure-TS
  corpus matches oracle rows 1:1 except small residuals (junto 536,
  effect 15, pulsar 2). The matched count equals oracle rows minus the
  `.rs` lizard rows exactly (e.g. pi: 50,018 − 228 rs = 49,790).
- **Rust is 100% oracle-only** (codex 31,009, typst 6,320, tantivy 6,184,
  convex-backend 8,200, pi 228, pulsar 2): the Rust adapter exists but
  `pulsar facts` does not call it yet — blocked on #657. Engine `.fns`
  for Rust corpora contains only their TS files.
- **Engine surplus is anonymous-function chains.** Engine-only rows are
  dominated by `arrow-or-closure` kind under `packages/app/e2e/` in
  opencode (10,539 surplus; 8,574 arrows). The oracle emits the same
  functions but under a different anonymous chain (`#0>#0` nesting vs
  the oracle's `<anon:N>` scheme) and possibly a different start-line
  anchor for multi-line arrow signatures, so neither the exact key nor
  the `(path, start_line)` fallback joins them. Not an inventory gap —
  a join-key divergence to fix before metric diffing (coordinate with
  pulsar-ts on chain naming and arrow span anchors).
- **Oracle-only TS residuals** (junto 536, effect 15, pulsar 2) are
  mostly `.rs` rows plus a handful of TS rows in files the engine marks
  unreadable or non-prod; enumerate during the metric pass.

## Metric diff results (2026-11-07, engine e75331e + CLI f70d268+)

Pipeline per corpus: `pulsar facts` → `pulsar-engine` → `fm_rows.py`
(FM lines joined to `.fns` identity, canonical metric names) →
`diff_metrics.py` with `--metric` aliases
(`eslint.cyclomatic=cyclomatic`, `lizard.ccn=cyclomatic`,
`lizard.length=length`). Raw table: `results/metric-diff-ee12518.txt`.
552,685 `.fns` rows across 18 corpora after the Rust lane landed.

### NPath fixtures: 28/28 exact

`fixtures/npath/` (14 TS + 14 Rust functions) run through the live
engine: every hand-computed Nejmeh value matched, including `&&`
predicates, ternaries, switch/match, guard returns, `else if` chains
and Rust `for … in` (modeled as while-equivalent, =2). The engine's
NPath is empirically the Nejmeh 1988 recurrence, saturating at
16,777,215 — not literal acyclic-path count (see research/thresholds.md).

### Cyclomatic: ESLint vs engine (TS)

| corpus | agree | diff | agreement |
|---|---|---|---|
| alchemy | 99,197 | 9,415 | 91.3% |
| effect | 77,744 | 2,863 | 96.5% |
| t3code | 74,515 | 4,851 | 93.9% |
| junto | 61,780 | 6,286 | 90.8% |
| opencode | 26,657 | 2,450 | 91.6% |
| pi | 45,283 | 4,507 | 91.0% |
| pulsar | 10,640 | 1,556 | 87.2% |
| js-genai | 2,703 | 246 | 91.7% |

Systematic direction: **engine reads lower than ESLint**, almost always
by 1–2 (`oracle=5 engine=4`, `oracle=2 engine=1`, `oracle=29 engine=27`).
Hypothesis to verify per-construct: ESLint counts `??`, `?.` chains or
`else if` arms that the CT-based count does not (or counts `if` without
`else` differently). Construct-level attribution is the next step —
pick diffing functions and diff their control trees by hand.

### Cyclomatic: lizard vs engine (Rust)

| corpus | agree | diff | agreement |
|---|---|---|---|
| codex | 21,884 | 9,142 | 70.5% |
| convex-backend | 9,994 | 3,801 | 72.4% |
| tantivy | 4,481 | 1,580 | 73.9% |
| typst | 4,527 | 1,692 | 72.8% |

Rust agreement is markedly lower and **bidirectional**: engine reads
lower on simple bodies (`oracle=2 engine=1` — likely `?`/`if let`/match
ergonomics) and higher on others (`oracle=1 engine=3`, `oracle=4 engine=6`
— likely `?` desugaring, match guards or closure bodies lizard skips).
Lizard also has no chain/kind, so the join relies on name+span
fallback; the ~2% unmatched (oracle-only 123–170 per corpus) are
same-name collisions and macro-generated items.

### Length: lizard vs engine (Rust)

agree/diff roughly 60–80% (codex 18,082/12,798; tantivy 5,018/1,043;
typst 4,969/1,196) — expected: lizard `length` is its own line metric,
engine `length` is the `.fns` span; definitions differ by braces/comments.

### Not yet comparable

- `nesting`/`npath` have no runnable TS oracle (NPath is fixture-verified
  only; nesting has no published spec oracle — sonarjs cognitive is a
  different metric and stays unmapped by design).
- `eslint.cognitive` (sonarjs) vs engine `nesting`: deliberately NOT
  aliased — SonarSource cognitive complexity and CT nesting are
  different definitions (nesting increments, `else if` chains, `switch`
  as one increment). If the team adds a cognitive-complexity rule per
  the SonarSource spec (lead's #663 note), sonarjs becomes its oracle.
- Coverage gaps: `fatal_parse=0` on all corpora; residual oracle-only
  rows are `.rs` items lizard can't see (macro-generated, some trait
  items) plus anonymous-chain join misses documented above.

## Running

```sh
# TS oracle for a corpus (git ls-files driven, same filter as pulsar facts)
node ts_oracle.mjs --repo <corpus> -o oracle-ts.jsonl

# Rust oracle
cd <corpus> && git ls-files '*.rs' | xargs lizard --csv \
  | python3 <thisdir>/lizard_dump.py > oracle-rs.jsonl

# Diff (engine rows optional until metrics land)
python3 diff_metrics.py oracle-ts.jsonl engine-ts.jsonl
```
