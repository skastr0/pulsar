import {
  CalibrationContextTag,
  SignalContextTag,
  SignalFactorPolicyTag,
  makeFactorEntry,
  makeFactorLedger,
  overriddenFactorValue,
  computeDiagnosticHash,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type Diagnostic,
  type ResolvedCalibrationContext,
  type Signal,
  type SignalFactorDefinition,
  type SignalFactorLedger,
  type SignalFactorLedgerEntry,
  type SignalFactorValue,
  SignalComputeError,
  type TypeScriptUnfinishedImplementationPolicyValue,
  type TypeScriptNoopClassificationValue,
} from "@skastr0/pulsar-core"
import { Effect, Option, Schema } from "effect"
import { Node, SyntaxKind, type Project } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  getFunctionBody,
  getFunctionLikeIndex,
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

export const TsSl04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  hard_gate_production: Schema.Boolean,
  include_test_stubs: Schema.Boolean,
})
export type TsSl04Config = typeof TsSl04Config.Type

type StubKind = "throw-not-implemented" | "empty-body" | "todo-comment" | "mock-return"
type StubConfidence = "high" | "medium" | "low"
type StubSeverity = "info" | "warn" | "block"

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

const STUB_KIND_FACTOR_PREFIX = "stub_kinds" as const

const stubKindFactorPath = (kind: StubKind, factor: string): string =>
  `${STUB_KIND_FACTOR_PREFIX}.${kind}.${factor}`

const stubKindFactorDefinitions = (
  kind: StubKind,
): ReadonlyArray<SignalFactorDefinition> => {
  const scoreCap = scoreCapForStubKind(kind)
  return [
    {
      path: stubKindFactorPath(kind, "confidence"),
      title: `${kind} confidence`,
      valueKind: "string",
      scoreRole: "confidence",
      defaultValue: confidenceForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "penalty_weight"),
      title: `${kind} penalty weight`,
      valueKind: "number",
      scoreRole: "penalty",
      defaultValue: penaltyWeightForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "score_cap_participation"),
      title: `${kind} score cap participation`,
      valueKind: "boolean",
      scoreRole: "score-cap",
      defaultValue: scoreCapParticipationForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "score_cap"),
      title: `${kind} score cap`,
      valueKind: "number",
      scoreRole: "score-cap",
      ...(scoreCap !== undefined ? { defaultValue: scoreCap } : {}),
    },
  ]
}

