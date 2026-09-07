import { ancestors, firstAncestor, textOf, walkDescendants } from "../ast.js"
import { dirname, normalize, resolve } from "node:path"
import {
  SyntaxKind,
  isArrowFunction,
  isAsExpression,
  isAwaitExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isIfStatement,
  isImportDeclaration,
  isImportSpecifier,
  isMethodDeclaration,
  isNamedImports,
  isNamespaceImport,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSatisfiesExpression,
  isSetAccessorDeclaration,
  isStringLiteral,
  isNoSubstitutionTemplateLiteral,
  isThrowStatement,
  isTypeOfExpression,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type ImportDeclaration,
  type Node,
  type SourceFile,
  type VariableDeclaration,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { stripKnownExtension } from "./shared-path-extensions.js"
import type { WeakBoundaryParameter } from "./ts-ad-04-boundary-parser-coverage.js"

export type BoundaryFunctionNode =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression

interface ParserEvidenceCandidate {
  readonly node: BoundaryFunctionNode
  readonly declaration: Node
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
}

export const collectParserEvidence = (
  fn: BoundaryFunctionNode,
  parserPatterns: ReadonlyArray<string>,
  ingressDeclarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): ReadonlyArray<string> => {
  const patterns = parserPatterns.map((pattern) => normalizeCallText(pattern))
  if (patterns.length === 0 || (ingressDeclarations.size === 0 && ingressNodes.size === 0)) {
    return []
  }
  const evidenceDeclarations = new Set<Node>([
    ...ingressDeclarations,
    ...collectStableOneHopAliases(fn, ingressDeclarations),
  ])
  const calls = collectKind(fn, isCallExpression)
  const evidence = new Set<string>()
  for (const call of calls) {
    if (!isDirectlyWithinFunction(call, fn)) continue
    const expression = call.expression
    const expressionText = textOf(expression)
    const normalizedCallee = normalizeCallText(calleeText(expression))
    if (
      !isParsedWireCall(call) &&
      patterns.some((pattern) => parserPatternMatchesCallee(pattern, normalizedCallee)) &&
      callReferencesIngress(call, evidenceDeclarations, ingressNodes)
    ) {
      evidence.add(expressionText)
    }
  }
  if (hasRejectingRuntimeRefinement(fn, evidenceDeclarations)) {
    evidence.add("runtime-refinement")
  }
  return [...evidence].sort()
}

const hasRejectingRuntimeRefinement = (
  fn: BoundaryFunctionNode,
  ingressDeclarations: ReadonlySet<Node>,
): boolean =>
  collectKind(fn, isIfStatement).some((statement) => {
    if (!isDirectlyWithinFunction(statement, fn)) return false
    const condition = statement.expression
    if (!nodeReferencesDeclaration(condition, ingressDeclarations)) return false
    const hasGuard = [condition, ...descendantsOf(condition).slice(1)].some((node) =>
      isTypeOfExpression(node) ||
      (
        isBinaryExpression(node) &&
        (
          node.operatorToken.kind === SyntaxKind.InstanceOfKeyword ||
          node.operatorToken.kind === SyntaxKind.InKeyword
        )
      ) ||
      (
        isCallExpression(node) &&
        normalizeCallText(textOf(node.expression)) === "array.isarray"
      )
    )
    if (!hasGuard) return false
    return [statement.thenStatement, statement.elseStatement]
      .some((branch) =>
        branch !== undefined && branchContainsExplicitRejection(branch, fn)
      )
  })

const branchContainsExplicitRejection = (
  branch: Node,
  fn: BoundaryFunctionNode,
): boolean => [branch, ...descendantsOf(branch).slice(1)].some((node) => {
  if (!isDirectlyWithinFunction(node, fn)) return false
  if (isThrowStatement(node)) return true
  if (!isReturnStatement(node)) return false
  const expression = node.expression
  if (expression === undefined) return true
  const value = unwrapValueExpression(expression)
  return isExplicitRejectionValue(value)
})

const isExplicitRejectionValue = (value: Node): boolean => {
  if (
    value.kind === SyntaxKind.NullKeyword ||
    value.kind === SyntaxKind.FalseKeyword ||
    (isIdentifier(value) && textOf(value) === "undefined")
  ) return true
  if (isObjectLiteralExpression(value)) {
    return value.properties.some((property) => {
      if (!isPropertyAssignment(property)) return false
      const name = propertyNameText(property.name)
      const initializer = unwrapValueExpression(property.initializer!)
      if (name === "error") return true
      if (["ok", "success", "valid"].includes(name)) {
        return initializer.kind === SyntaxKind.FalseKeyword
      }
      if (name !== "_tag" || !isStringLiteral(initializer)) return false
      return ["Error", "Failure", "Left", "None"].includes(initializer.text)
    })
  }
  if (!isCallExpression(value)) return false
  const terminal = calleeSegments(normalizeCallText(textOf(value.expression))).at(-1)
  return terminal !== undefined &&
    ["fail", "failure", "left", "none", "reject"].includes(terminal)
}

export const collectInheritedParserEvidence = (
  sourceFiles: ReadonlyArray<SourceFile>,
  callee: ParserEvidenceCandidate,
  parserPatterns: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const calls = sourceFiles.flatMap((sourceFile) =>
    collectKind(sourceFile, isCallExpression).filter((call) =>
      callTargetsDeclaration(call, callee.declaration)
    )
  )
  if (calls.length === 0) return []

  const ingressParameterIndexes = callee.node.parameters.flatMap((parameter, index) =>
    callee.weakParameters.some((weak) => weak.name === identifierText(parameter.name)) ? [index] : [],
  )
  if (ingressParameterIndexes.length === 0) return []
  const evidence = new Set<string>()
  for (const call of calls) {
    for (const index of ingressParameterIndexes) {
      const argument = call.arguments[index]
      if (argument === undefined) return []
      const decoded = decodedArgumentEvidence(argument, parserPatterns)
      if (decoded === undefined) return []
      evidence.add(`caller:${decoded}`)
    }
  }
  return [...evidence].sort()
}

const callTargetsDeclaration = (
  call: CallExpression,
  declaration: Node,
): boolean => {
  const declarationName = declarationNameOf(declaration)
  if (declarationName === undefined) return false
  const expression = call.expression
  if (isIdentifier(expression)) {
    const binding = resolveIdentifierBinding(expression)
    if (binding === declaration) return true
    return namedImportTargetsDeclaration(binding, declaration, declarationName)
  }
  if (isPropertyAccessExpression(expression) && isIdentifier(expression.expression)) {
    const namespaceBinding = resolveIdentifierBinding(expression.expression)
    const member = isIdentifier(expression.name) ? expression.name.text : textOf(expression.name)
    if (member !== declarationName) return false
    return namespaceImportTargetsDeclaration(namespaceBinding, declaration)
  }
  return false
}

const declarationNameOf = (declaration: Node): string | undefined => {
  if (isFunctionDeclaration(declaration) && declaration.name !== undefined) return declaration.name.text
  if (isVariableDeclaration(declaration) && isIdentifier(declaration.name)) return declaration.name.text
  return undefined
}

const namedImportTargetsDeclaration = (
  binding: Node | undefined,
  declaration: Node,
  declarationName: string,
): boolean => {
  if (binding === undefined || !isImportSpecifier(binding)) return false
  const importedName = (binding.propertyName ?? binding.name).text
  if (importedName !== declarationName) return false
  const importDeclaration = firstAncestor(binding, isImportDeclaration)
  return importDeclaration !== undefined &&
    importResolvesToFile(importDeclaration, binding.getSourceFile().fileName, declaration.getSourceFile().fileName)
}

const namespaceImportTargetsDeclaration = (
  binding: Node | undefined,
  declaration: Node,
): boolean => {
  if (binding === undefined || !isNamespaceImport(binding)) return false
  const importDeclaration = firstAncestor(binding, isImportDeclaration)
  return importDeclaration !== undefined &&
    importResolvesToFile(importDeclaration, binding.getSourceFile().fileName, declaration.getSourceFile().fileName)
}

const importResolvesToFile = (
  importDeclaration: ImportDeclaration,
  fromFile: string,
  declarationFile: string,
): boolean => {
  const specifierNode = importDeclaration.moduleSpecifier
  if (specifierNode === undefined) return false
  if (!isStringLiteral(specifierNode) && !isNoSubstitutionTemplateLiteral(specifierNode)) {
    return false
  }
  const specifier = specifierNode.text
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return false
  const resolved = normalize(resolve(dirname(fromFile), specifier))
  const target = normalize(declarationFile)
  const resolvedStem = stripKnownExtension(resolved)
  const targetStem = stripKnownExtension(target)
  return resolvedStem === targetStem || `${resolvedStem}/index` === targetStem
}

const decodedArgumentEvidence = (
  argument: Node,
  parserPatterns: ReadonlyArray<string>,
): string | undefined => {
  const direct = parserCallEvidence(unwrapValueExpression(argument), parserPatterns)
  if (direct !== undefined) return direct
  if (!isIdentifier(argument)) return undefined
  const binding = resolveIdentifierBinding(argument)
  if (binding === undefined || !isVariableDeclaration(binding)) return undefined
  const declarationKind = variableStatementKind(binding)
  if (declarationKind !== "const" && declarationKind !== "let") return undefined
  if (declarationKind === "let" && hasNonDefinitionWrite(binding)) return undefined
  const initializer = binding.initializer
  if (initializer === undefined) return undefined
  return parserCallEvidence(unwrapValueExpression(initializer), parserPatterns)
}

const unwrapValueExpression = (node: Node): Node => {
  if (
    isParenthesizedExpression(node) ||
    isAsExpression(node) ||
    isSatisfiesExpression(node) ||
    isNonNullExpression(node) ||
    isAwaitExpression(node)
  ) return unwrapValueExpression(node.expression)
  return node
}

const parserCallEvidence = (
  node: Node,
  parserPatterns: ReadonlyArray<string>,
): string | undefined => {
  if (!isCallExpression(node) || isParsedWireCall(node)) return undefined
  const normalizedCallee = normalizeCallText(calleeText(node.expression))
  const matches = parserPatterns
    .map(normalizeCallText)
    .some((pattern) => parserPatternMatchesCallee(pattern, normalizedCallee))
  return matches ? textOf(node.expression) : undefined
}

const isParsedWireCall = (call: CallExpression): boolean => {
  const callee = normalizeCallText(textOf(call.expression))
  return callee === "json.parse" || callee.endsWith(".json")
}

const calleeText = (node: Node): string => {
  if (isCallExpression(node)) return calleeText(node.expression)
  return textOf(node)
}

export const normalizeCallText = (text: string): string =>
  text.toLowerCase().replace(/\s+/gu, "")

const parserPatternMatchesCallee = (
  normalizedPattern: string,
  normalizedCallee: string,
): boolean => {
  if (normalizedPattern.includes(".")) {
    return normalizedCallee === normalizedPattern ||
      normalizedCallee.endsWith(`.${normalizedPattern}`)
  }
  return calleeSegments(normalizedCallee).some((segment) =>
    parserPatternMatchesSegment(normalizedPattern, segment),
  )
}

export const calleeSegments = (normalizedCallee: string): ReadonlyArray<string> =>
  normalizedCallee.split(/[^a-z0-9_$]+/u).filter((segment) => segment.length > 0)

const parserPatternMatchesSegment = (
  normalizedPattern: string,
  segment: string,
): boolean => {
  if (segment === normalizedPattern) return true
  const suffix = segment.slice(normalizedPattern.length)
  return (suffix === "sync" || suffix === "async") &&
    segment.startsWith(normalizedPattern)
}

export const callReferencesDeclaration = (
  call: CallExpression,
  declarations: ReadonlySet<Node>,
): boolean =>
  call.arguments.some((argument) =>
    nodeReferencesDeclaration(argument, declarations),
  )

export const callReferencesIngress = (
  call: CallExpression,
  declarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): boolean =>
  call.arguments.some((argument) =>
    nodeReferencesIngress(argument, declarations, ingressNodes),
  )

const nodeReferencesIngress = (
  node: Node,
  declarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): boolean => {
  if (ingressNodes.has(node)) return true
  if (isFunctionScopeNode(node)) return false
  if (isIdentifier(node) && identifierReferencesDeclaration(node, declarations)) {
    return true
  }
  return childrenOf(node).some((child) =>
    nodeReferencesIngress(child, declarations, ingressNodes),
  )
}

const collectStableOneHopAliases = (
  fn: BoundaryFunctionNode,
  weakParameterDeclarations: ReadonlySet<Node>,
): ReadonlySet<VariableDeclaration> => {
  // Intentionally bounded data flow: parameter -> one local initializer ->
  // parser argument. Symbols keep shadowed names from becoming evidence.
  const aliases = new Set<VariableDeclaration>()

  for (const declaration of collectKind(fn, isVariableDeclaration)) {
    if (!isDirectlyWithinFunction(declaration, fn)) continue
    const declarationKind = variableStatementKind(declaration)
    if (declarationKind !== "const" && declarationKind !== "let") continue
    if (!isIdentifier(declaration.name)) continue
    const initializer = declaration.initializer
    if (initializer === undefined) continue
    if (!nodeReferencesDeclaration(initializer, weakParameterDeclarations)) continue
    // `let` is evidence only when language-service references prove the
    // initializer remains its sole assignment.
    if (declarationKind === "let" && hasNonDefinitionWrite(declaration)) continue
    aliases.add(declaration)
  }

  return aliases
}

export const nodeReferencesDeclaration = (
  node: Node,
  declarations: ReadonlySet<Node>,
): boolean => {
  if (isFunctionScopeNode(node)) return false
  if (isIdentifier(node) && identifierReferencesDeclaration(node, declarations)) {
    return true
  }
  return childrenOf(node).some((child) =>
    nodeReferencesDeclaration(child, declarations),
  )
}

const identifierReferencesDeclaration = (
  identifier: Node,
  declarations: ReadonlySet<Node>,
): boolean => {
  if (!isIdentifier(identifier)) return false
  const binding = resolveIdentifierBinding(identifier)
  return binding !== undefined && declarations.has(binding)
}

const resolveIdentifierBinding = (identifier: import("../tsgo-api.js").Identifier): Node | undefined => {
  let current: Node | undefined = identifier.parent
  while (current !== undefined) {
    const binding = bindingInScope(current, identifier.text)
    if (binding !== undefined) return binding
    current = current.parent
  }
  return undefined
}

const bindingInScope = (scope: Node, name: string): Node | undefined => {
  if (isFunctionDeclaration(scope) && scope.name?.text === name) return scope
  if (isVariableDeclaration(scope) && isIdentifier(scope.name) && scope.name.text === name) return scope
  if ("parameters" in scope && Array.isArray((scope as { parameters?: ReadonlyArray<Node> }).parameters)) {
    for (const parameter of (scope as { parameters: ReadonlyArray<Node> }).parameters) {
      if ("name" in parameter && isIdentifier((parameter as { name: Node }).name) && (parameter as { name: import("../tsgo-api.js").Identifier }).name.text === name) {
        return parameter
      }
    }
  }
  if (isBlock(scope) || scope.kind === SyntaxKind.SourceFile) {
    return bindingInDirectStatements(scope, name)
  }
  return undefined
}

const bindingInDirectStatements = (scope: Node, name: string): Node | undefined => {
  const statements =
    "statements" in scope && Array.isArray((scope as { statements?: ReadonlyArray<Node> }).statements)
      ? (scope as { statements: ReadonlyArray<Node> }).statements
      : []
  for (const statement of statements) {
    if (isFunctionDeclaration(statement) && statement.name?.text === name) return statement
    if (isVariableDeclaration(statement) && isIdentifier(statement.name) && statement.name.text === name) {
      return statement
    }
    if (isVariableStatement(statement)) {
      for (const declaration of variableDeclarationsOf(statement)) {
        if (isIdentifier(declaration.name) && declaration.name.text === name) return declaration
      }
    }
    if (isImportDeclaration(statement)) {
      const importBinding = importBindingNamed(statement, name)
      if (importBinding !== undefined) return importBinding
    }
  }
  return undefined
}

const importBindingNamed = (statement: ImportDeclaration, name: string): Node | undefined => {
  const clause = statement.importClause
  if (clause === undefined) return undefined
  if (clause.name?.text === name) return clause.name
  const named = clause.namedBindings
  if (named === undefined) return undefined
  if (isNamespaceImport(named) && named.name.text === name) return named
  if (!isNamedImports(named)) return undefined
  for (const element of named.elements) {
    if (element.name.text === name) return element
  }
  return undefined
}

const hasNonDefinitionWrite = (declaration: VariableDeclaration): boolean => {
  if (!isIdentifier(declaration.name)) return false
  const name = declaration.name.text
  const sourceFile = declaration.getSourceFile()
  let writes = 0
  walkDescendants(sourceFile, (node) => {
    if (!isIdentifier(node) || node.text !== name) return
    const parent = node.parent
    if (isVariableDeclaration(parent) && parent.name === node) return
    if (isBinaryExpression(parent) && parent.left === node && assignmentOperator(parent)) writes += 1
  })
  return writes > 0
}

const assignmentOperator = (node: import("../tsgo-api.js").BinaryExpression): boolean =>
  node.operatorToken.kind === SyntaxKind.EqualsToken ||
  node.operatorToken.kind === SyntaxKind.PlusEqualsToken ||
  node.operatorToken.kind === SyntaxKind.MinusEqualsToken ||
  node.operatorToken.kind === SyntaxKind.AsteriskEqualsToken ||
  node.operatorToken.kind === SyntaxKind.SlashEqualsToken ||
  node.operatorToken.kind === SyntaxKind.PercentEqualsToken ||
  node.operatorToken.kind === SyntaxKind.AmpersandEqualsToken ||
  node.operatorToken.kind === SyntaxKind.BarEqualsToken ||
  node.operatorToken.kind === SyntaxKind.CaretEqualsToken ||
  node.operatorToken.kind === SyntaxKind.BarBarEqualsToken ||
  node.operatorToken.kind === SyntaxKind.AmpersandAmpersandEqualsToken ||
  node.operatorToken.kind === SyntaxKind.QuestionQuestionEqualsToken

export const isDirectlyWithinFunction = (
  node: Node,
  fn: BoundaryFunctionNode,
): boolean => firstAncestor(node, isFunctionScopeNode) === fn

const FUNCTION_SCOPE_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.Constructor,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
])

