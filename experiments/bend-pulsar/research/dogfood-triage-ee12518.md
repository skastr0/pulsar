# Dogfood triage — ee125189c0f868f851ac957249fccf7bb21b1a9c (82 findings)

Run: empty base 748111b6 -> ee12518, CLI+engine at ee12518/e75331e, .pulsar/policy.toml scope.
Classes per research/thresholds.md defaults (strict >): cc>10, nesting>3, npath>200, length>60.
Borderline bands for "threshold noise": cc 11-12, nesting 4, npath 201-400, length 61-80.
Detector bugs: none found. Spot-verified at ee12518: Rel>tag cc=31 is a 30-arm exhaustive
match (+1) exactly; visit_tagged_template_expression nesting=4 is four real nested if-lets;
handler_args nesting=5 real; Walker>enter npath=288 is a flat 50-line dispatcher (sequence
product of branch terms, plausible); scan_imports npath=338 and Resolution>resolve npath=252
verified against source — nested loops/matches multiply correctly. NPath recurrence checked
against Nejmeh (ACPATH arXiv:1610.07914 Table 2): branch/loop/multi-branch formulations match.

| class | rule | value | cc | nest | npath | len | subject |
|---|---|---|---|---|---|---|---|
| real | core.cyclomatic | 53 | 53 | 5 | 16777215 | 284 | `scripts/resource-bench.ts::runResourceBench` |
| real | core.cyclomatic | 46 | 46 | 4 | 4994 | 97 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::lex` |
| real | core.cyclomatic | 31 | 31 | 1 | 31 | 34 | `experiments/bend-pulsar/cli/src/facts.rs::Rel>tag` |
| real | core.cyclomatic | 25 | 25 | 5 | 16500 | 79 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::build` |
| real | core.cyclomatic | 24 | 24 | 6 | 133 | 99 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::extract` |
| real | core.cyclomatic | 23 | 23 | 2 | 108000 | 83 | `experiments/bend-pulsar/cli/src/catalog.rs::validate` |
| real | core.cyclomatic | 23 | 23 | 3 | 5760 | 61 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::next_tag` |
| real | core.cyclomatic | 20 | 20 | 4 | 300 | 83 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::parse` |
| real | core.cyclomatic | 19 | 19 | 4 | 120 | 45 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::Build>resolve` |
| real | core.cyclomatic | 19 | 19 | 5 | 76 | 72 | `experiments/bend-pulsar/cli/src/lang/ts/extract.rs::extract` |
| real | core.cyclomatic | 18 | 18 | 2 | 5832 | 74 | `experiments/bend-pulsar/cli/src/policy.rs::load` |
| real | core.cyclomatic | 17 | 17 | 5 | 481 | 73 | `experiments/bend-pulsar/cli/src/lang/rust/cargo.rs::discover` |
| real | core.cyclomatic | 17 | 17 | 1 | 4320 | 37 | `scripts/release-smoke.ts::assertScoreContract` |
| real | core.cyclomatic | 17 | 17 | 3 | 232 | 48 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>on_call` |
| real | core.cyclomatic | 15 | 15 | 6 | 28 | 44 | `experiments/bend-pulsar/cli/src/lang/ts/extract.rs::type_only_exports` |
| real | core.cyclomatic | 14 | 14 | 4 | 338 | 30 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>scan_imports` |
| real | core.cyclomatic | 14 | 14 | 2 | 3080 | 63 | `scripts/resource-bench.ts::parseResourceBenchArgs` |
| real | core.cyclomatic | 14 | 14 | 3 | 68 | 52 | `experiments/bend-pulsar/cli/src/engine.rs::parse` |
| real | core.cyclomatic | 14 | 14 | 6 | 100 | 48 | `experiments/bend-pulsar/cli/src/lang/ts/resolve.rs::Resolution>new` |
| real | core.cyclomatic | 14 | 14 | 3 | 772 | 58 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::Build>walk` |
| real | core.cyclomatic | 13 | 13 | 3 | 252 | 31 | `experiments/bend-pulsar/cli/src/lang/ts/resolve.rs::Resolution>resolve` |
| real | core.cyclomatic | 13 | 13 | 5 | 16 | 41 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::Walker>tokens` |
| real | core.cyclomatic | 13 | 13 | 3 | 27 | 46 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::Walker>block` |
| threshold-noise | core.cyclomatic | 12 | 12 | 2 | 56 | 61 | `scripts/onboard-smoke.ts::smokeTuiFirstFrame` |
| threshold-noise | core.cyclomatic | 12 | 12 | 4 | 290 | 46 | `scripts/release-contracts.ts::assertPublishedExportContract` |
| threshold-noise | core.cyclomatic | 12 | 12 | 6 | 55 | 59 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::link_laws` |
| threshold-noise | core.cyclomatic | 11 | 11 | 2 | 306 | 96 | `experiments/bend-pulsar/cli/src/driver.rs::build` |
| threshold-noise | core.cyclomatic | 11 | 11 | 4 | 82 | 55 | `experiments/bend-pulsar/cli/src/coverage/map.rs::assign` |
| threshold-noise | core.cyclomatic | 11 | 11 | 1 | 288 | 50 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>enter` |
| real | core.nesting | 6 | 12 | 6 | 55 | 59 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::link_laws` |
| real | core.nesting | 6 | 15 | 6 | 28 | 44 | `experiments/bend-pulsar/cli/src/lang/ts/extract.rs::type_only_exports` |
| real | core.nesting | 6 | 14 | 6 | 100 | 48 | `experiments/bend-pulsar/cli/src/lang/ts/resolve.rs::Resolution>new` |
| real | core.nesting | 6 | 24 | 6 | 133 | 99 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::extract` |
| real | core.nesting | 5 | 9 | 5 | 12 | 27 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>handler_args` |
| real | core.nesting | 5 | 53 | 5 | 16777215 | 284 | `scripts/resource-bench.ts::runResourceBench` |
| real | core.nesting | 5 | 13 | 5 | 16 | 41 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::Walker>tokens` |
| real | core.nesting | 5 | 19 | 5 | 76 | 72 | `experiments/bend-pulsar/cli/src/lang/ts/extract.rs::extract` |
| real | core.nesting | 5 | 17 | 5 | 481 | 73 | `experiments/bend-pulsar/cli/src/lang/rust/cargo.rs::discover` |
| real | core.nesting | 5 | 25 | 5 | 16500 | 79 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::build` |
| threshold-noise | core.nesting | 4 | 19 | 4 | 120 | 45 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::Build>resolve` |
| threshold-noise | core.nesting | 4 | 11 | 4 | 82 | 55 | `experiments/bend-pulsar/cli/src/coverage/map.rs::assign` |
| threshold-noise | core.nesting | 4 | 5 | 4 | 5 | 12 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker as Visit>visit_tagged_template_expression` |
| threshold-noise | core.nesting | 4 | 14 | 4 | 338 | 30 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>scan_imports` |
| threshold-noise | core.nesting | 4 | 12 | 4 | 290 | 46 | `scripts/release-contracts.ts::assertPublishedExportContract` |
| threshold-noise | core.nesting | 4 | 46 | 4 | 4994 | 97 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::lex` |
| threshold-noise | core.nesting | 4 | 20 | 4 | 300 | 83 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::parse` |
| real | core.npath | 16777215 | 53 | 5 | 16777215 | 284 | `scripts/resource-bench.ts::runResourceBench` |
| real | core.npath | 108000 | 23 | 2 | 108000 | 83 | `experiments/bend-pulsar/cli/src/catalog.rs::validate` |
| real | core.npath | 16500 | 25 | 5 | 16500 | 79 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::build` |
| real | core.npath | 5832 | 18 | 2 | 5832 | 74 | `experiments/bend-pulsar/cli/src/policy.rs::load` |
| real | core.npath | 5760 | 23 | 3 | 5760 | 61 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::next_tag` |
| real | core.npath | 4994 | 46 | 4 | 4994 | 97 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::lex` |
| real | core.npath | 4320 | 17 | 1 | 4320 | 37 | `scripts/release-smoke.ts::assertScoreContract` |
| real | core.npath | 3080 | 14 | 2 | 3080 | 63 | `scripts/resource-bench.ts::parseResourceBenchArgs` |
| real | core.npath | 772 | 14 | 3 | 772 | 58 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::Build>walk` |
| real | core.npath | 481 | 17 | 5 | 481 | 73 | `experiments/bend-pulsar/cli/src/lang/rust/cargo.rs::discover` |
| threshold-noise | core.npath | 338 | 14 | 4 | 338 | 30 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>scan_imports` |
| threshold-noise | core.npath | 306 | 11 | 2 | 306 | 96 | `experiments/bend-pulsar/cli/src/driver.rs::build` |
| threshold-noise | core.npath | 300 | 20 | 4 | 300 | 83 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::parse` |
| threshold-noise | core.npath | 290 | 12 | 4 | 290 | 46 | `scripts/release-contracts.ts::assertPublishedExportContract` |
| threshold-noise | core.npath | 288 | 11 | 1 | 288 | 50 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>enter` |
| threshold-noise | core.npath | 252 | 13 | 3 | 252 | 31 | `experiments/bend-pulsar/cli/src/lang/ts/resolve.rs::Resolution>resolve` |
| threshold-noise | core.npath | 232 | 17 | 3 | 232 | 48 | `experiments/bend-pulsar/cli/src/lang/ts/functions.rs::Walker>on_call` |
| real | core.length | 284 | 53 | 5 | 16777215 | 284 | `scripts/resource-bench.ts::runResourceBench` |
| real | core.length | 204 | 1 | 0 | 1 | 204 | `scripts/__tests__/resource-bench.test.ts::#1` |
| real | core.length | 134 | 5 | 2 | 8 | 134 | `scripts/agent-smoke.ts::smoke` |
| real | core.length | 128 | 9 | 3 | 60 | 128 | `experiments/bend-pulsar/cli/src/lang/ts/mod.rs::analyze` |
| real | core.length | 99 | 24 | 6 | 133 | 99 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::extract` |
| real | core.length | 97 | 46 | 4 | 4994 | 97 | `experiments/bend-pulsar/cli/src/lang/bend/mod.rs::lex` |
| real | core.length | 96 | 11 | 2 | 306 | 96 | `experiments/bend-pulsar/cli/src/driver.rs::build` |
| real | core.length | 91 | 5 | 2 | 12 | 91 | `experiments/bend-pulsar/cli/src/delta.rs::evaluate` |
| real | core.length | 83 | 23 | 2 | 108000 | 83 | `experiments/bend-pulsar/cli/src/catalog.rs::validate` |
| real | core.length | 83 | 20 | 4 | 300 | 83 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::parse` |
| threshold-noise | core.length | 79 | 25 | 5 | 16500 | 79 | `experiments/bend-pulsar/cli/src/lang/rust/graph.rs::build` |
| threshold-noise | core.length | 74 | 18 | 2 | 5832 | 74 | `experiments/bend-pulsar/cli/src/policy.rs::load` |
| threshold-noise | core.length | 73 | 17 | 5 | 481 | 73 | `experiments/bend-pulsar/cli/src/lang/rust/cargo.rs::discover` |
| threshold-noise | core.length | 72 | 6 | 2 | 18 | 72 | `scripts/release-smoke.ts::installNpmArtifact` |
| threshold-noise | core.length | 72 | 19 | 5 | 76 | 72 | `experiments/bend-pulsar/cli/src/lang/ts/extract.rs::extract` |
| threshold-noise | core.length | 66 | 10 | 2 | 64 | 66 | `experiments/bend-pulsar/cli/src/delta.rs::run` |
| threshold-noise | core.length | 63 | 14 | 2 | 3080 | 63 | `scripts/resource-bench.ts::parseResourceBenchArgs` |
| threshold-noise | core.length | 61 | 23 | 3 | 5760 | 61 | `experiments/bend-pulsar/cli/src/coverage/cobertura.rs::next_tag` |
| threshold-noise | core.length | 61 | 12 | 2 | 56 | 61 | `scripts/onboard-smoke.ts::smokeTuiFirstFrame` |

