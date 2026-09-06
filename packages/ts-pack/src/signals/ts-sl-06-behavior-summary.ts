import { firstAncestor, textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isMethodDeclaration,
  isNewExpression,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParameter,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isRegularExpressionLiteral,
  isReturnStatement,
  isThrowStatement,
  isTypeAssertion,
  isVariableDeclaration,
  type ArrowFunction,
  type BinaryExpression,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type NewExpression,
  type Node,
  type VariableDeclaration,
} from "../tsgo-api.js"

export type ClaimKind =
  | "parse"
  | "assert"
  | "ensure"
  | "validate"
  | "narrow"
  | "presence-check"

export type ClaimFunctionNode =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression

type BehaviorCategory = "runtime-check" | "parse" | "state" | "reject" | "delegation"

interface BehaviorEvidence {
  readonly category: BehaviorCategory
  readonly label: string
}

type AddEvidence = (category: BehaviorCategory, label: string) => void

export interface ClaimBehaviorSummary {
  readonly supportsClaim: boolean
  readonly claimedGuarantee: string
  readonly supportingBehavior: ReadonlyArray<string>
  readonly observedBehavior: ReadonlyArray<string>
  readonly missingBehavior: ReadonlyArray<string>
}

const VALIDATOR_NAMES = /^(?:parse|decode|validate|assert)[A-Z0-9_$]?/u
const EXTERNAL_VALIDATOR_MEMBERS = new Set(["parse", "safeParse", "decode", "validate", "assert"])
const PREDICATE_MEMBERS = new Set([
  "startsWith",
  "endsWith",
  "includes",
  "has",
  "isRight",
  "isLeft",
  "isSome",
  "isNone",
  "isOk",
  "isErr",
  "isSuccess",
  "isFailure",
])
const COMPARISON_OPERATORS = new Set([
  "===",
  "!==",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "instanceof",
])
const CLAIM_GUARANTEES: Readonly<Record<ClaimKind, string>> = {
  parse: "runtime parsing or sanitization",
  assert: "runtime assertion",
  ensure: "state establishment or idempotent enforcement",
  validate: "runtime validation",
  narrow: "runtime type narrowing",
  "presence-check": "runtime presence checking",
}

export const summarizeClaimBehavior = (
  fn: ClaimFunctionNode,
  claimKind: ClaimKind,
  seen: ReadonlySet<ClaimFunctionNode> = new Set(),
): ClaimBehaviorSummary => {
  if (seen.has(fn)) {
    return emptySummary(claimKind, ["cyclic validator delegation"])
  }

  const nextSeen = new Set(seen).add(fn)
  const evidence = collectLocalEvidence(fn, nextSeen)
  const observedBehavior = collectObservedBehavior(fn)
  const onlySuccessfulOutcomes = hasOnlySuccessfulOutcomes(fn)
  const supportsClaim = !onlySuccessfulOutcomes && evidenceSatisfiesClaim(evidence, claimKind)

  return {
    supportsClaim,
    claimedGuarantee: claimGuaranteeFor(claimKind),
    supportingBehavior: stableLabels(evidence),
    observedBehavior,
    missingBehavior: supportsClaim
      ? []
      : [onlySuccessfulOutcomes
        ? "a non-success outcome tied to the claimed check"
        : missingBehaviorFor(claimKind, evidence)],
  }
}

export const claimKindOf = (name: string): ClaimKind => {
  const lower = name.toLowerCase()
  if (lower.startsWith("parse")) return "parse"
  if (lower.startsWith("assert")) return "assert"
  if (lower.startsWith("ensure")) return "ensure"
  if (lower.startsWith("validate")) return "validate"
  if (lower.startsWith("is")) return "narrow"
  if (lower.startsWith("has")) return "presence-check"
  return "validate"
}

const collectLocalEvidence = (
  fn: ClaimFunctionNode,
  seen: ReadonlySet<ClaimFunctionNode>,
): ReadonlyArray<BehaviorEvidence> => {
  const body = functionBodyNode(fn)
  if (body === undefined) return []
  const evidence = new Map<string, BehaviorEvidence>()
  const add = (category: BehaviorCategory, label: string): void => {
    evidence.set(`${category}:${label}`, { category, label })
  }

  collectBinaryEvidence(body, fn, add)
  collectCallEvidence(body, fn, seen, add)
  collectConstructionEvidence(body, fn, add)
  collectRejectionEvidence(body, fn, evidence.values(), add)

  return [...evidence.values()]
}

