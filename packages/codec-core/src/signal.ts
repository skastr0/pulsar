import type { Effect, Schema } from "effect"
import type { Category } from "./category.js"
import type { SignalContextTag, ReferenceDataTag } from "./context.js"
import type { Diagnostic } from "./diagnostic.js"
import type { EnforcementCeiling } from "./enforcement.js"
import type { SignalError } from "./errors.js"
import type { SignalCacheTag } from "./cache.js"
import type { SignalKind, Tier } from "./tier.js"

/**
 * Declared input dependency for a compound (Tier 1.5) signal.
 *
 * Dependencies are declared by id — NOT called imperatively — so the
 * registry can topologically sort, enforce composition depth, and allow
 * the scoring engine to parallelize independent leaves.
 */
export interface SignalInputRef {
  readonly id: string
  readonly optional?: boolean
}

export type ConfigDirection = "higher-is-stricter" | "higher-is-looser"

export interface SignalOutputMetadata {
  readonly effectiveConfidence?: number
  readonly baseConfidence?: number
  readonly computedAt?: string
  readonly stale?: boolean
}

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

/**
 * Map of dependency output values, keyed by the producing signal's id.
 * Passed to `compute` for Tier 1.5 signals. Leaf signals receive an
 * empty map.
 */
export type InputOutputs = ReadonlyMap<string, unknown>

export interface Signal<Config, Output, R = SignalRequirements> {
  readonly id: string
  readonly tier: Tier
  readonly category: Category
  readonly kind: SignalKind
  readonly normalizationGroup?: string

  /**
   * Included in score/observer cache keys. Packs should bump this whenever
   * signal implementation or scoring semantics change without a corresponding
   * default-config change.
   */
  readonly cacheVersion?: string

  /**
   * Schema that decodes raw JSON config from the taste vector into a
   * typed `Config`. Validation happens at vector load time.
   */
  readonly configSchema: Schema.Schema<Config>

  /**
   * Default config when the taste vector does not override this signal.
   */
  readonly defaultConfig: Config

  readonly configDirections?: Partial<Record<keyof Config, ConfigDirection>>

  readonly inputs: ReadonlyArray<SignalInputRef>

  /**
   * `R` is the additional service requirement beyond the core
   * `SignalRequirements`. Packs provide these via their own layers
   * (e.g. ts-pack provides `TsProjectTag`). The scoring engine composes
   * all provided layers before running.
   */
  readonly compute: (
    config: Config,
    inputs: InputOutputs,
  ) => Effect.Effect<Output, SignalError, R>

  /**
   * Pure function from raw output to a 0..1 health score.
   *
   * The two-phase design (compute → score) lets us change thresholds
   * without re-running AST or git passes.
   */
  readonly score: (output: Output) => number

  readonly diagnose: (output: Output) => ReadonlyArray<Diagnostic>

  readonly outputMetadata?: (output: Output) => SignalOutputMetadata | undefined
}

/**
 * Opaque existential for "some signal with some config, output, and
 * requirement set". Used by the registry when types are not statically
 * known.
 */
export interface AnySignal extends Signal<any, any, any> {}

export interface ResolvedSignal extends AnySignal {
  readonly enforcement: EnforcementCeiling
}
