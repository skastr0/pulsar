import {
  applyFactorOverrides,
  makeFactorEntry,
  makeFactorLedger,
  SignalComputeError,
  type ResolvedCalibrationContext,
  type SignalFactorLedger,
  type SignalFactorValue,
} from "@skastr0/pulsar-core"
import { Effect, Option } from "effect"
import type { Project } from "ts-morph"
import {
  collectStubCandidates,
  type ChangedHunk,
} from "./ts-sl-04-candidates.js"
import type { TsSl04Config } from "./ts-sl-04-config.js"
import { evaluateStubCandidates } from "./ts-sl-04-evaluation.js"
import {
  factorDefinitionByPath,
  numberFactorValue,
  type StubConfidence,
  type StubKind,
} from "./ts-sl-04-factors.js"
import type {
  CleanBudget,
  EvaluatedStubCandidates,
  Stub,
  StubCandidateSummary,
  TsSl04Output,
} from "./ts-sl-04-model.js"

export const computeTsSl04Output = (
  config: TsSl04Config,
  deps: {
    readonly project: Project
    readonly context: {
      readonly worktreePath: string
      readonly changedHunks: ReadonlyArray<ChangedHunk>
    }
    readonly calibration: Option.Option<ResolvedCalibrationContext>
    readonly factorPolicy: Option.Option<{
      readonly vectorOverrides: Readonly<Record<string, SignalFactorValue>>
    }>
  },
): Effect.Effect<TsSl04Output, SignalComputeError, never> =>
  Effect.gen(function* () {
    const collection = yield* Effect.try({
      try: () => collectStubCandidates(deps.project, deps.context, config),
      catch: toSignalComputeError,
    })
    const factorOverrides = Option.isSome(deps.factorPolicy)
      ? deps.factorPolicy.value.vectorOverrides
      : {}
    const budget = resolveCleanBudget(collection.totalFunctions, factorOverrides)
    const evaluated = yield* evaluateStubCandidates(
      collection.candidates,
      deps.calibration,
      config.hard_gate_production,
      factorOverrides,
    ).pipe(Effect.mapError(toSignalComputeError))
    return buildTsSl04Output(config, collection.totalFunctions, budget, evaluated, factorOverrides)
  })

const resolveCleanBudget = (
  totalFunctions: number,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): CleanBudget => {
  const expectedCleanFunctionRatio = numberFactorValue(
    "budget.expected_clean_function_ratio",
    0.01,
    factorOverrides,
  ) ?? 0.01
  const expectedCleanMinFunctions = numberFactorValue(
    "budget.expected_clean_min_functions",
    10,
    factorOverrides,
  ) ?? 10
  return {
    expectedCleanBudget: Math.max(
      expectedCleanMinFunctions,
      totalFunctions * expectedCleanFunctionRatio,
    ),
    expectedCleanFunctionRatio,
    expectedCleanMinFunctions,
  }
}

const buildTsSl04Output = (
  config: TsSl04Config,
  totalFunctions: number,
  budget: CleanBudget,
  evaluated: EvaluatedStubCandidates,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): TsSl04Output => {
  const stubs = [...evaluated.stubs].sort(compareStubs)
  return {
    rawCandidates: [...evaluated.rawCandidates].sort(compareCandidateSummaries),
    stubs,
    calibrationDecisions: evaluated.calibrationDecisions,
    byKind: countStubsByKind(stubs),
    productionStubs: stubs.filter((s) => !s.inTestPath),
    testStubs: stubs.filter((s) => s.inTestPath),
    totalFunctions,
    ...budget,
    hardGateProduction: config.hard_gate_production,
    diagnosticLimit: config.top_n_diagnostics,
    factorLedger: buildTsSl04FactorLedger(config, budget, evaluated, factorOverrides),
  }
}

const countStubsByKind = (stubs: ReadonlyArray<Stub>): ReadonlyMap<StubKind, number> => {
  const byKind = new Map<StubKind, number>()
  for (const stub of stubs) {
    byKind.set(stub.kind, (byKind.get(stub.kind) ?? 0) + 1)
  }
  return byKind
}

const buildTsSl04FactorLedger = (
  config: TsSl04Config,
  budget: CleanBudget,
  evaluated: EvaluatedStubCandidates,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): SignalFactorLedger =>
  makeFactorLedger("TS-SL-04-unfinished-implementations", applyFactorOverrides([
    ...evaluated.factorEntries,
    makeFactorEntry(factorDefinitionByPath("budget.expected_clean_function_ratio"), budget.expectedCleanFunctionRatio),
    makeFactorEntry(factorDefinitionByPath("budget.expected_clean_min_functions"), budget.expectedCleanMinFunctions),
    makeFactorEntry(factorDefinitionByPath("filtering.include_test_stubs"), config.include_test_stubs),
    makeFactorEntry(factorDefinitionByPath("filtering.production_only_score"), true),
  ], factorOverrides))

const compareStubs = (a: Stub, b: Stub): number =>
  confidencePriority(a.confidence) - confidencePriority(b.confidence) ||
  b.penaltyWeight - a.penaltyWeight ||
  a.file.localeCompare(b.file) ||
  a.line - b.line

const confidencePriority = (confidence: StubConfidence): number => {
  if (confidence === "high") return 0
  if (confidence === "medium") return 1
  return 2
}

const compareCandidateSummaries = (
  a: StubCandidateSummary,
  b: StubCandidateSummary,
): number => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name)

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({ signalId: "TS-SL-04-unfinished-implementations", message: String(cause), cause })
