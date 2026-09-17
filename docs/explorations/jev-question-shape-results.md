# Jev recognizes contracts more reliably than it ranks these architectures

**Observed:** 2026-09-17. **Scope:** 12 research requests over three real Pulsar implementation pairs. No production code, score, weight, cache, or adopted calibration changed. This follows the [first-access experiment](jev-spike-results.md); it does not replace its unfavorable observations.

The Oracle proposed this bounded experiment and interpreted its recorded results. The parent agent executed the API calls and independent checks; the Oracle did not call Jev itself. The outcome supports retaining narrow, contract-level questions. It does not establish that optimizing a Jev number improves architecture, and it does not justify a composite score yet.

## What was sent

Each POST to `https://api.typesafe.ai/v1/systemone` contained `{ model: "jev-latest", state, questions }`. State held full source for two hypothetical alternatives, selected supporting excerpts, explicit behavior obligations, and an explicitly proposed repository-scoped preference. Requests were 28,435–43,571 serialized bytes, with 10–12 questions each. The API key was an authorization header, never part of the recorded packet.

The [experiment definition](../../scripts/fixtures/jev/question-shapes.json) supplies questions and criteria. The [candidate builder](../../scripts/jev-spike/shape-candidates.ts) generates actual source alternatives with drift-checked replacements. These alternatives are research fixtures, not changes adopted into production:

| Subject | Original A | Candidate B | Independent checks outside Jev input |
| --- | --- | --- | --- |
| Extraction | Successful `SignalRunResult` construction in both `runner.ts` and `observer-execution.ts` | Shared `finalizeSignalResult`; computation and failure handling remain in their callers | Compiler; metadata/ledger, vector overrides, inactive handling, capped diagnostics, runner failure propagation and observer isolation |
| Consolidation | Observer scheduler uses private mutable-state phase helpers | One local selection/snapshot/execution/publication sequence; per-signal computation remains separate | Compiler; matching outputs, downstream inputs, metadata, inactive IDs, invocation counts, failure isolation and batch visibility in a small dependency graph |
| Representation | `CacheLookupResult<T>` has optional payload fields | Miss versus hit/stale union; non-miss payloads required; consumer non-null assertions removed | Fixed-time runtime lookup comparisons; actual `tsc` assignability and narrowing probes, including miss-with-confidence |

The policies are **proposed experiment criteria, not adopted Pulsar policy**. Supporting `.pulsar/modules/pulsar-self.ts` excerpts describe this repository's calibration, not a universal preference. Neither “extract more” nor “consolidate more” becomes product behavior. There is no personal/per-agent policy. The same mechanism must support a different repository's explicitly different calibration.

The request schedule was fixed and committed before inference: extraction flat/swapped/structured, consolidation flat/swapped/structured, representation flat/swapped/structured, extraction with a deliberately missing severity ceiling, consolidation with policy removed, and a byte-identical repeat of consolidation-flat. Total: 12 attempts, concurrency one, 30-second timeout, zero retries. The mode stops after authentication/schema incompatibility and records remaining slots as not attempted; this stop path was exercised locally, not by live failures.

Flat and structured treatments contain the same named instruction/criterion fields. Each packet includes independent factual questions, matched Choice and Score descriptions of one organizational property, a policy preference, and separate evidence/policy readiness. Choice adds an explicit insufficient-evidence outcome. Local dependency metadata controls consumption, not what state the provider sees. Questions do not receive sibling answers.

## Results: facts stable here, preferences not

Probabilities below are provider outputs, **not measured accuracy**. Swapped results refer to the physical implementation, not its changing A/B label.

