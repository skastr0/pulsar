import { SignalComputeError, scoreThresholdViolationShare, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import {
  factorPathSegment,
  relativeFactorPath,
} from "@skastr0/pulsar-core/factors"
import {
  CalibrationContextTag,
  type CalibrationDecision,
  type ResolvedCalibrationContext,
  type TypeScriptNestingPolicyValue,
} from "@skastr0/pulsar-core/calibration"
import { Effect, Option, Schema } from "effect"
import { TsAnalysisTag } from "../ts-analysis.js"
import {
  isCatchClause,
  isConstructorDeclaration,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isIfStatement,
  isMethodDeclaration,
  isPropertyAssignment,
  isSetAccessorDeclaration,
  isSwitchStatement,
  isTryStatement,
  isVariableDeclaration,
  isWhileStatement,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import {
  compilerPropertyNameText as propertyNameText,
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"

type MutableFunctionNesting = {
  file: string
  name: string
  line: number
  maxNesting: number
}

export const TsLd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_nesting: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type TsLd03Config = typeof TsLd03Config.Type

interface FunctionNesting {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly maxNesting: number
  readonly threshold?: number
  readonly policy?: Pick<
    TypeScriptNestingPolicyValue,
    "visible" | "severity" | "penaltyWeight" | "metadata"
  >
}

interface TsLd03Output {
  readonly byFunction: ReadonlyArray<FunctionNesting>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThreshold: ReadonlyArray<FunctionNesting>
  readonly threshold: number
  readonly totalFunctions: number
  readonly diagnosticLimit: number
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
}

export const TsLd03: Signal<TsLd03Config, TsLd03Output, TsAnalysisTag> = {
  id: "TS-LD-03-nesting-depth",
  title: "Nesting depth",
  aliases: ["TS-LD-03"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  evidenceClass: "deterministic-ast",
  cacheVersion: "diagnostic-limit-v2",
  configSchema: TsLd03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
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
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    max_nesting: 4,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const analysis = yield* TsAnalysisTag
      const fileOutputs = yield* analysis.mapFiles(async (context) => {
        if (isExcluded(context.file.path, config.exclude_globs)) return []
        return [...collectFunctionNestings(context.sourceFile)]
      }).pipe(Effect.mapError((cause) =>
        new SignalComputeError({
          signalId: "TS-LD-03-nesting-depth",
          message: cause.message,
          cause,
        }),
      ))
      const result = yield* Effect.try({
        try: (): TsLd03Output => {
          const byFunction: Array<FunctionNesting> = []
          const byFileValues = new Map<string, Array<number>>()
          for (const fn of fileOutputs.flat()) {
            byFunction.push(fn)
            const values = byFileValues.get(fn.file) ?? []
            values.push(fn.maxNesting)
            byFileValues.set(fn.file, values)
          }

          const byFile = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFileValues) {
            byFile.set(file, summarize(values))
          }

          const sorted = byFunction.slice().sort(compareNesting)
          return {
            byFunction: sorted,
            byFile,
            overThreshold: sorted.filter((entry) => entry.maxNesting > config.max_nesting),
            threshold: config.max_nesting,
            totalFunctions: sorted.length,
            diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
            calibrationDecisions: [],
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-03-nesting-depth",
            message: String(cause),
            cause,
          }),
      })
      return yield* calibrateNestingOutput(result, config, calibration).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-LD-03-nesting-depth",
            message: String(cause),
            cause,
          }),
        ),
      )
  }),
  score: (out) => {
    return scoreThresholdViolationShare(out.totalFunctions, weightedNestingViolationCount(out))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: entry.policy?.severity ?? "warn",
      message: `Function nesting depth \`${entry.name}\` reaches ${entry.maxNesting}`,
      location: { file: entry.file, line: entry.line },
      data: {
        ...entry,
        threshold: entry.threshold ?? out.threshold,
      },
    })),
}

