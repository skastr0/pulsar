import { hasModifier, heritageTypeExpression } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isClassDeclaration,
  isClassExpression,
  isConstructorDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isJsxElement,
  isJsxFragment,
  isJsxSelfClosingElement,
  isMethodDeclaration,
  isNamedExports,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSourceFile,
  isVariableDeclaration,
  isVariableStatement,
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type Node,
  type ParameterDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import type { UncoveredFn } from "./ts-ld-06-annotation-coverage.js"

type CompilerFunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ConstructorDeclaration
  | ArrowFunction
  | FunctionExpression

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
  const boundaryNames = collectLocalBoundaryNames(sourceFile)
  const results: Array<TrackedFunction> = []

  const visit = (node: Node, context: VisitContext): void => {
    if (isClassDeclaration(node)) {
      const className = node.name?.text
      const boundary =
        hasModifier(node, SyntaxKind.ExportKeyword) ||
        hasModifier(node, SyntaxKind.DefaultKeyword) ||
        (className !== undefined && boundaryNames.has(className) && isTopLevelClassDeclaration(node))
      node.forEachChild((child) =>
        visit(child, { className, classBoundary: boundary }),
      )
      return
    }

    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isObjectLiteralExpression(node.initializer)
    ) {
      const objectName = node.name.text
      const boundary = boundaryNames.has(objectName) || isExportedVariableDeclaration(node)
      node.initializer.forEachChild((child) =>
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
      isPropertyAssignment(node) &&
      node.initializer !== undefined &&
      isObjectLiteralExpression(node.initializer) &&
      context.objectBoundary === true &&
      context.objectName !== undefined
    ) {
      const objectName = `${context.objectName}.${propertyNameText(node.name)}`
      node.initializer.forEachChild((child) =>
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
        line: sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1,
      })
    }

    node.forEachChild((child) => visit(child, context))
  }

  visit(sourceFile, {})
  return results
}

export const measureTrackedFunctionCoverage = (
  tracked: TrackedFunction,
  file: string,
): FunctionCoverageMeasurement => {
  const paramCount = tracked.fn.parameters.length
  const returnCount = isConstructorDeclaration(tracked.fn) ? 0 : 1
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

const collectLocalBoundaryNames = (sourceFile: SourceFile): ReadonlySet<string> => {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (
      (isFunctionDeclaration(statement) || isClassDeclaration(statement)) &&
      statement.name !== undefined &&
      (hasModifier(statement, SyntaxKind.ExportKeyword) ||
        hasModifier(statement, SyntaxKind.DefaultKeyword))
    ) {
      names.add(statement.name.text)
      continue
    }

    if (isVariableStatement(statement) && hasModifier(statement, SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }

    if (
      isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text)
      }
    }

    if (isExportAssignment(statement) && isIdentifier(statement.expression)) {
      names.add(statement.expression.text)
    }
  }

  return names
}

const isCompilerFunctionLike = (node: Node): node is CompilerFunctionLike =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isConstructorDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node)

const isTrackedFunction = (node: CompilerFunctionLike, context: VisitContext): boolean => {
  if (isConstructorDeclaration(node)) return true
  if (isFunctionDeclaration(node) || isMethodDeclaration(node)) {
    return !isOverloadImplementation(node)
  }
  const parent = node.parent
  return (
    isVariableDeclaration(parent) ||
    isExportAssignment(parent) ||
    (isPropertyAssignment(parent) &&
      context.objectBoundary === true &&
      context.objectName !== undefined)
  )
}

const isOverloadImplementation = (
  node: FunctionDeclaration | MethodDeclaration,
): boolean => {
  if (node.body === undefined) return false
  if (isFunctionDeclaration(node)) return functionHasOverloadSignature(node)
  return methodHasOverloadSignature(node)
}

const functionHasOverloadSignature = (node: FunctionDeclaration): boolean => {
  const name = node.name?.text
  if (name === undefined) return false
  return node
    .getSourceFile()
    .statements.some(
      (statement) =>
        statement !== node &&
        isFunctionDeclaration(statement) &&
        statement.body === undefined &&
        statement.name?.text === name,
    )
}

const methodHasOverloadSignature = (node: MethodDeclaration): boolean => {
  if (!isClassDeclaration(node.parent) && !isClassExpression(node.parent)) return false
  const name = propertyNameText(node.name)
  return node.parent.members.some(
    (member) =>
      member !== node &&
      isMethodDeclaration(member) &&
      member.body === undefined &&
      propertyNameText(member.name) === name,
  )
}

const hasContextualFunctionTypeAnnotation = (node: CompilerFunctionLike): boolean => {
  if (isConstructorDeclaration(node)) return false
  const parent = node.parent
  return (
    (isVariableDeclaration(parent) && parent.type !== undefined) ||
    hasContextuallyTypedObjectLiteralAncestor(node)
  )
}

