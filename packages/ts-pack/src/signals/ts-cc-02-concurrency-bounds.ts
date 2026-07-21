import {
  Node,
  SyntaxKind,
  VariableDeclarationKind,
  type CallExpression,
  type Identifier,
  type VariableDeclaration,
} from "ts-morph"

export type ConcurrencyBoundReason =
  | "literal-array"
  | "local-const-array"
  | "tuple-like-collection"
  | "slice-cap"
  | "slice-window"
  | "limiter-constant"

export interface ResolvedConcurrencyBound {
  readonly state: "bounded"
  readonly boundExpression: string
  readonly resolvedUpperBound: number
  readonly boundReason: ConcurrencyBoundReason
}

export interface UnresolvedConcurrencyBound {
  readonly state: "unbounded"
  readonly boundExpression: string
  readonly resolvedUpperBound: null
  readonly inferenceStoppedReason: string
}

export type ConcurrencyBoundInference =
  | ResolvedConcurrencyBound
  | UnresolvedConcurrencyBound

export const inferConcurrencyBound = (
  iterable: Node,
  callback: Node,
  limiterPattern: RegExp,
): ConcurrencyBoundInference => {
  const collection = inferCollectionBound(iterable, new Set())
  const limiter = inferLimiterBound(callback, limiterPattern)
  const resolved = [collection, limiter]
    .filter((inference): inference is ResolvedConcurrencyBound => inference?.state === "bounded")
    .sort((left, right) => left.resolvedUpperBound - right.resolvedUpperBound)[0]

  if (resolved !== undefined) return resolved
  if (limiter?.state === "unbounded") return limiter
  return collection
}

const inferCollectionBound = (
  node: Node,
  seenDeclarations: Set<VariableDeclaration>,
): ConcurrencyBoundInference => {
  const unwrapped = unwrapExpression(node)
  if (unwrapped === undefined) {
    return unresolved(node.getText(), `No finite local bound was found for ${node.getText()}`)
  }

  if (Node.isArrayLiteralExpression(unwrapped)) {
    if (unwrapped.getElements().some(Node.isSpreadElement)) {
      return unresolved(
        unwrapped.getText(),
        `Array ${unwrapped.getText()} contains a spread with no finite local bound`,
      )
    }
    return bounded(unwrapped.getText(), unwrapped.getElements().length, "literal-array")
  }

  if (Node.isIdentifier(unwrapped)) {
    return inferIdentifierCollectionBound(unwrapped, seenDeclarations)
  }

  if (Node.isCallExpression(unwrapped)) {
    const expression = unwrapped.getExpression()
    if (Node.isPropertyAccessExpression(expression) && expression.getName() === "slice") {
      return inferSliceBound(unwrapped, expression.getExpression(), seenDeclarations)
    }
  }

  return unresolved(
    unwrapped.getText(),
    `No finite local bound was found for ${unwrapped.getText()}`,
  )
}

const inferIdentifierCollectionBound = (
  identifier: Identifier,
  seenDeclarations: Set<VariableDeclaration>,
): ConcurrencyBoundInference => {
  const declaration = localVariableDeclaration(identifier)
  if (declaration === undefined) {
    return unresolved(
      identifier.getText(),
      `No finite local bound was found for ${identifier.getText()}`,
    )
  }
  if (!isConstDeclaration(declaration)) {
    return unresolved(
      identifier.getText(),
      `Iterable ${identifier.getText()} is not an immutable local array or tuple`,
    )
  }
  if (seenDeclarations.has(declaration)) {
    return unresolved(
      identifier.getText(),
      `Local bound resolution for ${identifier.getText()} is cyclic`,
    )
  }

  const nextSeen = new Set(seenDeclarations).add(declaration)
  const instability = collectionInstabilityReason(declaration, new Set())
  if (instability !== undefined) {
    return unresolved(identifier.getText(), instability)
  }
  const initializer = declaration.getInitializer()
  const unwrappedInitializer = unwrapExpression(initializer)
  if (unwrappedInitializer !== undefined && Node.isArrayLiteralExpression(unwrappedInitializer)) {
    if (unwrappedInitializer.getElements().some(Node.isSpreadElement)) {
      return unresolved(
        identifier.getText(),
        `Array ${identifier.getText()} contains a spread with no finite local bound`,
      )
    }
    const reason = isTupleLikeDeclaration(declaration)
      ? "tuple-like-collection"
      : "local-const-array"
    return bounded(
      identifier.getText(),
      unwrappedInitializer.getElements().length,
      reason,
    )
  }

  const tupleLength = tupleLengthOf(declaration)
  if (tupleLength !== undefined) {
    return bounded(identifier.getText(), tupleLength, "tuple-like-collection")
  }

  if (unwrappedInitializer !== undefined && Node.isIdentifier(unwrappedInitializer)) {
    const aliased = inferIdentifierCollectionBound(unwrappedInitializer, nextSeen)
    return aliased.state === "bounded"
      ? { ...aliased, boundExpression: identifier.getText() }
      : unresolved(identifier.getText(), aliased.inferenceStoppedReason)
  }

  return unresolved(
    identifier.getText(),
    `No finite local bound was found for ${identifier.getText()}`,
  )
}

