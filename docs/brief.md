# pulsar — brief

updated: 2026-09-24 · version: 0.2.1 · maturity: usable-with-gaps

Maturity argument: 0.2.1 is on npm and it did its job on a repository it had never seen (tether, below), but the agent protocol is still `v1alpha1`, TS-AD-04 fails on some repositories, and the README calls itself experimental.

## One line

Pulsar scores a repository and each agent diff under one shared policy.

## The pain

An agent finishes a change and reports done. Typecheck is green and the tests pass. The diff also has a `catch` that returns `{}`, a `validateSearchCache` that always returns `true`, and a `@ts-ignore` with no reason, and no test covers any of them. You can read every line or you can trust the claim. When several agents work in the same repository, reading every line is the job you meant to hand off. A whole-repository score doesn't help either: one bad change disappears into an average that still looks fine.

Receipts for the pain:
- Guilherme's stated goal for Pulsar: "greatly reduce / eliminate the need for line-by-line code review by providing deterministic trust based guarantees that the code is up to quality threshold" (quasar `codex:e8b2889348490c24d17a51996bc9f48a`, user message; date unverified).
- His review of 95 failed agent sessions found "completion claimed on proxy signals (typecheck green, never the real artifact)" was the largest failure class (quoted in the task prompt of quasar `claude:b3843fd0b0c091bdfca263feaf5fb32b`; date unverified).
- An average hiding severe evidence: one repository scored `weighted_mean ~0.88` "despite severe evidence", which led to the separate `readiness` aggregate (quasar `codex:258286f19ad5cdaea9eb303b59270d98`, from before September; used as history only). `readiness` is in the output today: `packages/core/src/observer-json.ts:278`.
- The diff in the scene is one I staged in a clone of tether to show the problem. It is not a captured agent incident. See "See it run" §1.

## What changes

`pulsar score --diff HEAD..WORKTREE --changed-only --agent-view` scores the base commit and the working tree, then lists only the diagnostics the change introduced, each with a signal ID and a `file:line`. An agent runs it before it says done and fixes what the diff hit. The policy is a committed `.pulsar/vector.json`, and every agent and person in the repository is scored against it. `pulsar agent score --expect-policy <fingerprint>` refuses to compare scores if the policy changed in between, so relaxing the rules cannot pass as a fix.

## Where it fits

When several agents share one repository, Pulsar is the quality check they all run against the same committed policy before they claim a change is done. Its TypeScript analysis runs on quartz (`@skastr0/quartz-engine` 0.2.1, `packages/ts-pack/package.json:47`). Committed `.pulsar/` policy exists today in junto, prism, groundwork, plinth, quasar, and rig (`ls ~/Projects/*/.pulsar`, run 2026-09-24).

## See it run

All four were run on 2026-09-24 against a fresh clone of tether at `f618dc3` using the npm release (`bunx @skastr0/pulsar@0.2.1`). Output is trimmed and nothing was reworded. Absolute paths were cut.

**1. What did this diff hit?** I added one file, `src/search/cache.ts`, with a swallowed error, an always-true validator, and an unexplained `@ts-ignore`.

```console
$ pulsar score --diff HEAD..WORKTREE --changed-only --agent-view --no-progress .
Pulsar Agent View: ROUTE
Range: HEAD..WORKTREE
Changed files: 1
Introduced diagnostics: 7
Changed-scope diagnostics: 6
Holdout signals: 14
- 6 introduced diagnostic(s) need review routing.
TS-AB-02-unused-exports WARN Export loadSearchCache in src/search/cache.ts: unused
TS-LD-07-unsafe-type-erosion INFO Unsafe `any` in assertion `<expression>`
  at src/search/cache.ts:7
TS-LD-09-error-channel-opacity WARN Catch fallback hides error channel in boundary `loadSearchCache`
  at src/search/cache.ts:8
  fix: Expose the failure contract (medium)
TS-SL-03-suppressions WARN ts-ignore is missing justification
  at src/search/cache.ts:6
TS-SL-06-confidence-claim-mismatch WARN validateSearchCache claims runtime validation; supporting behavior: none; observed behavior: unconditional success; missing behavior: a non-success outcome t...
  at src/search/cache.ts:13
  fix: Make the claim true or rename it (medium)
```
15.4 s wall time, bunx resolution included. Exit 0: `ROUTE` is printed, not signaled by the exit code (see Gaps).

**2. How healthy is the whole repository, with no setup?**