## Notes

- `facts.rs Rel>tag` (cc 31): correctly measured — a 30-arm exhaustive match returning string
  literals. Real by the metric, but it is the canonical McCabe false-positive shape (a data
  table in match form). Not a bug; if the team wants, a detector refinement could exclude
  arms that are pure literal returns — that is a semantics change needing its own evidence,
  not a threshold tweak.
- `scripts/__tests__/resource-bench.test.ts #1` (length 204, cc 1): a branch-free 204-line test
  body — correctly measured; low-value but real. Test files are in policy scope; consider a
  policy decision if test length should be exempt.
- Second run at 7788532 (dogfood/7788532….json): 71 findings after paydown — the loop works.

## Run 2 — 7788532bf14c5675be50852555605f505c4017f9 (71 findings)

Diffed against run 1 (dogfood/7788532….json):

- **12 findings resolved** by the Rust-graph paydown (6a07b68, 7788532): `graph.rs build`,
  `Build>resolve`, `Build>walk`, `cargo.rs discover` — the loop works as designed.
- **1 new finding**: `delta.rs::run` cyclomatic 12 (was cc 10, len 66 -> len 79, npath 64 -> 128).
  Borderline band (cc 11-12) — threshold noise; the function grew with the delta driver landing.
- **Metric growth on already-real findings**: `driver.rs::build` cc 11 -> 18, npath 306 -> 32640,
  len 96 -> 136 (delta/coverage driver work between the runs — sequential branches multiply in
  NPath; plausible, not a bug). `delta.rs::evaluate` len 91 -> 93 (still length-only).
- No new detector bugs; all changed values consistent with the source growth.

## Verdict

- real: 53
- threshold noise: 29
- detector bug: 0