const TsSl04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  ...stubKindFactorDefinitions("throw-not-implemented"),
  ...stubKindFactorDefinitions("empty-body"),
  ...stubKindFactorDefinitions("todo-comment"),
  ...stubKindFactorDefinitions("mock-return"),
  {
    path: "budget.expected_clean_function_ratio",
    title: "Expected clean function ratio",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: 0.01,
  },
  {
    path: "budget.expected_clean_min_functions",
    title: "Expected clean minimum functions",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: 10,
  },
  {
    path: "filtering.include_test_stubs",
    title: "Include test stubs",
    valueKind: "boolean",
    scoreRole: "metadata",
  },
  {
    path: "filtering.production_only_score",
    title: "Production-only score pressure",
    valueKind: "boolean",
    scoreRole: "metadata",
    defaultValue: true,
  },
]

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04-unfinished-implementations",
  title: "Unfinished implementations",
  aliases: ["TS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "factor-policy-v1",
  configSchema: TsSl04Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/.storybook/**",
      "**/sst-env.d.ts",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "demo/**",
      "**/demo/**",
      "demos/**",
      "**/demos/**",
      "private-demos/**",
      "**/private-demos/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "spec/**",
      "**/spec/**",
      "specs/**",
      "**/specs/**",
      "sdk-samples/**",
      "**/sdk-samples/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-helpers/**",
      "**/test-mocks/**",
      "**/test-harness/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*mock.ts",
      "**/*mock.tsx",
      "**/mock*.ts",
      "**/mock*.tsx",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*mocks.ts",
      "**/*mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*harness.ts",
      "**/*harness.tsx",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.harness.ts",
      "**/*.harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/test-runtime.ts",
      "**/*test-runtime.ts",
      "**/*test-runtime.tsx",
      "**/*.test-runtime.ts",
      "**/*.test-runtime.tsx",
      "**/*test-runtime*.ts",
      "**/*test-runtime*.tsx",
      "**/happydom.ts",
    ],
    top_n_diagnostics: 20,
    hard_gate_production: true,
    include_test_stubs: false,
  },
  factorDefinitions: TsSl04FactorDefinitions,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const factorPolicy = yield* Effect.serviceOption(SignalFactorPolicyTag)
      const { candidates, totalFunctions } = yield* Effect.try({
        try: () => collectStubCandidates(project, context, config),
        catch: toSignalComputeError,
      })
      const stubs: Array<Stub> = []
      const calibrationDecisions: Array<CalibrationDecision> = []
      const rawCandidates: Array<StubCandidateSummary> = []
      const factorEntries: Array<SignalFactorLedgerEntry> = []

      const factorOverrides = Option.isSome(factorPolicy)
        ? factorPolicy.value.vectorOverrides
        : {}
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
      const expectedCleanBudget = Math.max(
        expectedCleanMinFunctions,
        totalFunctions * expectedCleanFunctionRatio,
      )

      for (const candidate of candidates) {
        const classified = yield* classifyNoopCandidate(candidate, calibration).pipe(
          Effect.mapError(toSignalComputeError),
        )
        calibrationDecisions.push(...classified.decisions)

        if (classified.value.classification === "intentional_noop") {
          rawCandidates.push(summarizeStubCandidate(candidate, "intentional-noop"))
          continue
        }

        const stubKind = stubKindForClassifiedCandidate(candidate, classified.value)
        if (stubKind !== undefined) {
          rawCandidates.push(summarizeStubCandidate(candidate, stubKind.kind))
          const policyResult = yield* tuneStubPolicy(
            candidate,
            stubKind.kind,
            stubKind.message,
            calibration,
            config.hard_gate_production,
          ).pipe(Effect.mapError(toSignalComputeError))
          calibrationDecisions.push(...policyResult.decisions)
          const effectivePolicy = applyVectorOverridesToStubPolicy(
            policyResult.value,
            factorOverrides,
          )
          stubs.push(createStub(candidate, effectivePolicy, policyResult.decisions))
          factorEntries.push(...factorEntriesForPolicy(policyResult))
        }
      }

      const byKind = new Map<StubKind, number>()
      for (const stub of stubs) {
        byKind.set(stub.kind, (byKind.get(stub.kind) ?? 0) + 1)
      }

      return {
        rawCandidates: rawCandidates.sort(compareCandidateSummaries),
        stubs: stubs.sort(compareStubs),
        calibrationDecisions,
        byKind,
        productionStubs: stubs.filter((s) => !s.inTestPath),
        testStubs: stubs.filter((s) => s.inTestPath),
        totalFunctions,
        expectedCleanBudget,
        expectedCleanFunctionRatio,
        expectedCleanMinFunctions,
        hardGateProduction: config.hard_gate_production,
        diagnosticLimit: config.top_n_diagnostics,
        factorLedger: makeFactorLedger("TS-SL-04-unfinished-implementations", [
          ...factorEntries,
          makeFactorEntry(factorDefinitionByPath("budget.expected_clean_function_ratio"), expectedCleanFunctionRatio),
          makeFactorEntry(factorDefinitionByPath("budget.expected_clean_min_functions"), expectedCleanMinFunctions),
          makeFactorEntry(factorDefinitionByPath("filtering.include_test_stubs"), config.include_test_stubs),
          makeFactorEntry(factorDefinitionByPath("filtering.production_only_score"), true),
        ]),
      }
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
): ReadonlyArray<SignalFactorLedgerEntry> => {
  const policy = policyResult.value
  return [
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.confidence`, policy.confidence),
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.penalty_weight`, policy.penaltyWeight),
    factorEntryForPolicyValue(
      policyResult,
      `${policy.factorPathPrefix}.score_cap_participation`,
      policy.scoreCapParticipation,
    ),
    ...(policy.scoreCap !== undefined
      ? [factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.score_cap`, policy.scoreCap)]
      : []),
  ]
}

const factorEntryForPolicyValue = (
  policyResult: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  path: string,
  value: SignalFactorValue,
): SignalFactorLedgerEntry => {
  const decision = [...policyResult.decisions]
    .reverse()
    .find((item) => item.factorPaths?.includes(path))
  return makeFactorEntry(factorDefinitionByPath(path), value, {
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

const stubKindFromMetadata = (value: unknown): StubKind | undefined =>
  typeof value === "string" && STUB_KINDS.has(value as StubKind)
    ? (value as StubKind)
    : undefined

const STUB_KINDS = new Set<StubKind>([
  "throw-not-implemented",
  "empty-body",
  "todo-comment",
  "mock-return",
])

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

function confidenceForStubKind(kind: StubKind): StubConfidence {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return "high"
  if (kind === "mock-return") return "medium"
  return "low"
}

const toStubConfidence = (value: string): StubConfidence =>
  value === "high" || value === "medium" || value === "low" ? value : "medium"

const toStubKind = (value: TypeScriptUnfinishedImplementationPolicyValue["stubKind"]): StubKind =>
  value === "throw-not-implemented" ||
  value === "empty-body" ||
  value === "todo-comment" ||
  value === "mock-return"
    ? value
    : "empty-body"

function penaltyWeightForStubKind(kind: StubKind): number {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return 1
  if (kind === "mock-return") return 0.6
  return 0.25
}

function scoreCapParticipationForStubKind(kind: StubKind): boolean {
  return kind === "throw-not-implemented" || kind === "todo-comment"
}

function scoreCapForStubKind(kind: StubKind): number | undefined {
  return scoreCapParticipationForStubKind(kind) ? 0.8 : undefined
}

const severityForStub = (
  inTestPath: boolean,
  confidence: StubConfidence,
  hardGateProduction: boolean,
): StubSeverity =>
  hardGateProduction && !inTestPath && confidence === "high"
    ? "block"
    : !inTestPath
      ? "warn"
      : "info"

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

const factorDefinitionByPath = (path: string): SignalFactorDefinition => {
  const definition = TsSl04FactorDefinitions.find((item) => item.path === path)
  if (definition === undefined) {
    throw new Error(`Unknown TS-SL-04 factor path: ${path}`)
  }
  return definition
}

const numberFactorValue = (
  path: string,
  defaultValue: number | undefined,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): number | undefined => {
  const value = overriddenFactorValue(path, defaultValue ?? null, overrides)
  return typeof value === "number" ? value : defaultValue
}

const stringFactorValue = (
  path: string,
  defaultValue: string,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): string => {
  const value = overriddenFactorValue(path, defaultValue, overrides)
  return typeof value === "string" ? value : defaultValue
}

const booleanFactorValue = (
  path: string,
  defaultValue: boolean,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): boolean => {
  const value = overriddenFactorValue(path, defaultValue, overrides)
  return typeof value === "boolean" ? value : defaultValue
}

const isIntentionalNoop = (filePath: string, fn: FnLike, bodyText: string): boolean => {
  if (!isEmptyBodyText(bodyText) && !isNoopImplementationFile(filePath)) {
    return false
  }

  if (isNoopImplementationFile(filePath)) {
    return true
  }

  if (isPromiseSwallowHandler(fn)) {
    return true
  }

  if (isNeverSettlingPromiseExecutor(fn)) {
    return true
  }

  if (isReturnedNoop(fn)) {
    return true
  }

  if (isJsxEventNoop(fn)) {
    return true
  }

  if (isUiPlaceholderCallback(fn)) {
    return true
  }

  if (isEventTerminalNoop(fn)) {
    return true
  }

  if (isDisposableNoop(fn)) {
    return true
  }

  if (isFrameworkLifecycleNoop(filePath, fn)) {
    return true
  }

  if (isReactHostConfigOptionalNoop(fn)) {
    return true
  }

  if (isDeferredResolverPlaceholder(fn)) {
    return true
  }

  if (isMutablePlaceholderInitializer(fn)) {
    return true
  }

  if (isEmptyObjectMemberOnEmptyConstant(fn)) {
    return true
  }

  if (isIgnoredParameterInterfaceHook(fn)) {
    return true
  }

  if (isParameterPropertyConstructor(fn)) {
    return true
  }

  if (isProtectedHookNoop(fn)) {
    return true
  }

  if (isOptionalProtectedFrameworkHookNoop(fn)) {
    return true
  }

  if (isYargsParentCommandHandler(fn)) {
    return true
  }

  if (isInterfaceResetNoop(fn)) {
    return true
  }

  if (isObjectLifecycleNoop(fn)) {
    return true
  }

  if (isNullObjectLifecycleFallback(fn)) {
    return true
  }

  if (isIgnoredErrorHandler(fn)) {
    return true
  }

  if (isNoopFactoryObjectMember(fn)) {
    return true
  }

  if (isExplicitNoopObjectMember(fn)) {
    return true
  }

  if (isTerminalLifecycleCallback(fn)) {
    return true
  }

  if (isEventDeltaProjectionNoop(fn)) {
    return true
  }

  if (isEventMatchNoopBranch(fn)) {
    return true
  }

  if (isProjectionAdapterFinishNoop(fn)) {
    return true
  }

  if (isFallbackLoggerNoop(fn)) {
    return true
  }

  if (isFallbackCallbackInitializer(fn)) {
    return true
  }

  if (isConsoleMethodSilencingNoop(fn)) {
    return true
  }

  if (isExpressionBodyReturnedNoop(fn)) {
    return true
  }

  if (isCapabilityAbsentContractStub(fn)) {
    return true
  }

  if (isBorrowedResourceCloseNoop(fn)) {
    return true
  }

  if (isCommonEmptyContractCallback(fn)) {
    return true
  }

  if (isTimerKeepAliveNoop(fn)) {
    return true
  }

  if (isRegistrationMarkerNoop(fn)) {
    return true
  }

  if (isConditionalNoopBranch(fn)) {
    return true
  }

  if (isUnavailableCapabilitySetterNoop(fn)) {
    return true
  }

  if (isServerReactiveContractNoop(filePath, fn)) {
    return true
  }

  return hasNoopName(getFunctionName(fn))
}

const isEmptyBodyText = (bodyText: string): boolean => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  return normalized === "{}" || normalized === "{ }" || normalized === "{  }"
}

const isNoopImplementationFile = (filePath: string): boolean => {
  const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath
  return /(?:^|[._-])noop(?:[._-]|$)/i.test(fileName)
}

const hasNoopName = (name: string): boolean => /(?:^|[^a-z0-9])no[-_]?op(?:$|[^a-z0-9]|[A-Z])/i.test(name)

const isPromiseSwallowHandler = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) {
    return false
  }

  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) {
    return false
  }

  const expression = parent.getExpression()
  return Node.isPropertyAccessExpression(expression) && ["catch", "finally", "then"].includes(expression.getName())
}

const isNeverSettlingPromiseExecutor = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isNewExpression(parent)) return false
  return parent.getExpression().getText() === "Promise"
}

const isReturnedNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  return Node.isReturnStatement(fn.getParent())
}

const isJsxEventNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isJsxExpression(parent)) return false
  const attribute = parent.getParent()
  if (!Node.isJsxAttribute(attribute)) return false
  return /^on[A-Z]/.test(attribute.getNameNode().getText())
}

const isUiPlaceholderCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  const propertyName = propertyNameOf(parent)
  return [
    "onClose",
    "onDispose",
    "onDragMove",
    "onDragReset",
    "onDragStart",
    "onFlush",
    "onRedirect",
    "onSelect",
    "onSuccess",
  ].includes(propertyName)
}

const isEventTerminalNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  return propertyNameOf(parent).endsWith(".ended")
}

const isDisposableNoop = (fn: FnLike): boolean => {
  if (Node.isMethodDeclaration(fn) && fn.getNameNode().getText().includes("Symbol.dispose")) {
    return true
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  return Node.isPropertyAssignment(parent) && propertyNameOf(parent).includes("Symbol.dispose")
}

const isFrameworkLifecycleNoop = (filePath: string, fn: FnLike): boolean => {
  if (getFunctionName(fn) !== "deactivate") return false
  return /(?:^|[\\/])extension\.tsx?$/.test(filePath)
}

const isDeferredResolverPlaceholder = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  if (!["resolve", "reject"].includes(propertyNameOf(parent))) return false
  return hasOnlyIgnoredParameters(fn)
}

const isMutablePlaceholderInitializer = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isVariableDeclaration(parent)) return false
  const declarationList = parent.getParent()
  return Node.isVariableDeclarationList(declarationList) && declarationList.getText().trimStart().startsWith("let ")
}

const isEmptyObjectMemberOnEmptyConstant = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const property = fn.getParent()
  if (!Node.isPropertyAssignment(property)) return false
  const object = property.getParent()
  if (!Node.isObjectLiteralExpression(object)) return false
  const declaration = object.getParent()
  if (!Node.isVariableDeclaration(declaration)) return false
  return /^EMPTY(?:_|[A-Z])/.test(declaration.getName())
}

const isIgnoredParameterInterfaceHook = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) && !Node.isFunctionDeclaration(fn) && !Node.isArrowFunction(fn)) {
    return false
  }
  if (!hasOnlyIgnoredParameters(fn)) return false
  return /^(?:webSocket|on[A-Z])/.test(getFunctionName(fn))
}

const isParameterPropertyConstructor = (fn: FnLike): boolean => {
  if (!Node.isConstructorDeclaration(fn)) return false
  return fn.getParameters().some((parameter) =>
    /\b(?:public|private|protected|readonly)\b/.test(parameter.getText()),
  )
}

const isProtectedHookNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn)) return false
  const name = fn.getName()
  if (!name.startsWith("_")) return false
  if (!/\b(?:protected|private)\b/.test(fn.getText())) return false
  return fn.getParameters().every((parameter) => parameter.getName().startsWith("_"))
}

const OPTIONAL_PROTECTED_FRAMEWORK_HOOK_NAMES = new Set([
  "buildWrangler",
  "normalizeBuildCommand",
  "validate",
])

const isOptionalProtectedFrameworkHookNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn)) return false
  if (!/\bprotected\b/.test(fn.getText())) return false
  if (!OPTIONAL_PROTECTED_FRAMEWORK_HOOK_NAMES.has(fn.getName())) return false
  return fn.getParameters().every((parameter) => parameter.getName().startsWith("_"))
}

const isYargsParentCommandHandler = (fn: FnLike): boolean => {
  const parent = fn.getParent()
  let object: import("ts-morph").ObjectLiteralExpression | undefined

  if (Node.isMethodDeclaration(fn) && fn.getName() === "handler") {
    const methodParent = fn.getParent()
    if (Node.isObjectLiteralExpression(methodParent)) object = methodParent
  }

  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && Node.isPropertyAssignment(parent)) {
    if (propertyNameOf(parent) !== "handler") return false
    const propertyParent = parent.getParent()
    if (Node.isObjectLiteralExpression(propertyParent)) object = propertyParent
  }

  if (object === undefined) return false

  return object.getProperties().some((property) => {
    if (Node.isShorthandPropertyAssignment(property)) return property.getName() === "builder"
    if (!Node.isPropertyAssignment(property)) return false
    const name = property.getNameNode().getText().replace(/^["']|["']$/g, "")
    return name === "builder"
  })
}

const isInterfaceResetNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "reset") return false
  const parent = fn.getParent()
  if (!Node.isClassDeclaration(parent)) return false
  return parent.getImplements().length > 0
}

const isObjectLifecycleNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn)) return false
  if (!["remove", "dispose", "destroy", "cleanup", "stop"].includes(fn.getName())) return false
  if (!hasOnlyIgnoredParameters(fn)) return false

  const parent = fn.getParent()
  if (!Node.isObjectLiteralExpression(parent)) return false

  const siblingNames = objectMemberNames(parent)

  return ["create", "configure", "setup", "start", "target"].some((name) =>
    siblingNames.has(name),
  )
}

const isNullObjectLifecycleFallback = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const propertyName = objectMemberNameForFunction(fn)
  if (
    ![
      "attachLifecycle",
      "detachLifecycle",
      "dispose",
      "remove",
      "cleanup",
      "stop",
      "destroy",
      "shutdown",
    ].includes(propertyName)
  ) {
    return false
  }

  const siblingNames = objectMemberNames(object)

  const hasNullObjectShape =
    siblingNames.has("emitter") ||
    siblingNames.has("app") ||
    siblingNames.has("signal") ||
    siblingNames.has("drainPending") ||
    siblingNames.has("isAvailable") ||
    siblingNames.has("available") ||
    siblingNames.has("enabled")
  if (!hasNullObjectShape) return false

  return hasFallbackAncestor(object)
}

const isIgnoredErrorHandler = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  return /^ignore[A-Z].*Error$/.test(name)
}

const isNoopFactoryObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  for (const ancestor of object.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor)) {
      return hasNoopFactoryName(ancestor.getName() ?? "")
    }
    if (Node.isArrowFunction(ancestor) || Node.isSourceFile(ancestor)) {
      return false
    }
  }

  return false
}

const hasNoopFactoryName = (name: string): boolean => /(?:^|[^a-z0-9]|[a-z])no[-_]?op/i.test(name)

const isExplicitNoopObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const declaration = object.getParent()
  return Node.isVariableDeclaration(declaration) && hasNoopFactoryName(declaration.getName())
}

const isTerminalLifecycleCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const property = nearestPropertyAssignment(fn)
  if (property === undefined) return false
  return /^on(?=[A-Z])(?=.*(?:End|Settled|Complete|Close)$)/.test(propertyNameOf(property))
}

const isEventDeltaProjectionNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  if (parent.getExpression().getText() !== "SyncEvent.project") return false
  if (parent.getArguments()[1] !== fn) return false
  return /\.Delta\.Sync$/.test(parent.getArguments()[0]?.getText() ?? "")
}

const isEventMatchNoopBranch = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const property = nearestPropertyAssignment(fn)
  if (property === undefined) return false
  const object = property.getParent()
  if (!Node.isObjectLiteralExpression(object)) return false
  const call = object.getParent()
  if (!Node.isCallExpression(call)) return false
  if (!/Event\.All\.match$/.test(call.getExpression().getText())) return false
  return /\.(?:delta|retried)$/.test(propertyNameOf(property))
}

const isProjectionAdapterFinishNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "finish") return false
  const object = fn.getParent()
  if (!Node.isObjectLiteralExpression(object)) return false
  const siblingNames = objectMemberNames(object)
  return (
    siblingNames.has("appendMessage") &&
    (siblingNames.has("updateAssistant") ||
      siblingNames.has("updateCompaction") ||
      siblingNames.has("updateShell"))
  )
}

const isFallbackLoggerNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const loggerMethods = new Set(["debug", "trace", "info", "warn", "error"])
  const propertyName = objectMemberNameForFunction(fn)
  if (!loggerMethods.has(propertyName)) return false

  const memberNames = object.getProperties().flatMap((property) => {
    if (Node.isMethodDeclaration(property)) return [property.getName()]
    if (Node.isPropertyAssignment(property)) return [propertyNameOf(property)]
    return []
  })
  if (memberNames.length === 0 || memberNames.some((name) => !loggerMethods.has(name))) {
    return false
  }

  return hasFallbackAncestor(object)
}

const isFallbackCallbackInitializer = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const binary = fn.getAncestors().find(Node.isBinaryExpression)
  if (binary === undefined || binary.getOperatorToken().getText() !== "??") return false
  const declaration = binary.getAncestors().find(Node.isVariableDeclaration)
  if (declaration === undefined) return false
  return /^(?:log|logger|debug|trace|warn|error|noop|fallback)/i.test(declaration.getName())
}

const isConsoleMethodSilencingNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isBinaryExpression(parent) || parent.getOperatorToken().getText() !== "=") return false
  if (parent.getRight() !== fn) return false
  const left = parent.getLeft()
  if (!Node.isPropertyAccessExpression(left)) return false
  if (left.getExpression().getText() !== "console") return false
  return ["debug", "error", "info", "log", "trace", "warn"].includes(left.getName())
}

const isExpressionBodyReturnedNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isArrowFunction(parent)) return false
  return parent.getBody() === fn
}

const isCapabilityAbsentContractStub = (fn: FnLike): boolean => {
  if (!Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn)) return false
  const sourceFile = fn.getSourceFile()
  const beforeFunction = sourceFile.getFullText().slice(0, fn.getStart()).slice(-400)
  return /(?:does not expose|no .*surfaces|without .*surfaces)/i.test(beforeFunction)
}

const isBorrowedResourceCloseNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "close") return false
  const classDeclaration = fn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
  return classDeclaration?.getName()?.startsWith("Borrowed") === true
}

const isConditionalNoopBranch = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isConditionalExpression(parent)) return false
  const otherBranch =
    parent.getWhenTrue() === fn ? parent.getWhenFalse() : parent.getWhenTrue()
  return !isEmptyBodyText(otherBranch.getText())
}

const isUnavailableCapabilitySetterNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const propertyName = objectMemberNameForFunction(fn)
  if (!/^set[A-Z].*Value$/.test(propertyName)) return false

  return object.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property)) return false
    const name = propertyNameOf(property)
    const value = property.getInitializer()?.getText().trim()
    return (
      (name === "requiresCredential" && value === "false") ||
      (name === "credentialPath" && /^["']{2}$/.test(value ?? ""))
    )
  })
}

const SERVER_REACTIVE_EMPTY_CONTRACT_NAMES = new Set([
  "cancelCallback",
  "createEffect",
  "enableExternalSource",
  "fn",
  "onMount",
])

const isServerReactiveContractNoop = (filePath: string, fn: FnLike): boolean => {
  if (/(?:^|[\\/])server[\\/]reactive\.tsx?$/.test(filePath)) {
    return SERVER_REACTIVE_EMPTY_CONTRACT_NAMES.has(objectMemberNameForFunction(fn))
  }

  if (/(?:^|[\\/])server[\\/]rendering\.tsx?$/.test(filePath)) {
    return [
      "enableHydration",
      "enableScheduling",
      "f callback",
      "resetErrorBoundaries",
    ].includes(getFunctionName(fn))
  }

  return false
}

const COMMON_EMPTY_CONTRACT_CALLBACKS = new Set([
  "ack",
  "acknowledge",
  "cleanup",
  "clearSetupPromotionRuntimeModuleCache",
  "clearProviderRuntimeHookCache",
  "close",
  "dispose",
  "log",
  "markDispatchIdle",
  "markRunComplete",
  "notifyStarted",
  "onReplyStart",
  "prepareProviderDynamicModel",
  "refreshTypingTtl",
  "release",
  "releaseRetryTokens",
  "sendPairingReply",
  "startTypingLoop",
  "startTypingOnText",
  "stop",
  "unsubscribe",
  "[Symbol.asyncIterator]",
])

const isCommonEmptyContractCallback = (fn: FnLike): boolean => {
  if (
    !Node.isArrowFunction(fn) &&
    !Node.isFunctionExpression(fn) &&
    !Node.isFunctionDeclaration(fn) &&
    !Node.isMethodDeclaration(fn)
  ) {
    return false
  }
  if (fn.getParameters().length > 0) return false
  if (Node.isMethodDeclaration(fn) && !Node.isObjectLiteralExpression(fn.getParent())) return false
  return COMMON_EMPTY_CONTRACT_CALLBACKS.has(objectMemberNameForFunction(fn))
}

const isTimerKeepAliveNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  const expression = parent.getExpression().getText()
  return expression === "setInterval" || expression === "setTimeout"
}

const isRegistrationMarkerNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  const firstArg = parent.getArguments()[0]
  if (firstArg !== fn) return false
  return /\.register[A-Z]/.test(parent.getExpression().getText())
}

const nearestPropertyAssignment = (
  node: Node,
): import("ts-morph").PropertyAssignment | undefined => {
  for (const ancestor of [node, ...node.getAncestors()]) {
    if (Node.isPropertyAssignment(ancestor)) return ancestor
    if (Node.isSourceFile(ancestor)) return undefined
  }
  return undefined
}

const objectLiteralParentOfFunctionMember = (
  fn: FnLike,
): import("ts-morph").ObjectLiteralExpression | undefined => {
  if (Node.isMethodDeclaration(fn)) {
    const parent = fn.getParent()
    return Node.isObjectLiteralExpression(parent) ? parent : undefined
  }

  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return undefined
  const object = parent.getParent()
  return Node.isObjectLiteralExpression(object) ? object : undefined
}

const objectMemberNameForFunction = (fn: FnLike): string => {
  if (Node.isMethodDeclaration(fn)) return fn.getName()
  const parent = fn.getParent()
  return Node.isPropertyAssignment(parent) ? propertyNameOf(parent) : getFunctionName(fn)
}

const objectMemberNames = (
  object: import("ts-morph").ObjectLiteralExpression,
): ReadonlySet<string> =>
  new Set(
    object.getProperties().flatMap((property) => {
      if (Node.isMethodDeclaration(property)) return [property.getName()]
      if (Node.isPropertyAssignment(property)) return [propertyNameOf(property)]
      if (Node.isShorthandPropertyAssignment(property)) return [property.getName()]
      return []
    }),
  )

const hasFallbackAncestor = (node: Node): boolean => {
  for (const ancestor of node.getAncestors()) {
    if (Node.isIfStatement(ancestor)) return true
    if (Node.isConditionalExpression(ancestor)) return true
    if (Node.isBinaryExpression(ancestor) && ancestor.getOperatorToken().getText() === "??") return true
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isSourceFile(ancestor)
    ) {
      return false
    }
  }
  return false
}

const propertyNameOf = (property: import("ts-morph").PropertyAssignment): string => {
  return property.getNameNode().getText().replace(/^["']|["']$/g, "")
}

const hasOnlyIgnoredParameters = (fn: FnLike): boolean => {
  const parameters = fn.getParameters()
  return parameters.length > 0 && parameters.every((parameter) => parameter.getName().startsWith("_"))
}

const classifyStub = (fn: FnLike, bodyText: string): { kind: StubKind; message: string } | undefined => {
  if (isEmptyBodyText(bodyText)) {
    return { kind: "empty-body", message: "Empty implementation" }
  }

  if (MAYBE_THROW_STUB_PATTERN.test(bodyText)) {
    const throwStubMessage = directStubThrowMessage(fn)
    if (throwStubMessage !== undefined) {
      if (isExplicitUnsupportedCapabilityMessage(throwStubMessage)) return undefined
      if (isFrameworkContractUnsupportedHook(fn, throwStubMessage)) return undefined
      if (isFixtureEntrypointPlaceholder(fn, throwStubMessage)) return undefined
      const message = throwStubMessage.toLowerCase()
      if (/not\s*implemented|todo|fixme|stub/i.test(message)) {
        return { kind: "throw-not-implemented", message: throwStubMessage }
      }
    }
  }

  if (MAYBE_TODO_COMMENT_PATTERN.test(bodyText)) {
    const commentText = commentOnlyBodyText(bodyText)
    if (commentText !== undefined && /todo|fixme|xxx/i.test(commentText)) {
      return { kind: "todo-comment", message: commentText }
    }
  }

  if (!MAYBE_PLACEHOLDER_RETURN_PATTERN.test(bodyText)) return undefined

  const normalized = bodyText.replace(/\s+/g, " ").trim()
  const returnLiteralMatch = /^\{\s*return\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\d+|true|false|null|undefined|\[\s*\]|\{\s*\})\s*;?\s*\}$/.exec(
    normalized,
  )
  if (returnLiteralMatch) {
    const returnedText = (returnLiteralMatch[1] ?? returnLiteralMatch[2] ?? returnLiteralMatch[3] ?? "").toLowerCase()
    if (/placeholder|mock|todo|fixme|not\s*implemented|stub/.test(returnedText)) {
      return { kind: "mock-return", message: "Returns placeholder literal" }
    }
  }

  return undefined
}

const MAYBE_THROW_STUB_PATTERN = /\bthrow\b[\s\S]*(?:not\s*implemented|todo|fixme|stub)/i
const MAYBE_TODO_COMMENT_PATTERN = /(?:\/\/|\/\*)[\s\S]*(?:todo|fixme|xxx)/i
const MAYBE_PLACEHOLDER_RETURN_PATTERN = /\breturn\b[\s\S]*(?:placeholder|mock|todo|fixme|not\s*implemented|stub)/i

const isExplicitUnsupportedCapabilityMessage = (message: string): boolean =>
  /`[^`]+`\s+on\s+.+\s+is\s+not\s+implemented\s+by\s+[^.]+\./i.test(message) ||
  /^not\s+implemented\s+on\s+.+/i.test(message)

const isFixtureEntrypointPlaceholder = (fn: FnLike, message: string): boolean => {
  if (!/^fixture\s+not\s+implemented!?$/i.test(message.trim())) return false
  if (/placeholder/i.test(getFunctionName(fn))) return true

  let current: Node | undefined = fn.getParent()
  while (current !== undefined && !Node.isSourceFile(current)) {
    if (Node.isBinaryExpression(current) && /placeholder/i.test(current.getLeft().getText())) {
      return true
    }
    if (Node.isVariableDeclaration(current) && /placeholder/i.test(current.getName())) {
      return true
    }
    if (Node.isPropertyAssignment(current) && /placeholder/i.test(propertyNameOf(current))) {
      return true
    }
    current = current.getParent()
  }
  return false
}

const isFrameworkContractUnsupportedHook = (fn: FnLike, message: string): boolean => {
  if (!/^(?:function\s+)?not\s+(?:yet\s+)?implemented\.?$/i.test(message)) {
    return false
  }

  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  if (!looksLikeReactHostConfigObject(object)) return false

  return REACT_HOST_CONFIG_OPTIONAL_UNSUPPORTED_HOOKS.has(objectMemberNameForFunction(fn))
}

const isReactHostConfigOptionalNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  if (!looksLikeReactHostConfigObject(object)) return false
  return REACT_HOST_CONFIG_OPTIONAL_NOOP_HOOKS.has(objectMemberNameForFunction(fn))
}

const looksLikeReactHostConfigObject = (
  object: import("ts-morph").ObjectLiteralExpression,
): boolean => {
  const memberNames = objectMemberNames(object)
  return (
    (memberNames.has("supportsMutation") ||
      memberNames.has("supportsPersistence") ||
      memberNames.has("supportsHydration")) &&
    memberNames.has("getRootHostContext") &&
    memberNames.has("createInstance")
  )
}

const REACT_HOST_CONFIG_OPTIONAL_UNSUPPORTED_HOOKS = new Set([
  "cloneHiddenInstance",
  "cloneHiddenTextInstance",
  "getInstanceFromNode",
  "getInstanceFromScope",
  "prepareScopeUpdate",
])

const REACT_HOST_CONFIG_OPTIONAL_NOOP_HOOKS = new Set([
  "afterActiveInstanceBlur",
  "beforeActiveInstanceBlur",
  "detachDeletedInstance",
  "requestPostPaintCallback",
  "resetFormInstance",
  "startSuspendingCommit",
  "suspendInstance",
  "trackSchedulerEvent",
])

const directStubThrowMessage = (fn: FnLike): string | undefined => {
  const body = functionBodyNode(fn)
  if (body === undefined) return undefined

  const throwStatement = body
    .getDescendantsOfKind(SyntaxKind.ThrowStatement)
    .find((statement) => nearestFunctionLikeAncestor(statement) === fn)
  if (throwStatement === undefined) return undefined

  const expression = throwStatement.getExpression()
  if (!Node.isNewExpression(expression)) return undefined
  const thrownType = expression.getExpression().getText()
  if (!["Error", "TypeError", "RangeError"].includes(thrownType)) return undefined

  const [messageArg] = expression.getArguments()
  if (
    !Node.isStringLiteral(messageArg) &&
    !Node.isNoSubstitutionTemplateLiteral(messageArg)
  ) {
    return undefined
  }

  return messageArg.getLiteralText()
}

const functionBodyNode = (fn: FnLike): Node | undefined => {
  if (Node.isArrowFunction(fn)) return fn.getBody()
  if ("getBody" in fn && typeof fn.getBody === "function") return fn.getBody()
  return undefined
}

const nearestFunctionLikeAncestor = (node: Node): FnLike | undefined =>
  node.getFirstAncestor((ancestor): ancestor is FnLike =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isArrowFunction(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isConstructorDeclaration(ancestor) ||
    Node.isGetAccessorDeclaration(ancestor) ||
    Node.isSetAccessorDeclaration(ancestor),
  )

const commentOnlyBodyText = (bodyText: string): string | undefined => {
  const trimmed = bodyText.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined

  const body = trimmed.slice(1, -1)
  const comments: Array<string> = []
  const withoutBlockComments = body.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    comments.push(comment.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim())
    return ""
  })
  const withoutLineComments = withoutBlockComments.replace(/(^|\n)\s*\/\/([^\n]*)/g, (_match, prefix, comment) => {
    comments.push(String(comment).trim())
    return prefix
  })

  if (withoutLineComments.trim().length > 0 || comments.length === 0) {
    return undefined
  }

  return comments.join(" ").replace(/\s+/g, " ").trim()
}

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
