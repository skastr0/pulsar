import {
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type Identifier,
  Node,
  type ParameterDeclaration,
  SyntaxKind,
  type TypeNode,
  type VariableDeclaration,
  type SourceFile,
} from "ts-morph"
import type {
  BoundaryFunctionExclusionReason,
  BoundaryIngressKind,
  BoundaryIngressSource,
  WeakBoundaryParameter,
} from "./ts-ad-04-boundary-parser-coverage.js"
import {
  calleeSegments,
  callReferencesDeclaration,
  callReferencesIngress,
  collectInheritedParserEvidence,
  collectParserEvidence,
  isDirectlyWithinFunction,
  nodeReferencesDeclaration,
  normalizeCallText,
  type BoundaryFunctionNode,
} from "./ts-ad-04-parser-evidence.js"

export interface BoundaryFunctionAnalysis {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly node: BoundaryFunctionNode
  readonly declaration: Node
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
  readonly ingressSources: ReadonlyArray<BoundaryIngressSource>
  readonly parserEvidence: ReadonlyArray<string>
  readonly exclusionReason: BoundaryFunctionExclusionReason | undefined
  readonly exclusionEvidence: ReadonlyArray<string>
  readonly ingressDeclarations: ReadonlySet<Node>
  readonly ingressNodes: ReadonlySet<Node>
}

interface BoundaryFunctionDescriptor {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly node: BoundaryFunctionNode
  readonly declaration: Node
}

interface InternalIngressSource {
  readonly public: BoundaryIngressSource
  readonly node: Node
  readonly declaration: Node | undefined
}

const REQUEST_LIKE_TYPE_NAMES = [
  "Request",
  "NextRequest",
  "IncomingMessage",
  "APIGatewayProxyEvent",
  "APIGatewayEvent",
  "MessageEvent",
  "Event",
  "FormData",
  "URLSearchParams",
] as const

export const collectBoundaryFunctionCandidates = (
  sourceFile: SourceFile,
  parserPatterns: ReadonlyArray<string>,
): ReadonlyArray<BoundaryFunctionAnalysis> => {
  const descriptors = collectBoundaryFunctionDescriptors(sourceFile)
  const analyses = descriptors.map((descriptor) =>
    candidateFromFunction(descriptor, parserPatterns),
  )

  return analyses.map((analysis) => {
    if (
      analysis.exclusionReason !== undefined ||
      analysis.ingressSources.length === 0 ||
      analysis.parserEvidence.length > 0
    ) return analysis

    const inherited = collectInheritedParserEvidence(
      sourceFile,
      analysis,
      parserPatterns,
    )
    if (inherited.length === 0) return analysis
    return {
      ...analysis,
      parserEvidence: inherited,
      exclusionReason: "already-decoded-input",
      exclusionEvidence: inherited.map((evidence) =>
        `all local call sites pass parser-decoded input via ${evidence}`
      ),
    }
  })
}

const collectBoundaryFunctionDescriptors = (
  sourceFile: SourceFile,
): ReadonlyArray<BoundaryFunctionDescriptor> => [
  ...sourceFile.getFunctions().flatMap((fn) =>
    isBoundaryFunctionDeclaration(fn)
      ? [{
        file: sourceFile.getFilePath(),
        line: fn.getStartLineNumber(),
        symbol: fn.getName() ?? "default",
        node: fn,
        declaration: fn,
      }]
      : [],
  ),
  ...sourceFile.getVariableDeclarations().flatMap((declaration) =>
    boundaryVariableFunction(declaration).map((fn) => ({
      file: sourceFile.getFilePath(),
      line: fn.getStartLineNumber(),
      symbol: declaration.getName(),
      node: fn,
      declaration,
    })),
  ),
  ...sourceFile.getExportAssignments().flatMap((assignment) => {
    const expression = assignment.getExpression()
    if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) return []
    return [{
      file: sourceFile.getFilePath(),
      line: expression.getStartLineNumber(),
      symbol: "default",
      node: expression,
      declaration: expression,
    }]
  }),
]

const isBoundaryFunctionDeclaration = (fn: FunctionDeclaration): boolean =>
  fn.isExported() || fn.isDefaultExport() || isHandlerName(fn.getName() ?? "")

