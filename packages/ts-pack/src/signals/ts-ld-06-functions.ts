import { type SourceFile, ts } from "ts-morph"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import type { UncoveredFn } from "./ts-ld-06-annotation-coverage.js"

type CompilerFunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression

interface VisitContext {
  readonly className?: string | undefined
  readonly classBoundary?: boolean | undefined
  readonly objectName?: string | undefined
  readonly objectBoundary?: boolean | undefined
}

interface TrackedFunction {
  readonly fn: CompilerFunctionLike
  readonly boundary: boolean
  readonly name: string
  readonly line: number
}

export interface FunctionCoverageMeasurement {
  readonly paramCount: number
  readonly annotatedParams: number
  readonly returnCount: number
  readonly returnAnnotated: boolean
  readonly missingKind: UncoveredFn["missingKind"] | undefined
}

export const collectTrackedFunctions = (sourceFile: SourceFile): ReadonlyArray<TrackedFunction> => {
  const compilerSourceFile = sourceFile.compilerNode
  const boundaryNames = collectLocalBoundaryNames(compilerSourceFile)
  const results: Array<TrackedFunction> = []

  const visit = (node: ts.Node, context: VisitContext): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text
      const boundary =
        hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(node, ts.SyntaxKind.DefaultKeyword) ||
        (className !== undefined && boundaryNames.has(className))
      ts.forEachChild(node, (child) =>
        visit(child, { className, classBoundary: boundary }),
      )
      return
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const objectName = node.name.text
      const boundary = boundaryNames.has(objectName) || isExportedVariableDeclaration(node)
      ts.forEachChild(node.initializer, (child) =>
        visit(
          child,
          boundary
            ? { ...context, objectName, objectBoundary: true }
            : context,
        ),
      )
      return
    }

    if (
      ts.isPropertyAssignment(node) &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer) &&
      context.objectBoundary === true &&
      context.objectName !== undefined
    ) {
      const objectName = `${context.objectName}.${propertyNameText(node.name)}`
      ts.forEachChild(node.initializer, (child) =>
        visit(child, { ...context, objectName, objectBoundary: true }),
      )
      return
    }

    if (isCompilerFunctionLike(node) && isTrackedFunction(node, context)) {
      const boundary = isBoundaryFunction(node, boundaryNames, context)
      results.push({
        fn: node,
        boundary,
        name: functionDisplayName(node, context),
        line: compilerSourceFile.getLineAndCharacterOfPosition(
          node.getStart(compilerSourceFile),
        ).line + 1,
      })
    }

    ts.forEachChild(node, (child) => visit(child, context))
  }

  visit(compilerSourceFile, {})
  return results
}

export const measureTrackedFunctionCoverage = (
  tracked: TrackedFunction,
  file: string,
): FunctionCoverageMeasurement => {
  const paramCount = tracked.fn.parameters.length
  const returnCount = ts.isConstructorDeclaration(tracked.fn) ? 0 : 1
  const contextuallyTyped =
    hasContextualFunctionTypeAnnotation(tracked.fn) ||
    hasFrameworkMethodContract(tracked.fn)
  const annotatedParams = contextuallyTyped
    ? paramCount
    : tracked.fn.parameters.filter(hasCoveredParameterType).length
  const returnAnnotated =
    returnCount === 0 ||
    contextuallyTyped ||
    tracked.fn.type !== undefined ||
    hasImplicitComponentReturnCoverage(tracked.fn, tracked.name, file)
  return {
    paramCount,
    annotatedParams,
    returnCount,
    returnAnnotated,
    missingKind: classifyMissingKind(paramCount, annotatedParams, returnCount, returnAnnotated),
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
  ts.isConstructorDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node)

const isTrackedFunction = (node: CompilerFunctionLike, context: VisitContext): boolean => {
  if (ts.isConstructorDeclaration(node)) return true
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return !isOverloadImplementation(node)
  }
  const parent = node.parent
  return (
    ts.isVariableDeclaration(parent) ||
    ts.isExportAssignment(parent) ||
    (ts.isPropertyAssignment(parent) &&
      context.objectBoundary === true &&
      context.objectName !== undefined)
  )
}

