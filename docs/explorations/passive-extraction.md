# Passive signal extraction exploration

## Goal

Extract preference evidence from natural editing activity without silently mutating the user's vector.

## Observable source inventory

### 1. `tool.execute.after` in the opencode plugin

- **Available now**
- Sees edit-tool activity plus the resulting Observer delta
- Good enough for a prototype because it can log concrete signal improvements after a change
- Limitation: this currently observes agent-mediated edits, not arbitrary IDE keystrokes

### 2. Git history batch scans

- Better for coarse retrospective signals
- Too blunt for “what did the user just correct?”

### 3. IDE-native hooks

- Richest future source
- Not required for this batch

## Prototype implemented

Prototype code lives in:

- `packages/codec-core/src/elicitation/proposals.ts`
- `apps/opencode-plugin/src/server/taste-codec-hooks.ts`

Current behavior:

1. after each edit-time Observer run, compare previous vs current signal scores
2. if a signal improves by `>= 0.20`, create a **pending proposal** instead of mutating the vector
3. append an observation record to `.taste-codec/observations.log`
4. write the structured proposal to `.taste-codec/proposals/pending/<id>.json`

This keeps the prototype auditable and confirmation-first.

## Pattern catalog (initial)

- **Suppression cleanup** → stronger `TS-SL-03`
- **Complexity reduction after edits** → stronger `TS-LD-01`
- **Boundary repair** → stronger `TS-AD-01` / `TS-AD-02`
- **Duplication removal** → stronger `TS-SL-01` / `TS-SL-02`
- **Hotspot relief** → stronger `TS-RP-01`

## False-positive containment

- no silent vector writes
- require a score delta threshold
- cap each proposal to the top 3 improving signals
- write proposals as **pending confirmation** only

## Confirmation UX mockup

```text
I noticed recent edits consistently improved these signals:

- TS-SL-03  0.40 -> 0.90
- TS-LD-01  0.55 -> 0.80

Proposed vector updates:
- TS-SL-03 weight 1.00 -> 1.25
- TS-LD-01 weight 1.00 -> 1.12

Apply now? [y/N]
Review artifact: .taste-codec/proposals/pending/proposal-abc123def456.json
```

## Recommendation

Go forward with **proposal-first passive extraction**.

Do **not** auto-apply weight changes. The right product shape is:

1. observe deterministic signal deltas
2. accumulate auditable pending proposals
3. require confirmation before the vector changes

## Follow-up

- Build ticket: `TC-074 — Passive proposal confirmation flow`
- Open question deferred: IDE-native observation capture beyond tool-mediated edits
