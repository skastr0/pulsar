# Pulsar OpenTUI Prototypes

Experimental terminal UI sketches for Pulsar. These are not wired into the main CLI.

## Split Footer Score

Runs `pulsar score --json` internally and renders a durable human score panel below the command.

```bash
cd docs/explorations/prototypes/opentui-score
bun install
bun run split-footer --height=18 /path/to/repo
```

Behavior:

- TTY human output is durable command output, not a full-screen or footer-only TUI.
- The default path prints a styled panel directly below the command after scoring finishes.
- `--json` bypasses OpenTUI and delegates to `pulsar score --json`.
- `--height=<n>` controls the footer height.
- `--live` enables the OpenTUI split-footer experiment while scoring, then writes the durable panel.
- `--persist` keeps the live footer open after scoring; press `q` or `Esc` to close.
- The OpenTUI scrollback snapshot API duplicated output during teardown in this package version, so the durable default uses a direct ANSI renderer for now.

This is intentionally a wrapper around the installed `pulsar` binary. It does not change scoring logic, vector discovery, cache behavior, or the main CLI command surface.

Current limitation: the durable summary is a prototype renderer, not the exact production human renderer from `packages/cli/src/score.ts`.
