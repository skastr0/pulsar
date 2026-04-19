import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  buildExportedDeclarationSet,
  declarationKey,
  declarationName,
  type FunctionLikeDeclaration,
} from "./shared-type-analysis.js"

export const TsLd06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsLd06Config = typeof TsLd06Config.Type

export interface CoverageSummary {
  readonly totalParams: number
  readonly annotatedParams: number
  readonly totalReturns: number
  readonly annotatedReturns: number
  readonly coverage: number
}

export interface FileCoverage {
  readonly boundary: CoverageSummary
  readonly internal: CoverageSummary
}

export interface UncoveredFn {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly missingKind: "params" | "return" | "both"
}

export interface TsLd06Output {
  readonly byFile: ReadonlyMap<string, FileCoverage>
  readonly boundaryCoverage: CoverageSummary
  readonly internalCoverage: CoverageSummary
  readonly uncoveredBoundary: ReadonlyArray<UncoveredFn>
  readonly diagnosticLimit: number
}

export const TsLd06: Signal<TsLd06Config, TsLd06Output, TsProjectTag> = {
  id: "TS-LD-06",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd06Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd06Output => {
          const byFile = new Map<string, FileCoverage>()
          const uncoveredBoundary: Array<UncoveredFn> = []

          const boundaryTotals = emptyMutableCoverage()
          const internalTotals = emptyMutableCoverage()

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            const exportedDeclarations = buildExportedDeclarationSet(sourceFile)
            const fileBoundary = emptyMutableCoverage()
            const fileInternal = emptyMutableCoverage()

            for (const fn of collectTrackedFunctions(sourceFile)) {
              const boundary = isBoundaryFunction(fn, exportedDeclarations)
              const target = boundary ? fileBoundary : fileInternal
              const totals = boundary ? boundaryTotals : internalTotals
              const paramCount = fn.getParameters().length
              const annotatedParams = fn
                .getParameters()
                .filter((parameter) => parameter.getTypeNode() !== undefined).length
              const returnAnnotated = fn.getReturnTypeNode() !== undefined

              target.totalParams += paramCount
              target.annotatedParams += annotatedParams
              target.totalReturns += 1
              target.annotatedReturns += returnAnnotated ? 1 : 0

              totals.totalParams += paramCount
              totals.annotatedParams += annotatedParams
              totals.totalReturns += 1
              totals.annotatedReturns += returnAnnotated ? 1 : 0

              if (!boundary) continue

              const missingKind = classifyMissingKind(paramCount, annotatedParams, returnAnnotated)
              if (missingKind === undefined) continue
              uncoveredBoundary.push({
                file,
                name: functionDisplayName(fn),
                line: fn.getStartLineNumber(),
                missingKind,
              })
            }

            if (
              fileBoundary.totalParams > 0 ||
              fileBoundary.totalReturns > 0 ||
              fileInternal.totalParams > 0 ||
              fileInternal.totalReturns > 0
            ) {
              byFile.set(file, {
                boundary: finalizeCoverage(fileBoundary),
                internal: finalizeCoverage(fileInternal),
              })
            }
          }

          uncoveredBoundary.sort(compareUncoveredBoundary)

          return {
            byFile,
            boundaryCoverage: finalizeCoverage(boundaryTotals),
            internalCoverage: finalizeCoverage(internalTotals),
            uncoveredBoundary,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-06",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => out.boundaryCoverage.coverage,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.uncoveredBoundary.slice(0, out.diagnosticLimit).map((fn) => ({
      severity: "warn" as const,
      message: `Boundary function \`${fn.name}\` is missing explicit ${fn.missingKind} annotations`,
      location: { file: fn.file, line: fn.line },
      data: { ...fn },
    })),
}

type MutableCoverage = {
  totalParams: number
  annotatedParams: number
  totalReturns: number
  annotatedReturns: number
}

const collectTrackedFunctions = (sourceFile: SourceFile): ReadonlyArray<FunctionLikeDeclaration> => {
  const results: Array<FunctionLikeDeclaration> = []
  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      results.push(node)
      return
    }
    if ((Node.isArrowFunction(node) || Node.isFunctionExpression(node)) && isTrackedInlineFunction(node)) {
      results.push(node)
    }
  })
  return results
}

const isTrackedInlineFunction = (node: FunctionLikeDeclaration): boolean => {
  if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) return false
  const parent = node.getParent()
  return Node.isVariableDeclaration(parent) || Node.isExportAssignment(parent)
}

const isBoundaryFunction = (
  fn: FunctionLikeDeclaration,
  exportedDeclarations: ReadonlySet<string>,
): boolean => {
  if (Node.isFunctionDeclaration(fn)) {
    return exportedDeclarations.has(declarationKey(fn))
  }

  if (Node.isMethodDeclaration(fn)) {
    if (fn.hasModifier("private") || fn.hasModifier("protected")) return false
    const classDeclaration = fn.getAncestors().find(Node.isClassDeclaration)
    return classDeclaration !== undefined && exportedDeclarations.has(declarationKey(classDeclaration))
  }

  const parent = fn.getParent()
  if (Node.isVariableDeclaration(parent)) {
    return exportedDeclarations.has(declarationKey(parent))
  }
  return Node.isExportAssignment(parent)
}

const functionDisplayName = (fn: FunctionLikeDeclaration): string => {
  if (Node.isMethodDeclaration(fn)) {
    const classDeclaration = fn.getAncestors().find(Node.isClassDeclaration)
    const owner = classDeclaration?.getName()
    return owner === undefined ? fn.getName() : `${owner}.${fn.getName()}`
  }
  return declarationName(fn)
}

const classifyMissingKind = (
  totalParams: number,
  annotatedParams: number,
  returnAnnotated: boolean,
): UncoveredFn["missingKind"] | undefined => {
  const paramsMissing = annotatedParams < totalParams
  const returnMissing = !returnAnnotated
  if (paramsMissing && returnMissing) return "both"
  if (paramsMissing) return "params"
  if (returnMissing) return "return"
  return undefined
}

const emptyMutableCoverage = (): MutableCoverage => ({
  totalParams: 0,
  annotatedParams: 0,
  totalReturns: 0,
  annotatedReturns: 0,
})

const finalizeCoverage = (coverage: MutableCoverage): CoverageSummary => {
  const denominator = coverage.totalParams + coverage.totalReturns
  const numerator = coverage.annotatedParams + coverage.annotatedReturns
  return {
    ...coverage,
    coverage: denominator === 0 ? 1 : numerator / denominator,
  }
}

const compareUncoveredBoundary = (left: UncoveredFn, right: UncoveredFn): number => {
  const missingWeight = (kind: UncoveredFn["missingKind"]): number =>
    kind === "both" ? 2 : 1

  const byMissing = missingWeight(right.missingKind) - missingWeight(left.missingKind)
  if (byMissing !== 0) return byMissing
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.line - right.line
}
