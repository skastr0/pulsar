import { SignalContextTag, SignalComputeError, computeDiagnosticHash } from "@skastr0/pulsar-core/signal"
import type {
  Diagnostic,
  Signal,
  SignalFactorLedger,
  SignalFactorLedgerEntry,
  SignalFactorValue,
} from "@skastr0/pulsar-core/signal"
import {
  CalibrationContextTag,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type ResolvedCalibrationContext,
  type TypeScriptNoopClassificationValue,
  type TypeScriptUnfinishedImplementationPolicyValue,
} from "@skastr0/pulsar-core/calibration"
import {
  SignalFactorPolicyTag,
  applyFactorOverrides,
  makeFactorEntry,
  makeFactorLedger,
} from "@skastr0/pulsar-core/factors"
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
import { defaultTsSl04Config, TsSl04Config as tsSl04ConfigSchema } from "./ts-sl-04-config.js"
import type { TsSl04Config } from "./ts-sl-04-config.js"
import {
  STUB_KIND_FACTOR_PREFIX,
  booleanFactorValue,
  confidenceForStubKind,
  factorDefinitionByPath,
  numberFactorValue,
  penaltyWeightForStubKind,
  scoreCapForStubKind,
  scoreCapParticipationForStubKind,
  severityForStub,
  stringFactorValue,
  stubKindFromMetadata,
  tsSl04FactorDefinitions,
  stubKindFactorPath,
  toStubConfidence,
  toStubKind,
  type StubConfidence,
  type StubKind,
} from "./ts-sl-04-factors.js"
import {
  type Stub,
  type StubCandidateSummary,
  type TsSl04Output,
} from "./ts-sl-04-model.js"
import {
  isEmptyBodyText,
  isIntentionalNoop,
  propertyNameOf,
} from "./ts-sl-04-intentional-noops.js"

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04-unfinished-implementations",
  title: "Unfinished implementations",
  aliases: ["TS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "factor-policy-v1",
  configSchema: tsSl04ConfigSchema,
  defaultConfig: defaultTsSl04Config,
  factorDefinitions: tsSl04FactorDefinitions,
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
      config.hard_gate_production,
      factorOverrides,
    ).pipe(Effect.mapError(toSignalComputeError))
    return buildTsSl04Output(config, collection.totalFunctions, budget, evaluated, factorOverrides)
  })

interface StubCandidateCollection {
  readonly candidates: ReadonlyArray<StubCandidate>
  readonly totalFunctions: number
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

    if (isAbstractMethod(fn)) {
      continue
    }

    totalFunctions++

    const candidate = stubCandidateForFunction(path, fn, isTestPath)
    if (candidate !== undefined) {
      candidates.push(candidate)
    }
  }

  return { candidates, totalFunctions }
}

const stubCandidateForFunction = (
  path: string,
  fn: FnLike,
  isTestPath: boolean,
): StubCandidate | undefined => {
  const bodyText = getFunctionBody(fn)
  if (bodyText === undefined) return undefined

  const builtinIntentionalNoop = isIntentionalNoop(path, fn, bodyText)
  const stubKind = builtinIntentionalNoop ? undefined : classifyStub(fn, bodyText)
  if (!builtinIntentionalNoop && stubKind === undefined) return undefined

  return {
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
  }
}

const isAbstractMethod = (fn: FnLike): boolean =>
  Node.isMethodDeclaration(fn) && fn.isAbstract()

const syntaxKindName = (kind: SyntaxKind): string => SyntaxKind[kind] ?? String(kind)

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

const classifyStub = (
  fn: FnLike,
  bodyText: string,
): { kind: StubKind; message: string } | undefined => {
  if (isEmptyBodyText(bodyText)) {
    return { kind: "empty-body", message: "Empty implementation" }
  }

  if (MAYBE_THROW_STUB_PATTERN.test(bodyText)) {
    const throwStubMessage = directStubThrowMessage(fn)
    if (throwStubMessage !== undefined) {
      if (isExplicitUnsupportedCapabilityMessage(throwStubMessage)) return undefined
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

const evaluateStubCandidates = (
  candidates: ReadonlyArray<StubCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const evaluated = emptyEvaluatedStubCandidates()
    for (const candidate of candidates) {
      const candidateResult = yield* evaluateStubCandidate(
        candidate,
        calibration,
        hardGateProduction,
        factorOverrides,
      )
      mergeEvaluatedStubCandidate(evaluated, candidateResult)
    }
    return evaluated
  })

interface EvaluatedStubCandidates {
  readonly stubs: ReadonlyArray<Stub>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly rawCandidates: ReadonlyArray<StubCandidateSummary>
  readonly factorEntries: ReadonlyArray<SignalFactorLedgerEntry>
}

const emptyEvaluatedStubCandidates = (): {
  stubs: Array<EvaluatedStubCandidates["stubs"][number]>
  calibrationDecisions: Array<EvaluatedStubCandidates["calibrationDecisions"][number]>
  rawCandidates: Array<EvaluatedStubCandidates["rawCandidates"][number]>
  factorEntries: Array<EvaluatedStubCandidates["factorEntries"][number]>
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
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const classified = yield* classifyNoopCandidate(candidate, calibration)
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
    const policy = yield* evaluateStubPolicy(
      candidate,
      stubKind,
      calibration,
      hardGateProduction,
      factorOverrides,
    )
    return {
      stubs: [policy.stub],
      calibrationDecisions: [...classified.decisions, ...policy.decisions],
      rawCandidates: [summarizeStubCandidate(candidate, stubKind.kind)],
      factorEntries: policy.factorEntries,
    }
  })

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

const evaluateStubPolicy = (
  candidate: StubCandidate,
  stubKind: { readonly kind: StubKind; readonly message: string },
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<
  {
    readonly stub: Stub
    readonly decisions: ReadonlyArray<CalibrationDecision>
    readonly factorEntries: ReadonlyArray<SignalFactorLedgerEntry>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const policyResult = yield* tuneStubPolicy(
      candidate,
      stubKind.kind,
      stubKind.message,
      calibration,
      hardGateProduction,
    )
    const effectivePolicy = finalizeStubPolicy(
      applyVectorOverridesToStubPolicy(policyResult.value, factorOverrides),
      candidate,
      hardGateProduction,
      factorOverrides,
    )
    return {
      stub: createStub(candidate, effectivePolicy, policyResult.decisions),
      decisions: policyResult.decisions,
      factorEntries: factorEntriesForPolicy(policyResult, factorOverrides),
    }
  })

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

interface CleanBudget {
  readonly expectedCleanBudget: number
  readonly expectedCleanFunctionRatio: number
  readonly expectedCleanMinFunctions: number
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
