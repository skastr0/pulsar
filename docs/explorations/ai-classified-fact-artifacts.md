# AI-Classified Fact Artifacts

## Purpose

Pulsar may use AI to classify intent-like facts that deterministic analysis cannot reliably infer, but those labels must not make scoring nondeterministic. A model call is allowed only before scoring, to produce a repo-owned artifact. Scoring consumes the artifact in offline replay mode.

```text
content hash + prompt id + model id + classifier version + input scope -> label artifact
label artifact + deterministic policy -> replayed fact output
```

This keeps Pulsar in its normal role: deterministic, inspectable evidence under repo-owned policy. AI labels are facts with provenance, not final scores.

## Artifact Boundary

AI-classified fact artifacts should live under a repo-owned reference-data path such as `.pulsar/ai-facts/*.json`. They are explicit repository artifacts, like glossary or convention files. They are not personal state, prompt memory, or hidden agent output.

The first executable schema lives in `packages/core/src/ai-facts.ts`:

- `schema_version`: currently `pulsar.ai_fact_label.v1`;
- `artifact_id`: stable repo-local id for the label artifact;
- `classifier`: classifier id, classifier version, prompt id, prompt fingerprint, model id, and optional provider;
- `input`: input scope, content hash, input fingerprint, source paths, optional symbol, and optional git SHA;
- `label`: label kind, value, confidence, rationale, and evidence references;
- `policy`: missing-label behavior, stale policy, review route, and enforcement ceiling;
- `provenance`: whether this is a model-run artifact, offline replay fixture, repo artifact, or generated cache.

The replay output explicitly emits:

- `fact_source: "ai_classified"`;
- classifier metadata;
- input metadata;
- policy and enforcement ceiling;
- `cache_fingerprint`;
- `artifact_fingerprint`.

Deterministic fact sources should continue to identify themselves as deterministic through their own outputs. AI-consuming signals must make the source distinction visible in diagnostics or output data. Signals that replay AI-classified facts should also set public signal metadata `factSource: "ai_classified"` so serialized observer JSON keeps the distinction without exposing full runtime-only signal outputs.

## Cache Contract

The AI fact cache fingerprint includes the fields that would make two labels semantically different:

- input `content_hash`;
- classifier `prompt_id`;
- classifier `prompt_fingerprint`;
- classifier `model_id`;
- classifier `version`;
- input `scope`;
- input `input_fingerprint`;
- normalized `source_paths`;
- optional input symbol.

Changing any of those fields changes `computeAiFactCacheFingerprint()`. The full artifact fingerprint also includes the label, policy, and provenance so committed artifacts can be audited independently of cache identity.

Tier-3 cache confidence decay may still apply to runtime caches, but offline replay tests must compare deterministic replay serialization, not wall-clock-sensitive cache metadata.

## Replay Rule

Scoring must be able to run without network or model access:

1. Load committed artifact JSON.
2. Decode it with `AiFactLabelArtifact`.
3. Replay it with `replayAiFactArtifact()`.
4. Feed the replayed facts to downstream deterministic policy or review routing.

The committed fixture `packages/core/src/__tests__/fixtures/ai-facts/architectural-role.sample.json` proves this path. The test serializes replay output twice and expects byte-identical output.

## Enforcement Ceiling

AI-classified facts start at Tier 3. They can soft-warn or route review by default. They cannot hard-gate directly.

Allowed artifact ceilings:

- `informational`;
- `review-route`;
- `soft-warning`.

`hard-gate` is intentionally not a valid `AiFactEnforcementCeiling`. If a team wants a hard gate informed by AI, the AI label must first be converted into a human-reviewed deterministic artifact or a deterministic rule that can be replayed and reviewed without model authority.

## Missing Labels

Missing AI labels must not silently become a healthy zero. Artifact policy declares one of:

- `fail-open`: no label means no AI pressure;
- `ignore`: consumers ignore the missing label entirely;
- `soft-warn`: consumers may emit an informational or warning diagnostic that the label is missing.

The chosen behavior is part of the artifact and therefore visible to reviewers.

## Open Integration Work

This design intentionally stops before broad runtime loading. The next implementation step should load `.pulsar/ai-facts/*.json` through the reference-data path, expose aggregate artifact fingerprints, and let a Tier-3 proof signal consume replayed labels. That integration must preserve the same schema, cache key contract, output source distinction, and enforcement ceiling tested here.