const inferSliceBound = (
  sliceCall: CallExpression,
  collection: Node,
  seenDeclarations: Set<VariableDeclaration>,
): ConcurrencyBoundInference => {
  const [start, end] = sliceCall.getArguments()
  const collectionBound = inferCollectionBound(collection, seenDeclarations)
  if (end === undefined) return collectionBound

  const numericStart = resolveFiniteLocalInteger(start, new Set())
  const numericEnd = resolveFiniteLocalInteger(end, new Set())
  let sliceBound: ResolvedConcurrencyBound | undefined

  if (numericStart?.value === 0 && numericEnd !== undefined) {
    sliceBound = bounded(
      numericEnd.expression,
      numericEnd.value,
      "slice-cap",
    )
  } else if (numericStart !== undefined && numericEnd !== undefined) {
    sliceBound = bounded(
      `${numericEnd.expression} - ${numericStart.expression}`,
      Math.max(0, numericEnd.value - numericStart.value),
      "slice-window",
    )
  } else if (start !== undefined) {
    const window = resolveWindowSize(start, end)
    if (window !== undefined) {
      sliceBound = bounded(window.expression, window.value, "slice-window")
    }
  }

  if (sliceBound !== undefined && collectionBound.state === "bounded") {
    return sliceBound.resolvedUpperBound <= collectionBound.resolvedUpperBound
      ? sliceBound
      : collectionBound
  }
  if (sliceBound !== undefined) return sliceBound
  if (collectionBound.state === "bounded") return collectionBound

  return unresolved(
    end.getText(),
    `Slice cap ${end.getText()} is not a finite local constant`,
  )
}

const resolveWindowSize = (
  start: Node,
  end: Node,
): ResolvedNumber | undefined => {
  const unwrappedEnd = unwrapExpression(end)
  if (unwrappedEnd === undefined || !Node.isBinaryExpression(unwrappedEnd)) return undefined
  if (unwrappedEnd.getOperatorToken().getKind() !== SyntaxKind.PlusToken) return undefined

  const left = unwrapExpression(unwrappedEnd.getLeft())
  const right = unwrapExpression(unwrappedEnd.getRight())
  if (left === undefined || right === undefined) return undefined
  const startText = unwrapExpression(start)?.getText()
  if (startText === undefined) return undefined

  if (left.getText() === startText) {
    return resolveFiniteLocalInteger(right, new Set())
  }
  if (right.getText() === startText) {
    return resolveFiniteLocalInteger(left, new Set())
  }
  return undefined
}

const inferLimiterBound = (
  callback: Node,
  limiterPattern: RegExp,
): ConcurrencyBoundInference | undefined => {
  const limiterCalls = callback
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => isOnCallbackResultPath(call, callback))
    .filter((call) => isLimiterInvocation(call, limiterPattern))

  if (limiterCalls.length === 0) return undefined

  const resolved = limiterCalls
    .map((call) => resolveLimiterInvocation(call, limiterPattern))
    .filter((value): value is ResolvedConcurrencyBound => value !== undefined)
    .sort((left, right) => left.resolvedUpperBound - right.resolvedUpperBound)[0]
  if (resolved !== undefined) return resolved

  const limiterName = limiterInvocationName(limiterCalls[0]!)
  return unresolved(
    limiterName,
    `Limiter ${limiterName} has no finite local constant bound`,
  )
}

const isLimiterInvocation = (call: CallExpression, limiterPattern: RegExp): boolean =>
  limiterPattern.test(limiterInvocationName(call))

const isOnCallbackResultPath = (call: CallExpression, callback: Node): boolean => {
  let current = call.getParent()
  let returnsFromCallback = false
  while (current !== undefined && current !== callback) {
    if (Node.isFunctionLikeDeclaration(current)) return false
    if (Node.isReturnStatement(current)) returnsFromCallback = true
    current = current.getParent()
  }
  if (current !== callback) return false
  if (returnsFromCallback) return true
  if (Node.isArrowFunction(callback)) {
    return !Node.isBlock(callback.getBody())
  }
  return false
}

const limiterInvocationName = (call: CallExpression): string => {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getName()
  if (Node.isCallExpression(expression)) return expression.getExpression().getText()
  return expression.getText()
}