```console
$ pulsar agent score .        # exit 3
{ "schema": "pulsar/agent/v1alpha1", "operation": "score", "status": "completed",
  "result": {
    "policy": { "fingerprint": "d654fb01c258…", "vector": { "id": "all-defaults", "source_label": "built-in defaults" } },
    "assessment": {
      "hard_gate_status": "pass", "evidence_complete": false,
      "weighted_mean": 0.8287715301863126,
      "readiness": { "score": 0.676092553184, "status": "yellow" },
      "counts": { "applicable": 32, "not_applicable": 11, "insufficient_evidence": 29, "failed": 0 } },
    "findings": [
      { "signal_id": "TS-LD-02-function-size-distribution", "severity": "warn",
        "message": "Function outlier `collectFacts/Effect.gen` — 147 LOC",
        "location": { "file": "src/facts/lint.ts", "line": 378 } }, … ] } }
```
19.0 s wall time. Exit 3 means incomplete evidence, not a crash. Tether has one `.rs` file, so 21 of the 24 Rust signals report `insufficient_evidence`.

**3. Can an agent make the score pass by loosening the policy?**

```console
$ pulsar persona apply strict-type-safety --to ./.pulsar/vector.json
  Wrote repo vector:        …/tether/.pulsar/vector.json
$ pulsar agent config .       # fingerprint 13cdc8af65ae…, source "repo-local .pulsar/vector.json"
$ pulsar agent score --expect-policy d654fb01c258a9397d03d596be30452437bda2c30d207c278833a26a51c5ec67 .   # exit 1
{"status":"error","error":{"code":"POLICY_MISMATCH",
 "message":"The assessment policy changed; this run cannot verify a repair under the expected policy.",
 "recovery":["Inspect the policy change with pulsar agent config. Restore the prior policy or explicitly accept the changed interpretation before comparing assessments."]}}
```
A hand-written vector with the wrong shape is refused before scoring, with `INVALID_CONFIG` and the exact missing keys (`id`, `domain`, `signal_overrides`).

**4. What does it check?**

```console
$ pulsar agent catalog . | jq '.result.signals | length'
74
# by prefix: RS 24 · SHARED 12 · TS 38; calibration slots: 18
```

## How it works

`@skastr0/pulsar-core` holds the signal registry, the Observer that runs signals, the scoring engine, vectors, and calibration. Three signal packs feed it: `@skastr0/pulsar-ts-pack` (TypeScript analysis on quartz-engine and tsgo), `@skastr0/pulsar-rs-pack` (Rust), and `@skastr0/pulsar-shared-signals` (git history, manifests, coverage reports). Each signal declares a provability tier that caps how hard it can enforce. Only proof-grade signals can fail the hard gate, and the `readiness` aggregate ignores signals that are not applicable or lack evidence (`packages/core/src/observer-categories.ts:250`). The policy is `.pulsar/vector.json` plus optional project modules from `.pulsar/project-modules.json`. Modules are executable TypeScript calibration and run only with `--trust-project-code`. Vector and modules together hash to one policy fingerprint. `score --diff` runs `observeCommit` on the base and `observeWorktree` on the head (`packages/cli/src/score-diff.ts:161-166`), then routes the introduced diagnostics (`packages/cli/src/score-diff-gate.ts:47`). `pulsar agent` wraps all of this in one JSON envelope, `pulsar/agent/v1alpha1` (`packages/cli/src/agent-contract.ts:8`), with exit codes 0 complete, 1 invalid input or policy, 2 hard-gate violation, 3 incomplete evidence (`packages/cli/src/agent-report.ts:68`).

Diagram spec:
- Nodes: `repository` (code + git history + manifests + coverage) · `.pulsar/vector.json` · `.pulsar/project-modules.json` → `project modules` · `policy fingerprint` · `ts-pack` · `rs-pack` · `shared-signals` · `quartz-engine` · `Observer` · `findings` (signal_id, file:line, severity, evidence_class) · `readiness` / `hard_gate_status` · `pulsar agent score` (JSON envelope, exit 0/1/2/3) · `pulsar score --diff` (base vs WORKTREE → introduced diagnostics → PASS / ROUTE).
- Edges: repository → ts-pack, rs-pack, shared-signals · quartz-engine → ts-pack · packs → Observer · vector.json + project modules → policy fingerprint → Observer · Observer → findings → readiness / hard_gate_status → `agent score` · Observer(base) + Observer(WORKTREE) → introduced diagnostics → `score --diff` · `--expect-policy` compares against policy fingerprint → POLICY_MISMATCH.

## Who it is for / not for

For:
- Someone whose repository is mostly written by agents and who wants each change checked against a stated policy instead of read line by line.
- Agents that need a check they can run and parse: JSON on stdout, stable exit codes, a fix hint per finding.
- TypeScript and Rust repositories. TypeScript has the deepest coverage: 38 of the 74 signals.

Not for:
- A linter replacement or a security scanner. `TS-SEC-*` flags dangerous sinks and hard-coded secrets and does not audit.
- Scoring with personal preferences. There is no per-person or per-agent vector. A home-directory vector is only an organization fallback, and the output labels it that way (`AGENTS.md`).
- Languages other than TypeScript and Rust, beyond the 12 git and manifest signals.
- Windows. npm binaries exist for darwin and linux, arm64 and x64, only (`ls dist`).