const isOverloadImplementation = (
  node: ts.FunctionDeclaration | ts.MethodDeclaration,
): boolean => {
  if (node.body === undefined) return false
  if (ts.isFunctionDeclaration(node)) return functionHasOverloadSignature(node)
  return methodHasOverloadSignature(node)
}

const functionHasOverloadSignature = (node: ts.FunctionDeclaration): boolean => {
  const name = node.name?.text
  if (name === undefined) return false
  return node
    .getSourceFile()
    .statements.some(
      (statement) =>
        statement !== node &&
        ts.isFunctionDeclaration(statement) &&
        statement.body === undefined &&
        statement.name?.text === name,
    )
}

const methodHasOverloadSignature = (node: ts.MethodDeclaration): boolean => {
  if (!ts.isClassDeclaration(node.parent) && !ts.isClassExpression(node.parent)) return false
  const name = propertyNameText(node.name)
  return node.parent.members.some(
    (member) =>
      member !== node &&
      ts.isMethodDeclaration(member) &&
      member.body === undefined &&
      propertyNameText(member.name) === name,
  )
}

const hasContextualFunctionTypeAnnotation = (node: CompilerFunctionLike): boolean => {
  if (ts.isConstructorDeclaration(node)) return false
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
  context: VisitContext,
): boolean => {
  if (ts.isFunctionDeclaration(fn)) {
    return (
      hasModifier(fn, ts.SyntaxKind.ExportKeyword) ||
      hasModifier(fn, ts.SyntaxKind.DefaultKeyword) ||
      (fn.name !== undefined && boundaryNames.has(fn.name.text))
    )
  }

  if (ts.isConstructorDeclaration(fn)) {
    if (!ts.isClassDeclaration(fn.parent)) return false
    if (
      hasModifier(fn, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(fn, ts.SyntaxKind.ProtectedKeyword)
    ) {
      return false
    }
    return context.classBoundary === true
  }

  if (ts.isMethodDeclaration(fn)) {
    if (ts.isObjectLiteralExpression(fn.parent)) {
      return context.objectBoundary === true
    }
    if (!ts.isClassDeclaration(fn.parent)) return false
    if (
      hasModifier(fn, ts.SyntaxKind.PrivateKeyword) ||
      hasModifier(fn, ts.SyntaxKind.ProtectedKeyword)
    ) {
      return false
    }
    return context.classBoundary === true
  }

  const parent = fn.parent
  if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
    return context.objectBoundary === true
  }
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
  context: VisitContext,
): string => {
  if (ts.isConstructorDeclaration(fn)) {
    return `${context.className ?? "<anonymous class>"}.constructor`
  }
  if (ts.isMethodDeclaration(fn)) {
    const name = propertyNameText(fn.name)
    if (ts.isObjectLiteralExpression(fn.parent) && context.objectName !== undefined) {
      return `${context.objectName}.${name}`
    }
    return ts.isClassDeclaration(fn.parent) && context.className !== undefined
      ? `${context.className}.${name}`
      : name
  }
  if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
    if (fn.name !== undefined) return fn.name.text
  }

  const parent = fn.parent
  if (ts.isPropertyAssignment(parent) && context.objectName !== undefined) {
    return `${context.objectName}.${propertyNameText(parent.name)}`
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (ts.isExportAssignment(parent)) return "<default export>"
  return "<anonymous>"
}

const classifyMissingKind = (
  totalParams: number,
  annotatedParams: number,
  totalReturns: number,
  returnAnnotated: boolean,
): UncoveredFn["missingKind"] | undefined => {
  const paramsMissing = annotatedParams < totalParams
  const returnMissing = totalReturns > 0 && !returnAnnotated
  if (paramsMissing && returnMissing) return "both"
  if (paramsMissing) return "params"
  if (returnMissing) return "return"
  return undefined
}
