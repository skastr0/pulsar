# Agent constraints under backpressure

## Question

How should green/yellow/red backpressure states change agent behavior without turning soft pulsar weights into hidden hard policy?

## Prototypes

1. **Prompt-only** — injected qualitative guidance into the system prompt.
2. **Tool-only** — blocked structural edits directly in mutating tool hooks.
3. **Hybrid** — prompt guidance for all levels, plus hard veto only for red-state structural edits.

## Measurement

The implemented tests exercise the chosen seams:

- `apps/opencode-plugin/test/server.test.ts`
  - red-state structural edits are blocked
  - system prompt guidance is qualitative and score-free
- `apps/opencode-plugin/test/probe-bridge.test.ts`
  - Probe session start gets a precomputed snapshot before planning

## Recommendation

Use the **hybrid** mechanism.

- **Green**: advisory prompt only
- **Yellow**: advisory prompt only, explicitly steering reuse of existing terms/patterns
- **Red**: advisory prompt plus tool-level veto for structural changes (new files, structural manifests)

This keeps the coercive path narrow and evidence-based.

## Why this approach

- avoids pretending that prompt text alone is enforcement
- avoids broad noisy tool blocks in yellow state
- keeps red-state hard stops concrete, inspectable, and reversible
- preserves a single canonical seam for runtime enforcement: mutating tool hooks

## Chosen implementation

- `apps/opencode-plugin/src/server/agent-constraints.ts`
- wired in `apps/opencode-plugin/src/server.ts`

## Residual follow-up

The implementation landed inline in Wave 4B, so no separate build ticket is required for the committed mechanism.

Remaining future tuning is operational, not architectural:

- widen structural-change detection heuristics only if false negatives matter in practice
- add explicit justification capture for yellow-state structural moves if prompt-only steering proves too weak
