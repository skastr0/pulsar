import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
  type VariableDeclaration,
} from "ts-morph"

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
  const body = fn.getBody()
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
  for (const binary of nodesIncludingBody(body, SyntaxKind.BinaryExpression)) {
    if (!isExecutedBy(binary, fn) || !isBehaviorallyUsed(binary, fn)) continue
    const operator = binary.getOperatorToken().getText()
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
  for (const call of nodesIncludingBody(body, SyntaxKind.CallExpression)) {
    if (!isExecutedBy(call, fn)) continue
    const used = isBehaviorallyUsed(call, fn)
    if (used) collectUsedCallEvidence(call, add)
    collectStateCallEvidence(call, add)
    collectDelegationEvidence(call, fn, used, seen, add)
  }
}

const collectUsedCallEvidence = (call: CallExpression, add: AddEvidence): void => {
  const expression = call.getExpression()
  const member = Node.isPropertyAccessExpression(expression) ? expression.getName() : undefined
  const callee = expression.getText()

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
  const expression = call.getExpression()
  const member = Node.isPropertyAccessExpression(expression) ? expression.getName() : undefined
  const callee = expression.getText()
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
  const expression = call.getExpression()
  if (Node.isPropertyAccessExpression(expression)) {
    add("delegation", `direct ${expression.getName()} validator delegation`)
  }
}

const collectConstructionEvidence = (
  body: Node,
  fn: ClaimFunctionNode,
  add: AddEvidence,
): void => {
  for (const construct of nodesIncludingBody(body, SyntaxKind.NewExpression)) {
    if (!isExecutedBy(construct, fn) || !isBehaviorallyUsed(construct, fn)) continue
    const target = construct.getExpression().getText()
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
  const throws = body.getDescendantsOfKind(SyntaxKind.ThrowStatement)
    .filter((statement) => isExecutedBy(statement, fn))
  if (throws.length > 0 && evidenceHasCategory(evidence, "runtime-check")) {
    add("reject", "guard-backed rejecting throw")
  }
}

const collectObservedBehavior = (fn: ClaimFunctionNode): ReadonlyArray<string> => {
  const body = fn.getBody()
  if (body === undefined) return []
  const observed = new Set<string>()
  const returnTypeText = fn.getReturnType().getText(fn)

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

const nodesIncludingBody = <Kind extends SyntaxKind>(
  body: Node,
  kind: Kind,
): ReadonlyArray<import("ts-morph").KindToNodeMappings[Kind]> => {
  const descendants = body.getDescendantsOfKind(kind)
  return body.getKind() === kind
    ? [body as import("ts-morph").KindToNodeMappings[Kind], ...descendants]
    : descendants
}

const isExecutedBy = (node: Node, fn: ClaimFunctionNode): boolean => {
  if (node === fn) return true
  let current = node.getParent()
  while (current !== undefined) {
    if (isClaimFunctionNode(current)) return current === fn
    current = current.getParent()
  }
  return false
}

const isBehaviorallyUsed = (
  node: Node,
  fn: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration> = new Set(),
): boolean => {
  let current: Node = node
  let parent = current.getParent()

  while (parent !== undefined) {
    if (parent === fn) {
      return Node.isArrowFunction(fn) && fn.getBody() === current && !Node.isBlock(current)
    }
    if (isClaimFunctionNode(parent)) return false
    if (Node.isReturnStatement(parent) || Node.isThrowStatement(parent)) return true
    if (Node.isIfStatement(parent) && containsNode(parent.getExpression(), node)) {
      return conditionalStatementHasObservableEffect(parent, fn)
    }
    if (Node.isVariableDeclaration(parent) && containsNode(parent.getInitializer(), node)) {
      return variableFeedsBehavior(parent, fn, seenVariables)
    }
    if (Node.isExpressionStatement(parent)) return false
    current = parent
    parent = current.getParent()
  }

  return false
}

const variableFeedsBehavior = (
  declaration: VariableDeclaration,
  fn: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration>,
): boolean => {
  if (seenVariables.has(declaration)) return false
  const name = declaration.getNameNode()
  if (!Node.isIdentifier(name)) return false
  const nextSeen = new Set(seenVariables).add(declaration)
  try {
    return name.findReferencesAsNodes().some((reference) =>
      reference.getSourceFile() === fn.getSourceFile() &&
      isExecutedBy(reference, fn) &&
      isBehaviorallyUsed(reference, fn, nextSeen)
    )
  } catch {
    return false
  }
}

const conditionalStatementHasObservableEffect = (
  statement: import("ts-morph").IfStatement,
  fn: ClaimFunctionNode,
): boolean =>
  statement.getDescendants().some((descendant) =>
    isExecutedBy(descendant, fn) &&
    (Node.isReturnStatement(descendant) || Node.isThrowStatement(descendant))
  )

const containsNode = (container: Node | undefined, node: Node): boolean =>
  container !== undefined && (container === node || node.getAncestors().includes(container))

const hasFiniteRangeConjunction = (binary: import("ts-morph").BinaryExpression): boolean => {
  const operands = flattenConjunction(binary)
  return operands.some((operand) =>
    Node.isCallExpression(operand) && isNamedCall(operand, "Number.isFinite")
  ) && operands.some(isRangeComparison)
}

const flattenConjunction = (node: Node): ReadonlyArray<Node> => {
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === "&&") {
    return [...flattenConjunction(node.getLeft()), ...flattenConjunction(node.getRight())]
  }
  return [node]
}

const isRangeComparison = (node: Node): boolean =>
  Node.isBinaryExpression(node) && ["<", "<=", ">", ">="].includes(node.getOperatorToken().getText())

const comparisonLabel = (binary: import("ts-morph").BinaryExpression): string => {
  const operator = binary.getOperatorToken().getText()
  if (operator === "instanceof") return "instanceof check"
  if (operator === "in") return "property-presence check"
  if (/\b(?:length|size)\b/u.test(binary.getText())) return "collection cardinality check"
  return "runtime comparison"
}

const isRegexTestCall = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  return Node.isPropertyAccessExpression(expression) &&
    expression.getName() === "test" &&
    isRegexLike(expression.getExpression())
}

