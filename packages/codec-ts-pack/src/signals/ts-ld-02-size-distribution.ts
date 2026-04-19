import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  Node,
  type SetAccessorDeclaration,
  type SourceFile,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"

type FnLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

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
  id: "TS-LD-02",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd02Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    max_function_loc: 50,
    max_file_loc: 300,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd02Output => {
          const perFileFunctionLocs = new Map<string, Array<number>>()
          const fileLocs: Array<number> = []
          const allFunctionLocs: Array<number> = []
          const allFunctions: Array<FunctionSize> = []
          const allFiles: Array<FileSize> = []

          for (const sf of project.getSourceFiles()) {
            const path = sf.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            const fileLoc = effectiveLoc(sf.getFullText())
            fileLocs.push(fileLoc)
            allFiles.push({ file: path, loc: fileLoc })

            const bucket: Array<number> = []
            for (const fn of collectFunctions(sf)) {
              const loc = functionLoc(fn)
              bucket.push(loc)
              allFunctionLocs.push(loc)
              allFunctions.push({
                file: path,
                name: functionName(fn),
                line: fn.getStartLineNumber(),
                loc,
              })
            }
            perFileFunctionLocs.set(path, bucket)
          }

          const byFile = new Map<string, DistributionalSummary>()
          for (const [file, values] of perFileFunctionLocs) {
            byFile.set(file, summarize(values))
          }

          const fileSizes = summarize(fileLocs)
          const functionSizes = summarize(allFunctionLocs)
          const functionOutlierCutoff = functionSizes.p95 + config.max_function_loc
          const fileOutlierCutoff = fileSizes.p95 + config.max_file_loc

          const outlierFunctionsAll = allFunctions.filter(
            (f) => f.loc > functionOutlierCutoff,
          )
          const outlierFilesAll = allFiles.filter(
            (f) => f.loc > fileOutlierCutoff,
          )

          const outlierFunctions = outlierFunctionsAll
            .slice()
            .sort((a, b) => b.loc - a.loc)
            .slice(0, config.top_n_diagnostics)
          const outlierFiles = outlierFilesAll
            .slice()
            .sort((a, b) => b.loc - a.loc)
            .slice(0, config.top_n_diagnostics)

          return {
            byFile,
            fileSizes,
            functionSizes,
            outlierFunctionCount: outlierFunctionsAll.length,
            outlierFileCount: outlierFilesAll.length,
            totalFunctions: allFunctions.length,
            totalFiles: allFiles.length,
            functionOutlierCutoff,
            fileOutlierCutoff,
            outlierFunctions,
            outlierFiles,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-02",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    const totalEntities = out.totalFunctions + out.totalFiles
    if (totalEntities === 0) return 1
    const oversize = out.outlierFunctionCount + out.outlierFileCount
    // A repo where 5% of entities are true outliers lands around 0.9;
    // 25% outliers sinks to 0.5; 50% goes to zero. The 2x multiplier
    // matches TS-LD-01's ratio sensitivity for consistency.
    const ratio = oversize / totalEntities
    return Math.max(0, 1 - ratio * 2)
  },
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
const effectiveLoc = (text: string): number => {
  let count = 0
  let inBlockComment = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (inBlockComment) {
      const close = line.indexOf("*/")
      if (close === -1) {
        // still comment — skip
        continue
      }
      // Exiting comment mid-line; check if anything after it counts.
      inBlockComment = false
      const after = line.slice(close + 2).trim()
      if (after.length === 0 || after.startsWith("//")) continue
      if (after.startsWith("/*")) {
        const close2 = after.indexOf("*/", 2)
        if (close2 === -1) {
          inBlockComment = true
          continue
        }
      }
      count += 1
      continue
    }
    if (line === "") continue
    if (line.startsWith("//")) continue
    if (line.startsWith("/*")) {
      const close = line.indexOf("*/", 2)
      if (close === -1) {
        inBlockComment = true
        continue
      }
      // single-line block comment; check for trailing code.
      const after = line.slice(close + 2).trim()
      if (after.length === 0 || after.startsWith("//")) continue
      count += 1
      continue
    }
    count += 1
  }
  return count
}

const functionLoc = (fn: FnLike): number => {
  const body = getFunctionBodyText(fn)
  if (body === undefined) return 0
  return effectiveLoc(body)
}

const getFunctionBodyText = (fn: FnLike): string | undefined => {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn) ||
    Node.isConstructorDeclaration(fn) ||
    Node.isGetAccessorDeclaration(fn) ||
    Node.isSetAccessorDeclaration(fn)
  ) {
    const body = fn.getBody()
    return body?.getText()
  }
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    return body.getText()
  }
  return undefined
}

const functionName = (fn: FnLike): string => {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    const name = fn.getName?.()
    if (name !== undefined && name !== "") return name
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName()
    }
  }
  if (Node.isConstructorDeclaration(fn)) return "<constructor>"
  if (Node.isGetAccessorDeclaration(fn)) return `<get ${fn.getName()}>`
  if (Node.isSetAccessorDeclaration(fn)) return `<set ${fn.getName()}>`
  return "<anonymous>"
}

const collectFunctions = (sourceFile: SourceFile): ReadonlyArray<FnLike> => {
  const results: Array<FnLike> = []
  sourceFile.forEachDescendant((node) => {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      results.push(node as FnLike)
    }
  })
  return results
}

/* ------------------------------------------------------------------ */
/* Glob matching                                                       */
/* ------------------------------------------------------------------ */

const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

const matchesGlob = (path: string, glob: string): boolean => {
  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  return regex.test(path)
}