| Probe | Observed result | Supported conclusion |
| --- | --- | --- |
| Shared successful-result contract | `same_operation` 1.00 in all three treatments; distinct failure behavior 0.85–0.95; both severity ceilings supported 1.00 | Recognizes a shared operation without equating entire execution policies in these packets |
| Extraction preference | Shared constructor 0.98 flat, 0.99 swapped, 0.99 structured | Stable preference under this explicit criterion in three calls; not general extraction accuracy |
| Observer protocol | Helper form and local sequence identified across treatments; early publication contradicted 0.95–1.00 | Useful source-level data-flow distinctions on the supplied scheduler |
| **Identical consolidation repeat** | Original helpers preferred 0.60 versus local sequence 0.36; exact repeat prefers local sequence 0.52 versus original 0.43 | A ranking reversal without any input change; no fresh-inference determinism |
| Cache representation | Original `producer_only` 0.76–0.83; union `type_and_producer` 0.94–0.96; no added runtime validation 1.00 | Distinguishes implementation guarantees, static guarantees and executable validation |
| **Cache preference swap** | Flat/structured prefer optional-field original 0.62; swap prefers the union 0.85. Winning label remains `a` | Compatible with label/position sensitivity; not isolated from response variation by this small design |
| Missing severity ceiling | `severity_preserved_b: contradicts` 1.00, independently confirmed by uncapped `block`; preference original 0.52, neither 0.23, mutant 0.20 | Direct obligation question succeeds; broad preference does not reliably enforce its result |
| **No policy** | Policy `missing` 0.99; preference `equivalent` 0.55 versus `insufficient_evidence` 0.21 | Missing policy must deterministically prevent ranking. The local mask does so, preserving other descriptive answers |

All 24 matched Choice/Score pairs select the same descriptive anchor, although their distributions differ. These are repeated treatments of three subjects, not 24 independent architectural validations. Structured descriptions are accepted by the API, including structured Score legends, but this batch demonstrates no improvement from formatting alone.

The mutant still has one implementation owner, so its high sharing measurement is not itself wrong. Treating that measurement as correctness would be wrong. Mandatory obligations must disqualify a candidate, not be averaged against architectural preferences.

The consolidation criterion allows an unresolved judgment about whether a helper hides an independently useful contract. Thus the initial helper preference is not independently labeled wrong. The identical-repeat reversal is nevertheless observable. The representation criterion more directly favors expressing the producer guarantee without runtime change; its preference reversal conflicts with that straightforward interpretation. There is no independent human label adjudication here.

## Documentation implications

The research read the main concepts/primitives, patterns and relevant cookbooks, with a follow-up Oracle reading. This is not a claim to have audited every generated SDK page.