const collectBinaryEvidence = (
  body: Node,
  fn: ClaimFunctionNode,
  add: AddEvidence,
): void => {
  for (const binary of collectKind(body, isBinaryExpression)) {
    if (!isExecutedBy(binary, fn) || !isBehaviorallyUsed(binary, fn)) continue
    const operator = operatorText(binary)
    if (operator === "&&" && hasFiniteRangeConjunction(binary)) {
      add("runtime-check", "finite positive/range check")
      continue
    }
    if (COMPARISON_OPERATORS.has(operator)) {
      add("runtime-check", comparisonLabel(binary))
    }
  }
}

const collectCallEvidence = (
  body: Node,
  fn: ClaimFunctionNode,
  seen: ReadonlySet<ClaimFunctionNode>,
  add: AddEvidence,
): void => {
  for (const call of collectKind(body, isCallExpression)) {
    if (!isExecutedBy(call, fn)) continue
    const used = isBehaviorallyUsed(call, fn)
    if (used) collectUsedCallEvidence(call, add)
    collectStateCallEvidence(call, add)
    collectDelegationEvidence(call, fn, used, seen, add)
  }
}

const collectUsedCallEvidence = (call: CallExpression, add: AddEvidence): void => {
  const expression = call.expression
  const member = isPropertyAccessExpression(expression) ? propertyName(expression) : undefined
  const callee = textOf(expression)

  if (isNamedCall(call, "existsSync")) add("runtime-check", "filesystem existence check")
  if (isRegexTestCall(call)) add("runtime-check", "regular-expression test")
  if (isTruthyRegexMatchCall(call)) add("runtime-check", "truthy regular-expression match")
  if (isNamedCall(call, "Array.isArray")) add("runtime-check", "runtime array check")
  if (isNamedCall(call, "Number.isFinite")) add("runtime-check", "finite-number check")
  if (isNamedCall(call, "Number.isNaN")) add("runtime-check", "numeric validity check")
  if (member !== undefined && PREDICATE_MEMBERS.has(member)) {
    add("runtime-check", `${member} predicate`)
  }
  if (isBuiltInParseCall(callee)) add("parse", `${callee} conversion`)
  if (isRegexReplacement(call)) add("parse", "regular-expression replacement sanitization")
}

const collectStateCallEvidence = (call: CallExpression, add: AddEvidence): void => {
  const expression = call.expression
  const member = isPropertyAccessExpression(expression) ? propertyName(expression) : undefined
  const callee = textOf(expression)
  if (isEnsureMutation(call)) add("state", `${member ?? callee} state mutation`)
  if (hasConflictTolerantSqlArgument(call)) {
    add("state", "conflict-tolerant database write")
  }
}

const collectDelegationEvidence = (
  call: CallExpression,
  fn: ClaimFunctionNode,
  used: boolean,
  seen: ReadonlySet<ClaimFunctionNode>,
  add: AddEvidence,
): void => {
  if (
    (!used && !isDirectAssertionEffect(call, fn)) ||
    !isRecognizedValidatorCall(call) ||
    !callReferencesOwnerInput(call, fn)
  ) return
  const target = resolveLocalFunction(call, fn)
  if (target !== undefined) {
    const delegatedKind = claimKindOf(calleeSegment(call))
    const delegated = summarizeClaimBehavior(target, delegatedKind, seen)
    if (delegated.supportsClaim) {
      add("delegation", `checked local ${calleeSegment(call)} delegation`)
    }
    return
  }
  if (!isRecognizedExternalValidatorMember(call)) return
  const expression = call.expression
  if (isPropertyAccessExpression(expression)) {
    add("delegation", `direct ${propertyName(expression)} validator delegation`)
  }
}

const collectConstructionEvidence = (
  body: Node,
  fn: ClaimFunctionNode,
  add: AddEvidence,
): void => {
  for (const construct of collectKind(body, isNewExpression)) {
    if (!isExecutedBy(construct, fn) || !isBehaviorallyUsed(construct, fn)) continue
    const target = textOf(construct.expression)
    if (target === "Date" || target === "URL") {
      add("parse", `new ${target} conversion`)
    }
  }
}

