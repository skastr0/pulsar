# OpenTUI Exploration

## Decision

Keep the current OpenTUI work as an exploration, not a main CLI command.

The first spike proved that Pulsar can render an attractive repo-health instrument, but the command should not ship as `pulsar score-tui` yet. The main CLI needs to stay boring, deterministic, buildable as standalone binaries, and safe for agents that depend on JSON/serial output.

Archived prototype:

- `docs/explorations/prototypes/opentui-score/score-tui.prototype.ts`
- `docs/explorations/prototypes/opentui-score/split-footer-score.ts`

Those files are intentionally unhooked from `packages/cli/src/bin.ts` and are not part of the main TypeScript build.

## Source Grounding

The surface should feel like a repo-health instrument: precise, quiet, wireframe-heavy, near-black, high-contrast at small sizes, and never generic startup UI.

OpenTUI official docs/source show the useful technical envelope:

- `createCliRenderer()` owns the terminal renderer and supports `screenMode`, `footerHeight`, `externalOutputMode`, `targetFps`, `requestLive()`, and `dropLive()`.
- `screenMode` is officially `"alternate-screen"`, `"main-screen"`, or `"split-footer"`.
- `"split-footer"` pins OpenTUI to a reserved footer region while normal output remains above it.
- `externalOutputMode: "capture-stdout"` captures stdout above the footer in split-footer mode.
- `renderer.writeToScrollback(writer)` and `renderer.createScrollbackSurface(options?)` can commit styled renderable snapshots to scrollback.
- Components relevant to Pulsar include `Box`, `Text`, `ScrollBox`, `TabSelect`, `Select`, `Slider`, `Markdown`, `Code`, `Diff`, `FrameBuffer`, and source-level `TextTableRenderable`.
- Keyboard/mouse APIs exist, including `renderer.keyInput`, focus routing, Kitty keyboard support, mouse movement, and auto-focus.
- There is no first-class chart component. Charts should be text/box compositions or custom `FrameBuffer` drawings.

Primary sources:

- https://opentui.com/docs/core-concepts/renderer/
- https://opentui.com/docs/core-concepts/keyboard/
- https://opentui.com/docs/core-concepts/colors/
- https://opentui.com/docs/components/markdown/
- https://opentui.com/docs/components/code
- https://opentui.com/docs/components/diff/
- https://opentui.com/docs/components/frame-buffer/
- https://opentui.com/docs/reference/env-vars/
- https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/renderer.ts
- https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/lib/render-geometry.ts
- https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/renderables/index.ts
- https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/renderables/TextTable.ts
- https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/animation/Timeline.ts

## Screen Mode Implications

OpenTUI should not be treated as only a full-screen TUI library.

`alternate-screen` is wrong for the default Pulsar CLI. It takes over the terminal and is best for a deliberate dashboard mode.

`main-screen` avoids alternate-screen, but official docs say it still reserves a render region by scrolling terminal content. It is not true inline rendering.

`split-footer` is useful for transient progress, but it is awkward as the final artifact. The final score should appear as durable command output directly below the invocation. That matches Pulsar's shape: serial output remains primary, while humans get a richer but still normal terminal report.

Best initial target:

```ts
const renderer = await createCliRenderer({
  screenMode: "split-footer",
  footerHeight: 8,
  externalOutputMode: "capture-stdout",
  consoleMode: "disabled",
  clearOnShutdown: true,
})
```

The TUI footer should be optional and human-only. `--json` must bypass OpenTUI entirely. CI/non-TTY/agent contexts should also bypass it.

## Output Contract

Pulsar should keep one canonical scoring pipeline:

1. Resolve the repo/org vector.
2. Run Observer.
3. Produce `ObserverOutput`.
4. Choose a renderer.

Renderers should be adapters over the same immutable result:

- `json` for agents and automation.
- `plain` for stable terminal output.
- `rich-footer` for humans in an interactive TTY.
- `dashboard` only as an explicit future experiment, not a default command.

The OpenTUI adapter must never affect scores, cache keys, vector discovery, calibration fingerprints, exit status, or JSON shape.

