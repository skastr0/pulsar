import {
  CalibrationContextTag,
  SignalContextTag,
  SignalFactorPolicyTag,
  applyFactorOverrides,
  makeFactorEntry,
  makeFactorLedger,
  computeDiagnosticHash,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type Diagnostic,
  type ResolvedCalibrationContext,
  type Signal,
  type SignalFactorLedger,
  type SignalFactorLedgerEntry,
  type SignalFactorValue,
  SignalComputeError,
  type TypeScriptUnfinishedImplementationPolicyValue,
  type TypeScriptNoopClassificationValue,
} from "@skastr0/pulsar-core"
import { Effect, Option } from "effect"
import { Node, SyntaxKind, type Project } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  getFunctionBody,
  getFunctionLikeIndex,
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { isIntentionalNoop } from "./ts-sl-04-intentional-noops.js"
import { classifyStub } from "./ts-sl-04-classify.js"
import { defaultTsSl04Config, TsSl04Config as TsSl04ConfigSchema } from "./ts-sl-04-config.js"
import type { TsSl04Config as TsSl04ConfigShape } from "./ts-sl-04-config.js"
import {
  STUB_KIND_FACTOR_PREFIX,
  TsSl04FactorDefinitions,
  booleanFactorValue,
  confidenceForStubKind,
  factorDefinitionByPath,
  numberFactorValue,
  penaltyWeightForStubKind,
  scoreCapForStubKind,
  scoreCapParticipationForStubKind,
  severityForStub,
  stringFactorValue,
  stubKindFactorPath,
  stubKindFromMetadata,
  toStubConfidence,
  toStubKind,
  type StubConfidence,
  type StubKind,
  type StubSeverity,
} from "./ts-sl-04-factors.js"

export const TsSl04Config = TsSl04ConfigSchema
export type TsSl04Config = TsSl04ConfigShape

export interface Stub {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind
  readonly visible: boolean
  readonly severity: StubSeverity
  readonly confidence: StubConfidence
  readonly penaltyWeight: number
  readonly scoreCapParticipation: boolean
  readonly scoreCap: number | undefined
  readonly inTestPath: boolean
  readonly message: string | undefined
  readonly policyDecisions: ReadonlyArray<CalibrationDecision>
}

export interface TsSl04Output {
  readonly rawCandidates: ReadonlyArray<StubCandidateSummary>
  readonly stubs: ReadonlyArray<Stub>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly byKind: ReadonlyMap<StubKind, number>
  readonly productionStubs: ReadonlyArray<Stub>
  readonly testStubs: ReadonlyArray<Stub>
  readonly totalFunctions: number
  readonly expectedCleanBudget: number
  readonly expectedCleanFunctionRatio: number
  readonly expectedCleanMinFunctions: number
  readonly hardGateProduction: boolean
  readonly diagnosticLimit: number
  readonly factorLedger: SignalFactorLedger
}

export interface StubCandidateSummary {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind | "intentional-noop" | "unknown"
  readonly inTestPath: boolean
}

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04-unfinished-implementations",
  title: "Unfinished implementations",
  aliases: ["TS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "factor-policy-v1",
  configSchema: TsSl04Config,
  defaultConfig: defaultTsSl04Config,
  factorDefinitions: TsSl04FactorDefinitions,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const factorPolicy = yield* Effect.serviceOption(SignalFactorPolicyTag)
      return yield* computeTsSl04Output(config, {
        project,
        context,
        calibration,
        factorPolicy,
      })
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    if (out.productionStubs.length === 0) return 1
    const weightedProductionStubs = out.productionStubs.reduce(
      (sum, stub) => sum + stub.penaltyWeight,
      0,
    )
    const baseScore = Math.max(0, 1 - Math.min(1, weightedProductionStubs / out.expectedCleanBudget))
    const scoreCaps = out.productionStubs.flatMap((stub) =>
      stub.scoreCapParticipation && stub.scoreCap !== undefined ? [stub.scoreCap] : [],
    )
    return scoreCaps.length > 0 ? Math.min(baseScore, ...scoreCaps) : baseScore
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    const topN = out.stubs.filter((stub) => stub.visible).slice(0, out.diagnosticLimit)

    for (const stub of topN) {
      diagnostics.push({
        severity: stub.severity,
        message: `${stub.name}: ${stub.kind} (${stub.confidence} confidence)${stub.message ? ` — "${stub.message}"` : ""}`,
        location: { file: stub.file, line: stub.line },
        data: {
          hash: computeDiagnosticHash(`${stub.file}:${stub.line}:${stub.kind}`),
          kind: stub.kind,
          confidence: stub.confidence,
          penaltyWeight: stub.penaltyWeight,
          scoreCapParticipation: stub.scoreCapParticipation,
          scoreCap: stub.scoreCap,
          factorPaths: [
            stubKindFactorPath(stub.kind, "confidence"),
            stubKindFactorPath(stub.kind, "penalty_weight"),
            stubKindFactorPath(stub.kind, "score_cap_participation"),
            stubKindFactorPath(stub.kind, "score_cap"),
          ],
          inTestPath: stub.inTestPath,
          message: stub.message,
        },
      })
    }

    return diagnostics
  },
  factorLedger: (out) => out.factorLedger,
}

