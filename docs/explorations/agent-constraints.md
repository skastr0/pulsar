# Agent constraints under backpressure

## Question

How should green/yellow/red backpressure states change agent behavior without turning soft pulsar weights into hidden hard policy?

## Prototypes

1. **Prompt-only** — injected qualitative guidance into the system prompt.
2. **Tool-only** — blocked structural edits directly in mutating tool hooks.
3. **Hybrid** — prompt guidance for all levels, plus hard veto only for red-state structural edits.

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

## Chosen implementation boundary

Runtime adapters should own prompt injection and mutating-tool enforcement.
Pulsar should own backpressure state, policy contracts, and inspectable evidence.

Remaining future tuning is operational, not architectural:

- widen structural-change detection heuristics only if false negatives matter in practice
- add explicit justification capture for yellow-state structural moves if prompt-only steering proves too weak
