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
