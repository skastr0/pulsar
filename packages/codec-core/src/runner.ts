import { Effect } from "effect"
import type { Diagnostic } from "./diagnostic.js"
import { UnknownSignalIdError, type SignalError } from "./errors.js"
import type { Registry } from "./registry.js"
import type {
  InputOutputs,
  ResolvedSignal,
  SignalOutputMetadata,
} from "./signal.js"
import {
  isActive as vectorIsActive,
  resolvedConfig as vectorResolvedConfig,
  type TasteVector,
} from "./vector.js"

export interface SignalRunResult {
  readonly signalId: string
  readonly score: number
  readonly output: unknown
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly metadata?: SignalOutputMetadata
}

/**
 * Minimal single-invocation scoring runner for one target signal.
 *
 * Walks the dependency graph in topological order, computing each
 * ancestor of the target. Dependency outputs are memoized per run
 * (not persisted — the full hunk-level cache belongs to TC-017's
 * scoring engine).
 */
export const runSignal = (
  registry: Registry,
  signalId: string,
  vector?: TasteVector,
): Effect.Effect<SignalRunResult, SignalError, any> =>
  Effect.gen(function* () {
    const target = registry.byId.get(signalId)
    if (target === undefined) return yield* new UnknownSignalIdError({ id: signalId })

    const needed = collectAncestors(registry, target)
    const outputs = new Map<string, unknown>()

    for (const s of needed) {
      if (!vectorIsActive(s.id, vector)) continue
      const inputOutputs: InputOutputs = buildInputOutputs(s, outputs)
      const config = vectorResolvedConfig(s.id, s.defaultConfig, vector)
      const result = yield* s.compute(config, inputOutputs)
      outputs.set(s.id, result)
    }

    const out = outputs.get(target.id)
    if (out === undefined) {
      return {
        signalId: target.id,
        score: 0,
        output: undefined,
        diagnostics: [
          {
            severity: "warn" as const,
            message: `Signal ${target.id} did not produce an output (inactive?)`,
          },
        ],
      }
    }
    const metadata = target.outputMetadata?.(out)
    return {
      signalId: target.id,
      score: target.score(out),
      output: out,
      diagnostics: target.diagnose(out),
      ...(metadata !== undefined ? { metadata } : {}),
    }
  })

const collectAncestors = (
  registry: Registry,
  target: ResolvedSignal,
): ReadonlyArray<ResolvedSignal> => {
  const needed = new Set<string>()
  const visit = (s: ResolvedSignal): void => {
    if (needed.has(s.id)) return
    for (const input of s.inputs) {
      const parent = registry.byId.get(input.id)
      if (parent !== undefined) visit(parent)
    }
    needed.add(s.id)
  }
  visit(target)
  return registry.sorted.filter((s) => needed.has(s.id))
}

const buildInputOutputs = (
  s: ResolvedSignal,
  outputs: ReadonlyMap<string, unknown>,
): InputOutputs => {
  const map = new Map<string, unknown>()
  for (const input of s.inputs) {
    const value = outputs.get(input.id)
    if (value !== undefined) map.set(input.id, value)
  }
  return map
}
