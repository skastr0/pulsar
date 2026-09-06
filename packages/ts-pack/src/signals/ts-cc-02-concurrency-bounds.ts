import { textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isElementAccessExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isNonNullExpression,
  isNumericLiteral,
  isParenthesizedExpression,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isSatisfiesExpression,
  isSpreadElement,
  isTypeAssertion,
  isVariableDeclaration,
  isVariableDeclarationList,
  type CallExpression,
  type Identifier,
  type Node,
  type VariableDeclaration,
} from "../tsgo-api.js"

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
    return unresolved(textOf(node), `No finite local bound was found for ${textOf(node)}`)
  }

  if (isArrayLiteralExpression(unwrapped)) {
    if ([...unwrapped.elements].some(isSpreadElement)) {
      return unresolved(
        textOf(unwrapped),
        `Array ${textOf(unwrapped)} contains a spread with no finite local bound`,
      )
    }
    return bounded(textOf(unwrapped), unwrapped.elements.length, "literal-array")
  }

  if (isIdentifier(unwrapped)) {
    return inferIdentifierCollectionBound(unwrapped, seenDeclarations)
  }

  if (isCallExpression(unwrapped)) {
    const expression = unwrapped.expression
    if (isPropertyAccessExpression(expression) && textOf(expression.name) === "slice") {
      return inferSliceBound(unwrapped, expression.expression, seenDeclarations)
    }
  }

  return unresolved(
    textOf(unwrapped),
    `No finite local bound was found for ${textOf(unwrapped)}`,
  )
}

const inferIdentifierCollectionBound = (
  identifier: Identifier,
  seenDeclarations: Set<VariableDeclaration>,
): ConcurrencyBoundInference => {
  const declaration = localVariableDeclaration(identifier)
  if (declaration === undefined) {
    return unresolved(
      textOf(identifier),
      `No finite local bound was found for ${textOf(identifier)}`,
    )
  }
  if (!isConstDeclaration(declaration)) {
    return unresolved(
      textOf(identifier),
      `Iterable ${textOf(identifier)} is not an immutable local array or tuple`,
    )
  }
  if (seenDeclarations.has(declaration)) {
    return unresolved(
      textOf(identifier),
      `Local bound resolution for ${textOf(identifier)} is cyclic`,
    )
  }

  const nextSeen = new Set(seenDeclarations).add(declaration)
  const instability = collectionInstabilityReason(declaration, new Set())
  if (instability !== undefined) {
    return unresolved(textOf(identifier), instability)
  }
  const initializer = declaration.initializer
  const unwrappedInitializer = unwrapExpression(initializer)
  if (unwrappedInitializer !== undefined && isArrayLiteralExpression(unwrappedInitializer)) {
    if ([...unwrappedInitializer.elements].some(isSpreadElement)) {
      return unresolved(
        textOf(identifier),
        `Array ${textOf(identifier)} contains a spread with no finite local bound`,
      )
    }
    const reason = isTupleLikeDeclaration(declaration)
      ? "tuple-like-collection"
      : "local-const-array"
    return bounded(
      textOf(identifier),
      unwrappedInitializer.elements.length,
      reason,
    )
  }

  const tupleLength = tupleLengthOf(declaration)
  if (tupleLength !== undefined) {
    return bounded(textOf(identifier), tupleLength, "tuple-like-collection")
  }

  if (unwrappedInitializer !== undefined && isIdentifier(unwrappedInitializer)) {
    const aliased = inferIdentifierCollectionBound(unwrappedInitializer, nextSeen)
    return aliased.state === "bounded"
      ? { ...aliased, boundExpression: textOf(identifier) }
      : unresolved(textOf(identifier), aliased.inferenceStoppedReason)
  }

  return unresolved(
    textOf(identifier),
    `No finite local bound was found for ${textOf(identifier)}`,
  )
}

const inferSliceBound = (
  sliceCall: CallExpression,
  collection: Node,
  seenDeclarations: Set<VariableDeclaration>,
): ConcurrencyBoundInference => {
  const [start, end] = sliceCall.arguments
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
    textOf(end),
    `Slice cap ${textOf(end)} is not a finite local constant`,
  )
}

const resolveWindowSize = (
  start: Node,
  end: Node,
): ResolvedNumber | undefined => {
  const unwrappedEnd = unwrapExpression(end)
  if (unwrappedEnd === undefined || !isBinaryExpression(unwrappedEnd)) return undefined
  if (unwrappedEnd.operatorToken.kind !== SyntaxKind.PlusToken) return undefined

  const left = unwrapExpression(unwrappedEnd.left)
  const right = unwrapExpression(unwrappedEnd.right)
  if (left === undefined || right === undefined) return undefined
  const startText = unwrapExpression(start) === undefined ? undefined : textOf(unwrapExpression(start)!)
  if (startText === undefined) return undefined

  if (textOf(left) === startText) {
    return resolveFiniteLocalInteger(right, new Set())
  }
  if (textOf(right) === startText) {
    return resolveFiniteLocalInteger(left, new Set())
  }
  return undefined
}