const hasContextuallyTypedObjectLiteralAncestor = (node: Node): boolean => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (
      isObjectLiteralExpression(current) &&
      objectLiteralHasEnclosingVariableType(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const objectLiteralHasEnclosingVariableType = (node: Node): boolean => {
  let current: Node = node
  while (current.parent !== undefined) {
    if (isVariableDeclaration(current.parent)) {
      return current.parent.initializer === current && current.parent.type !== undefined
    }
    current = current.parent
  }
  return false
}

const DURABLE_OBJECT_METHOD_CONTRACTS = new Set([
  "alarm",
  "fetch",
  "webSocketClose",
  "webSocketError",
  "webSocketMessage",
])

const hasFrameworkMethodContract = (node: CompilerFunctionLike): boolean => {
  if (!isMethodDeclaration(node)) return false
  if (!isClassDeclaration(node.parent)) return false
  const name = propertyNameText(node.name)
  if (!DURABLE_OBJECT_METHOD_CONTRACTS.has(name)) return false
  return classExtendsIdentifier(node.parent, "DurableObject")
}

const classExtendsIdentifier = (node: Node, name: string): boolean =>
  (isClassDeclaration(node) ? node.heritageClauses : undefined)?.some(
    (clause) =>
      clause.token === SyntaxKind.ExtendsKeyword &&
      clause.types.some((heritage) => {
        const expression = heritageTypeExpression(heritage)
        return expression !== undefined && expressionMatchesIdentifier(expression, name)
      }),
  ) ?? false

const expressionMatchesIdentifier = (expression: Node, name: string): boolean => {
  if (isIdentifier(expression)) return expression.text === name
  if (isPropertyAccessExpression(expression)) return expression.name.text === name
  return false
}

const hasCoveredParameterType = (parameter: ParameterDeclaration): boolean =>
  parameter.type !== undefined || parameter.initializer !== undefined

const hasImplicitComponentReturnCoverage = (
  node: CompilerFunctionLike,
  name: string,
  filePath: string,
): boolean => {
  if (!filePath.endsWith(".tsx")) return false
  if (isMethodDeclaration(node)) return false
  if (!isPascalCaseIdentifier(name)) return false
  return bodyContainsJsx(node.body)
}

const isPascalCaseIdentifier = (name: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(name)

const bodyContainsJsx = (body: Node | undefined): boolean => {
  if (body === undefined) return false
  if (isJsxNode(body)) return true

  let found = false
  const visit = (node: Node): void => {
    if (found) return
    if (isReturnStatement(node)) {
      found = node.expression !== undefined && containsJsx(node.expression)
      return
    }
    node.forEachChild(visit)
  }
  visit(body)
  return found
}

const containsJsx = (node: Node): boolean => {
  if (isJsxNode(node)) return true
  let found = false
  const visit = (child: Node): void => {
    if (found) return
    if (isJsxNode(child)) {
      found = true
      return
    }
    child.forEachChild(visit)
  }
  node.forEachChild(visit)
  return found
}

const isJsxNode = (node: Node): boolean =>
  isJsxElement(node) || isJsxSelfClosingElement(node) || isJsxFragment(node)

const isBoundaryFunction = (
  fn: CompilerFunctionLike,
  boundaryNames: ReadonlySet<string>,
  context: VisitContext,
): boolean => {
  if (isFunctionDeclaration(fn)) {
    return (
      hasModifier(fn, SyntaxKind.ExportKeyword) ||
      hasModifier(fn, SyntaxKind.DefaultKeyword) ||
      (fn.name !== undefined && boundaryNames.has(fn.name.text) && isTopLevelFunctionDeclaration(fn))
    )
  }

  if (isConstructorDeclaration(fn)) {
    if (!isClassDeclaration(fn.parent)) return false
    if (
      hasModifier(fn, SyntaxKind.PrivateKeyword) ||
      hasModifier(fn, SyntaxKind.ProtectedKeyword)
    ) {
      return false
    }
    return context.classBoundary === true
  }

  if (isMethodDeclaration(fn)) {
    if (isObjectLiteralExpression(fn.parent)) {
      return context.objectBoundary === true
    }
    if (!isClassDeclaration(fn.parent)) return false
    if (
      hasModifier(fn, SyntaxKind.PrivateKeyword) ||
      hasModifier(fn, SyntaxKind.ProtectedKeyword)
    ) {
      return false
    }
    return context.classBoundary === true
  }

  const parent = fn.parent
  if (isPropertyAssignment(parent) && isObjectLiteralExpression(parent.parent)) {
    return context.objectBoundary === true
  }
  if (isVariableDeclaration(parent) && isIdentifier(parent.name)) {
    return (
      isExportedVariableDeclaration(parent) ||
      (boundaryNames.has(parent.name.text) && isTopLevelVariableDeclaration(parent))
    )
  }
  return isExportAssignment(parent)
}

const isExportedVariableDeclaration = (declaration: VariableDeclaration): boolean => {
  const declarationList = declaration.parent
  const statement = declarationList.parent
  return isVariableStatement(statement) && hasModifier(statement, SyntaxKind.ExportKeyword)
}

const isTopLevelFunctionDeclaration = (node: FunctionDeclaration): boolean =>
  isSourceFile(node.parent)

const isTopLevelClassDeclaration = (node: Node): boolean =>
  isSourceFile(node.parent)

const isTopLevelVariableDeclaration = (node: VariableDeclaration): boolean => {
  const declarationList = node.parent
  const statement = declarationList.parent
  return isVariableStatement(statement) && isSourceFile(statement.parent)
}

const functionDisplayName = (
  fn: CompilerFunctionLike,
  context: VisitContext,
): string => {
  if (isConstructorDeclaration(fn)) {
    return `${context.className ?? "<anonymous class>"}.constructor`
  }
  if (isMethodDeclaration(fn)) {
    const name = propertyNameText(fn.name)
    if (isObjectLiteralExpression(fn.parent) && context.objectName !== undefined) {
      return `${context.objectName}.${name}`
    }
    return isClassDeclaration(fn.parent) && context.className !== undefined
      ? `${context.className}.${name}`
      : name
  }
  if (isFunctionDeclaration(fn) || isFunctionExpression(fn)) {
    if (fn.name !== undefined) return fn.name.text
  }

  const parent = fn.parent
  if (isPropertyAssignment(parent) && context.objectName !== undefined) {
    return `${context.objectName}.${propertyNameText(parent.name)}`
  }
  if (isVariableDeclaration(parent) && isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (isExportAssignment(parent)) return "<default export>"
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