const collectRejectionEvidence = (
  body: Node,
  fn: ClaimFunctionNode,
  evidence: Iterable<BehaviorEvidence>,
  add: AddEvidence,
): void => {
  const throws = collectKind(body, isThrowStatement)
    .filter((statement) => isExecutedBy(statement, fn))
  if (throws.length > 0 && evidenceHasCategory(evidence, "runtime-check")) {
    add("reject", "guard-backed rejecting throw")
  }
}

const collectObservedBehavior = (fn: ClaimFunctionNode): ReadonlyArray<string> => {
  const body = functionBodyNode(fn)
  if (body === undefined) return []
  const observed = new Set<string>()
  const returnTypeText = ""

  for (const cast of [
    ...nodesIncludingBody(body, SyntaxKind.AsExpression),
    ...nodesIncludingBody(body, SyntaxKind.TypeAssertionExpression),
  ]) {
    if (isExecutedBy(cast, fn)) observed.add("type cast only")
  }
  for (const nonNull of nodesIncludingBody(body, SyntaxKind.NonNullExpression)) {
    if (isExecutedBy(nonNull, fn)) observed.add("non-null assertion only")
  }
  if (hasOnlySuccessfulOutcomes(fn)) observed.add("unconditional success")
  if (/\basserts\b|\sis\s/u.test(returnTypeText)) {
    observed.add("declared narrowing signature")
  }

  return [...observed]
}

const evidenceSatisfiesClaim = (
  evidence: ReadonlyArray<BehaviorEvidence>,
  claimKind: ClaimKind,
): boolean => {
  const has = (category: BehaviorCategory): boolean =>
    evidence.some((item) => item.category === category)

  switch (claimKind) {
    case "assert":
      return has("delegation") || (has("runtime-check") && has("reject"))
    case "ensure":
      return has("state") || (has("runtime-check") && has("reject"))
    case "parse":
      return has("parse") || has("runtime-check") || has("delegation")
    case "validate":
    case "narrow":
    case "presence-check":
      return has("runtime-check") || has("parse") || has("delegation")
  }
}

const claimGuaranteeFor = (claimKind: ClaimKind): string => CLAIM_GUARANTEES[claimKind]

const missingBehaviorFor = (
  claimKind: ClaimKind,
  evidence: ReadonlyArray<BehaviorEvidence>,
): string => {
  switch (claimKind) {
    case "parse":
      return "returned parsing, sanitization, or checked-validator behavior"
    case "assert":
      return evidence.some((item) => item.category === "runtime-check")
        ? "a guard-backed rejecting throw"
        : "a runtime guard plus rejecting throw, or checked assertion delegation"
    case "ensure":
      return "an idempotent state mutation or guard-backed rejection"
    case "validate":
      return "a returned or control-flow runtime check"
    case "narrow":
      return "a returned or control-flow narrowing check"
    case "presence-check":
      return "a returned or control-flow presence check"
  }
}

const emptySummary = (
  claimKind: ClaimKind,
  observedBehavior: ReadonlyArray<string>,
): ClaimBehaviorSummary => ({
  supportsClaim: false,
  claimedGuarantee: claimGuaranteeFor(claimKind),
  supportingBehavior: [],
  observedBehavior,
  missingBehavior: [missingBehaviorFor(claimKind, [])],
})

const stableLabels = (evidence: ReadonlyArray<BehaviorEvidence>): ReadonlyArray<string> =>
  [...new Set(evidence.map((item) => item.label))].sort()

const evidenceHasCategory = (
  evidence: Iterable<BehaviorEvidence>,
  category: BehaviorCategory,
): boolean => Array.from(evidence).some((item) => item.category === category)

const nodesIncludingBody = (
  body: Node,
  kind: SyntaxKind,
): ReadonlyArray<Node> => collectKind(body, (node) => node.kind === kind)

const isExecutedBy = (node: Node, fn: ClaimFunctionNode): boolean => {
  if (node === fn) return true
  let current = node.parent
  while (current !== undefined) {
    if (isClaimFunctionNode(current)) return current === fn
    current = current.parent
  }
  return false
}