const boundaryVariableFunction = (
  declaration: VariableDeclaration,
): Array<BoundaryFunctionNode> => {
  const initializer = declaration.getInitializer()
  if (initializer === undefined) return []
  const variableStatement = declaration.getVariableStatement()
  const boundaryLike =
    variableStatement?.isExported() === true ||
    isHandlerName(declaration.getName())
  if (!boundaryLike) return []
  if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
    return [initializer]
  }
  return []
}

const isHandlerName = (name: string): boolean =>
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|handler|handle|loader|action|fetch|main|run)$/u.test(name)

const candidateFromFunction = (
  descriptor: BoundaryFunctionDescriptor,
  parserPatterns: ReadonlyArray<string>,
): BoundaryFunctionAnalysis => {
  const fn = descriptor.node
  const weakParameters = fn.getParameters().flatMap(classifyWeakParameter)
  const parameterIngress = collectParameterIngressSources(fn, weakParameters)
  const bodyIngress = collectBodyIngressSources(fn)
  const ingressSources = dedupeIngressSources([
    ...parameterIngress.map((source) => source.public),
    ...bodyIngress.map((source) => source.public),
  ])
  const ingressDeclarations = new Set<Node>([
    ...parameterIngress.map((source) => source.declaration).filter(isPresent),
    ...bodyIngress.map((source) => source.declaration).filter(isPresent),
  ])
  const ingressNodes = new Set<Node>(bodyIngress.map((source) => source.node))
  const parserEvidence = collectParserEvidence(
    fn,
    parserPatterns,
    ingressDeclarations,
    ingressNodes,
  )
  const exclusion = classifySemanticExclusion(
    fn,
    ingressSources,
    ingressDeclarations,
    ingressNodes,
  )
  return {
    ...descriptor,
    weakParameters,
    ingressSources,
    parserEvidence,
    exclusionReason: exclusion?.reason,
    exclusionEvidence: exclusion?.evidence ?? [],
    ingressDeclarations,
    ingressNodes,
  }
}

const classifyWeakParameter = (
  parameter: ParameterDeclaration,
): ReadonlyArray<WeakBoundaryParameter> => {
  const name = parameter.getName()
  const typeNode = parameter.getTypeNode()
  const typeText = typeNode?.getText() ?? "<untyped>"
  // A default initializer means the inferred type comes from an internal
  // expression (`authPath = getAuthPath()`), not from untrusted callers.
  if (typeNode === undefined) {
    return parameter.hasInitializer() ? [] : [{ name, typeText, reason: "untyped" }]
  }
  // Function-typed parameters (`decode: (value: unknown) => T`) CONSUME
  // unknown; the unknown in their signature is not data entering through
  // this boundary.
  if (isFunctionShapedTypeNode(typeNode)) {
    return []
  }
  const unsafeKinds = collectUntrustedDataKinds(typeNode)
  if (unsafeKinds.has("any")) {
    return [{ name, typeText, reason: "any" }]
  }
  if (unsafeKinds.has("unknown")) {
    return [{ name, typeText, reason: "unknown" }]
  }
  if (isRequestLikeTypeNode(typeNode)) {
    return [{ name, typeText, reason: "request-like" }]
  }
  return []
}

const collectUntrustedDataKinds = (
  typeNode: TypeNode,
): ReadonlySet<"any" | "unknown"> => {
  if (typeNode.getKind() === SyntaxKind.AnyKeyword) return new Set(["any"])
  if (typeNode.getKind() === SyntaxKind.UnknownKeyword) return new Set(["unknown"])
  if (Node.isParenthesizedTypeNode(typeNode)) {
    return collectUntrustedDataKinds(typeNode.getTypeNode())
  }
  if (isFunctionShapedTypeNode(typeNode)) return new Set()
  if (Node.isArrayTypeNode(typeNode)) {
    return collectUntrustedDataKinds(typeNode.getElementTypeNode())
  }
  if (Node.isUnionTypeNode(typeNode) || Node.isIntersectionTypeNode(typeNode)) {
    return mergeUnsafeKinds(typeNode.getTypeNodes().map(collectUntrustedDataKinds))
  }
  if (Node.isTypeReference(typeNode)) {
    const argumentsToInspect = dataBearingTypeArguments(typeNode)
    return mergeUnsafeKinds(argumentsToInspect.map(collectUntrustedDataKinds))
  }
  return mergeUnsafeKinds(
    typeNode.getChildren().filter(Node.isTypeNode).map(collectUntrustedDataKinds),
  )
}

