import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, type TypeParameterDeclaration } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectGenericTrackedDeclarations,
  declarationName,
  type FunctionLikeDeclaration,
  type GenericTrackedDeclaration,
  typeParameterIsUsedInNodes,
  typeSyntaxDepth,
} from "./shared-type-analysis.js"

export const TsAb05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_generic_parameters: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsAb05Config = typeof TsAb05Config.Type

export interface GenericAnalysis {
  readonly file: string
  readonly declarationName: string
  readonly line: number
  readonly paramCount: number
  readonly maxConstraintDepth: number
  readonly returnOnlyParams: ReadonlyArray<string>
}

export interface TsAb05Output {
  readonly byDeclaration: ReadonlyArray<GenericAnalysis>
  readonly distribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<GenericAnalysis>
  readonly genericThreshold: number
  readonly diagnosticLimit: number
}

export const TsAb05: Signal<TsAb05Config, TsAb05Output, TsProjectTag> = {
  id: "TS-AB-05",
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb05Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    max_generic_parameters: 3,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb05Output => {
          const byDeclaration: Array<GenericAnalysis> = []
          const paramCounts: Array<number> = []

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            for (const declaration of collectGenericTrackedDeclarations(sourceFile)) {
              const typeParameters = declaration.getTypeParameters()
              const analysis: GenericAnalysis = {
                file,
                declarationName: declarationName(declaration),
                line: declaration.getStartLineNumber(),
                paramCount: typeParameters.length,
                maxConstraintDepth: typeParameters.reduce(
                  (max, typeParameter) => Math.max(max, typeSyntaxDepth(typeParameter.getConstraint())),
                  0,
                ),
                returnOnlyParams: detectReturnOnlyParams(declaration, typeParameters),
              }
              byDeclaration.push(analysis)
              paramCounts.push(analysis.paramCount)
            }
          }

          byDeclaration.sort(compareGenericAnalysis)

          return {
            byDeclaration,
            distribution: summarize(paramCounts),
            overThreshold: byDeclaration.filter(
              (analysis) => analysis.paramCount > config.max_generic_parameters,
            ),
            genericThreshold: config.max_generic_parameters,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-05",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.byDeclaration.length === 0) return 1
    const ratio = out.overThreshold.length / out.byDeclaration.length
    return Math.max(0, 1 - ratio)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((analysis) => ({
      severity: "warn" as const,
      message:
        `Generic proliferation in \`${analysis.declarationName}\`: ` +
        `${analysis.paramCount} type parameters ` +
        `(max constraint depth ${analysis.maxConstraintDepth})`,
      location: { file: analysis.file, line: analysis.line },
      data: {
        ...analysis,
        genericThreshold: out.genericThreshold,
      },
    })),
}

const detectReturnOnlyParams = (
  declaration: GenericTrackedDeclaration,
  typeParameters: ReadonlyArray<TypeParameterDeclaration>,
): ReadonlyArray<string> => {
  if (!isFunctionLikeDeclaration(declaration)) return []

  const parameterTypeNodes = declaration.getParameters().map((parameter) => parameter.getTypeNode())
  const returnTypeNode = declaration.getReturnTypeNode()

  return typeParameters
    .filter(
      (typeParameter) =>
        typeParameterIsUsedInNodes(typeParameter, [returnTypeNode]) &&
        !typeParameterIsUsedInNodes(typeParameter, parameterTypeNodes),
    )
    .map((typeParameter) => typeParameter.getName())
}

const isFunctionLikeDeclaration = (value: GenericTrackedDeclaration): value is FunctionLikeDeclaration =>
  Node.isFunctionDeclaration(value) ||
  Node.isMethodDeclaration(value) ||
  Node.isArrowFunction(value) ||
  Node.isFunctionExpression(value)

const compareGenericAnalysis = (left: GenericAnalysis, right: GenericAnalysis): number => {
  if (right.paramCount !== left.paramCount) {
    return right.paramCount - left.paramCount
  }
  if (right.maxConstraintDepth !== left.maxConstraintDepth) {
    return right.maxConstraintDepth - left.maxConstraintDepth
  }
  if (left.file !== right.file) {
    return left.file.localeCompare(right.file)
  }
  return left.line - right.line
}