const isFunctionScopeNode = (node: Node): boolean =>
  FUNCTION_SCOPE_KINDS.has(node.kind)

const variableDeclarationsOf = (statement: Node): ReadonlyArray<VariableDeclaration> => {
  if (!isVariableStatement(statement)) return []
  return [...statement.declarationList.declarations]
}

const collectKind = <T extends Node>(root: Node, predicate: (node: Node) => node is T): ReadonlyArray<T> => {
  const results: Array<T> = []
  walkDescendants(root, (node) => {
    if (predicate(node)) results.push(node)
  })
  return results
}

const descendantsOf = (root: Node): ReadonlyArray<Node> => {
  const results: Array<Node> = [root]
  walkDescendants(root, (node) => {
    results.push(node)
  })
  return results
}

const childrenOf = (node: Node): ReadonlyArray<Node> => {
  const children: Array<Node> = []
  node.forEachChild((child) => {
    children.push(child)
  })
  return children
}

const identifierText = (node: Node): string =>
  isIdentifier(node) ? node.text : textOf(node)

const variableStatementKind = (declaration: VariableDeclaration): "const" | "let" | "var" | undefined => {
  const list = declaration.parent
  if (!isVariableDeclarationList(list)) return undefined
  if ((list.flags & 2) !== 0 || textOf(list).trimStart().startsWith("const ")) return "const"
  if (textOf(list).trimStart().startsWith("let ")) return "let"
  return "var"
}
