import {
  CalibrationContextTag,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type Diagnostic,
  type DistributionalSummary,
  type ResolvedCalibrationContext,
  type Signal,
  SignalComputeError,
  summarize,
  type TypeScriptCallbackContextNameValue,
} from "@skastr0/pulsar-core"
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

export const TsLd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_function_loc: Schema.Number,
  max_file_loc: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsLd02Config = typeof TsLd02Config.Type

export interface FunctionSize {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly loc: number
}

type FunctionNameCalibrationInput = Omit<TypeScriptCallbackContextNameValue, "file" | "line">

type FunctionSizeCandidate = FunctionSize & {
  readonly callbackContext?: FunctionNameCalibrationInput
}

export interface FileSize {
  readonly file: string
  readonly loc: number
}

export interface TsLd02Output {
  /** Per-file distribution of function LOC. */
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  /** Repo-wide distribution of file LOC. */
  readonly fileSizes: DistributionalSummary
  /** Repo-wide distribution of function LOC. */
  readonly functionSizes: DistributionalSummary
  readonly outlierFunctionCount: number
  readonly outlierFileCount: number
  readonly totalFunctions: number
  readonly totalFiles: number
  /** Inclusive floor for function outliers: items must be strictly above this. */
  readonly functionOutlierCutoff: number
  /** Inclusive floor for file outliers: items must be strictly above this. */
  readonly fileOutlierCutoff: number
  /** Top-N true function outliers, sorted largest-first. */
  readonly outlierFunctions: ReadonlyArray<FunctionSize>
  /** Top-N true file outliers, sorted largest-first. */
  readonly outlierFiles: ReadonlyArray<FileSize>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly ratioPressure: number
  readonly maxFunctionPressure: number
  readonly maxFilePressure: number
}

/**
 * TS-LD-02 — function / file size distribution.
 *
 * Counts non-blank, non-comment lines per function body and per
 * source file. Emits both true outliers (above p95 + threshold) and
 * distributional summaries (for trend analysis and compound signals).
 *
 * Threshold defaults:
 * - max_function_loc: 50 — mainstream cognitive-load guidance across
 *   Rich Hickey, Kent Beck, and modern style guides converges around
 *   "fits on a screen" (~50 LOC). Good enough as a first cut.
 * - max_file_loc: 300 — typical "this file is a drag to review"
 *   threshold across linter defaults and team conventions. Trend
 *   metric first, hard gate later.
 */
