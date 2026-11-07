# Pulsar

Pulsar tells a team of peer agents what a change did to the health of the code. You give it two git shas. It prints the findings the change **added** and **removed**, each with a file, a symbol, the evidence behind it, and a stable key. There is no score and no grade.

It is built to run on every sha, beside many agents. A Rust CLI reads the code into compact facts, and a formally verified engine written in Bend decides what is a finding. *Each finding Pulsar reports is checked by a formally verified engine, given the facts it read.* What that does and does not cover is in [`experiments/bend-pulsar/research/verification-status.md`](experiments/bend-pulsar/research/verification-status.md).

Works on TypeScript (including Effect and Cloudflare Workers code), Rust, Bend and SQL files. The npm package ships for macOS on arm64 and Linux on x64; other macOS and Linux targets build from a checkout. Windows is not supported (use WSL). What changed since 0.3.0 is in [`CHANGELOG.md`](CHANGELOG.md).

## Install

```sh
npm install --save-dev @skastr0/pulsar     # 0.4.0 or later
npx pulsar version                          # CLI sha, engine sha, every rule with its version
```

The package carries the CLI and the engine for your platform. You need git and nothing else.

From a checkout (needs Rust stable, clang 14+ and the Bend pinned in `experiments/bend-pulsar/packaging/bend-version`):

```sh
cargo build --release --manifest-path experiments/bend-pulsar/cli/Cargo.toml
experiments/bend-pulsar/packaging/build-engine.sh        # writes the engine under dist/engine/
export PULSAR_ENGINE=$PWD/experiments/bend-pulsar/dist/engine/<target>/pulsar-engine
```

## First run

```sh
pulsar init              # writes .pulsar/policy.toml from what the repo shows
$EDITOR .pulsar/policy.toml
pulsar policy            # the effective policy and its fingerprint
git add .pulsar && git commit -m "chore: pulsar policy"
```

`init` states only what the evidence supports, and puts the evidence in a comment next to each choice:

- **Lanes** from `tsconfig.json` and `Cargo.toml`: a root manifest means the whole repo, otherwise only the directories that have one.
- **Production and test code** from layout. The default path rules already treat `test/`, `fixtures/`, `docs/`, generated and config files as non-production. `init` lists the other directories whose names say "not the product" (`scripts/`, `bench/`, `e2e/`, ...) with a file count, so you can strike any that hold shipped code.
- **The history window**, with the number of commits it holds, and a warning on a shallow clone.
- **Packs**, reported and not listed: a pack switches on by itself from evidence (`effect` in a `package.json`, a `wrangler.jsonc`), and the comment names the file that triggered it.

`init` never turns a rule on. Opt-in rules, and the Effect scope lists that decide where the Effect scope rules fire, change which findings appear, so it leaves them to you: it names the opt-in rules in a comment, and when a package other than the root depends on `effect` it lists that package's directory as a commented `[packs.effect] effect_only` suggestion. When only the root package depends on `effect`, it writes no `[packs.effect]` block at all: set `effect_only` and `boundary` by hand. It also cannot tell which root-level directory is the product: with a root `tsconfig.json` it covers the whole repo, so narrow `[lanes.ts] include` yourself. It refuses to overwrite an existing policy (`--force` replaces it, `--print` shows what it would write).

## Daily commands

```sh
pulsar delta <base> <head>        # what the change added and removed
pulsar delta main HEAD --json     # the same, one JSON line per finding, then a summary line
pulsar delta main HEAD --trend    # also list functions whose measured values moved
pulsar delta main HEAD --coverage coverage/lcov.info    # coverage for HEAD from a named report (default: found at the repo root)
pulsar explain                    # list every rule
pulsar explain core.cyclomatic    # definition, threshold, the laws that prove it, an example
pulsar policy                     # policy parts and fingerprint
pulsar catalog list               # class catalogs in effect, and why each is on
```

**Exit codes.** `delta`: 0 = nothing added, 1 = at least one finding added, 2 = error. Any other command: 0 = ok, 2 = error. A run whose engine certificate is missing or fails exits 2 and prints no findings, because the cycle list could not be certified complete.

**Reading a delta.**