const dataBearingTypeArguments = (
  typeNode: import("ts-morph").TypeReferenceNode,
): ReadonlyArray<TypeNode> => {
  const typeName = typeNode.getTypeName().getText()
  const args = typeNode.getTypeArguments()
  if (isEffectTypeName(typeName) || isEitherTypeName(typeName)) {
    return args.slice(0, 1)
  }
  return args
}

const mergeUnsafeKinds = (
  sets: ReadonlyArray<ReadonlySet<"any" | "unknown">>,
): ReadonlySet<"any" | "unknown"> => {
  const merged = new Set<"any" | "unknown">()
  for (const set of sets) for (const kind of set) merged.add(kind)
  return merged
}

const isRequestLikeTypeNode = (typeNode: TypeNode): boolean =>
  typeIdentifierNames(typeNode).some((name) =>
    REQUEST_LIKE_TYPE_NAMES.includes(name as (typeof REQUEST_LIKE_TYPE_NAMES)[number]) ||
    /^API(?:Gateway[A-Za-z0-9]*)?Event$/u.test(name) ||
    /^(?:Ipc|IPC)[A-Za-z0-9]*Event$/u.test(name)
  )

const typeIdentifierNames = (typeNode: TypeNode): ReadonlyArray<string> => [
  ...(Node.isIdentifier(typeNode) ? [typeNode.getText()] : []),
  ...typeNode.getDescendantsOfKind(SyntaxKind.Identifier).map((identifier) =>
    identifier.getText()
  ),
]

const isFunctionShapedTypeNode = (typeNode: Node): boolean => {
  if (Node.isParenthesizedTypeNode(typeNode)) {
    return isFunctionShapedTypeNode(typeNode.getTypeNode())
  }
  if (Node.isUnionTypeNode(typeNode) || Node.isIntersectionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().every(isFunctionShapedTypeNode)
  }
  return Node.isFunctionTypeNode(typeNode) || Node.isConstructorTypeNode(typeNode)
}

const collectParameterIngressSources = (
  fn: BoundaryFunctionNode,
  weakParameters: ReadonlyArray<WeakBoundaryParameter>,
): ReadonlyArray<InternalIngressSource> => {
  const weakByName = new Map(weakParameters.map((parameter) => [parameter.name, parameter]))
  return fn.getParameters().flatMap((parameter) => {
    const weak = weakByName.get(parameter.getName())
    if (weak === undefined) return []
    const requestIsIpc = weak.reason === "request-like" &&
      /(?:Ipc|IPC|MessageEvent)/u.test(weak.typeText)
    return [{
      public: {
        kind: weak.reason === "unknown"
          ? "unknown"
          : weak.reason === "request-like"
          ? requestIsIpc ? "ipc" : "parsed-wire"
          : "untyped",
        evidence: `parameter ${weak.name}: ${weak.typeText}`,
        parameter: weak.name,
      },
      node: parameter,
      declaration: parameter,
    }]
  })
}

const collectBodyIngressSources = (
  fn: BoundaryFunctionNode,
): ReadonlyArray<InternalIngressSource> => {
  const sources: Array<InternalIngressSource> = []
  for (const access of fn.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (!isDirectlyWithinFunction(access, fn) || !isEnvironmentAccess(access)) continue
    const parentAccess = access.getParentIfKind(SyntaxKind.PropertyAccessExpression)
    if (parentAccess !== undefined && isEnvironmentAccess(parentAccess)) continue
    sources.push(internalIngressSource("environment", access, fn))
  }
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDirectlyWithinFunction(call, fn)) continue
    const kind = classifyIngressCall(call)
    if (kind !== undefined) sources.push(internalIngressSource(kind, call, fn))
  }
  return sources.sort((left, right) => left.node.getStart() - right.node.getStart())
}

