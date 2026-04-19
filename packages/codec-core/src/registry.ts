import { Context, Effect, Layer } from "effect"
import { deriveEnforcement } from "./enforcement.js"
import {
  CompositionTooDeepError,
  CycleDetectedError,
  DuplicateSignalIdError,
  MissingDependencyError,
  type RegistryError,
} from "./errors.js"
import type { AnySignal, ResolvedSignal } from "./signal.js"

export const MAX_COMPOSITION_DEPTH = 2

export interface Registry {
  readonly byId: ReadonlyMap<string, ResolvedSignal>
  readonly sorted: ReadonlyArray<ResolvedSignal>
  readonly has: (id: string) => boolean
}

export class RegistryTag extends Context.Tag("@taste-codec/core/Registry")<
  RegistryTag,
  Registry
>() {}

const validateNoDuplicates = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<void, DuplicateSignalIdError> =>
  Effect.gen(function* () {
    const seen = new Set<string>()
    for (const s of signals) {
      if (seen.has(s.id)) return yield* new DuplicateSignalIdError({ id: s.id })
      seen.add(s.id)
    }
  })

const normalizeSignals = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<ReadonlyArray<AnySignal>, DuplicateSignalIdError> =>
  Effect.gen(function* () {
    const canonicalById = new Map<string, AnySignal>()
    const normalized: Array<AnySignal> = []
    for (const signal of signals) {
      const existing = canonicalById.get(signal.id)
      if (existing === undefined) {
        canonicalById.set(signal.id, signal)
        normalized.push(signal)
        continue
      }
      if (existing === signal) continue
      return yield* new DuplicateSignalIdError({ id: signal.id })
    }
    return normalized
  })

const validateDependenciesExist = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<void, MissingDependencyError> =>
  Effect.gen(function* () {
    const ids = new Set(signals.map((s) => s.id))
    for (const s of signals) {
      for (const input of s.inputs) {
        if (!ids.has(input.id) && input.optional !== true) {
          return yield* new MissingDependencyError({
            signalId: s.id,
            missingInputId: input.id,
          })
        }
      }
    }
  })

/**
 * Kahn topological sort. Returns nodes in dependency order (leaves first).
 * Fails with CycleDetectedError if a cycle exists.
 */
const topologicalSort = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<ReadonlyArray<AnySignal>, CycleDetectedError> =>
  Effect.gen(function* () {
    const byId = new Map(signals.map((s) => [s.id, s] as const))
    const indegree = new Map<string, number>()
    const dependents = new Map<string, Array<string>>()

    for (const s of signals) {
      indegree.set(
        s.id,
        s.inputs.filter((input) => byId.has(input.id)).length,
      )
      for (const input of s.inputs) {
        if (!byId.has(input.id)) continue
        const list = dependents.get(input.id) ?? []
        list.push(s.id)
        dependents.set(input.id, list)
      }
    }

    const queue: Array<string> = []
    for (const [id, deg] of indegree) if (deg === 0) queue.push(id)

    const sorted: Array<AnySignal> = []
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = byId.get(id)
      if (node !== undefined) sorted.push(node)
      for (const dep of dependents.get(id) ?? []) {
        const next = (indegree.get(dep) ?? 0) - 1
        indegree.set(dep, next)
        if (next === 0) queue.push(dep)
      }
    }

    if (sorted.length !== signals.length) {
      const unresolved = signals.filter((s) => !sorted.includes(s)).map((s) => s.id)
      return yield* new CycleDetectedError({ chain: unresolved })
    }
    return sorted
  })

const validateCompositionDepth = (
  sorted: ReadonlyArray<AnySignal>,
): Effect.Effect<ReadonlyMap<string, number>, CompositionTooDeepError> =>
  Effect.gen(function* () {
    const depths = new Map<string, number>()
    for (const s of sorted) {
      if (s.inputs.length === 0) {
        depths.set(s.id, 1)
        continue
      }
      let maxInputDepth = 0
      for (const input of s.inputs) {
        if (!depths.has(input.id)) continue
        const d = depths.get(input.id) ?? 1
        if (d > maxInputDepth) maxInputDepth = d
      }
      const depth = 1 + maxInputDepth
      if (depth > MAX_COMPOSITION_DEPTH) {
        return yield* new CompositionTooDeepError({
          signalId: s.id,
          depth,
          max: MAX_COMPOSITION_DEPTH,
        })
      }
      depths.set(s.id, depth)
    }
    return depths
  })

export const buildRegistry = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<Registry, RegistryError> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeSignals(signals)
    yield* validateNoDuplicates(normalized)
    yield* validateDependenciesExist(normalized)
    const sorted = yield* topologicalSort(normalized)
    yield* validateCompositionDepth(sorted)

    const resolved: Array<ResolvedSignal> = sorted.map((s) => ({
      ...s,
      enforcement: deriveEnforcement(s.tier, s.kind),
    }))
    const byId = new Map(resolved.map((s) => [s.id, s] as const))

    return {
      byId,
      sorted: resolved,
      has: (id: string) => byId.has(id),
    }
  })

/**
 * Build a Layer that provides the Registry given a static list of signals.
 * Packs export `Layer`s that collect their signals; the CLI composes them
 * with `Layer.merge` and then feeds the union into `registryLayer`.
 */
export const registryLayer = (
  signals: ReadonlyArray<AnySignal>,
): Layer.Layer<RegistryTag, RegistryError> =>
  Layer.effect(RegistryTag, buildRegistry(signals))