```
+ core.cyclomatic 0f40c570f3e24fa4 m.ts:1 tangled  cyclomatic 13 > 10 [cyclomatic 13 nesting 1 npath 4096 length 16 cognitive 12] (rule v2)
- graph.import-cycle 78c5bd807667298b a.ts b.ts
~ graph.import-cycle ...  [allowed: legacy pair, tracked in #12]
? core.crap ...  [head only, needs coverage]
! DEGRADED INPUT (head) ts: ...
# base=ddb9485ac1eb head=428b29ab86e7 added=1 allowed=1 removed=1 unchanged=0 worsened=0 improved=0 degraded=1 ...
```

`+` added (counts toward exit 1), `-` removed, `~` allowed by a committed decision (or a trend line under `--trend`), `?` needs coverage, `!` the run read its input only partly and says what it skipped: read these before trusting a clean result. The word after the rule is the finding's key. It does not change when lines move, so a peer can look the finding up, and a decision can name it. A delta compares committed shas: uncommitted edits in your worktree are not seen.

The first run on a sha parses it. The result is cached per sha under `~/.pulsar/cache` (`PULSAR_CACHE_DIR`, `PULSAR_CACHE_MAX_MB`, `PULSAR_CACHE=off`), so the second run on the same sha is fast. `--no-cache` recomputes.

## Rules

`pulsar explain <rule>` gives the definition, the threshold and the laws behind each one; `pulsar version` lists their versions. A rule is **on** by default, **opt-in** (list it in `[rules] enable`), or **with its pack** (the pack switches on from evidence; `[rules] disable` turns one rule off). Every threshold is in the rule or its catalog, never hidden.

| Rule | Flags | On when |
|---|---|---|
| `core.cyclomatic`, `core.nesting`, `core.npath`, `core.length` | a function over a size or complexity threshold | default |
| `core.cognitive` | cognitive complexity (SonarSource) | opt-in |
| `core.hotspot` | a complexity finding on a function that changed often | default, with git history |
| `core.crap`, `core.risky-change` | complex, under-tested code, and the same on a function that changes often | with a coverage report |
| `core.untested-data-access` | a function that runs a query and has a `core.crap` finding or no coverage data | with a coverage report |
| `graph.import-cycle` | files that reach each other through value imports | default |
| `sql.unindexed-filter`, `sql.index-defeat`, `sql.offset-param`, `sql.dynamic-text`, `sql.fk-unindexed`, `sql.schema-drift` | query and schema problems in `.sql` files and in queries the code runs | opt-in |
| `effect.promise-style-in-effect-scope`, `effect.exception-style-in-effect-scope` | async/await, promises, `throw` or `try` in an Effect-first file | Effect pack, with `[packs.effect]` scope lists |
| `effect.ambient-read-in-effect`, `effect.blocking-in-effect`, `effect.runtime-escape-in-effect` | clock, blocking host calls or runtime escapes inside Effect code | Effect pack |
| `effect.layer-cycle`, `effect.unprovided-service`, `effect.duplicate-builder`, `effect.hub-service` | problems in the Effect layer graph | Effect pack |
| `cloudflare.query-in-loop` | a D1 or Durable Object SQL query run once per loop iteration, directly or through a function it calls within 2 call edges (test code excluded) | Cloudflare pack |
| `cloudflare.hot-query-fan-out` | that finding in code a request, alarm or queue entry point reaches within 3 call edges | Cloudflare pack |
| `cloudflare.hot-unindexed-query` | a `sql.unindexed-filter` finding in such code | Cloudflare pack and `sql.unindexed-filter` enabled; `pulsar policy` says when it is off |
| `cloudflare.unbounded-growth` | a `SELECT` with no `LIMIT` and no key bound, on a table that code an entry point reaches (within 3 call edges) inserts into | Cloudflare pack; needs a complete `.sql` schema |

## Coverage

Coverage is optional and comes from a report your repo already writes; Pulsar never runs your tests. `pulsar facts` and `pulsar delta` find the report themselves: they look at the repo root for `coverage/coverage-final.json`, `coverage/lcov.info`, `coverage/cobertura.xml`, `coverage/cobertura-coverage.xml` and `lcov.info`. `delta` applies it to HEAD only (the report describes your worktree, never the base), so run the tests before the delta. `--coverage <file|dir>` points either command at another location, and `delta` prints on stderr which report it read, or that it found none.

```sh
npx vitest run --coverage
# Vitest, v8 or istanbul provider: writes coverage/coverage-final.json (json is a default reporter)

bun test --coverage --coverage-reporter=lcov
# bun's own runner: writes coverage/lcov.info

mkdir -p coverage && cargo llvm-cov --lcov --output-path coverage/lcov.info
# Rust, from the crate root; cargo-llvm-cov does not create the directory
```

