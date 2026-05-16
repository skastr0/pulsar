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
  const payload: {
    readonly signal: unknown
    readonly calibrationFingerprint?: string
  } = {
    signal:
      signal === undefined
        ? null
        : signalConfigHashPayload(signal.id, registry, vector, new Set()),
  }
  const hash = createHash("sha256")
  if (calibrationFingerprint !== undefined) {
    hash.update(stableStringify({ ...payload, calibrationFingerprint }))
  } else {
    hash.update(stableStringify(payload))
  }
  return hash.digest("hex")
}

const signalConfigHashPayload = (
  signalId: string,
  registry: Registry,
  vector: PulsarVector | undefined,
  seen: Set<string>,
): unknown => {
  const signal = registry.byId.get(signalId)
  if (signal === undefined) return null
  if (seen.has(signal.id)) return { id: signal.id, cycle: true }
  seen.add(signal.id)
  const config = vectorResolvedConfig(signal, signal.defaultConfig, vector)
  const inputs =
    signal.kind === "compound"
      ? signal.inputs.map((input) => ({
          id: input.id,
          optional: input.optional === true,
          cacheFingerprint: input.cacheFingerprint ?? null,
          signal: signalConfigHashPayload(input.id, registry, vector, new Set(seen)),
        }))
      : []

  return {
    id: signal.id,
    cacheVersion: signal.cacheVersion ?? null,
    cacheDependencies: signal.cacheDependencies ?? [],
    config,
    factorDefinitions: signal.factorDefinitions ?? [],
    factorOverrides: factorOverridesOf(signal, vector),
    inputs,
  }
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
