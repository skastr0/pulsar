import { type SourceFile, ts } from "ts-morph"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import type { UncoveredFn } from "./ts-ld-06-annotation-coverage.js"

type CompilerFunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression

export interface TrackedFunction {
  readonly fn: CompilerFunctionLike
  readonly boundary: boolean
  readonly name: string
  readonly line: number
}

export interface FunctionCoverageMeasurement {
  readonly paramCount: number
  readonly annotatedParams: number
  readonly returnAnnotated: boolean
  readonly missingKind: UncoveredFn["missingKind"] | undefined
}

export const collectTrackedFunctions = (sourceFile: SourceFile): ReadonlyArray<TrackedFunction> => {
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

export const measureTrackedFunctionCoverage = (
  tracked: TrackedFunction,
  file: string,
): FunctionCoverageMeasurement => {
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
  return {
    paramCount,
    annotatedParams,
    returnAnnotated,
    missingKind: classifyMissingKind(paramCount, annotatedParams, returnAnnotated),
  }
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