Discovery is repo-root relative, so a report inside a crate dir (`cli/coverage/lcov.info`) needs `--coverage`.

No report, no CRAP: without coverage Pulsar emits no `CV` facts, so `core.crap` is not reported at all. The cause is absent, which is not the same as full coverage. A report that says a function was never run is 0%, and there CRAP is c squared plus c (c is its cyclomatic complexity): cc6 at 0% is 42, a finding over the default 30, listed under `?` and never counted toward exit 1.

The pass signal on stderr: `pulsar: coverage reports=1 files=3 lines=35 skipped=0 assigned=35 unassigned=0 cv=8`. `skipped=0` means every report path matched a fact file; `cv=0` with `reports=1` means the report named no file Pulsar knows. (Commands and counts verified by pulsar-cov at e11fa15; rerun at the freeze sha.)

## The repo's policy

One policy per repo, committed in `.pulsar/`, and its fingerprint is printed with every run:

- `policy.toml`: the history window, `[lanes.ts]` / `[lanes.rust]` / `[lanes.bend]` / `[lanes.sql]` coverage and `prod` / `test` prefixes, `[rules] enable` / `disable`, `[packs.effect]` scope.
- `decisions.toml`: a finding key accepted with a written reason. It is shown as `~ allowed` and does not fail the run.
- `catalogs/*.toml`: your own class data (which calls are queries, which block). See `pulsar catalog --help`.

`~/.pulsar/policy.toml` is an organization fallback used only when the repo has none, and the output says so. There is no personal or per-agent policy.

## For your AGENTS.md

```md
## Code health (Pulsar)

- Before you hand off a change, run `pulsar delta <base-sha> HEAD`. Exit 1 means your change added findings.
- Fix what you added. If a finding is wrong or accepted, do not hide it: add its key to `.pulsar/decisions.toml`
  with a reason and say so in your handoff. Never edit `.pulsar/policy.toml` to make a finding go away.
- Read any `! DEGRADED INPUT` line. A clean result with degraded input is not a clean result.
- `pulsar explain <rule>` says what a rule means and what number it flags.
- Peers can reproduce your result with the same command on the same shas.
```

## Known limits

- **Verification stops at the facts.** The engine's findings are proven correct for the facts it decoded. Reading code into facts (the parsers, the adapters, the byte readers) and printing the delta, including its added/removed set difference, are tested against fixtures and reference tools, not proven. See `experiments/bend-pulsar/research/verification-status.md` for the current boundary.
- **No type checker in the default lane.** Rules that need types are not part of 0.4.0.
- **Packs switch on from dependencies and file names.** `import:` activators in a catalog do not match yet.
- **History needs history.** A shallow clone cuts the history facts short, and `init` says so. History is capped by the policy window (default: the newest 2000 commits of the last 365 days).
- **Renames are followed, not guaranteed.** A renamed file keeps its findings (`renamed_files` in the summary); a move Pulsar could not match shows as `unmatched_moves`, and that finding can appear as removed and added.
- **Coverage is yours to supply.** `core.crap` does not exist for a sha without a report (see Coverage above).
- **Effect scope takes path prefixes, not globs.** `[packs.effect] effect_only` and `boundary` match like the lane scopes: a prefix ending in `/` is a directory, anything else is that file.
- **`.then`, `.catch` and `.finally` on an imported binding are deliberately not flagged as promise style**, to keep `Effect.catch`-style APIs out.
- **Constructs at module level, outside any function, are not yet sites** for the Effect style rules (fixed in 0.4.1).
- **Thresholds are conventions.** `core.cyclomatic` flags above 10, `core.nesting` above 3, `core.npath` above 200. The evidence for each is in [`experiments/bend-pulsar/research/thresholds.md`](experiments/bend-pulsar/research/thresholds.md) and is weaker than the numbers look. In 0.4.0 they are fixed in the engine's rules, not set by policy; `pulsar explain <rule>` prints each one.
- **Not a score.** Pulsar does not rank repos, rate agents or blend signals.

More: [`experiments/bend-pulsar/PRODUCT.md`](experiments/bend-pulsar/PRODUCT.md) (scope), [`experiments/bend-pulsar/FACTS.md`](experiments/bend-pulsar/FACTS.md) (the fact format and every rule's facts).