const inferLimiterBound = (
  callback: Node,
  limiterPattern: RegExp,
): ConcurrencyBoundInference | undefined => {
  const limiterCalls: Array<CallExpression> = []
  walkDescendants(callback, (node) => {
    if (!isCallExpression(node)) return
    if (!isOnCallbackResultPath(node, callback)) return
    if (!isLimiterInvocation(node, limiterPattern)) return
    limiterCalls.push(node)
  })

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

const isFunctionLike = (node: Node): boolean =>
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isArrowFunction(node) ||
  isMethodDeclaration(node)

const isOnCallbackResultPath = (call: CallExpression, callback: Node): boolean => {
  let current = call.parent
  let returnsFromCallback = false
  while (current !== undefined && current !== callback) {
    if (isFunctionLike(current)) return false
    if (isReturnStatement(current)) returnsFromCallback = true
    current = current.parent
  }
  if (current !== callback) return false
  if (returnsFromCallback) return true
  if (isArrowFunction(callback)) {
    return !isBlock(callback.body)
  }
  return false
}

const limiterInvocationName = (call: CallExpression): string => {
  const expression = call.expression
  if (isIdentifier(expression)) return textOf(expression)
  if (isPropertyAccessExpression(expression)) return textOf(expression.name)
  if (isCallExpression(expression)) return textOf(expression.expression)
  return textOf(expression)
}

const resolveLimiterInvocation = (
  invocation: CallExpression,
  limiterPattern: RegExp,
): ResolvedConcurrencyBound | undefined => {
  const expression = invocation.expression
  if (isCallExpression(expression)) {
    return resolveLimiterFactoryBound(expression, limiterPattern)
  }
  if (!isIdentifier(expression)) return undefined

  const declaration = localVariableDeclaration(expression)
  if (declaration === undefined || !isConstDeclaration(declaration)) return undefined
  const initializer = unwrapExpression(declaration.initializer)
  if (initializer === undefined || !isCallExpression(initializer)) return undefined
  return resolveLimiterFactoryBound(initializer, limiterPattern)
}

const resolveLimiterFactoryBound = (
  factory: CallExpression,
  limiterPattern: RegExp,
): ResolvedConcurrencyBound | undefined => {
  if (!limiterPattern.test(limiterInvocationName(factory))) return undefined
  const size = resolveFiniteLocalInteger(factory.arguments[0], new Set())
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

  if (isNumericLiteral(unwrapped)) {
    const value = Number(unwrapped.text)
    return isFiniteNonNegativeInteger(value)
      ? { expression: textOf(unwrapped), value }
      : undefined
  }
  if (!isIdentifier(unwrapped)) return undefined

  const declaration = localVariableDeclaration(unwrapped)
  if (
    declaration === undefined ||
    !isConstDeclaration(declaration) ||
    seenDeclarations.has(declaration)
  ) {
    return undefined
  }
  const resolved = resolveFiniteLocalInteger(
    declaration.initializer,
    new Set(seenDeclarations).add(declaration),
  )
  return resolved === undefined
    ? undefined
    : { expression: textOf(unwrapped), value: resolved.value }
}

const localVariableDeclaration = (identifier: Identifier): VariableDeclaration | undefined => {
  const name = identifier.text
  let current: Node | undefined = identifier.parent
  while (current !== undefined) {
    let found: VariableDeclaration | undefined
    const visit = (node: Node): void => {
      if (found !== undefined) return
      if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) {
        found = node
        return
      }
      node.forEachChild(visit)
    }
    current.forEachChild(visit)
    if (found !== undefined) return found
    current = current.parent
  }
  return undefined
}

