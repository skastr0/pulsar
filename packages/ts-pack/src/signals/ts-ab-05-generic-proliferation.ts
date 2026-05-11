import { SignalComputeError, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { ts, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import { scoreThresholdViolationShare } from "./shared-threshold-score.js"

const TsAb05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_generic_parameters: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type TsAb05Config = typeof TsAb05Config.Type

interface GenericAnalysis {
  readonly file: string
  readonly declarationName: string
  readonly line: number
  readonly paramCount: number
  readonly maxConstraintDepth: number
  readonly returnOnlyParams: ReadonlyArray<string>
}

interface TsAb05Output {
  readonly byDeclaration: ReadonlyArray<GenericAnalysis>
  readonly distribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<GenericAnalysis>
  readonly genericThreshold: number
  readonly diagnosticLimit: number
}

export const TsAb05: Signal<TsAb05Config, TsAb05Output, TsProjectTag> = {
  id: "TS-AB-05-generic-proliferation",
  title: "Generic proliferation",
  aliases: ["TS-AB-05"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb05Config,
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

            for (const declaration of collectGenericAnalyses(sourceFile)) {
              const analysis: GenericAnalysis = {
                file,
                ...declaration,
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
            signalId: "TS-AB-05-generic-proliferation",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    return scoreThresholdViolationShare(out.byDeclaration.length, out.overThreshold.length)
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

type CompilerGenericDeclaration =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.TypeAliasDeclaration
  | ts.InterfaceDeclaration
  | ts.ClassDeclaration

type CompilerFunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression

const collectGenericAnalyses = (
  sourceFile: SourceFile,
): ReadonlyArray<Omit<GenericAnalysis, "file">> => {
  const compilerSourceFile = sourceFile.compilerNode
  const analyses: Array<Omit<GenericAnalysis, "file">> = []

  const visit = (node: ts.Node): void => {
    if (isTrackedGenericDeclaration(node)) {
      const typeParameters = node.typeParameters ?? []
      analyses.push({
        declarationName: compilerDeclarationName(node, compilerSourceFile),
        line: compilerSourceFile.getLineAndCharacterOfPosition(node.getStart(compilerSourceFile)).line + 1,
        paramCount: typeParameters.length,
        maxConstraintDepth: typeParameters.reduce(
          (max, typeParameter) => Math.max(max, compilerTypeSyntaxDepth(typeParameter.constraint)),
          0,
        ),
        returnOnlyParams: detectCompilerReturnOnlyParams(node, typeParameters),
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return analyses
}

const isTrackedGenericDeclaration = (node: ts.Node): node is CompilerGenericDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isClassDeclaration(node)

const compilerDeclarationName = (
  node: CompilerGenericDeclaration,
  sourceFile: ts.SourceFile,
): string => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node)
  ) {
    const name = node.name?.getText(sourceFile)
    if (name !== undefined && name !== "") return name
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent
    if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) {
      return parent.name.getText(sourceFile)
    }
    if (ts.isExportAssignment(parent)) {
      return "<default export>"
    }
  }

  return "<anonymous>"
}

const detectCompilerReturnOnlyParams = (
  declaration: CompilerGenericDeclaration,
  typeParameters: ReadonlyArray<ts.TypeParameterDeclaration>,
): ReadonlyArray<string> => {
  if (!isCompilerFunctionLikeDeclaration(declaration)) return []

  const parameterTypeNodes = declaration.parameters.map((parameter) => parameter.type)
  const returnTypeNode = declaration.type

  return typeParameters
    .map((typeParameter) => typeParameter.name.text)
    .filter(
      (name) =>
        compilerNameIsUsedInNodes(name, [returnTypeNode]) &&
        !compilerNameIsUsedInNodes(name, parameterTypeNodes),
    )
}

const isCompilerFunctionLikeDeclaration = (
  value: CompilerGenericDeclaration,
): value is CompilerFunctionLike =>
  ts.isFunctionDeclaration(value) ||
  ts.isMethodDeclaration(value) ||
  ts.isArrowFunction(value) ||
  ts.isFunctionExpression(value)

const compilerNameIsUsedInNodes = (
  name: string,
  nodes: ReadonlyArray<ts.Node | undefined>,
): boolean => {
  for (const root of nodes) {
    if (root === undefined) continue
    let found = false
    const visit = (node: ts.Node): void => {
      if (found) return
      if (ts.isIdentifier(node) && node.text === name) {
        found = true
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(root)
    if (found) return true
  }
  return false
}

const compilerTypeSyntaxDepth = (node: ts.TypeNode | undefined): number => {
  if (node === undefined) return 0
  if (ts.isParenthesizedTypeNode(node)) {
    return compilerTypeSyntaxDepth(node.type)
  }

  let childDepth = 0
  node.forEachChild((child) => {
    if (isCompilerTypeNode(child)) {
      childDepth = Math.max(childDepth, compilerTypeSyntaxDepth(child))
      return
    }
    if (ts.isExpressionWithTypeArguments(child)) {
      childDepth = Math.max(childDepth, 1 + maxCompilerTypeArgumentDepth(child))
    }
  })

  return 1 + childDepth
}

const isCompilerTypeNode = (node: ts.Node): node is ts.TypeNode =>
  node.kind >= ts.SyntaxKind.FirstTypeNode && node.kind <= ts.SyntaxKind.LastTypeNode

const maxCompilerTypeArgumentDepth = (
  node: ts.ExpressionWithTypeArguments,
): number => {
  let max = 0
  for (const typeArg of node.typeArguments ?? []) {
    max = Math.max(max, compilerTypeSyntaxDepth(typeArg))
  }
  return max
}

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