export const TsLd02: Signal<TsLd02Config, TsLd02Output, TsProjectTag> = {
  id: "TS-LD-02-function-size-distribution",
  title: "Function size distribution",
  aliases: ["TS-LD-02"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "callback-context-calibration-v1",
  configSchema: TsLd02Config,
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
    max_function_loc: 50,
    max_file_loc: 300,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const collected = yield* Effect.try({
        try: () => {
          const perFileFunctionLocs = new Map<string, Array<number>>()
          const fileLocs: Array<number> = []
          const allFunctionLocs: Array<number> = []
          const allFunctions: Array<FunctionSizeCandidate> = []
          const allFiles: Array<FileSize> = []

          for (const sf of project.getSourceFiles()) {
            const path = sf.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            const locCounter = buildEffectiveLineCounter(sf.getFullText())
            const fileLoc = locCounter.total
            fileLocs.push(fileLoc)
            allFiles.push({ file: path, loc: fileLoc })

            const bucket: Array<number> = []
            for (const fn of collectFunctionSizes(sf, locCounter)) {
              const loc = fn.loc
              bucket.push(loc)
              allFunctionLocs.push(loc)
              allFunctions.push(fn)
            }
            perFileFunctionLocs.set(path, bucket)
          }

          return { perFileFunctionLocs, fileLocs, allFunctionLocs, allFunctions, allFiles }
        },
        catch: toSignalComputeError,
      })

      const byFile = new Map<string, DistributionalSummary>()
      for (const [file, values] of collected.perFileFunctionLocs) {
        byFile.set(file, summarize(values))
      }

      const fileSizes = summarize(collected.fileLocs)
      const functionSizes = summarize(collected.allFunctionLocs)
      const functionOutlierCutoff = functionSizes.p95 + config.max_function_loc
      const fileOutlierCutoff = fileSizes.p95 + config.max_file_loc

      const outlierFunctionCandidatesAll = collected.allFunctions.filter(
        (f) => f.loc > functionOutlierCutoff,
      )
      const outlierFilesAll = collected.allFiles.filter(
        (f) => f.loc > fileOutlierCutoff,
      )

      const outlierFunctionCandidates = outlierFunctionCandidatesAll
        .slice()
        .sort((a, b) => b.loc - a.loc)
        .slice(0, config.top_n_diagnostics)
      const { functions: outlierFunctions, calibrationDecisions } = yield* calibrateFunctionNames(
        outlierFunctionCandidates,
        calibration,
      ).pipe(Effect.mapError(toSignalComputeError))
      const outlierFiles = outlierFilesAll
        .slice()
        .sort((a, b) => b.loc - a.loc)
        .slice(0, config.top_n_diagnostics)
      const totalEntities = collected.allFunctions.length + collected.allFiles.length
      const oversize = outlierFunctionCandidatesAll.length + outlierFilesAll.length
      const ratioPressure =
        totalEntities === 0 ? 0 : Math.min(1, (oversize / totalEntities) * 2)
      const maxFunctionLoc = functionSizes.max
      const maxFileLoc = fileSizes.max
      const maxFunctionPressure =
        maxFunctionLoc <= config.max_function_loc || maxFunctionLoc === 0
          ? 0
          : (maxFunctionLoc - config.max_function_loc) / maxFunctionLoc
      const maxFilePressure =
        maxFileLoc <= config.max_file_loc || maxFileLoc === 0
          ? 0
          : (maxFileLoc - config.max_file_loc) / maxFileLoc

      return {
        byFile,
        fileSizes,
        functionSizes,
        outlierFunctionCount: outlierFunctionCandidatesAll.length,
        outlierFileCount: outlierFilesAll.length,
        totalFunctions: collected.allFunctions.length,
        totalFiles: collected.allFiles.length,
        functionOutlierCutoff,
        fileOutlierCutoff,
        outlierFunctions,
        outlierFiles,
        calibrationDecisions,
        ratioPressure,
        maxFunctionPressure,
        maxFilePressure,
      }
    }),
  score: (out) => {
    const totalEntities = out.totalFunctions + out.totalFiles
    if (totalEntities === 0) return 1
    const pressure = Math.max(
      out.ratioPressure,
      out.maxFunctionPressure,
      out.maxFilePressure,
    )
    return Math.max(0, 1 - pressure)
  },
  outputMetadata: (out) =>
    out.totalFunctions + out.totalFiles === 0
      ? { applicability: "not_applicable" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const fnDiags: Array<Diagnostic> = out.outlierFunctions.map((f) => ({
      severity: "warn" as const,
      message: `Function outlier \`${f.name}\` — ${f.loc} LOC`,
      location: { file: f.file, line: f.line },
      data: {
        kind: "function",
        name: f.name,
        loc: f.loc,
        cutoff: out.functionOutlierCutoff,
        p95: out.functionSizes.p95,
        ratioPressure: out.ratioPressure,
        maxFunctionPressure: out.maxFunctionPressure,
        maxFilePressure: out.maxFilePressure,
      },
    }))
    const fileDiags: Array<Diagnostic> = out.outlierFiles.map((f) => ({
      severity: "warn" as const,
      message: `File outlier ${f.file} — ${f.loc} LOC`,
      location: { file: f.file },
      data: {
        kind: "file",
        loc: f.loc,
        cutoff: out.fileOutlierCutoff,
        p95: out.fileSizes.p95,
        ratioPressure: out.ratioPressure,
        maxFunctionPressure: out.maxFunctionPressure,
        maxFilePressure: out.maxFilePressure,
      },
    }))
    return [...fnDiags, ...fileDiags]
  },
}

/* ------------------------------------------------------------------ */
/* Size counting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Effective LOC = non-blank, non-comment lines.
 *
 * We work on raw text rather than AST nodes so the same rule applies
 * uniformly to function bodies and whole-file counts. A lightweight
 * state machine handles `//`, `/* ... *\/`, and template/string
 * boundaries that might contain comment markers.
 */