const isBehaviorallyUsed = (
  node: Node,
  fn: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration> = new Set(),
): boolean => {
  let current: Node = node
  let parent = current.parent

  while (parent !== undefined) {
    if (parent === fn) {
      return isArrowFunction(fn) && functionBodyNode(fn) === current && !isBlock(current)
    }
    if (isClaimFunctionNode(parent)) return false
    if (isReturnStatement(parent) || isThrowStatement(parent)) return true
    if (isIfStatement(parent) && containsNode(parent.expression, node)) {
      return conditionalStatementHasObservableEffect(parent, fn)
    }
    if (isVariableDeclaration(parent) && containsNode(parent.initializer, node)) {
      return variableFeedsBehavior(parent, fn, seenVariables)
    }
    if (isExpressionStatement(parent)) return false
    current = parent
    parent = current.parent
  }

  return false
}

const variableFeedsBehavior = (
  declaration: VariableDeclaration,
  fn: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration>,
): boolean => {
  if (seenVariables.has(declaration)) return false
  const name = declaration.name
  if (!isIdentifier(name)) return false
  const nextSeen = new Set(seenVariables).add(declaration)
  return collectKind(fn.getSourceFile(), isIdentifier).some((reference) =>
    reference.text === name.text &&
    reference !== name &&
    isExecutedBy(reference, fn) &&
    isBehaviorallyUsed(reference, fn, nextSeen)
  )
}

const conditionalStatementHasObservableEffect = (
  statement: Node,
  fn: ClaimFunctionNode,
): boolean =>
  collectKind(statement, (descendant) => isReturnStatement(descendant) || isThrowStatement(descendant))
    .some((descendant) => isExecutedBy(descendant, fn))

const containsNode = (container: Node | undefined, node: Node): boolean =>
  container !== undefined && (container === node || isAncestor(container, node))

const hasFiniteRangeConjunction = (binary: import("../tsgo-api.js").BinaryExpression): boolean => {
  const operands = flattenConjunction(binary)
  return operands.some((operand) =>
    isCallExpression(operand) && isNamedCall(operand, "Number.isFinite")
  ) && operands.some(isRangeComparison)
}

const flattenConjunction = (node: Node): ReadonlyArray<Node> => {
  if (isBinaryExpression(node) && operatorText(node) === "&&") {
    return [...flattenConjunction(node.left), ...flattenConjunction(node.right)]
  }
  return [node]
}

const isRangeComparison = (node: Node): boolean =>
  isBinaryExpression(node) && ["<", "<=", ">", ">="].includes(operatorText(node))

const comparisonLabel = (binary: import("../tsgo-api.js").BinaryExpression): string => {
  const operator = operatorText(binary)
  if (operator === "instanceof") return "instanceof check"
  if (operator === "in") return "property-presence check"
  if (/\b(?:length|size)\b/u.test(textOf(binary))) return "collection cardinality check"
  return "runtime comparison"
}

const isRegexTestCall = (call: CallExpression): boolean => {
  const expression = call.expression
  return isPropertyAccessExpression(expression) &&
    propertyName(expression) === "test" &&
    isRegexLike(expression.expression)
}

const isTruthyRegexMatchCall = (call: CallExpression): boolean => {
  const expression = call.expression
  const pattern = call.arguments[0]
  return isPropertyAccessExpression(expression) &&
    propertyName(expression) === "match" &&
    pattern !== undefined &&
    isRegexLike(pattern)
}

const isRegexReplacement = (call: CallExpression): boolean => {
  const expression = call.expression
  const [pattern, replacement] = call.arguments
  return isPropertyAccessExpression(expression) &&
    (propertyName(expression) === "replace" || propertyName(expression) === "replaceAll") &&
    pattern !== undefined &&
    replacement !== undefined &&
    isRegexLike(pattern)
}

const isRegexLike = (node: Node, seen: ReadonlySet<VariableDeclaration> = new Set()): boolean => {
  if (isRegularExpressionLiteral(node)) return true
  if (isNewExpression(node) && textOf(node.expression) === "RegExp") return true
  if (isParenthesizedExpression(node)) return isRegexLike(node.expression, seen)
  if (!isIdentifier(node)) return false
  const declaration = localVariableDeclaration(node)
  if (declaration === undefined || seen.has(declaration)) return false
  const initializer = declaration.initializer
  return initializer !== undefined && isRegexLike(initializer, new Set(seen).add(declaration))
}