## Install

```bash
npx @skastr0/pulsar agent score .     # Node ≥ 18 (README); I ran it through bunx
bunx @skastr0/pulsar agent score .
```
`npx -y @skastr0/pulsar@0.2.1 --version` → `0.2.1`, run 2026-09-24. Prebuilt binaries: darwin-arm64, darwin-x64, linux-arm64, linux-x64. From source: `bun install --frozen-lockfile && bun run build:cli && bun run install:local` (README; I did not run this).

## Proof

- Releases: 7 tags, `v0.1.0`–`v0.2.1` (`git tag`). npm `@skastr0/pulsar` 0.2.1 was published 2026-09-16, and the first release was 2026-05-16 (`npm view @skastr0/pulsar time`).
- History: 957 commits since 2026-04-15 (`git log --oneline | wc -l`; first commit `396eedb`).
- Tests: 2,032 bun tests in 11 suites, plus 12 artifact-contract tests, all green in CI run 35966573027 on `39684c7` (2026-09-24, `gh run view --log`). In a fresh local clone with Bun 1.3.14, `bun run verify` passed typecheck and build and ran 2,032 tests. 2,031 passed and 1 failed (see Gaps).
- Signals: 74 production signals, 18 calibration slots (`agent catalog`, See it run §4).
- Usage: committed `.pulsar/` policy in 6 of Guilherme's other repositories (Where it fits). Agents use `score --diff … --agent-view` as a pre-claim check in other repos, for example plinth (quasar `codex:31fd6820d14c8d2fd16bd992e2b307e1`).
- Resource work in 0.2.1, measured: `docs/explorations/resource-performance-2026-09-15.md`.

## Gaps

- `score --diff --agent-view` exits 0 when it prints `ROUTE` (See it run §1). A script has to parse the text. Exit-code gating exists only through `agent score` hard gates and `score --ci` with a baseline.
- On a mostly TypeScript repository with one Rust file, 21 of 24 Rust signals report `insufficient_evidence`, and `agent score` exits 3 by default (See it run §2).
- TS-AD-04 still fails on some repositories. The Effect benchmark exceeds a 4 GiB footprint budget (CHANGELOG 0.2.1, Known limitations).
- In the shared working checkout, `bun run verify` fails at the `@skastr0/pulsar-shared-signals` typecheck with TS7006 in `src/__tests__/shared-11-theory-encoding-index.test.ts:210,223,387`. That happens under Bun 1.4.2 and under the pinned 1.3.14, while CI on the same commit is green. A fresh clone typechecks cleanly, so this is stale state in the shared checkout. In that fresh clone, `proposeOwnershipInventory > quarantines unsafe sources` fails (`packages/cli/src/__tests__/ownership-discovery.test.ts:327`, expected `true`, received `false`) while CI passes it. It may depend on the clone living under `/private/tmp` (unverified).
- The README header image (`docs/assets/pulsar-hero.png`) is cyan. The `pulsar onboard` TUI accent is amber (`packages/onboard/src/palette.ts:13`, `#e5b567`, title at `packages/onboard/src/app.tsx:426`).
- The `pulsar onboard` closing screen tells users that "testimonials we earn here open the door to charging for private repos" (`packages/onboard/src/app.tsx:794-806`). A license screen exists in the code, but the CLI hardcodes `phase: "beta"` (`packages/cli/src/onboard.ts:120`), so no user can reach it. The license is MIT.
- The globally installed `pulsar` on this machine is 0.1.5 through mise, while npm has 0.2.1. That is local drift, not a product fault.

## Demo moments

1. **Diff check** (terminal, about 20 s): an agent's new file on screen, then `pulsar score --diff HEAD..WORKTREE --changed-only --agent-view` printing `ROUTE` and the six diagnostics with `file:line`. It shows the tool finds what typecheck and tests did not.
2. **Moving the goalposts** (terminal, about 15 s): `persona apply` changes the vector, then `agent score --expect-policy <old>` returns `POLICY_MISMATCH`. It shows a policy edit cannot pass as a repair.
3. **Repair loop** (terminal, about 30 s, not recorded yet): the same diff after the fixes are applied, and the diff check printing `PASS` (`packages/cli/src/score-diff-gate.ts:68`). It shows the loop closing. The fixed run has to be recorded first.

## Copy bank

- tagline: Score every agent diff against one repo policy.
- short description: Deterministic repository-health scoring for agent-written code. Scores each diff against a committed, fingerprinted repo policy.
- page lede: An agent says a change is done, and Pulsar checks the diff against the policy the repository has committed. It lists what the change introduced, file and line, and refuses to compare scores if anyone loosened the rules in between.
- X post: Typecheck green and tests passing don't tell you what an agent's diff did. `pulsar score --diff HEAD..WORKTREE` lists what the change introduced: a catch that swallows the error, a validator that always returns true, a ts-ignore with no reason. Each one with a file and line.