interface EffectiveLineCounter {
  readonly total: number
  readonly countInclusive: (startLine: number, endLine: number) => number
}

const buildEffectiveLineCounter = (text: string): EffectiveLineCounter => {
  const prefixCounts: Array<number> = [0]
  let inBlockComment = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    let countsAsCode = false

    if (inBlockComment) {
      const close = line.indexOf("*/")
      if (close === -1) {
        prefixCounts.push(prefixCounts[prefixCounts.length - 1] ?? 0)
        continue
      }
      inBlockComment = false
      const after = line.slice(close + 2).trim()
      if (after.length === 0 || after.startsWith("//")) {
        prefixCounts.push(prefixCounts[prefixCounts.length - 1] ?? 0)
        continue
      }
      if (after.startsWith("/*")) {
        const close2 = after.indexOf("*/", 2)
        if (close2 === -1) {
          inBlockComment = true
          prefixCounts.push(prefixCounts[prefixCounts.length - 1] ?? 0)
          continue
        }
      }
      countsAsCode = true
    } else if (line === "" || line.startsWith("//")) {
      countsAsCode = false
    } else if (line.startsWith("/*")) {
      const close = line.indexOf("*/", 2)
      if (close === -1) {
        inBlockComment = true
        countsAsCode = false
      } else {
        const after = line.slice(close + 2).trim()
        countsAsCode = after.length > 0 && !after.startsWith("//")
      }
    } else {
      countsAsCode = true
    }

    const previous = prefixCounts[prefixCounts.length - 1] ?? 0
    prefixCounts.push(previous + (countsAsCode ? 1 : 0))
  }

  return {
    total: prefixCounts[prefixCounts.length - 1] ?? 0,
    countInclusive: (startLine, endLine) => {
      const start = Math.max(0, startLine)
      const end = Math.min(prefixCounts.length - 2, endLine)
      if (end < start) return 0
      return (prefixCounts[end + 1] ?? 0) - (prefixCounts[start] ?? 0)
    },
  }
}

const collectFunctionSizes = (
  sourceFile: SourceFile,
  locCounter: EffectiveLineCounter,
): ReadonlyArray<FunctionSizeCandidate> => {
  const compilerSourceFile = sourceFile.compilerNode
  const file = sourceFile.getFilePath()
  const functions: Array<FunctionSizeCandidate> = []

  const visit = (node: ts.Node): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(compilerSourceFile)
      const nameInfo = functionName(node)
      functions.push({
        file,
        name: nameInfo.name,
        line: compilerSourceFile.getLineAndCharacterOfPosition(start).line + 1,
        loc: functionLoc(node, compilerSourceFile, locCounter),
        ...(nameInfo.callbackContext !== undefined
          ? { callbackContext: nameInfo.callbackContext }
          : {}),
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return functions
}

const functionLoc = (
  fn: CompilerFunctionLike,
  sourceFile: ts.SourceFile,
  locCounter: EffectiveLineCounter,
): number => {
  const body = getFunctionBodyNode(fn)
  if (body === undefined) return 0
  const startLine = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line
  const endLine = sourceFile.getLineAndCharacterOfPosition(body.getEnd()).line
  return locCounter.countInclusive(startLine, endLine)
}

const getFunctionBodyNode = (fn: CompilerFunctionLike): ts.Node | undefined =>
  "body" in fn ? fn.body : undefined

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({ signalId: "TS-LD-02-function-size-distribution", message: String(cause), cause })

const calibrateFunctionNames = (
  candidates: ReadonlyArray<FunctionSizeCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  {
    readonly functions: ReadonlyArray<FunctionSize>
    readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) {
      return {
        functions: candidates.map(stripFunctionNameCalibration),
        calibrationDecisions: [],
      }
    }

    const functions: Array<FunctionSize> = []
    const calibrationDecisions: Array<CalibrationDecision> = []
    for (const candidate of candidates) {
      const callbackContext = candidate.callbackContext
      if (callbackContext === undefined) {
        functions.push(stripFunctionNameCalibration(candidate))
        continue
      }

      const result = yield* calibration.value.runSlot("typescript.callback-context-namer", {
        file: candidate.file,
        line: candidate.line,
        ...callbackContext,
      })
      calibrationDecisions.push(...result.decisions)
      functions.push({
        file: candidate.file,
        line: candidate.line,
        loc: candidate.loc,
        name: result.value.resolvedName,
      })
    }

    return { functions, calibrationDecisions }
  })

const stripFunctionNameCalibration = (
  candidate: FunctionSizeCandidate,
): FunctionSize => ({
  file: candidate.file,
  name: candidate.name,
  line: candidate.line,
  loc: candidate.loc,
})

const functionName = (fn: CompilerFunctionLike): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isFunctionExpression(fn)
  ) {
    const name = fn.name
    if (name !== undefined) return { name: propertyNameText(name) }
  }
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const parent = fn.parent
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return { name: parent.name.text }
    }
    if (ts.isPropertyAssignment(parent)) {
      return objectPropertyFunctionName(parent)
    }
    if (ts.isCallExpression(parent)) return callExpressionCallbackName(parent, fn)
  }
  if (ts.isConstructorDeclaration(fn)) return { name: "<constructor>" }
  if (ts.isGetAccessorDeclaration(fn)) return { name: `<get ${propertyNameText(fn.name)}>` }
  if (ts.isSetAccessorDeclaration(fn)) return { name: `<set ${propertyNameText(fn.name)}>` }
  return { name: "<anonymous>" }
}

