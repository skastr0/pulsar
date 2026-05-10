import { Context, Effect, Layer } from "effect"
import { deriveEnforcement } from "./enforcement.js"
import {
  CompositionTooDeepError,
  CycleDetectedError,
  DuplicateSignalIdError,
  MissingDependencyError,
  type RegistryError,
} from "./errors.js"
import type { AnySignal, ResolvedSignal, SignalInputRef } from "./signal.js"

export const MAX_COMPOSITION_DEPTH = 2

export interface Registry {
  /**
   * Lookup table for canonical IDs and accepted aliases. Iteration over
   * executable signals should use `sorted`, which contains each signal once.
   */
  readonly byId: ReadonlyMap<string, ResolvedSignal>
  readonly sorted: ReadonlyArray<ResolvedSignal>
  readonly has: (id: string) => boolean
  readonly canonicalIdOf: (id: string) => string | undefined
  readonly aliasesOf: (id: string) => ReadonlyArray<string>
}

export class RegistryTag extends Context.Tag("@skastr0/pulsar-core/Registry")<
  RegistryTag,
  Registry
>() {}

const validateNoDuplicates = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<void, DuplicateSignalIdError> =>
  Effect.gen(function* () {
    const seen = new Map<string, AnySignal>()
    for (const s of signals) {
      for (const id of signalIdentifiers(s)) {
        const existing = seen.get(id)
        if (existing !== undefined && existing !== s) {
          return yield* new DuplicateSignalIdError({ id })
        }
        seen.set(id, s)
      }
    }
  })

const normalizeSignals = (
  signals: ReadonlyArray<AnySignal>,
): Effect.Effect<ReadonlyArray<AnySignal>, DuplicateSignalIdError> =>
  Effect.gen(function* () {
    const canonicalById = new Map<string, AnySignal>()
    const ownerByIdentifier = new Map<string, AnySignal>()
    const normalized: Array<AnySignal> = []
    for (const signal of signals) {
      const existing = canonicalById.get(signal.id)
      if (existing === undefined) {
        for (const id of signalIdentifiers(signal)) {
          const owner = ownerByIdentifier.get(id)
          if (owner !== undefined && owner !== signal) {
            return yield* new DuplicateSignalIdError({ id })
          }
          ownerByIdentifier.set(id, signal)
        }
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
    const ids = new Set(signals.flatMap(signalIdentifiers))
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
    const canonicalByIdentifier = buildCanonicalIdentifierMap(signals)
    const indegree = new Map<string, number>()
    const dependents = new Map<string, Array<string>>()

    for (const s of signals) {
      const presentInputs = s.inputs
        .map((input) => canonicalByIdentifier.get(input.id))
        .filter((id): id is string => id !== undefined)
      indegree.set(
        s.id,
        presentInputs.length,
      )
      for (const inputId of presentInputs) {
        const list = dependents.get(inputId) ?? []
        list.push(s.id)
        dependents.set(inputId, list)
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
    const canonicalByIdentifier = buildCanonicalIdentifierMap(sorted)
    for (const s of sorted) {
      if (s.inputs.length === 0) {
        depths.set(s.id, 1)
        continue
      }
      let maxInputDepth = 0
      for (const input of s.inputs) {
        const inputId = canonicalByIdentifier.get(input.id)
        if (inputId === undefined || !depths.has(inputId)) continue
        const d = depths.get(inputId) ?? 1
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

    const canonicalByIdentifier = buildCanonicalIdentifierMap(sorted)
    const resolved: Array<ResolvedSignal> = sorted.map((s) => ({
      ...s,
      inputs: normalizeInputs(s.inputs, canonicalByIdentifier),
      enforcement: deriveEnforcement(s.tier, s.kind),
    }))
    const byId = new Map<string, ResolvedSignal>()
    for (const signal of resolved) {
      for (const id of signalIdentifiers(signal)) {
        byId.set(id, signal)
      }
    }
    const aliasesByCanonical = new Map(
      resolved.map((signal) => [signal.id, [...new Set(signal.aliases ?? [])]] as const),
    )

    return {
      byId,
      sorted: resolved,
      has: (id: string) => byId.has(id),
      canonicalIdOf: (id: string) => byId.get(id)?.id,
      aliasesOf: (id: string) => {
        const canonical = byId.get(id)?.id ?? id
        return aliasesByCanonical.get(canonical) ?? []
      },
    }
  })

const signalIdentifiers = (signal: Pick<AnySignal, "id" | "aliases">): ReadonlyArray<string> =>
  [signal.id, ...(signal.aliases ?? [])]

const buildCanonicalIdentifierMap = (
  signals: ReadonlyArray<Pick<AnySignal, "id" | "aliases">>,
): ReadonlyMap<string, string> => {
  const map = new Map<string, string>()
  for (const signal of signals) {
    for (const id of signalIdentifiers(signal)) {
      map.set(id, signal.id)
    }
  }
  return map
}

const normalizeInputs = (
  inputs: ReadonlyArray<SignalInputRef>,
  canonicalByIdentifier: ReadonlyMap<string, string>,
): ReadonlyArray<SignalInputRef> =>
  inputs.map((input) => {
    const canonical = canonicalByIdentifier.get(input.id)
    if (canonical === undefined || canonical === input.id) return input
    return { ...input, id: canonical }
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
