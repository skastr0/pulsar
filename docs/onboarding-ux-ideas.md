# Onboarding UX ideas from a discarded prototype

## Decision

The obsolete local onboarding polish implementation was discarded, not merged.
The current `main` implementation is canonical: typed calibration actions, real
previews and persistence, explicit failure states, and compiled TUI delivery.
These notes preserve useful design ideas, not a porting plan or a second flow.
They are proposals, not claims that the current implementation supports them.

## Useful ideas and acceptance criteria

| Idea | What would make it useful and trustworthy |
| --- | --- |
| Source snippets beside findings | Show a bounded window of actual repository code with repo-relative paths, line numbers, and the diagnostic line kept visible. Handle missing and oversized files. Never present a guessed line as an authoritative diagnostic location. |
| Browse evidence without changing an answer | Left/right cycles through findings with a visible position counter. Keep the selected answer unchanged and distinguish the displayed sample from the total finding count. |
| Lightweight syntax coloring | Improve code readability without compromising compiled delivery or introducing a heavyweight parser solely for short snippets. Preserve text exactly. |
| Compact terminal layouts | Prioritize the question, answer options, evidence, and essential shortcuts. Shorten explanatory prose first; show an explicit minimum-size state rather than silently clipping controls. |
| Safe back and quit behavior | Restore previous answers when revisiting pages. Dismissing quit confirmation must not also select an answer, advance, or write configuration. Recompute dependent pack selections when an answer changes. |
| Finish remaining questions with defaults | Retain confirmed answers, apply valid typed default actions only to unanswered questions, and preserve baseline-consent requirements. Preview the resulting plan through the real engine. |
| Explain each answer's effect | Identify whether it changes configuration, weight, activation, conventions, a pack, or baseline debt. Show “clears” or “remains” only when actual preview evidence supports that claim. |

An empty findings list is not sufficient evidence that a signal is healthy.
Keep unavailable evidence, informational facts, and measured violations distinct.
Calibration is repo-owned interpretation, not an automatic score improvement.

## Lessons from the discarded implementation

- A headless 80×24 interaction reproduced Esc then Enter both dismissing quit
  confirmation and advancing the calibration selector. Returning from a global
  keyboard callback does not necessarily consume input in a focused child.
- A 50×16 render lost source code and clipped footer controls. Row budgets must
  be exercised at their boundaries, not merely calculated in code.
- Token-based source lookup filled missing diagnostic lines with guesses and
  rendered them as exact locations. Approximate context must remain separate
  from authoritative evidence.
- Synthetic survivor counts and score lifting belonged to the old implementation;
  they must not return as UI previews or production fallbacks.

These observations concern the discarded prototype, not reproduced defects in
the current `main` implementation.

## Where future work belongs

- UI and shared contracts: `packages/onboard/src/app.tsx`, `types.ts`, and
  `actions.ts`.
- Actual scan/preview/persistence: `packages/cli/src/onboard-persistence.ts`.
  Keep source-file enrichment at a repository-aware boundary rather than adding
  filesystem access to the renderer or duplicating the scoring path.
- Regression coverage: `packages/onboard/src/__tests__/app-render.test.tsx`
  and `packages/cli/src/__tests__/onboard-persistence.test.ts`.
- Compiled delivery checks: `scripts/onboard-smoke.ts`.

For any future implementation, test keyboard behavior and answer persistence,
missing evidence, preview/write failures, and normal/compact terminal sizes.
Capture and inspect representative rendered states as well as running assertions.
Run the relevant package tests, `bun run verify`, and the existing compiled TUI
smoke workflow. Saved configuration and a subsequent real score must agree with
the preview. No obsolete implementation needs to be recovered to build these ideas.
