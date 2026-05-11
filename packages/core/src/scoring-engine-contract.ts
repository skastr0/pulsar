import { createHash } from "node:crypto"
import { Context, Layer } from "effect"
import type { ChangedHunk } from "./context.js"
import type {
  ScoringEngineError,
  SignalError,
} from "./errors.js"
import type { ObserverOutput } from "./observer.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import {
  factorOverridesOf,
  resolvedConfig as vectorResolvedConfig,
  type PulsarVector,
} from "./vector.js"

export class ScoringEngineTag extends Context.Tag("@skastr0/pulsar-core/ScoringEngine")<
  ScoringEngineTag,
  {
    readonly scoreCommit: (
      repoPath: string,
      sha: string,
      signalId: string,
    ) => import("effect").Effect.Effect<SignalRunResult, SignalError | ScoringEngineError, never>
    readonly scoreRange: (
      repoPath: string,
      fromSha: string,
      toSha: string,
      signalId: string,
      options?: { concurrency?: number },
    ) => import("effect").Effect.Effect<
      ReadonlyArray<{ sha: string; result: SignalRunResult }>,
      SignalError | ScoringEngineError,
      never
    >
    readonly observeCommit: (
      repoPath: string,
      sha: string,
    ) => import("effect").Effect.Effect<ObserverOutput, ScoringEngineError, never>
    readonly observeWorktree: (
      repoPath: string,
      headSha: string,
      options?: { readonly changedHunks?: ReadonlyArray<ChangedHunk> },
    ) => import("effect").Effect.Effect<ObserverOutput, ScoringEngineError, never>
    readonly observeRange: (
      repoPath: string,
      fromSha: string,
      toSha: string,
      options?: { concurrency?: number },
    ) => import("effect").Effect.Effect<
      ReadonlyArray<{ sha: string; result: ObserverOutput }>,
      ScoringEngineError,
      never
    >
  }
>() {}

/**
 * Layer factory contract for per-worktree resources like the ts-morph
 * Project. The engine lives in core and must not import language packs
 * directly — callers pass this factory when building the engine layer.
 */
export type PackLayerFactory = (
  worktreePath: string,
) => Layer.Layer<never, never, never> | Layer.Layer<any, unknown, never>

/**
 * SHA-256 over the stable JSON encoding of a signal's resolved config.
 * Config changes invalidate the score cache for that signal; content
 * changes invalidate it independently. Keys stay orthogonal.
 */
export const computeConfigHash = (
  signalId: string,
  registry: Registry,
  vector: PulsarVector | undefined,
  calibrationFingerprint?: string,
): string => {
  const signal = registry.byId.get(signalId)
  const config = signal
    ? vectorResolvedConfig(signal, signal.defaultConfig, vector)
    : undefined
  const payload: {
    readonly cacheVersion: string | null
    readonly config: unknown
    readonly factorDefinitions: unknown
    readonly factorOverrides: unknown
    readonly calibrationFingerprint?: string
  } = {
    cacheVersion: signal?.cacheVersion ?? null,
    config: config ?? null,
    factorDefinitions: signal?.factorDefinitions ?? [],
    factorOverrides: signal === undefined ? {} : factorOverridesOf(signal, vector),
  }
  const hash = createHash("sha256")
  if (calibrationFingerprint !== undefined) {
    hash.update(stableStringify({ ...payload, calibrationFingerprint }))
  } else {
    hash.update(stableStringify(payload))
  }
  return hash.digest("hex")
}

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${parts.join(",")}}`
}