const resolveLimiterInvocation = (
  invocation: CallExpression,
  limiterPattern: RegExp,
): ResolvedConcurrencyBound | undefined => {
  const expression = invocation.getExpression()
  if (Node.isCallExpression(expression)) {
    return resolveLimiterFactoryBound(expression, limiterPattern)
  }
  if (!Node.isIdentifier(expression)) return undefined

  const declaration = localVariableDeclaration(expression)
  if (declaration === undefined || !isConstDeclaration(declaration)) return undefined
  const initializer = unwrapExpression(declaration.getInitializer())
  if (initializer === undefined || !Node.isCallExpression(initializer)) return undefined
  return resolveLimiterFactoryBound(initializer, limiterPattern)
}

const resolveLimiterFactoryBound = (
  factory: CallExpression,
  limiterPattern: RegExp,
): ResolvedConcurrencyBound | undefined => {
  if (!limiterPattern.test(limiterInvocationName(factory))) return undefined
  const size = resolveFiniteLocalInteger(factory.getArguments()[0], new Set())
  if (size === undefined || size.value <= 0) return undefined
  return bounded(size.expression, size.value, "limiter-constant")
}

interface ResolvedNumber {
  readonly expression: string
  readonly value: number
}

const resolveFiniteLocalInteger = (
  node: Node | undefined,
  seenDeclarations: Set<VariableDeclaration>,
): ResolvedNumber | undefined => {
  const unwrapped = unwrapExpression(node)
  if (unwrapped === undefined) return undefined

  if (Node.isNumericLiteral(unwrapped)) {
    const value = unwrapped.getLiteralValue()
    return isFiniteNonNegativeInteger(value)
      ? { expression: unwrapped.getText(), value }
      : undefined
  }
  if (!Node.isIdentifier(unwrapped)) return undefined

  const declaration = localVariableDeclaration(unwrapped)
  if (
    declaration === undefined ||
    !isConstDeclaration(declaration) ||
    seenDeclarations.has(declaration)
  ) {
    return undefined
  }
  const resolved = resolveFiniteLocalInteger(
    declaration.getInitializer(),
    new Set(seenDeclarations).add(declaration),
  )
  return resolved === undefined
    ? undefined
    : { expression: unwrapped.getText(), value: resolved.value }
}

const localVariableDeclaration = (identifier: Identifier): VariableDeclaration | undefined =>
  identifier
    .getSymbol()
    ?.getDeclarations()
    .find((declaration): declaration is VariableDeclaration =>
      Node.isVariableDeclaration(declaration) &&
      declaration.getSourceFile() === identifier.getSourceFile()
    )

const isConstDeclaration = (declaration: VariableDeclaration): boolean => {
  const parent = declaration.getParent()
  return Node.isVariableDeclarationList(parent) &&
    parent.getDeclarationKind() === VariableDeclarationKind.Const
}

const CARDINALITY_MUTATORS = new Set(["pop", "push", "shift", "splice", "unshift"])

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
])

const collectionInstabilityReason = (
  declaration: VariableDeclaration,
  seenDeclarations: Set<VariableDeclaration>,
  rootName = declaration.getName(),
): string | undefined => {
  if (seenDeclarations.has(declaration)) return undefined
  const name = declaration.getNameNode()
  if (!Node.isIdentifier(name)) {
    return `Iterable ${rootName} uses a binding shape with no stable local upper bound`
  }
  const nextSeen = new Set(seenDeclarations).add(declaration)

  for (const reference of name.findReferencesAsNodes()) {
    const reason = referenceInstabilityReason(
      reference,
      declaration,
      nextSeen,
      rootName,
    )
    if (reason !== undefined) return reason
  }

  return undefined
}

const referenceInstabilityReason = (
  reference: Node,
  declaration: VariableDeclaration,
  seenDeclarations: Set<VariableDeclaration>,
  rootName: string,
): string | undefined => {
  if (reference.getSourceFile() !== declaration.getSourceFile()) {
    return `Iterable ${rootName} escapes its local cardinality analysis`
  }
  if (!Node.isIdentifier(reference)) {
    return `Iterable ${rootName} has a reference shape with no stable local upper bound`
  }

  const expression = transparentExpressionParent(reference)
  const member = expression.getParent()
  if (Node.isPropertyAccessExpression(member) && member.getExpression() === expression) {
    return propertyInstabilityReason(member, rootName)
  }
  if (Node.isElementAccessExpression(member) && member.getExpression() === expression) {
    return elementInstabilityReason(member, rootName)
  }

  const alias = directAliasDeclaration(reference)
  if (alias !== undefined) {
    return collectionInstabilityReason(alias, seenDeclarations, rootName)
  }
  return escapedReferenceReason(expression, rootName)
}

