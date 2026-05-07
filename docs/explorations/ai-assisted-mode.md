# AI-assisted mode exploration

## Goal

Represent AI-assisted code review pressure as an explicit vector mechanism, not a hidden branch in the scoring engine.

## Research summary

The architecture already cites two consistent observations:

- AI-assisted code tends to increase complexity faster than manual code
- AI-assisted workflows also correlate with more duplication and clone pressure

That is enough to justify a stricter preset prototype without pretending we already have perfect automatic detection.

## Prototype implemented

- Preset: `packages/core/presets/ai-slop-defense.json`
- Explicit vector marker: `modes.ai_assisted: true`

The prototype tightens thresholds through ordinary vector overrides:

- `TS-LD-01.max_complexity`: `20 -> 15`
- `TS-SL-01.min_tokens`: `12 -> 8`
- `TS-RP-01.min_churn`: `2 -> 1`
- `TS-RP-01.min_complexity`: `5 -> 4`
- stronger weights on `TS-SL-*`, `TS-LD-01`, `TS-AB-03`, `TS-AB-05`

## Comparison analysis

Compared with a general preset such as `strict-type-safety`, the AI-assisted preset:

- raises duplication sensitivity
- raises unfinished-stub sensitivity
- tightens hotspot and complexity thresholds
- leaves the mechanism visible in the vector itself

That keeps composition simple: the Observer still reads one vector, and review tooling can explain why the thresholds are tighter.

## UX recommendation

Treat AI-assisted mode as a **named preset / mode combination**:

1. visible in the vector via `modes.ai_assisted: true`
2. selectable via persona flows
3. diffable via `pulsar persona diff ai-slop-defense`

This avoids the dark pattern of a hidden switch while still making the stricter posture easy to opt into.

## Recommendation

Ship AI-assisted mode as an **explicit preset-backed vector mode** first.

Do not auto-detect AI usage in this batch. Detection can come later, but the scoring effect should remain encoded in normal vector fields so it stays inspectable.

## Follow-up

- Build ticket: `TC-075 — AI-assisted mode auto-detection`
