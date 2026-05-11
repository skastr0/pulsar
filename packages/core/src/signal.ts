import type { Effect, Schema } from "effect"
import type { Category } from "./category.js"
import type { Diagnostic } from "./diagnostic.js"
import type { EnforcementCeiling } from "./enforcement.js"
import type { SignalError } from "./errors.js"
import type { SignalKind, Tier } from "./tier.js"
import type {
  SignalFactorDefinition,
  SignalFactorLedger,
} from "./signal-factor-model.js"
import type { SignalRequirements } from "./signal-runtime.js"

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

type ConfigDirection = "higher-is-stricter" | "higher-is-looser"

export type SignalApplicability =
  | "applicable"
  | "not_applicable"
  | "insufficient_evidence"
  | "failed"

type SignalCacheDependency = "git-revision-context"

export interface SignalOutputMetadata {
  readonly effectiveConfidence?: number
  readonly baseConfidence?: number
  readonly computedAt?: string
  readonly stale?: boolean
  readonly applicability?: SignalApplicability
}

export interface SignalIdentity {
  /**
   * Canonical, emitted signal identifier. New signal IDs should be stable and
   * semantic, e.g. TS-SL-04-unfinished-implementations.
   */
  readonly id: string

  /**
   * Human-readable display title for CLI, JSON explain output, and docs.
   */
  readonly title?: string

  /**
   * Legacy or alternate IDs accepted at input boundaries. Aliases are never
   * emitted as canonical IDs for new output.
   */
  readonly aliases?: ReadonlyArray<string>
}

/**
 * Map of dependency output values, keyed by the producing signal's id.
 * Passed to `compute` for Tier 1.5 signals. Leaf signals receive an
 * empty map.
 */
export type InputOutputs = ReadonlyMap<string, unknown>

export interface Signal<Config, Output, R = SignalRequirements> {
  readonly id: string
  readonly title?: string
  readonly aliases?: ReadonlyArray<string>
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
   * Extra repository facts that affect the signal output beyond the tracked
   * source tree and resolved config. Use this sparingly for signals whose
   * evidence depends on git topology, branch upstreams, or commit identity.
   */
  readonly cacheDependencies?: ReadonlyArray<SignalCacheDependency>

  /**
   * Schema that decodes raw JSON config from the pulsar vector into a
   * typed `Config`. Validation happens at vector load time.
   */
  readonly configSchema: Schema.Schema<Config>

  /**
   * Default config when the pulsar vector does not override this signal.
   */
  readonly defaultConfig: Config

  readonly configDirections?: Partial<Record<keyof Config, ConfigDirection>>

  readonly factorDefinitions?: ReadonlyArray<SignalFactorDefinition>

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

  readonly factorLedger?: (output: Output) => SignalFactorLedger | undefined
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