const isConstDeclaration = (declaration: VariableDeclaration): boolean => {
  const parent = declaration.parent
  return isVariableDeclarationList(parent) &&
    ((parent.flags & 2) !== 0 || textOf(parent).startsWith("const "))
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
  rootName = isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name),
): string | undefined => {
  if (seenDeclarations.has(declaration)) return undefined
  const name = declaration.name
  if (!isIdentifier(name)) {
    return `Iterable ${rootName} uses a binding shape with no stable local upper bound`
  }
  const nextSeen = new Set(seenDeclarations).add(declaration)
  const sourceFile = declaration.getSourceFile()
  const references: Array<Identifier> = []
  walkDescendants(sourceFile, (node) => {
    if (isIdentifier(node) && node.text === name.text && node !== name) {
      references.push(node)
    }
  })

  for (const reference of references) {
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
  if (!isIdentifier(reference)) {
    return `Iterable ${rootName} has a reference shape with no stable local upper bound`
  }

  const expression = transparentExpressionParent(reference)
  const member = expression.parent
  if (isPropertyAccessExpression(member) && member.expression === expression) {
    return propertyInstabilityReason(member, rootName)
  }
  if (isElementAccessExpression(member) && member.expression === expression) {
    return elementInstabilityReason(member, rootName)
  }

  const alias = directAliasDeclaration(reference)
  if (alias !== undefined) {
    return collectionInstabilityReason(alias, seenDeclarations, rootName)
  }
  return escapedReferenceReason(expression, rootName)
}

const propertyInstabilityReason = (property: Node, rootName: string): string | undefined => {
  if (!isPropertyAccessExpression(property)) return undefined
  const propertyName = textOf(property.name)
  const call = property.parent
  if (
    CARDINALITY_MUTATORS.has(propertyName) &&
    isCallExpression(call) &&
    call.expression === property
  ) {
    return `Iterable ${rootName} has a cardinality-changing ${propertyName} mutation`
  }
  return propertyName === "length" && isWriteTarget(property)
    ? `Iterable ${rootName} has a length write that can change its upper bound`
    : undefined
}

const elementInstabilityReason = (element: Node, rootName: string): string | undefined => {
  if (!isElementAccessExpression(element)) return undefined
  if (isWriteTarget(element)) {
    return `Iterable ${rootName} has an element write that can change its upper bound`
  }
  const call = element.parent
  return isCallExpression(call) && call.expression === element
    ? `Iterable ${rootName} has a computed method call with no stable cardinality proof`
    : undefined
}

const escapedReferenceReason = (expression: Node, rootName: string): string | undefined => {
  const parent = expression.parent
  if (
    isCallExpression(parent) &&
    [...parent.arguments].some((argument) => transparentExpressionNode(argument) === expression)
  ) {
    return `Iterable ${rootName} escapes local cardinality analysis through a function call`
  }
  if (isReturnStatement(parent)) {
    return `Iterable ${rootName} escapes local cardinality analysis through a return`
  }
  if (
    isBinaryExpression(parent) &&
    parent.right === expression &&
    ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)
  ) {
    return `Iterable ${rootName} escapes local cardinality analysis through an assignment`
  }
  return undefined
}

const directAliasDeclaration = (reference: Identifier): VariableDeclaration | undefined => {
  const expression = transparentExpressionParent(reference)
  const parent = expression.parent
  if (
    isVariableDeclaration(parent) &&
    transparentExpressionNode(parent.initializer) === expression
  ) {
    return parent
  }
  if (
    isBinaryExpression(parent) &&
    parent.operatorToken.kind === SyntaxKind.EqualsToken &&
    transparentExpressionNode(parent.right) === expression
  ) {
    const left = transparentExpressionNode(parent.left)
    return left !== undefined && isIdentifier(left) ? localVariableDeclaration(left) : undefined
  }
  return undefined
}

const isWriteTarget = (node: Node): boolean => {
  const expression = transparentExpressionParent(node)
  const parent = expression.parent
  if (
    isBinaryExpression(parent) &&
    parent.left === expression &&
    ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)
  ) {
    return true
  }
  if (isPrefixUnaryExpression(parent) || isPostfixUnaryExpression(parent)) {
    return parent.operator === SyntaxKind.PlusPlusToken || parent.operator === SyntaxKind.MinusMinusToken
  }
  return false
}

const transparentExpressionParent = (node: Node): Node => {
  let current = node
  while (true) {
    const parent = current.parent
    if (
      parent !== undefined &&
      (
        isAsExpression(parent) ||
        isSatisfiesExpression(parent) ||
        isTypeAssertion(parent) ||
        isParenthesizedExpression(parent) ||
        isNonNullExpression(parent)
      ) &&
      parent.expression === current
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
  hasConstAssertion(declaration.initializer) || tupleLengthOf(declaration) !== undefined

const hasConstAssertion = (node: Node | undefined): boolean => {
  let current = node
  while (current !== undefined) {
    if (isAsExpression(current) && current.type !== undefined && textOf(current.type) === "const") return true
    if (
      isAsExpression(current) ||
      isSatisfiesExpression(current) ||
      isTypeAssertion(current) ||
      isParenthesizedExpression(current)
    ) {
      current = current.expression
      continue
    }
    return false
  }
  return false
}

const tupleLengthOf = (declaration: VariableDeclaration): number | undefined => {
  const typeText = declaration.type === undefined ? undefined : textOf(declaration.type)
  if (typeText === undefined || !typeText.startsWith("[") || typeText.includes("...")) return undefined
  const inner = typeText.slice(1, typeText.lastIndexOf("]"))
  if (inner.trim().length === 0) return 0
  return inner.split(",").length
}

const unwrapExpression = (node: Node | undefined): Node | undefined => {
  let current = node
  while (current !== undefined) {
    if (
      isAsExpression(current) ||
      isSatisfiesExpression(current) ||
      isTypeAssertion(current) ||
      isParenthesizedExpression(current) ||
      isNonNullExpression(current)
    ) {
      current = current.expression
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