const isBuiltInParseCall = (callee: string): boolean =>
  [
    "JSON.parse",
    "Number",
    "String",
    "Boolean",
    "parseInt",
    "parseFloat",
    "Date.parse",
    "URL.parse",
  ].includes(callee)

const isEnsureMutation = (call: CallExpression): boolean => {
  const expression = call.expression
  const name = isPropertyAccessExpression(expression) ? propertyName(expression) : textOf(expression)
  return ["mkdir", "writeFile", "rename", "rm"].includes(name)
}

const hasConflictTolerantSqlArgument = (call: CallExpression): boolean =>
  call.arguments.some((argument) => {
    const text = textOf(argument)
    return /\binsert\s+or\s+ignore\b/iu.test(text) ||
      /\bon\s+conflict\b[\s\S]{0,120}?\bdo\s+nothing\b/iu.test(text)
  })

const isRecognizedValidatorCall = (call: CallExpression): boolean => {
  const expression = call.expression
  if (isPropertyAccessExpression(expression)) {
    return EXTERNAL_VALIDATOR_MEMBERS.has(propertyName(expression)) ||
      VALIDATOR_NAMES.test(propertyName(expression))
  }
  return isIdentifier(expression) && VALIDATOR_NAMES.test(textOf(expression))
}

const isRecognizedExternalValidatorMember = (call: CallExpression): boolean => {
  const expression = call.expression
  return isPropertyAccessExpression(expression) &&
    EXTERNAL_VALIDATOR_MEMBERS.has(propertyName(expression))
}

const isDirectAssertionEffect = (call: CallExpression, fn: ClaimFunctionNode): boolean => {
  if (!calleeSegment(call).startsWith("assert")) return false
  const statement = firstAncestor(call, isExpressionStatement)
  return statement !== undefined && isExecutedBy(statement, fn)
}

const resolveLocalFunction = (
  call: CallExpression,
  owner: ClaimFunctionNode,
): ClaimFunctionNode | undefined => {
  const name = calleeSegment(call)
  const sourceFile = owner.getSourceFile()
  for (const declaration of collectKind(sourceFile, isFunctionDeclaration)) {
    if (declaration.name !== undefined && isIdentifier(declaration.name) && declaration.name.text === name) {
      return declaration
    }
  }
  for (const declaration of collectKind(sourceFile, isVariableDeclaration)) {
    if (!isIdentifier(declaration.name) || declaration.name.text !== name) continue
    const initializer = declaration.initializer
    if (initializer !== undefined && isClaimFunctionNode(initializer)) return initializer
  }
  return undefined
}

const localVariableDeclaration = (identifier: import("../tsgo-api.js").Identifier): VariableDeclaration | undefined => {
  const sourceFile = identifier.getSourceFile()
  return collectKind(sourceFile, isVariableDeclaration).find((declaration) =>
    isIdentifier(declaration.name) && declaration.name.text === identifier.text
  )
}

const calleeSegment = (call: CallExpression): string => {
  const expression = call.expression
  return isPropertyAccessExpression(expression) ? propertyName(expression) : textOf(expression)
}

const isNamedCall = (call: CallExpression, name: string): boolean =>
  textOf(call.expression) === name

const callReferencesOwnerInput = (call: CallExpression, owner: ClaimFunctionNode): boolean =>
  call.arguments.some((argument) => nodeReferencesOwnerInput(argument, owner, new Set()))

const nodeReferencesOwnerInput = (
  node: Node,
  owner: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration>,
): boolean => {
  const identifiers = [
    ...(isIdentifier(node) ? [node] : []),
    ...collectKind(node, isIdentifier),
  ]
  return identifiers.some((identifier) => {
    const declarations = identifierDeclarations(identifier)
    if (declarations.some((declaration) =>
      isParameter(declaration) && nearestClaimFunction(declaration) === owner
    )) return true

    const variable = declarations.find((declaration): declaration is VariableDeclaration =>
      isVariableDeclaration(declaration) && declaration.getSourceFile() === owner.getSourceFile()
    )
    if (variable === undefined || seenVariables.has(variable)) return false
    const initializer = variable.initializer
    return initializer !== undefined && nodeReferencesOwnerInput(
      initializer,
      owner,
      new Set(seenVariables).add(variable),
    )
  })
}

