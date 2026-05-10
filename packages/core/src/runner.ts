import { Effect } from "effect"
import type { Diagnostic } from "./diagnostic.js"
import { UnknownSignalIdError, type SignalError } from "./errors.js"
import {
  applySignalFactorPolicy,
  makeSignalFactorPolicyContext,
  SignalFactorPolicyTag,
} from "./factor-ledger.js"
import { buildInputOutputs } from "./input-outputs.js"
import type { Registry } from "./registry.js"
import type {
  ResolvedSignal,
  SignalFactorLedger,
  SignalOutputMetadata,
  SignalRequirements,
} from "./signal.js"
import {
  isActive as vectorIsActive,
  resolvedConfig as vectorResolvedConfig,
  type PulsarVector,
} from "./vector.js"

export interface SignalRunResult {
  readonly signalId: string
  readonly score: number
  readonly output: unknown
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly metadata?: SignalOutputMetadata
  readonly factorLedger?: SignalFactorLedger
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
  vector?: PulsarVector,
): Effect.Effect<SignalRunResult, SignalError, SignalRequirements> =>
  Effect.gen(function* () {
    const target = registry.byId.get(signalId)
    if (target === undefined) return yield* new UnknownSignalIdError({ id: signalId })

    const needed = collectAncestors(registry, target)
    const outputs = new Map<string, unknown>()

    for (const s of needed) {
      if (!vectorIsActive(s, vector)) continue
      const inputOutputs = buildInputOutputs(s, outputs)
      const config = vectorResolvedConfig(s, s.defaultConfig, vector)
      const factorPolicy = makeSignalFactorPolicyContext(s, vector)
      const result = yield* s.compute(config, inputOutputs).pipe(
        Effect.provideService(SignalFactorPolicyTag, factorPolicy),
      )
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
    const rawFactorLedger = target.factorLedger?.(out)
    const factorLedger =
      rawFactorLedger === undefined
        ? undefined
        : applySignalFactorPolicy(
            rawFactorLedger,
            makeSignalFactorPolicyContext(target, vector),
          )
    return {
      signalId: target.id,
      score: target.score(out),
      output: out,
      diagnostics: target.diagnose(out),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(factorLedger !== undefined ? { factorLedger } : {}),
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
