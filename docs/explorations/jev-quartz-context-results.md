# Quartz context spike: more evidence changed uncertainty, not the disputed verdict

**Historical.** The experiment CLI `scripts/jev-quartz-context.ts` and `scripts/jev-poc/quartz-context.ts` were retired. Exact sources remain at snapshot [`f09151f07e493ac9c76c84c32c38aed31df4669b`](https://github.com/skastr0/pulsar/commit/f09151f07e493ac9c76c84c32c38aed31df4669b). Findings are also summarized in [jev-poc-archive.md](jev-poc-archive.md). Commands below are not currently runnable. No new provider calls were made for this note.

The same Pulsar candidate was evaluated with the existing file-window context and with a Quartz-resolved neighborhood. **The richer context moved Jev toward a near-tie between mechanical similarity and a shared rule. It did not resolve the subsequent policy contradiction.** One treatment repeat stopped at the existing confidence gate; the other crossed it and still called the shared-rule policy violated after classifying the code as mechanics only.

This is an isolated experiment, not a production scoring change. No source repair, default signal change, or policy/threshold adjustment was made. The comparison concerns one previously observed candidate, not held-out architectural accuracy.

## Evidence and questions

The candidate is the eight identical `normalizeDiagnosticLimit` functions in Pulsar's TypeScript signals (`clone-group:TS-SL-01-duplication:5d502cd31d4f9fca`). Its detector-provided bodies and locations come from the recorded autonomous v2 run. The question factories remain `autonomous-semantic-v2`; the repo rule remains `single-rule-owner`, with its original 20-point penalty, 0.60 probability floor and 0.15 separation floor.

The new context builder:

- Uses Pulsar's production-file membership, but opens **original TypeScript project configurations** through Quartz for semantic resolution. The fast signal-analysis configurations intentionally set `noLib` and `noResolve`; those were inadequate for this experiment's relationships.
- Inventories 494 production TypeScript files and 7,076 function-like nodes. This is an inventory, not a full-project symbol graph or signature dump.
- Resolves the eight function declarations, then native compiler symbol references, enclosing reference bodies and one-hop referenced declarations. Alias resolution distinguishes a renamed import from an unrelated same-name function.
- Captures **11 reference sites, 122 declarations, 185 reference/dependency edges, and 67 external declaration contracts**. Definitions themselves are excluded from reference sites. Edges identify symbol references, not a claim to recover every runtime call.
- Sends a compact directory/function-count overview, stable per-packet declaration IDs, source locations, exact selected project declaration text and relationships. It replaces the old module windows; it does not append the entire project map.
- Removes JSDoc tokens from external-library declarations in the accepted v2 packet. String literals and complex lexical forms are preserved. Full original external declarations remain in the local plan.

Coverage is explicitly incomplete: dependencies are only one hop deep; dynamic dispatch, all runtime consumers, tests and transitive obligations are not established. The artifact also reports an unavailable `undefined` declaration and oversized `Array`/`ReadonlyArray` declaration aggregates. Selected project declaration bodies are not line-truncated. Oversized packets fail closed rather than silently clipping declarations.

Every incomplete-context finding is **unknown for consumption**, regardless of Jev's readiness or violation probability. Raw pipeline findings remain available under `diagnosticSummary` for comparison; they are not authoritative penalties or repair instructions. This safeguard is specific to the spike, not retrofitted into the production POC's aggregation.

## The completed comparison

Both epochs used predeclared **A–B–B–A** order: two independent file-window controls and two independent Quartz treatments, with no automatic retries. The same chained-question state machine drives both arms. Later questions run only if earlier answers pass the unchanged gates.

In the successful v2 epoch all 10 responses validated and reported model `jev-1.13.0`:

| Trial | Context | Mechanical similarity | Shared rule | Readiness sufficient | Chain outcome |
| --- | --- | ---: | ---: | ---: | --- |
| A1 | Old file windows | 68% | 32% | 88% | Mechanics only 98%; violated 90%; investigate |
| B1 | Quartz neighborhood | 56% | 43% | 97% | Stops: top probability below 60%, separation 13 points below 15 |
| B2 | Identical Quartz packet | 60% | 39% | 97% | Mechanics only 95%; violated 94%; direction unresolved |
| A2 | Identical old packet | 74% | 26% | 92% | Mechanics only 98%; violated 92%; investigate |

These are returned option weights, not calibrated correctness probabilities. Both treatment repeats still put mechanical similarity first, but with more weight on the competing shared-rule interpretation. An identical treatment request crossed the acceptance boundary on one repeat and not the other. Readiness rose despite this ambiguity: evidence sufficiency and interpretation certainty are different measurements.

The completed treatment did **not** demonstrate a justified domain-debt diagnosis. Its policy stage repeated the disputed mechanics-only → shared-rule-violation transition. This points to a remaining question/interpretation problem; this experiment does not establish its cause or the correct architecture verdict.

The treatment changes context selection, representation, external documentation and explicit coverage metadata together. It therefore does not isolate which added caller or declaration caused the distribution shift. Two repeats on one previously examined case cannot establish general accuracy or stable threshold behavior.

## Token cost and the failed first epoch

The old fact request used **12,210 provider-reported input tokens**. The accepted Quartz fact request used **33,169**, about 2.72× as many. Its refinement used 33,011 and policy 33,606. These are observed usage counts, not a claim about the provider's exact context-window accounting.

The first epoch retained external-library JSDoc. Its ~95.8 KB treatment fact packet received HTTP 400 `max_tokens_exceeded` on both predeclared B trials. Those are **request rejections, not model abstentions**. Both old-context controls completed and reproduced the mechanics-only/violation sequence. The initial byte guard was insufficient to guarantee admission; there is no verified Jev tokenizer in this spike. After external-documentation compaction, the fact packet was ~85.0 KB and all requests were accepted.

Across the two epochs: **18 attempted requests, 16 validated responses, two token-limit rejections**. Valid responses reported 280,591 input and 1,962 output tokens in total. The failed epoch and every successful or rejected raw receipt are retained; no answer was discarded in favor of a favorable rerun.

## Reproduce or inspect without inference (retired; not currently runnable)

The following commands are historical. Replay of recorded artifacts still requires the snapshot sources, not the current tree.

```sh
# Build a frozen context experiment; zero provider calls.
bun scripts/jev-quartz-context.ts plan <baseline-run.json> <baseline-sha256> <candidate-id> [repo]

# Explicit inference, up to four three-stage chains. Requires TYPESAFE_API_KEY.
bun scripts/jev-quartz-context.ts run <experiment.json> <experiment-sha256>

# Reconstruct requests, validate raw receipts and reproduce all four diagnostic summaries offline.
bun scripts/jev-quartz-context.ts replay <result.json> <result-sha256>
```

The accepted result is `.pulsar/context-experiments/1789705202709-d1877c10/run-1789705203083-cd1a5d1a/result.json`, SHA256 `0edd6a23369ac1f726aa093ec2256029b0d108328903d66004d3f0f8ecb1cf6c`. Its code is [the v2 experiment commit](https://github.com/skastr0/pulsar/commit/2401e46a219088387bcc9af80a280c6adc718b0f). The rejected epoch result has SHA256 `d252ee19bbe68d5ed2b31789b37ece62bb155dd3aba54590b32b87bca5f2af69` and uses [the v1 wire format](https://github.com/skastr0/pulsar/commit/0ff5f14). Wire-format changes intentionally invalidate replay under different code; retain the corresponding snapshot.

The review archive `jev-quartz-context-spike.tar.gz` includes both epochs, intents, raw receipts, compiler maps, source snapshots and verification logs. The six targeted tests exercise native function/arrow reference resolution through aliases, same-name decoys, local policy-table retention, external built-in signatures, source drift, byte-budget rejection, question preservation, incomplete-evidence consumption and documentation-token compaction. Offline CLI replay reproduced the accepted epoch's four summaries without provider calls.

Final verification at the time of the experiment: `bun run test:jev` → **150 pass, 0 fail** across 11 files; `bun run typecheck:jev` → exit 0. Those research scripts and the `test:jev` glob that targeted them are retired. An independent file read verified all 122 selected declaration texts against their source offsets and hashes. Repeated requests within each arm were byte-identical. Altered request, missing receipt and altered verdict probes were all rejected by replay. These checks establish packet integrity and execution, not semantic accuracy.
