# Cross-language score normalization

**Status**: Built + documented — TC-065  
**Date**: 2026-04-19  
**Scope**: Final Wave A core composition / normalization batch

---

## Question

When a workspace contains both TypeScript and Rust, is a raw signal score of `0.7` in one language meaningfully comparable to `0.7` in the other?

## Short answer

**Not enough to justify raw score remapping.**

The committed design is therefore:

1. **Keep raw signal scores language-local.**
2. **Do not invent a hidden TS↔Rust scalar conversion.**
3. **Aggregate only at the category layer, and only explicitly.**
4. **Surface the aggregation strategy in output so it is auditable.**

That is now implemented as `language-group-mean` normalization in `ObserverOutput.categories[*].normalization`.

---

## Evidence considered

### 1. Current workspace observation

Running:

```bash
bun run "./packages/codec-cli/src/bin.ts" score --json .
```

showed that mixed-category aggregation already needs explanation even before full TS+Rust weighting. For example, `generated-slop` now reports an explicit breakdown instead of a silent blended mean:

- `typescript` group
- `shared` group
- `default` group (framework/plugin-level signals)

This confirmed the core problem: **once multiple signal families coexist, a single raw mean hides where the score came from.**

### 2. Polyglot fixture validation

`packages/codec-cli/src/__tests__/shared-signals.test.ts` builds a synthetic TS+Rust repo and verifies:

- shared signals register exactly once
- TS and Rust suppression inputs both feed `SHARED-05`
- polyglot composition works without duplicate shared ids

This validates the composition shape, but it is **not** enough evidence to justify percentile remapping between languages.

### 3. Negative evidence

No real corpus of matched TS and Rust repositories exists in-tree that would support:

- percentile normalization
- broken↔healthy anchor calibration
- language-specific transfer functions

Without that corpus, any direct `TS 0.7 -> Rust 0.7` mapping would be fabricated.

---

## Options considered

### Option A — raw per-signal normalization

Map TS and Rust scores onto a shared scalar before category aggregation.

**Rejected for now.** There is not enough empirical evidence to defend the mapping.

### Option B — no normalization at all

Keep scores side-by-side forever and never aggregate.

**Too weak.** Polyglot workspaces still need a category view for routing, backpressure, and shared governance.

### Option C — category-layer normalization only

Keep raw signal scores local to their language pack. When multiple language groups appear in one category, compute:

- per-group weighted mean first
- then an explicit `language-group-mean`

**Chosen.** This gives a usable aggregate without pretending the underlying signals are directly comparable.

---

## Committed recommendation

### Implemented rule

If a category contains more than one language-local group, the observer now emits:

```json
{
  "normalization": {
    "strategy": "language-group-mean",
    "groups": {
      "typescript": { "score": 0.51, "signalCount": 4 },
      "rust": { "score": 0.74, "signalCount": 4 },
      "shared": { "score": 1.0, "signalCount": 1 }
    }
  }
}
```

Semantics:

- raw signal scores stay unchanged
- no hidden cross-language remapping is performed
- the aggregate is explicit and auditable

### Why this is honest

It answers the operational need — "give me one category score for this mixed workspace" — while preserving the epistemic fact that the underlying languages are still different measurement domains.

---

## Implementation hooks landed in this batch

- `packages/codec-shared-signals/` now owns shared-pack composition
- shared aggregates (`SHARED-05`, `SHARED-06`) compose once across packs
- `SignalInputRef.optional` allows shared aggregates to work with TS-only, Rust-only, or mixed registries
- `ObserverOutput` exposes category normalization metadata when cross-group aggregation occurs

---

## Residual gap

This is **composition-safe normalization**, not **empirical calibration**.

What is still not solved:

- whether TS and Rust complexity distributions can ever be directly mapped
- whether a percentile-based strategy is better once real polyglot history exists
- whether shared/default groups should eventually receive explicit weights instead of equal group means

---

## Follow-up

See **TC-076 — Empirical polyglot normalization calibration**:

- `docs/explorations/empirical-polyglot-normalization-calibration.md`
- `docs/explorations/empirical-polyglot-normalization-calibration.data.json`

TC-076 evaluated three real polyglot repos (`fractals-agent`, `agent-browser`, `entele-forge-tauri`) and again rejected percentile / anchor remapping as not yet defensible.
