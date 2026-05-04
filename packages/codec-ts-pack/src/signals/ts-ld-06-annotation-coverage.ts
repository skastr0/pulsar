import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { type SourceFile, ts } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"

type CompilerFunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression

interface TrackedFunction {
  readonly fn: CompilerFunctionLike
  readonly boundary: boolean
  readonly name: string
  readonly line: number
}

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
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.opencode/**",
      "**/.pi/**",
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

            const fileBoundary = emptyMutableCoverage()
            const fileInternal = emptyMutableCoverage()

            for (const tracked of collectTrackedFunctions(sourceFile)) {
              const target = tracked.boundary ? fileBoundary : fileInternal
              const totals = tracked.boundary ? boundaryTotals : internalTotals
              const paramCount = tracked.fn.parameters.length
              const contextuallyTyped =
                hasContextualFunctionTypeAnnotation(tracked.fn) ||
                hasFrameworkMethodContract(tracked.fn)
              const annotatedParams = contextuallyTyped
                ? paramCount
                : tracked.fn.parameters.filter(hasCoveredParameterType).length
              const returnAnnotated =
                contextuallyTyped ||
                tracked.fn.type !== undefined ||
                hasImplicitComponentReturnCoverage(tracked.fn, tracked.name, file)

              target.totalParams += paramCount
              target.annotatedParams += annotatedParams
              target.totalReturns += 1
              target.annotatedReturns += returnAnnotated ? 1 : 0

              totals.totalParams += paramCount
              totals.annotatedParams += annotatedParams
              totals.totalReturns += 1
              totals.annotatedReturns += returnAnnotated ? 1 : 0

              if (!tracked.boundary) continue

              const missingKind = classifyMissingKind(paramCount, annotatedParams, returnAnnotated)
              if (missingKind === undefined) continue
              uncoveredBoundary.push({
                file,
                name: tracked.name,
                line: tracked.line,
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
  score: (out) => weightedBoundaryCoverage(out.boundaryCoverage),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.uncoveredBoundary.slice(0, out.diagnosticLimit).map((fn) => ({
      severity: fn.missingKind === "return" ? "info" : "warn",
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

const PARAMETER_COVERAGE_WEIGHT = 4
const RETURN_COVERAGE_WEIGHT = 1

const weightedBoundaryCoverage = (coverage: CoverageSummary): number => {
  const denominator =
    coverage.totalParams * PARAMETER_COVERAGE_WEIGHT +
    coverage.totalReturns * RETURN_COVERAGE_WEIGHT
  const numerator =
    coverage.annotatedParams * PARAMETER_COVERAGE_WEIGHT +
    coverage.annotatedReturns * RETURN_COVERAGE_WEIGHT
  return denominator === 0 ? 1 : numerator / denominator
}

const collectTrackedFunctions = (sourceFile: SourceFile): ReadonlyArray<TrackedFunction> => {
  const compilerSourceFile = sourceFile.compilerNode
  const boundaryNames = collectLocalBoundaryNames(compilerSourceFile)
  const results: Array<TrackedFunction> = []

  const visit = (
    node: ts.Node,
    classContext: { readonly name: string | undefined; readonly boundary: boolean } | undefined,
  ): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text
      const boundary =
        hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword) ||
        (className !== undefined && boundaryNames.has(className))
      ts.forEachChild(node, (child) => visit(child, { name: className, boundary }))
      return
    }

    if (isCompilerFunctionLike(node) && isTrackedFunction(node)) {
      const boundary = isBoundaryFunction(node, boundaryNames, classContext)
      results.push({
        fn: node,
        boundary,
        name: functionDisplayName(node, classContext?.name),
        line: compilerSourceFile.getLineAndCharacterOfPosition(
          node.getStart(compilerSourceFile),
        ).line + 1,
      })
    }

    ts.forEachChild(node, (child) => visit(child, classContext))
  }

  visit(compilerSourceFile, undefined)
  return results
}

const collectLocalBoundaryNames = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined &&
      (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
    ) {
      names.add(statement.name.text)
      continue
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text)
      }
    }
  }

  return names
}

const isCompilerFunctionLike = (node: ts.Node): node is CompilerFunctionLike =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node)

const isTrackedFunction = (node: CompilerFunctionLike): boolean => {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return true
  const parent = node.parent
  return ts.isVariableDeclaration(parent) || ts.isExportAssignment(parent)
}

const hasContextualFunctionTypeAnnotation = (node: CompilerFunctionLike): boolean => {
  const parent = node.parent
  if (!ts.isVariableDeclaration(parent)) return false
  return parent.type !== undefined
}

const DURABLE_OBJECT_METHOD_CONTRACTS = new Set([
  "alarm",
  "fetch",
  "webSocketClose",
  "webSocketError",
  "webSocketMessage",
])

const hasFrameworkMethodContract = (node: CompilerFunctionLike): boolean => {
  if (!ts.isMethodDeclaration(node)) return false
  if (!ts.isClassDeclaration(node.parent)) return false
  const name = propertyNameText(node.name)
  if (!DURABLE_OBJECT_METHOD_CONTRACTS.has(name)) return false
  return classExtendsIdentifier(node.parent, "DurableObject")
}

const classExtendsIdentifier = (node: ts.ClassDeclaration, name: string): boolean =>
  node.heritageClauses?.some(
    (clause) =>
      clause.token === ts.SyntaxKind.ExtendsKeyword &&
      clause.types.some((heritage) => expressionMatchesIdentifier(heritage.expression, name)),
  ) ?? false

const expressionMatchesIdentifier = (expression: ts.Expression, name: string): boolean => {
  if (ts.isIdentifier(expression)) return expression.text === name
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === name
  return false
}

const hasCoveredParameterType = (parameter: ts.ParameterDeclaration): boolean =>
  parameter.type !== undefined || parameter.initializer !== undefined

const hasImplicitComponentReturnCoverage = (
  node: CompilerFunctionLike,
  name: string,
  filePath: string,
): boolean => {
  if (!filePath.endsWith(".tsx")) return false
  if (ts.isMethodDeclaration(node)) return false
  if (!isPascalCaseIdentifier(name)) return false
  return bodyContainsJsx(node.body)
}

const isPascalCaseIdentifier = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(name)

const bodyContainsJsx = (body: ts.ConciseBody | ts.FunctionBody | undefined): boolean => {
  if (body === undefined) return false
  if (isJsxNode(body)) return true

  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isReturnStatement(node)) {
      found = node.expression !== undefined && containsJsx(node.expression)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return found
}

const containsJsx = (node: ts.Node): boolean => {
  if (isJsxNode(node)) return true
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (isJsxNode(child)) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

const isJsxNode = (node: ts.Node): boolean =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)

const isBoundaryFunction = (
  fn: CompilerFunctionLike,
  boundaryNames: ReadonlySet<string>,
  classContext: { readonly boundary: boolean } | undefined,
): boolean => {
  if (ts.isFunctionDeclaration(fn)) {
    return (
      hasModifier(fn, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(fn, ts.SyntaxKind.DefaultKeyword) ||
      (fn.name !== undefined && boundaryNames.has(fn.name.text))
    )
  }

  if (ts.isMethodDeclaration(fn)) {
    if (!ts.isClassDeclaration(fn.parent)) return false
    if (
      hasModifier(fn, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(fn, ts.SyntaxKind.ProtectedKeyword)
    ) {
      return false
    }
    return classContext?.boundary === true
  }

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return boundaryNames.has(parent.name.text) || isExportedVariableDeclaration(parent)
  }
  return ts.isExportAssignment(parent)
}

const isExportedVariableDeclaration = (declaration: ts.VariableDeclaration): boolean => {
  const declarationList = declaration.parent
  const statement = declarationList.parent
  return ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
}

const hasModifier = (
  node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> | undefined },
  kind: ts.SyntaxKind,
): boolean => node.modifiers?.some((modifier) => modifier.kind === kind) ?? false

const functionDisplayName = (
  fn: CompilerFunctionLike,
  className: string | undefined,
): string => {
  if (ts.isMethodDeclaration(fn)) {
    const name = propertyNameText(fn.name)
    return ts.isClassDeclaration(fn.parent) && className !== undefined ? `${className}.${name}` : name
  }
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    if (fn.name !== undefined) return fn.name.text
  }

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (ts.isExportAssignment(parent)) return "<default export>"
  return "<anonymous>"
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