const isTruthyRegexMatchCall = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  const pattern = call.getArguments()[0]
  return Node.isPropertyAccessExpression(expression) &&
    expression.getName() === "match" &&
    pattern !== undefined &&
    isRegexLike(pattern)
}

const isRegexReplacement = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  const [pattern, replacement] = call.getArguments()
  return Node.isPropertyAccessExpression(expression) &&
    (expression.getName() === "replace" || expression.getName() === "replaceAll") &&
    pattern !== undefined &&
    replacement !== undefined &&
    isRegexLike(pattern)
}

const isRegexLike = (node: Node, seen: ReadonlySet<VariableDeclaration> = new Set()): boolean => {
  if (Node.isRegularExpressionLiteral(node)) return true
  if (Node.isNewExpression(node) && node.getExpression().getText() === "RegExp") return true
  if (Node.isParenthesizedExpression(node)) return isRegexLike(node.getExpression(), seen)
  if (!Node.isIdentifier(node)) return false
  const declaration = localVariableDeclaration(node)
  if (declaration === undefined || seen.has(declaration)) return false
  const initializer = declaration.getInitializer()
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
  const expression = call.getExpression()
  const name = Node.isPropertyAccessExpression(expression) ? expression.getName() : expression.getText()
  return ["mkdir", "writeFile", "rename", "rm"].includes(name)
}

const hasConflictTolerantSqlArgument = (call: CallExpression): boolean =>
  call.getArguments().some((argument) => {
    const text = argument.getText()
    return /\binsert\s+or\s+ignore\b/iu.test(text) ||
      /\bon\s+conflict\b[\s\S]{0,120}?\bdo\s+nothing\b/iu.test(text)
  })

const isRecognizedValidatorCall = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  if (Node.isPropertyAccessExpression(expression)) {
    return EXTERNAL_VALIDATOR_MEMBERS.has(expression.getName()) ||
      VALIDATOR_NAMES.test(expression.getName())
  }
  return Node.isIdentifier(expression) && VALIDATOR_NAMES.test(expression.getText())
}

const isRecognizedExternalValidatorMember = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  return Node.isPropertyAccessExpression(expression) &&
    EXTERNAL_VALIDATOR_MEMBERS.has(expression.getName())
}

const isDirectAssertionEffect = (call: CallExpression, fn: ClaimFunctionNode): boolean => {
  if (!calleeSegment(call).startsWith("assert")) return false
  const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
  return statement !== undefined && isExecutedBy(statement, fn)
}

const resolveLocalFunction = (
  call: CallExpression,
  owner: ClaimFunctionNode,
): ClaimFunctionNode | undefined => {
  let declarations: ReadonlyArray<Node>
  try {
    declarations = call.getExpression().getSymbol()?.getDeclarations() ?? []
  } catch {
    return undefined
  }

  for (const declaration of declarations) {
    if (declaration.getSourceFile() !== owner.getSourceFile()) continue
    if (isClaimFunctionNode(declaration)) return declaration
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer()
      if (initializer !== undefined && isClaimFunctionNode(initializer)) return initializer
    }
  }
  return undefined
}