const identifierDeclarations = (identifier: import("../tsgo-api.js").Identifier): ReadonlyArray<Node> => {
  const sourceFile = identifier.getSourceFile()
  const name = identifier.text
  const declarations: Array<Node> = []
  walkDescendants(sourceFile, (node) => {
    if (isParameter(node) && isIdentifier(node.name) && node.name.text === name) declarations.push(node)
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) declarations.push(node)
    if (isFunctionDeclaration(node) && node.name !== undefined && isIdentifier(node.name) && node.name.text === name) {
      declarations.push(node)
    }
  })
  return declarations
}

const nearestClaimFunction = (node: Node): ClaimFunctionNode | undefined =>
  firstClaimFunction(node)

const hasOnlySuccessfulOutcomes = (fn: ClaimFunctionNode): boolean => {
  const body = functionBodyNode(fn)
  if (body === undefined) return false
  if (!isBlock(body)) return isSuccessfulExpression(body)
  if (collectKind(body, isThrowStatement).some((node) => isExecutedBy(node, fn))) {
    return false
  }
  const returns = collectKind(body, isReturnStatement)
    .filter((statement) => isExecutedBy(statement, fn))
  const terminal = body.statements.at(-1)
  return returns.length > 0 &&
    returns.every((statement) => isSuccessfulExpression(statement.expression)) &&
    terminal !== undefined &&
    statementAlwaysSucceeds(terminal)
}

const statementAlwaysSucceeds = (statement: Node): boolean => {
  if (isReturnStatement(statement)) return isSuccessfulExpression(statement.expression)
  if (isBlock(statement)) {
    const terminal = statement.statements.at(-1)
    return terminal !== undefined && statementAlwaysSucceeds(terminal)
  }
  if (!isIfStatement(statement)) return false
  const alternate = statement.elseStatement
  return alternate !== undefined &&
    statementAlwaysSucceeds(statement.thenStatement) &&
    statementAlwaysSucceeds(alternate)
}

const isSuccessfulExpression = (expression: Node | undefined): boolean => {
  if (expression === undefined) return false
  if (isTrueLiteral(expression)) return true
  if (isParenthesizedExpression(expression)) return isSuccessfulExpression(expression.expression)
  if (isConditionalExpression(expression)) {
    return isSuccessfulExpression(expression.whenTrue) &&
      isSuccessfulExpression(expression.whenFalse)
  }
  if (isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) =>
      isPropertyAssignment(property) &&
      ["success", "ok"].includes(propertyNameText(property)) &&
      isTrueLiteral(property.initializer)
    )
  }
  if (!isCallExpression(expression)) return false
  const name = calleeSegment(expression).toLowerCase()
  return ["succeed", "success", "ok", "right"].includes(name)
}

const isClaimFunctionNode = (node: Node): node is ClaimFunctionNode =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node)

const functionBodyNode = (fn: ClaimFunctionNode): Node | undefined =>
  "body" in fn ? fn.body : undefined

const propertyName = (expression: import("../tsgo-api.js").PropertyAccessExpression): string =>
  isIdentifier(expression.name) ? expression.name.text : textOf(expression.name)

const propertyNameText = (property: import("../tsgo-api.js").PropertyAssignment): string =>
  isIdentifier(property.name) ? property.name.text : textOf(property.name)

const operatorText = (node: import("../tsgo-api.js").BinaryExpression): string =>
  textOf(node.operatorToken)

const isTrueLiteral = (node: Node | undefined): boolean =>
  node !== undefined && node.kind === SyntaxKind.TrueKeyword

const collectKind = <T extends Node>(
  root: Node,
  predicate: ((node: Node) => node is T) | ((node: Node) => boolean),
): Array<T> => {
  const results: Array<T> = []
  const visit = (node: Node): void => {
    if ((predicate as (node: Node) => boolean)(node)) results.push(node as T)
    node.forEachChild(visit)
  }
  visit(root)
  return results
}

const isAncestor = (container: Node, node: Node): boolean => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (current === container) return true
    current = current.parent
  }
  return false
}

const firstClaimFunction = (node: Node): ClaimFunctionNode | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (isClaimFunctionNode(current)) return current
    current = current.parent
  }
  return undefined
}