## UI Ideas

1. **Durable Score Panel**
   - Run the canonical score pipeline and render the finished result below the command.
   - Keep it scrollback-friendly, copyable, and non-interactive by default.
   - Use color, bars, and boxed grouping without taking over the terminal.

2. **Split-Footer Scan Instrument**
   - While `pulsar score` runs, reserve 6-10 bottom rows.
   - Show current phase, active pack, signal count, cache hits, and a small wire trace.
   - When scoring finishes, write the durable score panel below the command.

3. **Interactive Top Findings Footer**
   - After a human run, leave a footer open with top diagnostics.
   - Arrow keys cycle findings; Enter expands one into scrollback using `writeToScrollback`.
   - JSON output remains unaffected because this mode is disabled with `--json`.

4. **Vector Provenance Diff**
   - Use `DiffRenderable` to compare repo `.pulsar/vector.json` to org fallback or preset.
   - Label source explicitly to preserve Pulsar's repository-level invariant.
   - Useful for `persona diff`, `elicit review`, and calibration proposal review.

5. **Signal Drilldown Workbench**
   - `TabSelect`: Overview / Signals / Calibration / Cache / Diff.
   - Left pane: selectable signal table.
   - Right pane: Markdown evidence, rule IDs, activation evidence, diagnostics, and fingerprints.
   - This belongs behind an explicit experimental command or dev-only runner.

6. **Cache Correctness Inspector**
   - Show observer config hash, vector ID, calibration fingerprint, and signal cache status.
   - Make stale/fresh states visually obvious without changing any scoring behavior.
   - Good candidate for `pulsar score --profile --interactive` later.

7. **Bisect Timeline**
   - Use `FrameBuffer` or text sparklines to show score curves across commits.
   - Selecting a commit writes a compact culprit explanation to scrollback.
   - Keep `--json` bisect output as the machine interface.

8. **Calibration Activation Radar**
   - A compact footer showing which repo/framework/technology calibration rules activated.
   - Each activation has source, rule ID, evidence, and fingerprint.
   - This directly supports the "score-affecting calibration must be visible" invariant.

## Recommended Architecture

Do not add OpenTUI directly to `@skastr0/pulsar-cli` yet.

Preferred next spike:

- Create a separate exploration package under `docs/explorations/prototypes/opentui-score/`.
- Depend on `@opentui/core` only there.
- Feed it saved `ObserverOutput` fixtures or invoke the CLI with `--json`.
- Prototype `split-footer` first, not `alternate-screen`.

Current split-footer prototype:

```bash
cd docs/explorations/prototypes/opentui-score
bun install
bun run split-footer --height=18 /path/to/repo
```

It shells out to `pulsar score --json` and renders a compact human summary from the JSON result as durable terminal output below the command. Passing `--json` bypasses rich rendering and delegates directly to `pulsar score --json`.

This avoids the bad terminal state caused by mixing OpenTUI split-footer rendering with normal human `stdout` output. The production version should avoid duplicate summary code by extracting the existing human renderer into a reusable adapter.

The OpenTUI scrollback snapshot API duplicated output during teardown in `@opentui/core@0.2.3`, so the current durable path uses a direct ANSI renderer. The live OpenTUI footer remains behind `--live` for progress experiments only.

Future production shape, if the experiment earns it:

- Add a renderer boundary in `packages/cli/src/score.ts`.
- Keep `--json` and non-TTY output on the existing path.
- Add an opt-in flag such as `--interactive` or `--rich`.
- Load OpenTUI lazily only when that flag is active and `process.stdout.isTTY` is true.
- Treat OpenTUI as an optional runtime dependency or separate package so standalone binary builds remain reliable.

## Open Questions

- Can `split-footer` be polished enough to feel precise without becoming noisy?
- Should the panel remain the default human renderer for TTY output, or stay behind an explicit `--interactive` / `--rich` flag?
- How should agent callers signal "never use rich output" beyond `--json` and non-TTY detection?
- Does a separate `pulsar-lab` binary make more sense than adding experimental UI modes to `pulsar`?
