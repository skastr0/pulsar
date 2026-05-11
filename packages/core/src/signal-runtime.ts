import type { SignalCacheTag } from "./cache.js"
import type { SignalContextTag, ReferenceDataTag } from "./context.js"

/**
 * The runtime services a signal's `compute` has access to.
 *
 * - `SignalContextTag`:  gitSha, worktreePath, changedHunks
 * - `ReferenceDataTag`:  glossary, boundary rules, etc.
 * - `SignalCacheTag`:    read-through cache (the scoring engine also
 *                        caches at the outer layer; signals can cache
 *                        sub-computations if they need)
 */
export type SignalRequirements = SignalContextTag | ReferenceDataTag | SignalCacheTag