const internalIngressSource = (
  kind: BoundaryIngressKind,
  node: Node,
  fn: BoundaryFunctionNode,
): InternalIngressSource => ({
  public: {
    kind,
    evidence: `${kind} source ${node.getText()}`,
  },
  node,
  declaration: sourceHoldingDeclaration(node, fn),
})

const sourceHoldingDeclaration = (
  node: Node,
  fn: BoundaryFunctionNode,
): VariableDeclaration | undefined => {
  const declaration = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  return declaration !== undefined && isDirectlyWithinFunction(declaration, fn)
    ? declaration
    : undefined
}

const isEnvironmentAccess = (node: Node): boolean => {
  const text = node.getText()
  return text === "process.env" || text.startsWith("process.env.") ||
    text === "Bun.env" || text.startsWith("Bun.env.")
}

const classifyIngressCall = (
  call: CallExpression,
): BoundaryIngressKind | undefined => {
  const callee = normalizeCallText(call.getExpression().getText())
  if (callee === "json.parse" || callee.endsWith(".json")) return "parsed-wire"
  if (callee === "bun.spawn" || callee === "bun.spawnsync") return "subprocess"

  const moduleSpecifier = importModuleSpecifier(call.getExpression())
  const member = calleeSegments(callee).at(-1) ?? ""
  if (
    moduleSpecifier !== undefined &&
    isFileSystemSpecifier(moduleSpecifier) &&
    FILESYSTEM_READ_MEMBERS.has(member)
  ) return "filesystem"
  if (
    moduleSpecifier !== undefined &&
    isChildProcessSpecifier(moduleSpecifier) &&
    SUBPROCESS_MEMBERS.has(member)
  ) return "subprocess"
  if (moduleSpecifier === "electron") return "ipc"
  if (
    moduleSpecifier !== undefined &&
    isExternalPackageSpecifier(moduleSpecifier) &&
    callReturnsUntrustedData(call)
  ) return "external-sdk"
  return undefined
}

const FILESYSTEM_READ_MEMBERS: ReadonlySet<string> = new Set([
  "read",
  "readfile",
  "readfilesync",
  "createreadstream",
  "readdir",
  "readdirsync",
])

const SUBPROCESS_MEMBERS: ReadonlySet<string> = new Set([
  "exec",
  "execfile",
  "execfilesync",
  "execsync",
  "fork",
  "spawn",
  "spawnsync",
])

const isFileSystemSpecifier = (specifier: string): boolean =>
  specifier.replace(/^node:/u, "") === "fs" ||
  specifier.replace(/^node:/u, "") === "fs/promises"

const isChildProcessSpecifier = (specifier: string): boolean =>
  specifier.replace(/^node:/u, "") === "child_process"

const isExternalPackageSpecifier = (specifier: string): boolean =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("/") &&
  !specifier.startsWith("node:") &&
  specifier !== "effect" &&
  specifier !== "electron"

const callReturnsUntrustedData = (call: CallExpression): boolean => {
  const typeText = call.getType().getText(call)
  return /(^|[<(, ])(?:any|unknown)(?=$|[>), ])/u.test(typeText)
}

const importModuleSpecifier = (expression: Expression): string | undefined => {
  const root = calleeRootIdentifier(expression)
  if (root === undefined) return undefined
  const symbol = root.getSymbol()
  const symbols = [symbol, symbol?.getAliasedSymbol()].filter(isPresent)
  for (const candidate of symbols) {
    for (const declaration of candidate.getDeclarations()) {
      const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
      if (importDeclaration !== undefined) return importDeclaration.getModuleSpecifierValue()
    }
  }
  return undefined
}

const calleeRootIdentifier = (expression: Expression): Identifier | undefined => {
  if (Node.isIdentifier(expression)) return expression
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return calleeRootIdentifier(expression.getExpression())
  }
  if (Node.isCallExpression(expression)) return calleeRootIdentifier(expression.getExpression())
  return undefined
}

const dedupeIngressSources = (
  sources: ReadonlyArray<BoundaryIngressSource>,
): ReadonlyArray<BoundaryIngressSource> => {
  const unique = new Map<string, BoundaryIngressSource>()
  for (const source of sources) {
    const key = `${source.kind}:${source.evidence}:${source.parameter ?? ""}`
    if (!unique.has(key)) unique.set(key, source)
  }
  return [...unique.values()]
}

