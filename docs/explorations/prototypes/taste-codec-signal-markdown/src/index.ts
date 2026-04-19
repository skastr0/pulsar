/**
 * Taste Codec Community Signal Prototype: Markdown Analysis
 * 
 * Demonstrates how a third-party package can extend the Taste Codec
 * with new signals for non-code domains (writing, documentation).
 * 
 * This is an exploration artifact for TC-062 (Community signal plugin interface).
 */

export { MARKDOWN_SIGNALS } from "./pack.js"
export { MarkdownProjectLayer, MarkdownProjectTag } from "./project.js"
export { MarkdownWordCount } from "./signals/md-ld-01-word-count.js"
export { MarkdownHeadingStructure } from "./signals/md-ld-02-heading-structure.js"