const localVariableDeclaration = (identifier: import("ts-morph").Identifier): VariableDeclaration | undefined => {
  try {
    return identifier.getSymbol()?.getDeclarations().find((declaration): declaration is VariableDeclaration =>
      Node.isVariableDeclaration(declaration) &&
      declaration.getSourceFile() === identifier.getSourceFile()
    )
  } catch {
    return undefined
  }
}

const calleeSegment = (call: CallExpression): string => {
  const expression = call.getExpression()
  return Node.isPropertyAccessExpression(expression) ? expression.getName() : expression.getText()
}

const isNamedCall = (call: CallExpression, name: string): boolean =>
  call.getExpression().getText() === name

const callReferencesOwnerInput = (call: CallExpression, owner: ClaimFunctionNode): boolean =>
  call.getArguments().some((argument) => nodeReferencesOwnerInput(argument, owner, new Set()))

const nodeReferencesOwnerInput = (
  node: Node,
  owner: ClaimFunctionNode,
  seenVariables: ReadonlySet<VariableDeclaration>,
): boolean => {
  const identifiers = [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ]
  return identifiers.some((identifier) => {
    const declarations = identifierDeclarations(identifier)
    if (declarations.some((declaration) =>
      Node.isParameterDeclaration(declaration) && nearestClaimFunction(declaration) === owner
    )) return true

    const variable = declarations.find((declaration): declaration is VariableDeclaration =>
      Node.isVariableDeclaration(declaration) && declaration.getSourceFile() === owner.getSourceFile()
    )
    if (variable === undefined || seenVariables.has(variable)) return false
    const initializer = variable.getInitializer()
    return initializer !== undefined && nodeReferencesOwnerInput(
      initializer,
      owner,
      new Set(seenVariables).add(variable),
    )
  })
}

const identifierDeclarations = (identifier: import("ts-morph").Identifier): ReadonlyArray<Node> =>
  identifier.getSymbol()?.getDeclarations() ?? []

const nearestClaimFunction = (node: Node): ClaimFunctionNode | undefined =>
  node.getFirstAncestor((ancestor): ancestor is ClaimFunctionNode => isClaimFunctionNode(ancestor))

const hasOnlySuccessfulOutcomes = (fn: ClaimFunctionNode): boolean => {
  const body = fn.getBody()
  if (body === undefined) return false
  if (!Node.isBlock(body)) return isSuccessfulExpression(body)
  if (body.getDescendantsOfKind(SyntaxKind.ThrowStatement).some((node) => isExecutedBy(node, fn))) {
    return false
  }
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) => isExecutedBy(statement, fn))
  const terminal = body.getStatements().at(-1)
  return returns.length > 0 &&
    returns.every((statement) => isSuccessfulExpression(statement.getExpression())) &&
    terminal !== undefined &&
    statementAlwaysSucceeds(terminal)
}

const statementAlwaysSucceeds = (statement: Node): boolean => {
  if (Node.isReturnStatement(statement)) return isSuccessfulExpression(statement.getExpression())
  if (Node.isBlock(statement)) {
    const terminal = statement.getStatements().at(-1)
    return terminal !== undefined && statementAlwaysSucceeds(terminal)
  }
  if (!Node.isIfStatement(statement)) return false
  const alternate = statement.getElseStatement()
  return alternate !== undefined &&
    statementAlwaysSucceeds(statement.getThenStatement()) &&
    statementAlwaysSucceeds(alternate)
}

const isSuccessfulExpression = (expression: Node | undefined): boolean => {
  if (Node.isTrueLiteral(expression)) return true
  if (Node.isParenthesizedExpression(expression)) return isSuccessfulExpression(expression.getExpression())
  if (Node.isConditionalExpression(expression)) {
    return isSuccessfulExpression(expression.getWhenTrue()) &&
      isSuccessfulExpression(expression.getWhenFalse())
  }
  if (Node.isObjectLiteralExpression(expression)) {
    return expression.getProperties().some((property) =>
      Node.isPropertyAssignment(property) &&
      ["success", "ok"].includes(property.getName()) &&
      Node.isTrueLiteral(property.getInitializer())
    )
  }
  if (!Node.isCallExpression(expression)) return false
  const name = calleeSegment(expression).toLowerCase()
  return ["succeed", "success", "ok", "right"].includes(name)
}

const isClaimFunctionNode = (node: Node): node is ClaimFunctionNode =>
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node)
