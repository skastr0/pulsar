import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  Node,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from "ts-morph"
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
  const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression)
  const evidence = new Set<string>()
  for (const call of calls) {
    if (!isDirectlyWithinFunction(call, fn)) continue
    const expression = call.getExpression()
    const expressionText = expression.getText()
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
  fn.getDescendantsOfKind(SyntaxKind.IfStatement).some((statement) => {
    if (!isDirectlyWithinFunction(statement, fn)) return false
    const condition = statement.getExpression()
    if (!nodeReferencesDeclaration(condition, ingressDeclarations)) return false
    const hasGuard = condition.getDescendants().some((node) =>
      Node.isTypeOfExpression(node) ||
      (
        Node.isBinaryExpression(node) &&
        (
          node.getOperatorToken().getKind() === SyntaxKind.InstanceOfKeyword ||
          node.getOperatorToken().getKind() === SyntaxKind.InKeyword
        )
      ) ||
      (
        Node.isCallExpression(node) &&
        normalizeCallText(node.getExpression().getText()) === "array.isarray"
      )
    )
    if (!hasGuard) return false
    const rejection = statement.getThenStatement()
    return Node.isReturnStatement(rejection) || Node.isThrowStatement(rejection) ||
      rejection.getDescendants().some((node) =>
        Node.isReturnStatement(node) || Node.isThrowStatement(node)
      )
  })

export const collectInheritedParserEvidence = (
  sourceFile: SourceFile,
  callee: ParserEvidenceCandidate,
  parserPatterns: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) =>
    callTargetsDeclaration(call, callee.declaration)
  )
  if (calls.length === 0) return []

  const ingressParameterIndexes = callee.node.getParameters().flatMap((parameter, index) =>
    callee.weakParameters.some((weak) => weak.name === parameter.getName()) ? [index] : [],
  )
  if (ingressParameterIndexes.length === 0) return []
  const evidence = new Set<string>()
  for (const call of calls) {
    for (const index of ingressParameterIndexes) {
      const argument = call.getArguments()[index]
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
  const expression = call.getExpression()
  const symbol = expression.getSymbol()?.getAliasedSymbol() ?? expression.getSymbol()
  return (symbol?.getDeclarations() ?? []).some((candidate) => candidate === declaration)
}

const decodedArgumentEvidence = (
  argument: Node,
  parserPatterns: ReadonlyArray<string>,
): string | undefined => {
  const direct = parserCallEvidence(unwrapValueExpression(argument), parserPatterns)
  if (direct !== undefined) return direct
  if (!Node.isIdentifier(argument)) return undefined
  const symbol = argument.getSymbol()?.getAliasedSymbol() ?? argument.getSymbol()
  for (const declaration of symbol?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue
    const initializer = declaration.getInitializer()
    if (initializer === undefined) continue
    const evidence = parserCallEvidence(unwrapValueExpression(initializer), parserPatterns)
    if (evidence !== undefined) return evidence
  }
  return undefined
}

const unwrapValueExpression = (node: Node): Node => {
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isAwaitExpression(node)
  ) return unwrapValueExpression(node.getExpression())
  return node
}

const parserCallEvidence = (
  node: Node,
  parserPatterns: ReadonlyArray<string>,
): string | undefined => {
  if (!Node.isCallExpression(node) || isParsedWireCall(node)) return undefined
  const normalizedCallee = normalizeCallText(calleeText(node.getExpression()))
  const matches = parserPatterns
    .map(normalizeCallText)
    .some((pattern) => parserPatternMatchesCallee(pattern, normalizedCallee))
  return matches ? node.getExpression().getText() : undefined
}

const isParsedWireCall = (call: CallExpression): boolean => {
  const callee = normalizeCallText(call.getExpression().getText())
  return callee === "json.parse" || callee.endsWith(".json")
}

const calleeText = (node: Node): string => {
  if (Node.isCallExpression(node)) return calleeText(node.getExpression())
  return node.getText()
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
  call.getArguments().some((argument) =>
    nodeReferencesDeclaration(argument, declarations),
  )

export const callReferencesIngress = (
  call: CallExpression,
  declarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): boolean =>
  call.getArguments().some((argument) =>
    nodeReferencesIngress(argument, declarations, ingressNodes),
  )

const nodeReferencesIngress = (
  node: Node,
  declarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): boolean => {
  if (ingressNodes.has(node)) return true
  if (isFunctionScopeNode(node)) return false
  if (Node.isIdentifier(node) && identifierReferencesDeclaration(node, declarations)) {
    return true
  }
  return node.getChildren().some((child) =>
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

  for (const declaration of fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!isDirectlyWithinFunction(declaration, fn)) continue
    const declarationKind = declaration.getVariableStatement()?.getDeclarationKind()
    if (declarationKind !== "const" && declarationKind !== "let") continue
    if (!Node.isIdentifier(declaration.getNameNode())) continue
    const initializer = declaration.getInitializer()
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
  if (Node.isIdentifier(node) && identifierReferencesDeclaration(node, declarations)) {
    return true
  }
  return node.getChildren().some((child) =>
    nodeReferencesDeclaration(child, declarations),
  )
}

const identifierReferencesDeclaration = (
  identifier: Node,
  declarations: ReadonlySet<Node>,
): boolean =>
  Node.isIdentifier(identifier) &&
  (identifier.getSymbol()?.getDeclarations() ?? []).some((declaration) =>
    declarations.has(declaration),
  )

const hasNonDefinitionWrite = (declaration: VariableDeclaration): boolean =>
  declaration.findReferences().some((reference) =>
    reference.getReferences().some((entry) =>
      entry.isWriteAccess() && entry.isDefinition() !== true,
    ),
  )

export const isDirectlyWithinFunction = (
  node: Node,
  fn: BoundaryFunctionNode,
): boolean => node.getFirstAncestor(isFunctionScopeNode) === fn

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
  FUNCTION_SCOPE_KINDS.has(node.getKind())