const computeTsSl04Output = (
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
      config,
      factorOverrides,
    )
    return buildTsSl04Output(config, collection.totalFunctions, budget, evaluated, factorOverrides)
  })

interface CleanBudget {
  readonly expectedCleanBudget: number
  readonly expectedCleanFunctionRatio: number
  readonly expectedCleanMinFunctions: number
}

interface EvaluatedStubCandidates {
  readonly stubs: ReadonlyArray<Stub>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly rawCandidates: ReadonlyArray<StubCandidateSummary>
  readonly factorEntries: ReadonlyArray<SignalFactorLedgerEntry>
}

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

const evaluateStubCandidates = (
  candidates: ReadonlyArray<StubCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
  config: TsSl04Config,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, SignalComputeError, never> =>
  Effect.gen(function* () {
    const evaluated = emptyEvaluatedStubCandidates()
    for (const candidate of candidates) {
      const candidateResult = yield* evaluateStubCandidate(
        candidate,
        calibration,
        config,
        factorOverrides,
      )
      mergeEvaluatedStubCandidate(evaluated, candidateResult)
    }
    return evaluated
  })

const emptyEvaluatedStubCandidates = (): {
  stubs: Array<Stub>
  calibrationDecisions: Array<CalibrationDecision>
  rawCandidates: Array<StubCandidateSummary>
  factorEntries: Array<SignalFactorLedgerEntry>
} => ({
  stubs: [],
  calibrationDecisions: [],
  rawCandidates: [],
  factorEntries: [],
})

const mergeEvaluatedStubCandidate = (
  target: ReturnType<typeof emptyEvaluatedStubCandidates>,
  source: EvaluatedStubCandidates,
): void => {
  target.stubs.push(...source.stubs)
  target.calibrationDecisions.push(...source.calibrationDecisions)
  target.rawCandidates.push(...source.rawCandidates)
  target.factorEntries.push(...source.factorEntries)
}

const evaluateStubCandidate = (
  candidate: StubCandidate,
  calibration: Option.Option<ResolvedCalibrationContext>,
  config: TsSl04Config,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, SignalComputeError, never> =>
  Effect.gen(function* () {
    const classified = yield* classifyNoopCandidate(candidate, calibration).pipe(
      Effect.mapError(toSignalComputeError),
    )
    if (classified.value.classification === "intentional_noop") {
      return {
        stubs: [],
        calibrationDecisions: classified.decisions,
        rawCandidates: [summarizeStubCandidate(candidate, "intentional-noop")],
        factorEntries: [],
      }
    }
    const stubKind = stubKindForClassifiedCandidate(candidate, classified.value)
    if (stubKind === undefined) {
      return {
        stubs: [],
        calibrationDecisions: classified.decisions,
        rawCandidates: [],
        factorEntries: [],
      }
    }
    const policy = yield* evaluateStubPolicy(candidate, stubKind, calibration, config, factorOverrides)
    return {
      stubs: [policy.stub],
      calibrationDecisions: [...classified.decisions, ...policy.decisions],
      rawCandidates: [summarizeStubCandidate(candidate, stubKind.kind)],
      factorEntries: policy.factorEntries,
    }
  })

const evaluateStubPolicy = (
  candidate: StubCandidate,
  stubKind: { readonly kind: StubKind; readonly message: string },
  calibration: Option.Option<ResolvedCalibrationContext>,
  config: TsSl04Config,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<
  {
    readonly stub: Stub
    readonly decisions: ReadonlyArray<CalibrationDecision>
    readonly factorEntries: ReadonlyArray<SignalFactorLedgerEntry>
  },
  SignalComputeError,
  never
> =>
  Effect.gen(function* () {
    const policyResult = yield* tuneStubPolicy(
      candidate,
      stubKind.kind,
      stubKind.message,
      calibration,
      config.hard_gate_production,
    ).pipe(Effect.mapError(toSignalComputeError))
    const effectivePolicy = finalizeStubPolicy(
      applyVectorOverridesToStubPolicy(policyResult.value, factorOverrides),
      candidate,
      config.hard_gate_production,
      factorOverrides,
    )
    return {
      stub: createStub(candidate, effectivePolicy, policyResult.decisions),
      decisions: policyResult.decisions,
      factorEntries: factorEntriesForPolicy(policyResult, factorOverrides),
    }
  })

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

const isAbstractMethod = (fn: FnLike): boolean => {
  return Node.isMethodDeclaration(fn) && fn.isAbstract()
}

interface StubCandidate {
  readonly path: string
  readonly name: string
  readonly line: number
  readonly nodeKind: string
  readonly bodyText: string
  readonly functionText: string
  readonly parentKind: string
  readonly parentText: string
  readonly ancestorKinds: ReadonlyArray<string>
  readonly isTestPath: boolean
  readonly builtinIntentionalNoop: boolean
  readonly stubKind: { readonly kind: StubKind; readonly message: string } | undefined
}

interface StubCandidateCollection {
  readonly candidates: ReadonlyArray<StubCandidate>
  readonly totalFunctions: number
}

interface ChangedHunk {
  readonly file: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
}

interface HunkLineRange {
  readonly start: number
  readonly end: number
}

const collectStubCandidates = (
  project: Project,
  context: {
    readonly worktreePath: string
    readonly changedHunks: ReadonlyArray<ChangedHunk>
  },
  config: TsSl04Config,
): StubCandidateCollection => {
  const candidates: Array<StubCandidate> = []
  let totalFunctions = 0
  const hunkIndex = buildChangedHunkIndex(context.worktreePath, context.changedHunks)

  for (const { path, fn } of getFunctionLikeIndex(project)) {
    if (isExcluded(path, config.exclude_globs)) continue

    const isTestPath = matchesAnyGlob(path, config.test_globs)
    if (isTestPath && !config.include_test_stubs) continue

    if (!lineRangeOverlapsHunkIndex(path, fn, context.worktreePath, hunkIndex)) {
      continue
    }

    // Skip abstract methods — they intentionally have no body.
    if (isAbstractMethod(fn)) {
      continue
    }

    totalFunctions++

    const bodyText = getFunctionBody(fn)
    if (bodyText === undefined) {
      continue
    }

    const builtinIntentionalNoop = isIntentionalNoop(path, fn, bodyText)
    const stubKind = builtinIntentionalNoop ? undefined : classifyStub(fn, bodyText)
    if (!builtinIntentionalNoop && stubKind === undefined) {
      continue
    }

    candidates.push({
      path,
      name: getFunctionName(fn),
      line: fn.getStartLineNumber(),
      nodeKind: syntaxKindName(fn.getKind()),
      bodyText,
      functionText: fn.getText(),
      parentKind: syntaxKindName(fn.getParent().getKind()),
      parentText: fn.getParent().getText(),
      ancestorKinds: fn
        .getAncestors()
        .slice(-8)
        .map((ancestor) => syntaxKindName(ancestor.getKind())),
      isTestPath,
      builtinIntentionalNoop,
      stubKind,
    })
  }

  return { candidates, totalFunctions }
}

const classifyNoopCandidate = (
  candidate: StubCandidate,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.noop-classifier">,
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const input: TypeScriptNoopClassificationValue = {
      file: candidate.path,
      name: candidate.name,
      line: candidate.line,
      nodeKind: candidate.nodeKind,
      bodyText: candidate.bodyText,
      functionText: candidate.functionText,
      parentKind: candidate.parentKind,
      parentText: candidate.parentText,
      ancestorKinds: candidate.ancestorKinds,
      candidateKind: candidate.stubKind?.kind ?? "unknown",
      inTestPath: candidate.isTestPath,
      classification: candidate.builtinIntentionalNoop ? "intentional_noop" : "stub",
      confidence: candidate.stubKind === undefined
        ? "high"
        : confidenceForStubKind(candidate.stubKind.kind),
      metadata: {
        builtinIntentionalNoop: candidate.builtinIntentionalNoop,
        ...(candidate.stubKind?.message !== undefined ? { message: candidate.stubKind.message } : {}),
      },
    }
    if (Option.isNone(calibration)) {
      return { value: input, decisions: [] }
    }
    return yield* calibration.value.runSlot("typescript.noop-classifier", input)
  })

const stubKindForClassifiedCandidate = (
  candidate: StubCandidate,
  classified: TypeScriptNoopClassificationValue,
): { readonly kind: StubKind; readonly message: string } | undefined => {
  if (classified.classification !== "stub") return undefined

  const metadata = classified.metadata
  const metadataKind = stubKindFromMetadata(metadata?.stubKind)
  const metadataMessage = typeof metadata?.message === "string" ? metadata.message : undefined
  return {
    kind: metadataKind ?? candidate.stubKind?.kind ?? "empty-body",
    message: metadataMessage ?? candidate.stubKind?.message ?? "Empty implementation",
  }
}

const tuneStubPolicy = (
  candidate: StubCandidate,
  kind: StubKind,
  message: string | undefined,
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const input = defaultStubPolicy(candidate, kind, message, hardGateProduction)
    if (Option.isNone(calibration)) {
      return { value: input, decisions: [] }
    }
    return yield* calibration.value.runSlot("typescript.unfinished-implementation-policy", input)
  })

const defaultStubPolicy = (
  candidate: StubCandidate,
  kind: StubKind,
  message: string | undefined,
  hardGateProduction: boolean,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const confidence = confidenceForStubKind(kind)
  const scoreCap = scoreCapForStubKind(kind)
  return {
    signalId: "TS-SL-04-unfinished-implementations",
    findingId: `${candidate.path}:${candidate.line}:${candidate.name}:${kind}`,
    file: candidate.path,
    name: candidate.name,
    line: candidate.line,
    stubKind: kind,
    message: message ?? "Empty implementation",
    visible: true,
    severity: severityForStub(candidate.isTestPath, confidence, hardGateProduction),
    confidence,
    penaltyWeight: penaltyWeightForStubKind(kind),
    scoreCapParticipation: scoreCapParticipationForStubKind(kind),
    ...(scoreCap !== undefined ? { scoreCap } : {}),
    factorPathPrefix: `${STUB_KIND_FACTOR_PREFIX}.${kind}`,
    metadata: {
      inTestPath: candidate.isTestPath,
    },
  }
}

const applyVectorOverridesToStubPolicy = (
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const prefix = policy.factorPathPrefix
  const confidence = stringFactorValue(`${prefix}.confidence`, policy.confidence, overrides)
  const scoreCap = numberFactorValue(`${prefix}.score_cap`, policy.scoreCap, overrides)
  return {
    ...policy,
    confidence: toStubConfidence(confidence),
    penaltyWeight:
      numberFactorValue(`${prefix}.penalty_weight`, policy.penaltyWeight, overrides) ??
      policy.penaltyWeight,
    scoreCapParticipation: booleanFactorValue(
      `${prefix}.score_cap_participation`,
      policy.scoreCapParticipation,
      overrides,
    ),
    ...(scoreCap !== undefined ? { scoreCap } : {}),
  }
}

const finalizeStubPolicy = (
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  candidate: StubCandidate,
  hardGateProduction: boolean,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const confidence = toStubConfidence(policy.confidence)
  const confidencePath = `${policy.factorPathPrefix}.confidence`
  const defaultSeverity = severityForStub(
    candidate.isTestPath,
    confidenceForStubKind(toStubKind(policy.stubKind)),
    hardGateProduction,
  )
  const shouldRecomputeSeverity =
    Object.hasOwn(overrides, confidencePath) || policy.severity === defaultSeverity
  return {
    ...policy,
    confidence,
    severity: shouldRecomputeSeverity
      ? severityForStub(candidate.isTestPath, confidence, hardGateProduction)
      : policy.severity,
  }
}

const createStub = (
  candidate: StubCandidate,
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  policyDecisions: ReadonlyArray<CalibrationDecision>,
): Stub => ({
  file: candidate.path,
  name: candidate.name,
  line: candidate.line,
  kind: toStubKind(policy.stubKind),
  visible: policy.visible,
  severity: policy.severity,
  confidence: toStubConfidence(policy.confidence),
  penaltyWeight: policy.penaltyWeight,
  scoreCapParticipation: policy.scoreCapParticipation,
  scoreCap: policy.scoreCap,
  inTestPath: candidate.isTestPath,
  message: policy.message,
  policyDecisions,
})

const factorEntriesForPolicy = (
  policyResult: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): ReadonlyArray<SignalFactorLedgerEntry> => {
  const policy = policyResult.value
  const scoreCapPath = `${policy.factorPathPrefix}.score_cap`
  return [
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.confidence`, policy.confidence),
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.penalty_weight`, policy.penaltyWeight),
    factorEntryForPolicyValue(
      policyResult,
      `${policy.factorPathPrefix}.score_cap_participation`,
      policy.scoreCapParticipation,
    ),
    ...(policy.scoreCap !== undefined || Object.hasOwn(overrides, scoreCapPath)
      ? [factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.score_cap`, policy.scoreCap)]
      : []),
  ]
}

const factorEntryForPolicyValue = (
  policyResult: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  path: string,
  value: SignalFactorValue | undefined,
): SignalFactorLedgerEntry => {
  const decision = [...policyResult.decisions]
    .reverse()
    .find((item) => item.factorPaths?.includes(path))
  return makeFactorEntry(factorDefinitionByPath(path), value ?? null, {
    source: decision === undefined ? "computed" : "module",
    ...(decision !== undefined
      ? {
          attribution: {
            moduleId: decision.moduleId,
            processorId: decision.processorId,
            ...(decision.ruleId !== undefined ? { ruleId: decision.ruleId } : {}),
            evidence: decision.evidence,
          },
        }
      : {}),
  })
}

const syntaxKindName = (kind: SyntaxKind): string => SyntaxKind[kind] ?? String(kind)

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({ signalId: "TS-SL-04-unfinished-implementations", message: String(cause), cause })

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

const summarizeStubCandidate = (
  candidate: StubCandidate,
  kind: StubCandidateSummary["kind"],
): StubCandidateSummary => ({
  file: candidate.path,
  name: candidate.name,
  line: candidate.line,
  kind,
  inTestPath: candidate.isTestPath,
})

const compareCandidateSummaries = (
  a: StubCandidateSummary,
  b: StubCandidateSummary,
): number => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name)

const buildChangedHunkIndex = (
  worktreePath: string,
  hunks: ReadonlyArray<ChangedHunk>,
): ReadonlyMap<string, ReadonlyArray<HunkLineRange>> | undefined => {
  if (hunks.length === 0) return undefined
  const byFile = new Map<string, Array<HunkLineRange>>()

  for (const hunk of hunks) {
    const absoluteFile = absoluteHunkFilePath(worktreePath, hunk.file)
    const ranges = byFile.get(absoluteFile) ?? []
    ranges.push({
      start: hunk.newStart,
      end: hunk.newStart + hunk.newLines,
    })
    byFile.set(absoluteFile, ranges)
  }

  return byFile
}

const lineRangeOverlapsHunkIndex = (
  filePath: string,
  fn: FnLike,
  worktreePath: string,
  hunkIndex: ReadonlyMap<string, ReadonlyArray<HunkLineRange>> | undefined,
): boolean => {
  if (hunkIndex === undefined) return true
  const absoluteFile = absoluteHunkFilePath(worktreePath, filePath)
  const ranges = hunkIndex.get(absoluteFile)
  if (ranges === undefined) return false

  const startLine = fn.getStartLineNumber()
  const endLine = fn.getEndLineNumber()
  for (const range of ranges) {
    if (startLine < range.end && endLine >= range.start) {
      return true
    }
  }

  return false
}

const absoluteHunkFilePath = (worktreePath: string, filePath: string): string =>
  filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`