const objectPropertyFunctionName = (
  property: ts.PropertyAssignment,
): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  const objectLiteral = property.parent
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return { name: propertyNameText(property.name) }
  }

  const call = objectLiteral.parent
  if (!ts.isCallExpression(call)) {
    return { name: propertyNameText(property.name) }
  }

  const propertyName = propertyNameText(property.name)
  const callee = expressionName(call.expression)
  const owner = nearestCallbackOwnerName(call)
  const resolvedName =
    owner !== undefined && callee !== undefined
      ? `${owner}/${callee}/${propertyName}`
      : owner !== undefined
      ? `${owner}/${propertyName}`
      : callee !== undefined
      ? `${callee}/${propertyName}`
      : propertyName

  return {
    name: resolvedName,
    callbackContext: {
      fallbackName: propertyName,
      resolvedName,
      metadata: {
        ...(callee !== undefined ? { calleeText: callee } : {}),
        ...(owner !== undefined ? { ownerName: owner } : {}),
        propertyName,
      },
    },
  }
}

const callExpressionCallbackName = (
  call: ts.CallExpression,
  fn: ts.ArrowFunction | ts.FunctionExpression,
): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  const callee = expressionName(call.expression)
  const owner = nearestCallbackOwnerName(call)
  const effectFnLabel = effectFnLabelFromOuterCall(call)
  const resolvedName =
    owner !== undefined && callee !== undefined
      ? `${owner}/${callee}`
      : owner !== undefined
      ? `${owner} callback`
      : callee !== undefined
      ? `${callee} callback`
      : "<anonymous>"

  return {
    name: resolvedName,
    callbackContext: {
      fallbackName: "<anonymous>",
      resolvedName,
      metadata: {
        ...(callee !== undefined ? { calleeText: callee } : {}),
        ...(owner !== undefined ? { ownerName: owner } : {}),
        ...(effectFnLabel !== undefined ? { effectFnLabel } : {}),
        argumentIndex: call.arguments.findIndex((arg) => arg === fn),
      },
    },
  }
}

const nearestCallbackOwnerName = (node: ts.Node): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    if (ts.isPropertyAssignment(current)) {
      return propertyNameText(current.name)
    }
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isFunctionExpression(current)) &&
      current.name !== undefined
    ) {
      return propertyNameText(current.name)
    }
    current = current.parent
  }
  return undefined
}

const expressionName = (expression: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const left = expressionName(expression.expression)
    return left === undefined ? expression.name.text : `${left}.${expression.name.text}`
  }
  if (ts.isCallExpression(expression)) return expressionName(expression.expression)
  return undefined
}

const effectFnLabelFromOuterCall = (call: ts.CallExpression): string | undefined => {
  const expression = call.expression
  if (!ts.isCallExpression(expression)) return undefined
  if (expressionName(expression.expression) !== "Effect.fn") return undefined
  const label = expression.arguments[0]
  return label !== undefined && ts.isStringLiteral(label) ? label.text : undefined
}
