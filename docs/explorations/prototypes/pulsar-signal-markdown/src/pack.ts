import type { AnySignal } from "@skastr0/pulsar-core"
import { MarkdownWordCount } from "./signals/md-ld-01-word-count.js"
import { MarkdownHeadingStructure } from "./signals/md-ld-02-heading-structure.js"

/**
 * Community signal pack: Markdown/Writing analysis.
 * 
 * This demonstrates how third-party packages export signals
 * that can be composed into the Pulsar registry.
 * 
 * Usage in a pulsar runtime:
 * ```typescript
 * import { buildRegistry } from "@skastr0/pulsar-core"
 * import { TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
 * import { MARKDOWN_SIGNALS } from "pulsar-signal-markdown"
 * 
 * const registry = await Effect.runPromise(
 *   buildRegistry([...TS_PACK_SIGNALS, ...MARKDOWN_SIGNALS])
 * )
 * ```
 */
export const MARKDOWN_SIGNALS: ReadonlyArray<AnySignal> = [
  MarkdownWordCount,
  MarkdownHeadingStructure,
]