- [Score](https://docs.typesafe.ai/primitives/score) evaluates each descriptive level independently. Numeric positions and neighboring levels are not visible to the model. The returned mean is a position on the supplied scale, not calibrated architectural utility; confidence describes the distribution, not correctness.
- [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) combines separate measurements using application-owned weights. It is an option, not a requirement. These three measurements have no established common utility or validated tradeoffs to aggregate.
- [Independent questions](https://docs.typesafe.ai/primitives#when-one-question-depends-on-another) do not consume sibling answers. Where an answer really depends on a prior result, use code or a subsequent request. An obligation question cannot make a sibling preference enforce its verdict.
- [Entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment) demonstrates a single routing Score with diagnostics, not necessarily a composite. Recognizing the same entity or operation does not by itself justify a software extraction.
- [Autoresearch feature discovery](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) tests measurements against external labels and held-out data. Learning to predict architecture labels and showing that optimizing the resulting number improves code are separate experiments.
- [Choice consistency](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) explicitly distinguishes repeatability from correctness. Its illustrative top-probability threshold of 0.60 would accept both conflicting cache preferences here, at 0.62 and 0.85. It is not a transferable acceptance threshold.

## Recommended question shape, not an adopted scoring design

Retain bounded questions whose answer can be checked against a contract or a concrete maintenance task:

| Purpose | Example |
| --- | --- |
| Shared concept | “Do these two sites implement the same operation on an already-computed output?” |
| Change coupling | “Given requirement R, do both sites need the same semantic change, or does one caller intentionally require different behavior?” |
| Data flow | “Can this batch publish a result before collection completes?” |
| Representation | “Does this consumer assertion rely on a producer guarantee that the type fails to express?” |
| Change ownership | “Which supplied implementation owns the rule that requirement R changes?” |

For a future optimization loop: freeze the repo/org policy and evaluation definition; generate a candidate; check mandatory obligations independently; assess relevant semantic facts; interpret those facts using explicit repository-owned calibration; retain the evidence for independent review. A compiler owns assignability facts. A passing model readiness answer does not establish correctness or policy adoption. Missing policy means no ranking, not equivalence.

Do not implement a composite merely because a scalar is the eventual product goal. A composite may become appropriate after a repository explicitly adopts multiple graded objectives and their tradeoffs, and held-out evaluation demonstrates useful ranking. Broken obligations must remain non-compensating. Future score-affecting rules need IDs, scope/activation evidence, sources and fingerprints, including source, effective policy/calibration, question definitions and model identity. Recorded replay and fresh inference remain different guarantees.

The Oracle's proposed next experiment, **not executed here**, is one real change-impact task on extraction A/B. Choose a new severity-authorization requirement affecting both entry points. Both variants already delegate that rule to `enforceSeverityCeiling`, so the additional result constructor may offer no edit advantage for that task. Independently define expected edit regions, ask Jev to locate the change owner, implement the requirement in scratch A/B, and check the new and existing obligations. Success means correct, scoped change guidance—including recognizing when no extra abstraction is needed—not a larger sharing number.

## Receipts and reproduction

All **12/12 POSTs returned HTTP 200 and validated on replay**. All responses identified `jev-1.13.0`; requests selected `jev-latest`, so immutable version pinning remains unresolved. Input usage: **120,905 tokens**; output: **6,572 tokens**. Under the recorded $0.042/million input-token and free-output assumption, cost is **$0.00507801**, not verified account billing. Orb-observed fetch/body latency: **p50 141 ms, p95/max 302 ms**, nearest-rank percentiles. This serial, small-sample measurement excludes evidence preparation and local checks; it is not a service-level benchmark.

Exact receipts, intents, manifest, plan and summary are retained in the thread artifact `jev-question-shapes-2026-09-17.tar.gz`. The source variants are inside the plan and raw run, so replay does not require the source to remain unchanged. The bundle contains no authorization headers. Its `run.json` digest is independently recorded here:

```text
run SHA256: 22d15ba7b645ef2d0aad824ce17da3cbc6ac7344450a135f251368fbabdd82b1
canonical plan SHA256: 2e2a5abf9989bfb71b0bda5bf271d6e4a4de37b95e4a259cb7276dca845413e6
consolidation flat/repeat request SHA256: 4866c33a51c9c1bbaec7d23959ffe375c4345ffe5f25bb9c7eaadc30fff7df00
```

The implementation was checkpointed before inference at [14e8910](https://github.com/skastr0/pulsar/commit/14e8910fcac4f06a9163451c03e43cd5e1f7aa4b), local-only when recorded. The digest detects later edits; it is not signed provider authentication.

After extracting the archive from the repository root:

```sh
bun run research:jev replay .pulsar/jev-research/question-shapes/run.json \
  22d15ba7b645ef2d0aad824ce17da3cbc6ac7344450a135f251368fbabdd82b1
```

For a separately authorized fresh experiment, use new paths and inspect the prepared packet before egress:

```sh
bun run research:jev prepare question-shapes .pulsar/jev-research/new-shapes-plan.json
bun run research:jev evaluate .pulsar/jev-research/new-shapes-plan.json \
  .pulsar/jev-research/new-shapes-run --allow-egress
```

Validation: `bun run typecheck:jev` passed; `bun run test:jev` returned **35 pass, 0 fail**, including real candidate compiler/runtime checks, structured-response validation, per-question masking, request controls and the previous corpus. Historical development replay remains **25 valid / 25**. There is still no held-out architectural evaluation, matched conventional-provider baseline, independently labeled policy comparison, score-directed agent trial, calibrated decision threshold or production enforcement integration.
