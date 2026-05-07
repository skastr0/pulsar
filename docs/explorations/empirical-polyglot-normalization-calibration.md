# Empirical polyglot normalization calibration

**Status**: Built + documented — TC-076  
**Date**: 2026-04-19  
**Scope**: Final follow-up batch B

Machine-readable evidence: `docs/explorations/empirical-polyglot-normalization-calibration.data.json`

---

## Question

Given real TypeScript + Rust repositories, is there enough evidence to remap TS and Rust category scores onto one shared scalar?

## Short answer

**No.**

On the evaluated corpus, neither **percentile calibration** nor **anchor calibration** is defensible enough to ship as a default TS↔Rust scalar remap.

The honest default remains:

1. keep raw signal scores language-local
2. aggregate mixed categories with explicit `language-group-mean`
3. require explicit provenance + audit metadata for any future calibration experiment

---

## Corpus and provenance

All three repos were scored locally with:

```bash
bun run "./packages/cli/src/bin.ts" score --json <repo>
```

| Repo | Origin | HEAD | TS commit-touches / files | RS commit-touches / files |
| --- | --- | --- | ---: | ---: |
| `fractals-agent` | `git@github.com:skastr0/fractals-agent.git` | `4c742a494b64` | `11 / 130` | `57 / 90` |
| `agent-browser` | `https://github.com/vercel-labs/agent-browser` | `fa043a496f75` | `157 / 116` | `239 / 53` |
| `entele-forge-tauri` | `git@github.com:castrotechstudio/entele-forge.git` | `c3e50d2afad6` | `390 / 310` | `34 / 16` |

This is a **real** corpus, but still a **small** one. It is enough to reject a hand-wavy remap, not enough to justify a strong one.

---

## What was compared

For each repo and each mixed TS+Rust category, TC-076 compared:

- raw TS signal score distribution
- raw Rust signal score distribution
- emitted `normalization.groups.typescript.score`
- emitted `normalization.groups.rust.score`
- the TS-minus-Rust group gap

This is category-level empirical calibration evidence, not a theoretical argument.

---

## Pooled category findings

| Category | Avg TS group mean | Avg RS group mean | Avg TS-RS gap | Read |
| --- | ---: | ---: | ---: | --- |
| `architectural-drift` | `0.928` | `0.959` | `-0.031` | Mostly ceilinged at `1.0`; weak calibration signal |
| `dependency-entropy` | `0.592` | `0.732` | `-0.140` | Rust above TS in 2/3 repos |
| `abstraction-bloat` | `0.911` | `0.660` | `+0.251` | TS above Rust in all 3 repos |
| `legibility-decay` | `0.935` | `0.779` | `+0.156` | TS above Rust in all 3 repos |
| `generated-slop` | `0.233` | `0.218` | `+0.015` | Sign flips by repo (`+0.450`, `0`, `-0.405`) |
| `review-pain` | `0.835` | `0.838` | `-0.003` | Closest match, but high-ceiling and different signal sets |

### What this means

- There is **no stable global offset** between TS and Rust.
- There is **no stable direction** across categories.
- The categories that look closest (`architectural-drift`, `review-pain`) are also the most ceilinged.
- The categories with strong separation (`abstraction-bloat`, `legibility-decay`) separate in the **opposite direction** from `dependency-entropy`.
- The pooled all-signal means look superficially close (`TS 0.7405`, `RS 0.6877`), but that is cancellation between categories, not evidence of a common scale.

---

## Recommendation

### Percentile calibration

**Reject for now.**

Why:

- the observed distributions are category-specific, not globally aligned
- several distributions are ceilinged or zero-inflated, which makes percentiles unstable
- the corpus is too small to defend a durable transfer function
- repo-local percentiles would not travel cleanly across repos

### Anchor calibration

**Reject for now.**

Why:

- there is no independently labeled “healthy” / “broken” TS+Rust anchor set
- picking anchors from this corpus would bake in repo- and domain-specific bias
- ceiling effects would make the anchor fit look stronger than it really is

### Default to keep

Keep the TC-065 rule:

- no hidden TS↔Rust scalar remap
- raw scores remain language-local
- mixed categories continue to expose explicit `language-group-mean`

---

## Fail-closed contract for any future experiment

This ticket does **not** recommend implementing remapping now.

If a later ticket ever revisits it, require all of the following:

1. **Per-category calibration only** — never one global TS↔Rust transfer function.
2. **Versioned artifact** — one committed calibration artifact per category + language pair.
3. **Corpus provenance** — origin URL, head SHA, scoring command, pulsar version, commit/file counts.
4. **Observer audit output** — raw group scores must remain visible beside any calibrated value.
5. **Fail-closed status** — `accepted`, `experimental`, or `rejected`; anything except `accepted` must leave the score on raw `language-group-mean`.

Suggested artifact envelope:

```json
{
  "schema_id": "pulsar/polyglot-calibration/v1",
  "artifact_id": "ts-rust-legibility-decay-2026-04-19",
  "decision": "rejected",
  "method": "percentile",
  "category": "legibility-decay",
  "languages": ["typescript", "rust"],
  "corpus": [
    {
      "origin": "https://github.com/vercel-labs/agent-browser",
      "head_sha": "fa043a496f7579680c78b22d0a5015f48dc99a4d",
      "ts_commits": 157,
      "rs_commits": 239
    }
  ],
  "warnings": ["small-corpus", "ceilinged-distribution"]
}
```

Suggested observer audit shape:

```json
{
  "normalization": {
    "strategy": "language-group-mean",
    "groups": {
      "typescript": { "score": 0.92, "signalCount": 6 },
      "rust": { "score": 0.74, "signalCount": 6 }
    },
    "calibration": {
      "status": "rejected",
      "artifact_id": "ts-rust-legibility-decay-2026-04-19",
      "method": "percentile",
      "reason": "no defensible remap on current corpus"
    }
  }
}
```

That keeps the output auditable even when the answer is “do not calibrate.”

---

## Limitations

- only 3 repos
- head-snapshot scoring, not longitudinal replay
- analogous categories are not strict one-to-one signal maps
- one repo (`fractals-agent`) is history-asymmetric between TS and Rust

Those limitations argue for more caution, not less.

---

## Conclusion

TC-076 strengthens the TC-065 conservative answer.

There is now **real corpus evidence** against shipping a default TS↔Rust scalar remap. The defensible recommendation is still:

**keep raw language-local scores and aggregate only with explicit `language-group-mean`.**
