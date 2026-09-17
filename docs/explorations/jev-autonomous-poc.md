# Autonomous semantic health POC

This is an opt-in **tool**, not an agent prompt. Pulsar computes the signals, selects source, composes every question, follows the answers through a bounded state machine, and applies the repository's declared penalties. The invoking agent supplies no code excerpts, labels, diagnoses, or proposed refactors.

This source-checkout command is experimental. It does not change published CLI contracts, built-in signal scoring, or the production project-module manifest.

## Run it once

```sh
# No provider calls: inspect deterministic discovery and the selected policy.
bun run dev semantic plan . --trust-project-code

# Requires TYPESAFE_API_KEY in the environment; sends selected source to Jev.
bun run dev semantic run . --trust-project-code

# After a repair, refuse to compare against changed interpretation/configuration.
bun run dev semantic run . --trust-project-code --expect-policy <policyFingerprint>

# Offline: use the exact runPath and runHash printed by a completed run.
bun run dev semantic replay <runPath> <runHash>
```

`run` exits 0 for green, 2 for red, 3 for unresolved/amber, and 1 for configuration or execution errors. `plan` and successful `replay` exit 0 independently of health. Each invocation starts fresh inference; there is no hidden favorable-answer cache or automatic retry. Recorded replay is deterministic; fresh Jev inference is not.

The repository must own `.pulsar/modules/semantic-policy.ts`. There is no personal semantic policy, fallback, or policy-free score. The module exports explicit include/exclude scope, rules, fixed penalties, confidence/margin floors, budgets and optional executable `selectRules(candidate)`. Executing it requires `--trust-project-code`; it is trusted code, not sandboxed. Static owned dependencies are content-hashed and materialized using the existing SDK loader. Arbitrary environment/network reads and external dependency bytes are not covered by this identity.

`--expect-policy` covers semantic module source/configuration, structural assessment policy, the requested model identifier, question version and POC implementation bytes. It cannot pin the server's implementation behind `jev-latest`; responses record their reported model version. Changing the tool or policy creates a different scoring epoch, not a repair.

## Pulsar owns all transitions

```text
runAgentAssessment (repo/org vector + existing modules)
  → full clone-group and complexity-function outputs, never diagnostic top-N
  → repo scope + deterministic ranked/interleaved candidate budget
  → exact function extents + bounded imports/consumers/source context
  → Jev: readiness + semantic relationship
  → when clear, Jev: relationship-specific refinement
  → when clear, Jev: compliance with each explicit applicable repo rule
  → deterministic fixed penalties, unresolved interval, existing hard gates
```

Stage-one labels describe shared rules, distinct rules, integration, forwarding, cohesive operations or mixed responsibilities. They are authored hypotheses, not validated universal architectural categories. The next stage asks a narrower question selected by the clear relationship. Near-ties stop as unknown; this POC does not implement multi-branch retention. The last stage receives the explicit repository criterion and fallible prior judgments alongside the original source.

Jev never invents reported locations. Findings refer to discovery's hashed file/line pointers. Directions such as consolidate a rule or investigate a forwarding boundary are bounded options, not generated patches or proofs of behavior preservation.

## The number has a declared meaning

Each clear violation costs its rule's fixed `penaltyPoints`. Clear compliance or non-applicability costs zero. A missing/ambiguous answer reserves that rule's full possible penalty. Identical rule/member-set observations are deduplicated before inference and aggregation.

With known penalty K and unresolved penalty U, the semantic interval is `[max(0, 100 − K − U), max(0, 100 − K)]`. Incomplete discovery forces the lower endpoint to zero because omitted candidates have unbounded total debt within this sample. The reported semantic score is the lower endpoint. **The upper endpoint assumes all unread evidence is benign; it is not a passing score.**

Green requires complete in-scope discovery, no unresolved judgment, and the policy's `greenAt` threshold. Confirmed debt below `redBelow` makes the semantic result red; uncertainty alone is amber. The overall `health` score is the minimum of the semantic lower bound and Pulsar's existing readiness score. Existing hard gates remain non-compensating: a semantic pass cannot turn a failed structural gate green.

There is no per-file/per-candidate average. Adding compliant candidates cannot dilute known penalties. It can consume the discovery budget and increase uncertainty, which is exposed rather than rewarded. Removing evidence cannot buy green. Repository scope exclusions remain visible and part of policy identity.

The supplied self-policy is illustrative calibration: 20 points for independently copied shared rules and 15 for unsupported boundaries/mixed responsibilities. Those weights and confidence floors are not empirically calibrated. **Green means only that the declared checks found no disqualifying debt within their detector-reachable scope**, not that every architectural problem is ruled out.

## Receipts and evaluation

Every live run writes an immutable plan and exclusive intent files before egress under `.pulsar/semantic-runs/`. Receipts retain raw provider bodies, exact requests, hashes, request IDs, status and latency. Replay reconstructs every transition, checks exact request identity and hash, validates raw responses against their questions, and recomputes the summary. A caller-supplied run SHA256 protects the entire recorded artifact. Failed/invalid provider responses remain unknown; there is no second stored answer object that can drift from the raw body.

`bun scripts/jev-poc-smoke.ts` creates disposable TypeScript/Git development repositories, runs the real signal engine and unchanged semantic pipeline, and retains receipts. It compares delegation, copied rule bodies, independent same-shaped rules, and repair. No expected outcome or fixture description is passed into discovery or Jev. These small authored cases test end-to-end operation, **not held-out accuracy**.

The separate mutation fixtures in `scripts/jev-poc/challenges.ts` operate on real Pulsar code: a duplicated rule, a forwarding wrapper, independent same-shaped rules, healthy-file padding and a low-ranked duplicate. Their tests establish detector reach and selected behavioral preservation; they do not by themselves validate semantic score movement. Notably, the wrapper appears in the full complexity inventory despite producing no over-threshold diagnostic. Top-N diagnostics alone would miss it.

See [taxonomy research](jev-autonomous-taxonomy.md) for alternative questions and proposed extensions, not the implemented API contract. Earlier [staged experiments](jev-staged-judgment-results.md) justify explicit gating and ambiguity reporting; they did not establish better policy judgment accuracy.