const classifySemanticExclusion = (
  fn: BoundaryFunctionNode,
  ingressSources: ReadonlyArray<BoundaryIngressSource>,
  ingressDeclarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): { readonly reason: BoundaryFunctionExclusionReason; readonly evidence: ReadonlyArray<string> } | undefined => {
  if (isRuntimeTypeRefinement(fn, ingressDeclarations)) {
    return {
      reason: "runtime-type-refinement",
      evidence: ["type predicate is grounded by runtime typeof/in/instanceof checks"],
    }
  }
  if (
    ingressSources.length > 0 &&
    isTerminalOutputType(fn.getReturnTypeNode()) &&
    (
      hasTerminalProjectionEvidence(fn, ingressDeclarations, ingressNodes) ||
      ingressSources.every((source) => source.parameter === undefined)
    )
  ) {
    return {
      reason: "terminal-output-projection",
      evidence: ["untrusted value terminates as a primitive output after runtime refinement or serialization"],
    }
  }
  if (
    ingressSources.length > 0 &&
    ingressSources.every((source) => source.parameter === undefined) &&
    isRawCarrierOutputType(fn.getReturnTypeNode())
  ) {
    return {
      reason: "raw-ingress-carrier",
      evidence: ["external bytes or environment values remain in a conventional raw carrier type"],
    }
  }
  if (ingressSources.length === 0 && hasEffectRequirementWrapper(fn)) {
    return {
      reason: "effect-requirement-wrapper",
      evidence: ["unsafe top type appears only in the Effect requirement channel, not its success value"],
    }
  }
  if (ingressSources.length === 0 && hasTypedErrorEnvelope(fn)) {
    return {
      reason: "typed-error-envelope",
      evidence: ["unknown appears only in a typed Either error channel; the success payload is typed"],
    }
  }
  if (ingressSources.length === 0 && hasTypedInputProjection(fn)) {
    return {
      reason: "typed-input-projection",
      evidence: ["explicitly typed input is projected with map/property access and carries no supported raw ingress"],
    }
  }
  return undefined
}

const isRuntimeTypeRefinement = (
  fn: BoundaryFunctionNode,
  ingressDeclarations: ReadonlySet<Node>,
): boolean => {
  const returnType = fn.getReturnTypeNode()
  return returnType !== undefined &&
    Node.isTypePredicate(returnType) &&
    hasRuntimeRefinement(fn, ingressDeclarations)
}

const hasRuntimeRefinement = (
  fn: BoundaryFunctionNode,
  ingressDeclarations: ReadonlySet<Node>,
): boolean => {
  for (const expression of fn.getDescendantsOfKind(SyntaxKind.TypeOfExpression)) {
    if (
      isDirectlyWithinFunction(expression, fn) &&
      nodeReferencesDeclaration(expression, ingressDeclarations)
    ) return true
  }
  for (const expression of fn.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!isDirectlyWithinFunction(expression, fn)) continue
    const operator = expression.getOperatorToken().getKind()
    if (
      (operator === SyntaxKind.InstanceOfKeyword || operator === SyntaxKind.InKeyword) &&
      nodeReferencesDeclaration(expression, ingressDeclarations)
    ) return true
  }
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) =>
    isDirectlyWithinFunction(call, fn) &&
    normalizeCallText(call.getExpression().getText()) === "array.isarray" &&
    callReferencesDeclaration(call, ingressDeclarations)
  )
}

const isTerminalOutputType = (typeNode: TypeNode | undefined): boolean => {
  if (typeNode === undefined) return false
  if (Node.isParenthesizedTypeNode(typeNode)) return isTerminalOutputType(typeNode.getTypeNode())
  if (Node.isUnionTypeNode(typeNode) || Node.isIntersectionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().every(isTerminalOutputType)
  }
  if (Node.isLiteralTypeNode(typeNode)) return true
  if (Node.isTypeReference(typeNode)) {
    const name = typeNode.getTypeName().getText()
    if (["Promise", "Readonly", "Awaited"].includes(name)) {
      const args = typeNode.getTypeArguments()
      return args.length === 1 && isTerminalOutputType(args[0])
    }
    return ["String", "Number", "Boolean"].includes(name)
  }
  return new Set<SyntaxKind>([
    SyntaxKind.StringKeyword,
    SyntaxKind.NumberKeyword,
    SyntaxKind.BooleanKeyword,
    SyntaxKind.UndefinedKeyword,
    SyntaxKind.NullKeyword,
    SyntaxKind.VoidKeyword,
    SyntaxKind.NeverKeyword,
  ]).has(typeNode.getKind())
}

