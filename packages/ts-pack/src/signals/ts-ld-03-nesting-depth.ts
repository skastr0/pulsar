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
import {
  type SourceFile,
  ts,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
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

const TsLd03Config = Schema.Struct({
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

export const TsLd03: Signal<TsLd03Config, TsLd03Output, TsProjectTag> = {
  id: "TS-LD-03-nesting-depth",
  title: "Nesting depth",
  aliases: ["TS-LD-03"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "diagnostic-limit-v1",
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
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const result = yield* Effect.try({
        try: (): TsLd03Output => {
          const byFunction: Array<FunctionNesting> = []
          const byFileValues = new Map<string, Array<number>>()

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            const values = byFileValues.get(file) ?? []
            for (const fn of collectFunctionNestings(sourceFile)) {
              byFunction.push(fn)
              values.push(fn.maxNesting)
            }
            byFileValues.set(file, values)
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
  Math.max(0, Math.floor(limit))

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
  const compilerSourceFile = sourceFile.compilerNode
  const file = sourceFile.getFilePath()
  const functions: Array<MutableFunctionNesting> = []

  const visit = (
    node: ts.Node,
    currentFunction: MutableFunctionNesting | undefined,
    depth: number,
  ): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(compilerSourceFile)
      const fn = {
        file,
        name: functionName(node),
        line: compilerSourceFile.getLineAndCharacterOfPosition(start).line + 1,
        maxNesting: 0,
      }
      functions.push(fn)
      ts.forEachChild(node, (child) => visit(child, fn, 0))
      return
    }

    const nextDepth =
      currentFunction !== undefined && isControlFlowNode(node) ? depth + 1 : depth
    if (currentFunction !== undefined && nextDepth > currentFunction.maxNesting) {
      currentFunction.maxNesting = nextDepth
    }

    ts.forEachChild(node, (child) => visit(child, currentFunction, nextDepth))
  }

  visit(compilerSourceFile, undefined, 0)
  return functions
}

const isControlFlowNode = (node: ts.Node): boolean =>
  ts.isIfStatement(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node) ||
  ts.isCatchClause(node)

const functionName = (fn: CompilerFunctionLike): string => {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn)
  ) {
    return fn.name === undefined ? "<anonymous>" : propertyNameText(fn.name)
  }
  if (ts.isConstructorDeclaration(fn)) return "constructor"

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (ts.isPropertyAssignment(parent)) {
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