const calibrateNestingOutput = (
  output: TsLd03Output,
  config: TsLd03Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
) =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) return output

    const byFunction: Array<FunctionNesting> = []
    const decisions: Array<CalibrationDecision> = []
    for (const entry of output.byFunction) {
      const result = yield* calibration.value.runSlot(
        "typescript.nesting-policy",
        defaultNestingPolicy(entry, config, calibration.value),
      )
      decisions.push(...result.decisions)
      byFunction.push(withNestingPolicy(entry, result.value))
    }

    const sorted = byFunction.slice().sort(compareNesting)
    return {
      ...output,
      byFunction: sorted,
      overThreshold: sorted.filter((entry) =>
        entry.policy?.visible !== false &&
        (entry.policy?.penaltyWeight ?? 1) > 0 &&
        entry.maxNesting > (entry.threshold ?? output.threshold),
      ),
      calibrationDecisions: decisions,
    }
  })

const defaultNestingPolicy = (
  entry: FunctionNesting,
  config: TsLd03Config,
  calibration: ResolvedCalibrationContext,
): TypeScriptNestingPolicyValue => ({
  signalId: "TS-LD-03-nesting-depth",
  findingId: `nesting:${entry.file}:${entry.line}`,
  file: entry.file,
  name: entry.name,
  line: entry.line,
  observedNesting: entry.maxNesting,
  defaultThreshold: config.max_nesting,
  threshold: config.max_nesting,
  visible: true,
  severity: "warn",
  penaltyWeight: 1,
  factorPathPrefix: `nesting.${factorPathSegment(relativeFactorPath(entry.file, calibration.repoFacts.repoRoot))}.${entry.line}`,
})

const weightedNestingViolationCount = (out: TsLd03Output): number =>
  out.overThreshold.reduce(
    (sum, entry) => sum + Math.max(0, entry.policy?.penaltyWeight ?? 1),
    0,
  )

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

const withNestingPolicy = (
  entry: FunctionNesting,
  policy: TypeScriptNestingPolicyValue,
): FunctionNesting => ({
  ...entry,
  threshold: policy.threshold,
  policy: {
    visible: policy.visible,
    severity: policy.severity,
    penaltyWeight: policy.penaltyWeight,
    ...(policy.metadata !== undefined ? { metadata: policy.metadata } : {}),
  },
})

const collectFunctionNestings = (sourceFile: SourceFile): ReadonlyArray<FunctionNesting> => {
  const file = sourceFile.fileName
  const functions: Array<MutableFunctionNesting> = []

  const visit = (
    node: Node,
    currentFunction: MutableFunctionNesting | undefined,
    depth: number,
  ): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(sourceFile)
      const fn = {
        file,
        name: functionName(node),
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        maxNesting: 0,
      }
      functions.push(fn)
      node.forEachChild((child) => visit(child, fn, 0))
      return
    }

    const nextDepth =
      currentFunction !== undefined && isControlFlowNode(node) ? depth + 1 : depth
    if (currentFunction !== undefined && nextDepth > currentFunction.maxNesting) {
      currentFunction.maxNesting = nextDepth
    }

    node.forEachChild((child) => visit(child, currentFunction, nextDepth))
  }

  visit(sourceFile, undefined, 0)
  return functions
}

const isControlFlowNode = (node: Node): boolean =>
  isIfStatement(node) ||
  isForStatement(node) ||
  isForInStatement(node) ||
  isForOfStatement(node) ||
  isWhileStatement(node) ||
  isDoStatement(node) ||
  isSwitchStatement(node) ||
  isTryStatement(node) ||
  isCatchClause(node)

const functionName = (fn: CompilerFunctionLike): string => {
  if (
    isFunctionDeclaration(fn) ||
    isMethodDeclaration(fn) ||
    isGetAccessorDeclaration(fn) ||
    isSetAccessorDeclaration(fn)
  ) {
    return fn.name === undefined ? "<anonymous>" : propertyNameText(fn.name)
  }
  if (isConstructorDeclaration(fn)) return "constructor"

  const parent = fn.parent
  if (isVariableDeclaration(parent) && isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (isPropertyAssignment(parent)) {
    return propertyNameText(parent.name)
  }
  return "<anonymous>"
}

const compareNesting = (left: FunctionNesting, right: FunctionNesting): number => {
  if (right.maxNesting !== left.maxNesting) {
    return right.maxNesting - left.maxNesting
  }
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.line - right.line
}