const isRawCarrierOutputType = (typeNode: TypeNode | undefined): boolean => {
  if (typeNode === undefined) return false
  if (Node.isParenthesizedTypeNode(typeNode)) {
    return isRawCarrierOutputType(typeNode.getTypeNode())
  }
  if (Node.isUnionTypeNode(typeNode) || Node.isIntersectionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().every((member) =>
      isRawCarrierOutputType(member) || isTerminalOutputType(member)
    )
  }
  if (!Node.isTypeReference(typeNode)) return false
  const name = typeNode.getTypeName().getText()
  if (["Promise", "Readonly", "Awaited"].includes(name)) {
    const args = typeNode.getTypeArguments()
    return args.length === 1 && isRawCarrierOutputType(args[0])
  }
  return [
    "Buffer",
    "Uint8Array",
    "ArrayBuffer",
    "NodeJS.ProcessEnv",
    "Response",
  ].includes(name)
}

const hasTerminalProjectionEvidence = (
  fn: BoundaryFunctionNode,
  ingressDeclarations: ReadonlySet<Node>,
  ingressNodes: ReadonlySet<Node>,
): boolean =>
  hasRuntimeRefinement(fn, ingressDeclarations) ||
  fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (!isDirectlyWithinFunction(call, fn)) return false
    const callee = normalizeCallText(call.getExpression().getText())
    return (callee === "json.stringify" || callee === "string") &&
      callReferencesIngress(call, ingressDeclarations, ingressNodes)
  })

const hasEffectRequirementWrapper = (fn: BoundaryFunctionNode): boolean =>
  hasTypedCarrierChannel(fn, "Effect.Effect", 2)

const hasTypedErrorEnvelope = (fn: BoundaryFunctionNode): boolean =>
  hasTypedCarrierChannel(fn, "Either.Either", 1)

const hasTypedCarrierChannel = (
  fn: BoundaryFunctionNode,
  typeName: string,
  channelIndex: number,
): boolean =>
  fn.getParameters().some((parameter) => {
    const typeNode = parameter.getTypeNode()
    if (typeNode === undefined || !Node.isTypeReference(typeNode)) return false
    const args = typeNode.getTypeArguments()
    return typeNode.getTypeName().getText() === typeName &&
      args.length > channelIndex &&
      collectUntrustedDataKinds(args[0]!).size === 0 &&
      collectUnsafeKeywordsUnbounded(args[channelIndex]!).size > 0
  })

const collectUnsafeKeywordsUnbounded = (
  node: Node,
): ReadonlySet<"any" | "unknown"> => {
  const kinds = new Set<"any" | "unknown">()
  if (node.getKind() === SyntaxKind.AnyKeyword) kinds.add("any")
  if (node.getKind() === SyntaxKind.UnknownKeyword) kinds.add("unknown")
  for (const child of node.getChildren()) {
    for (const kind of collectUnsafeKeywordsUnbounded(child)) kinds.add(kind)
  }
  return kinds
}

const isEffectTypeName = (name: string): boolean => name === "Effect.Effect"
const isEitherTypeName = (name: string): boolean => name === "Either.Either"

const hasTypedInputProjection = (fn: BoundaryFunctionNode): boolean => {
  const typedParameters = new Set<Node>(
    fn.getParameters().filter((parameter) => parameter.getTypeNode() !== undefined),
  )
  if (typedParameters.size === 0) return false
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (!isDirectlyWithinFunction(call, fn)) return false
    const expression = call.getExpression()
    return Node.isPropertyAccessExpression(expression) &&
      expression.getName() === "map" &&
      nodeReferencesDeclaration(expression.getExpression(), typedParameters)
  })
}

const isPresent = <T>(value: T | undefined): value is T => value !== undefined
