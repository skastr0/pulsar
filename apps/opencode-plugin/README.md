# opencode Effect Plugin Template

This repository demonstrates native opencode server, TUI, and tool plugins
written with idiomatic Effect internals.

There is intentionally no adapter facade over opencode. The public boundary is
the real `@opencode-ai/plugin` API; Effect is used inside that boundary for
options, services, layers, typed errors, and tracing-friendly functions.

The important invariant:

```text
opencode plugin invocation
  -> create one ManagedRuntime
  -> hook/tool/TUI callbacks run through that runtime
  -> opencode Promise/mutation contracts stay explicit at the edge
```

## Shape

```text
src/
  shared/            # options, errors, logger, policy services
  server/            # Effect-authored server hook programs and layers
  tui/               # Effect-authored TUI setup and command programs
  server.ts          # native opencode ./server entrypoint
  tui.ts             # native opencode ./tui entrypoint
.opencode/tools/     # standalone Effect-authored tool example
```

## Scripts

```bash
bun install
bun run verify
```

## opencode config

After building, add the package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["opencode-effect-plugin-template", { "blockEnvFiles": true }]]
}
```

This example registers:

- a server `event` observer that logs `session.idle`
- a rejecting `tool.execute.before` policy for `.env*` paths
- a `chat.params` mutator that applies an Effect-computed patch explicitly
- a server custom tool named `template_status`
- a standalone `.opencode/tools/effect-status.ts` tool
- a TUI command and slash command

## Patterns Shown

- Decode plugin options once with `Effect.Schema`.
- Build one `ManagedRuntime` per server plugin invocation.
- Build one `ManagedRuntime` per TUI plugin invocation and dispose it through
  `api.lifecycle.onDispose`.
- Build one module-scoped `ManagedRuntime` per standalone tool file.
- Keep opencode SDK calls direct and visible, wrapping them in Effect services
  only where that makes the example cleaner.
- Use `Effect.fn` and `Effect.withSpan` around hook/tool/TUI programs.
- Convert typed Effect errors, like `ToolDenied`, into opencode-compatible
  thrown `Error`s at the boundary.

## OpenTelemetry

The local opencode source already has OpenTelemetry support behind
`experimental.openTelemetry`. It wires `@effect/opentelemetry/NodeSdk` in
`packages/opencode/src/effect/observability.ts` and passes a tracer into AI SDK
calls through `experimental_telemetry` in `session/llm.ts` and `agent/agent.ts`.

These examples name hooks and handlers with `Effect.withSpan` / `Effect.fn`, so
plugin code is ready for Effect tracing. Plugin-owned OTEL export can be added
later as its own layer without changing the native opencode plugin boundary.
