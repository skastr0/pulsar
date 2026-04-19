import type { AnySignal } from "@taste-codec/core"
import { MarkdownWordCount } from "./signals/md-ld-01-word-count.js"
import { MarkdownHeadingStructure } from "./signals/md-ld-02-heading-structure.js"

/**
 * Community signal pack: Markdown/Writing analysis.
 * 
 * This demonstrates how third-party packages export signals
 * that can be composed into the Taste Codec registry.
 * 
 * Usage in a codec runtime:
 * ```typescript
 * import { buildRegistry } from "@taste-codec/core"
 * import { TS_PACK_SIGNALS } from "@taste-codec/ts-pack"
 * import { MARKDOWN_SIGNALS } from "taste-codec-signal-markdown"
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
