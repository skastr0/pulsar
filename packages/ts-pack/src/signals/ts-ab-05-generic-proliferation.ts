import { SignalComputeError, scoreThresholdViolationShare, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { textOf } from "../ast.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import {
  SyntaxKind,
  isArrowFunction,
  isCallSignatureDeclaration,
  isClassDeclaration,
  isConstructSignatureDeclaration,
  isConstructorTypeNode,
  isExportAssignment,
  isExpressionWithTypeArguments,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isIdentifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isMethodSignature,
  isParenthesizedTypeNode,
  isPropertyAssignment,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isVariableDeclaration,
  type ArrowFunction,
  type CallSignatureDeclaration,
  type ClassDeclaration,
  type ConstructSignatureDeclaration,
  type ConstructorTypeNode,
  type FunctionDeclaration,
  type FunctionExpression,
  type FunctionTypeNode,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type MethodSignature,
  type Node,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeParameterDeclaration,
} from "../tsgo-api.js"
import { isExcluded } from "./shared-globs.js"

export const TsAb05Config = Schema.Struct({
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

export const TsAb05: Signal<TsAb05Config, TsAb05Output, TsAnalysisTag> = {
  id: "TS-AB-05-generic-proliferation",
  title: "Generic proliferation",
  aliases: ["TS-AB-05"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  evidenceClass: "statistical",
  cacheVersion: "generic-proliferation-v3-signature-declarations-v1",
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
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (context) => context.sourceFile)
      const result = yield* Effect.try({
        try: (): TsAb05Output => {
          const byDeclaration: Array<GenericAnalysis> = []
          const paramCounts: Array<number> = []

          for (const sourceFile of sourceFiles) {
            const file = sourceFile.fileName
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
            diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
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
  | FunctionDeclaration
  | MethodDeclaration
  | MethodSignature
  | CallSignatureDeclaration
  | ConstructSignatureDeclaration
  | FunctionTypeNode
  | ConstructorTypeNode
  | ArrowFunction
  | FunctionExpression
  | TypeAliasDeclaration
  | InterfaceDeclaration
  | ClassDeclaration

type CompilerFunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | MethodSignature
  | CallSignatureDeclaration
  | ConstructSignatureDeclaration
  | FunctionTypeNode
  | ConstructorTypeNode
  | ArrowFunction
  | FunctionExpression

const collectGenericAnalyses = (
  sourceFile: SourceFile,
): ReadonlyArray<Omit<GenericAnalysis, "file">> => {
  const analyses: Array<Omit<GenericAnalysis, "file">> = []

  const visit = (node: Node): void => {
    if (isTrackedGenericDeclaration(node)) {
      const typeParameters = node.typeParameters ?? []
      analyses.push({
        declarationName: compilerDeclarationName(node, sourceFile),
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        paramCount: typeParameters.length,
        maxConstraintDepth: typeParameters.reduce(
          (max, typeParameter) => Math.max(max, compilerTypeSyntaxDepth(typeParameter.constraint)),
          0,
        ),
        returnOnlyParams: detectCompilerReturnOnlyParams(node, typeParameters),
      })
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return analyses
}

const isTrackedGenericDeclaration = (node: Node): node is CompilerGenericDeclaration =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isMethodSignature(node) ||
  isCallSignatureDeclaration(node) ||
  isConstructSignatureDeclaration(node) ||
  isDirectTypeAliasFunctionShape(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isTypeAliasDeclaration(node) ||
  isInterfaceDeclaration(node) ||
  isClassDeclaration(node)

const compilerDeclarationName = (
  node: CompilerGenericDeclaration,
  sourceFile: SourceFile,
): string => {
  if (
    isFunctionDeclaration(node) ||
    isMethodDeclaration(node) ||
    isMethodSignature(node) ||
    isFunctionExpression(node) ||
    isTypeAliasDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isClassDeclaration(node)
  ) {
    const name = node.name === undefined ? undefined : textOf(node.name, sourceFile)
    if (name !== undefined && name !== "") return name
  }

  if (isFunctionTypeNode(node) || isConstructorTypeNode(node)) {
    const typeAlias = directTypeAliasDeclaration(node)
    const signatureName = isConstructorTypeNode(node) ? "<new>" : "<call>"
    return typeAlias === undefined
      ? signatureName
      : `${textOf(typeAlias.name, sourceFile)}.${signatureName}`
  }

  if (isCallSignatureDeclaration(node) || isConstructSignatureDeclaration(node)) {
    const ownerName = compilerOwnerDeclarationName(node.parent, sourceFile)
    const signatureName = isConstructSignatureDeclaration(node) ? "<new>" : "<call>"
    return ownerName === undefined ? signatureName : `${ownerName}.${signatureName}`
  }

  if (isArrowFunction(node) || isFunctionExpression(node)) {
    const parent = node.parent
    if (isVariableDeclaration(parent) || isPropertyAssignment(parent)) {
      return textOf(parent.name, sourceFile)
    }
    if (isExportAssignment(parent)) {
      return "<default export>"
    }
  }

  return "<anonymous>"
}

const isDirectTypeAliasFunctionShape = (
  node: Node,
): node is FunctionTypeNode | ConstructorTypeNode =>
  (isFunctionTypeNode(node) || isConstructorTypeNode(node)) &&
  directTypeAliasDeclaration(node) !== undefined

const directTypeAliasDeclaration = (
  node: FunctionTypeNode | ConstructorTypeNode,
): TypeAliasDeclaration | undefined => {
  let directRhs: Node = node
  while (isParenthesizedTypeNode(directRhs.parent)) {
    directRhs = directRhs.parent
  }

  const parent = directRhs.parent
  return isTypeAliasDeclaration(parent) && parent.type === directRhs
    ? parent
    : undefined
}

const compilerOwnerDeclarationName = (
  node: Node | undefined,
  sourceFile: SourceFile,
): string | undefined => {
  if (node === undefined) return undefined
  if (
    isInterfaceDeclaration(node) ||
    isTypeLiteralNode(node) ||
    isClassDeclaration(node) ||
    isTypeAliasDeclaration(node)
  ) {
    const named = "name" in node ? node.name : undefined
    const name = named === undefined ? undefined : textOf(named, sourceFile)
    if (name !== undefined && name !== "") return name
  }
  return compilerOwnerDeclarationName(node.parent, sourceFile)
}

const detectCompilerReturnOnlyParams = (
  declaration: CompilerGenericDeclaration,
  typeParameters: ReadonlyArray<TypeParameterDeclaration>,
): ReadonlyArray<string> => {
  if (!isCompilerFunctionLikeDeclaration(declaration)) return []

  const parameterTypeNodes = declaration.parameters.map((parameter) => parameter.type)
  const returnTypeNode = declaration.type
  const inputTypeNodes = typeParameters.flatMap((typeParameter) => [
    typeParameter.constraint,
    typeParameter.defaultType,
  ])

  return typeParameters
    .map((typeParameter) => typeParameter.name.text)
    .filter(
      (name) =>
        compilerNameIsUsedInNodes(name, [returnTypeNode]) &&
        !compilerNameIsUsedInNodes(name, [...parameterTypeNodes, ...inputTypeNodes]),
    )
}

const isCompilerFunctionLikeDeclaration = (
  value: CompilerGenericDeclaration,
): value is CompilerFunctionLike =>
  isFunctionDeclaration(value) ||
  isMethodDeclaration(value) ||
  isMethodSignature(value) ||
  isCallSignatureDeclaration(value) ||
  isConstructSignatureDeclaration(value) ||
  isFunctionTypeNode(value) ||
  isConstructorTypeNode(value) ||
  isArrowFunction(value) ||
  isFunctionExpression(value)

const compilerNameIsUsedInNodes = (
  name: string,
  nodes: ReadonlyArray<Node | undefined>,
): boolean => {
  for (const root of nodes) {
    if (root === undefined) continue
    let found = false
    const visit = (node: Node): void => {
      if (found) return
      if (isIdentifier(node) && node.text === name) {
        found = true
        return
      }
      node.forEachChild(visit)
    }
    visit(root)
    if (found) return true
  }
  return false
}

const compilerTypeSyntaxDepth = (node: Node | undefined): number => {
  if (node === undefined) return 0
  if (isParenthesizedTypeNode(node)) {
    return compilerTypeSyntaxDepth(node.type)
  }

  let childDepth = 0
  node.forEachChild((child) => {
    if (isCompilerTypeNode(child)) {
      childDepth = Math.max(childDepth, compilerTypeSyntaxDepth(child))
      return
    }
    if (isExpressionWithTypeArguments(child)) {
      childDepth = Math.max(childDepth, 1 + maxCompilerTypeArgumentDepth(child))
    }
  })

  return 1 + childDepth
}

const isCompilerTypeNode = (node: Node): node is Node =>
  node.kind >= SyntaxKind.FirstTypeNode && node.kind <= SyntaxKind.LastTypeNode

const maxCompilerTypeArgumentDepth = (
  node: Node,
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

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