const propertyInstabilityReason = (property: Node, rootName: string): string | undefined => {
  if (!Node.isPropertyAccessExpression(property)) return undefined
  const propertyName = property.getName()
  const call = property.getParent()
  if (
    CARDINALITY_MUTATORS.has(propertyName) &&
    Node.isCallExpression(call) &&
    call.getExpression() === property
  ) {
    return `Iterable ${rootName} has a cardinality-changing ${propertyName} mutation`
  }
  return propertyName === "length" && isWriteTarget(property)
    ? `Iterable ${rootName} has a length write that can change its upper bound`
    : undefined
}

const elementInstabilityReason = (element: Node, rootName: string): string | undefined => {
  if (!Node.isElementAccessExpression(element)) return undefined
  if (isWriteTarget(element)) {
    return `Iterable ${rootName} has an element write that can change its upper bound`
  }
  const call = element.getParent()
  return Node.isCallExpression(call) && call.getExpression() === element
    ? `Iterable ${rootName} has a computed method call with no stable cardinality proof`
    : undefined
}

const escapedReferenceReason = (expression: Node, rootName: string): string | undefined => {
  const parent = expression.getParent()
  if (
    Node.isCallExpression(parent) &&
    parent.getArguments().some((argument) => transparentExpressionNode(argument) === expression)
  ) {
    return `Iterable ${rootName} escapes local cardinality analysis through a function call`
  }
  if (Node.isReturnStatement(parent)) {
    return `Iterable ${rootName} escapes local cardinality analysis through a return`
  }
  if (
    Node.isBinaryExpression(parent) &&
    parent.getRight() === expression &&
    ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getKind())
  ) {
    return `Iterable ${rootName} escapes local cardinality analysis through an assignment`
  }
  return undefined
}

const directAliasDeclaration = (reference: Identifier): VariableDeclaration | undefined => {
  const expression = transparentExpressionParent(reference)
  const parent = expression.getParent()
  if (
    Node.isVariableDeclaration(parent) &&
    transparentExpressionNode(parent.getInitializer()) === expression
  ) {
    return parent
  }
  if (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    transparentExpressionNode(parent.getRight()) === expression
  ) {
    const left = transparentExpressionNode(parent.getLeft())
    return Node.isIdentifier(left) ? localVariableDeclaration(left) : undefined
  }
  return undefined
}

const isWriteTarget = (node: Node): boolean => {
  const expression = transparentExpressionParent(node)
  const parent = expression.getParent()
  if (
    Node.isBinaryExpression(parent) &&
    parent.getLeft() === expression &&
    ASSIGNMENT_OPERATORS.has(parent.getOperatorToken().getKind())
  ) {
    return true
  }
  if (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) {
    const operator = parent.getOperatorToken()
    return operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken
  }
  return false
}

const transparentExpressionParent = (node: Node): Node => {
  let current = node
  while (true) {
    const parent = current.getParent()
    if (
      parent !== undefined &&
      (
        Node.isAsExpression(parent) ||
        Node.isSatisfiesExpression(parent) ||
        Node.isTypeAssertion(parent) ||
        Node.isParenthesizedExpression(parent) ||
        Node.isNonNullExpression(parent)
      ) &&
      parent.getExpression() === current
    ) {
      current = parent
      continue
    }
    return current
  }
}

const transparentExpressionNode = (node: Node | undefined): Node | undefined =>
  node === undefined ? undefined : transparentExpressionParent(unwrapExpression(node) ?? node)

const isTupleLikeDeclaration = (declaration: VariableDeclaration): boolean =>
  hasConstAssertion(declaration.getInitializer()) || tupleLengthOf(declaration) !== undefined

const hasConstAssertion = (node: Node | undefined): boolean => {
  let current = node
  while (current !== undefined) {
    if (Node.isAsExpression(current) && current.getTypeNode()?.getText() === "const") return true
    if (
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isParenthesizedExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    return false
  }
  return false
}

const tupleLengthOf = (declaration: VariableDeclaration): number | undefined => {
  const type = declaration.getType()
  if (!type.isTuple()) return undefined
  const text = declaration.getTypeNode()?.getText() ?? declaration.getInitializer()?.getText() ?? ""
  if (text.includes("...")) return undefined
  return type.getTupleElements().length
}

const unwrapExpression = (node: Node | undefined): Node | undefined => {
  let current = node
  while (current !== undefined) {
    if (
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isNonNullExpression(current)
    ) {
      current = current.getExpression()
      continue
    }
    return current
  }
  return undefined
}

const isFiniteNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

const bounded = (
  boundExpression: string,
  resolvedUpperBound: number,
  boundReason: ConcurrencyBoundReason,
): ResolvedConcurrencyBound => ({
  state: "bounded",
  boundExpression,
  resolvedUpperBound,
  boundReason,
})

const unresolved = (
  boundExpression: string,
  inferenceStoppedReason: string,
): UnresolvedConcurrencyBound => ({
  state: "unbounded",
  boundExpression,
  resolvedUpperBound: null,
  inferenceStoppedReason,
})
