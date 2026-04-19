# Community Signal Package: Markdown Analysis

This is a prototype community signal pack demonstrating the Taste Codec third-party extension interface.

## Purpose

Demonstrates TC-062 (Community signal plugin interface) exploration findings:
- Third-party packages can extend the codec with new signals
- The `Signal<Config, Output, R>` interface generalizes to non-code domains
- Domain-specific services (MarkdownProjectTag) integrate via Effect Layer

## Signals

| ID | Name | Tier | Category | Description |
|----|------|------|----------|-------------|
| MD-LD-01 | Word Count | 1 | Legibility decay | Documentation file size distribution |
| MD-LD-02 | Heading Structure | 1.5 | Legibility decay | H1 presence, nesting depth, hierarchy |

## Usage

```typescript
import { buildRegistry, makeCodecRuntime } from "@taste-codec/core"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@taste-codec/ts-pack"
import { MARKDOWN_SIGNALS, MarkdownProjectLayer } from "taste-codec-signal-markdown"

const registry = await Effect.runPromise(
  buildRegistry([...TS_PACK_SIGNALS, ...MARKDOWN_SIGNALS])
)

// In runtime, provide both layers
const layer = Layer.mergeAll(
  TsProjectLayer(worktreePath),
  MarkdownProjectLayer(worktreePath),
)
```

## Trust Model

This prototype follows the community trust recommendations:
- Peer dependency on `@taste-codec/core`
- No sandboxing (follows ESLint/cargo model)
- Explicit opt-in via taste vector

## Limitations

This is an exploration artifact, not production code:
- Word counting is naive (basic regex)
- No frontmatter parsing
- No integration with actual codec runtime
- Missing comprehensive tests
- Not part of the workspace `bun run typecheck` / `bun test` contract

## Future Work

For production use, consider:
- TF-IDF-based vocabulary drift detection
- Brand voice consistency checking
- Integration with `taste-codec/text-pack` if that effort proceeds
