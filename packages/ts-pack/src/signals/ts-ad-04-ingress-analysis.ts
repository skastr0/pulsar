import { firstAncestor, hasExportModifier, hasModifier, textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrayTypeNode,
  isArrowFunction,
  isBinaryExpression,
  isCallExpression,
  isConstructorTypeNode,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isIdentifier,
  isImportDeclaration,
  isIntersectionTypeNode,
  isLiteralTypeNode,
  isParenthesizedTypeNode,
  isPropertyAccessExpression,
  isTypeOfExpression,
  isTypePredicateNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  isVariableDeclaration,
  isVariableStatement,
  type CallExpression,
  type FunctionDeclaration,
  type Identifier,
  type Node,
  type ParameterDeclaration,
  type SourceFile,
  type TypeNode,
  type VariableDeclaration,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
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
  callSiteSourceFiles: ReadonlyArray<SourceFile> = [sourceFile],
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
      callSiteSourceFiles,
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
  ...sourceFile.statements.filter(isFunctionDeclaration).flatMap((fn) =>
    isBoundaryFunctionDeclaration(fn)
      ? [{
        file: sourceFile.fileName,
        line: startLine(fn),
        symbol: fn.name?.text ?? "default",
        node: fn,
        declaration: fn,
      }]
      : [],
  ),
  ...collectKind(sourceFile, isVariableDeclaration).flatMap((declaration) =>
    boundaryVariableFunction(declaration).map((fn) => ({
      file: sourceFile.fileName,
      line: startLine(fn),
      symbol: identifierText(declaration.name),
      node: fn,
      declaration,
    })),
  ),
  ...sourceFile.statements.filter(isExportAssignment).flatMap((assignment) => {
    const expression = assignment.expression
    if (!isArrowFunction(expression) && !isFunctionExpression(expression)) return []
    return [{
      file: sourceFile.fileName,
      line: startLine(expression),
      symbol: "default",
      node: expression,
      declaration: expression,
    }]
  }),
]

const isBoundaryFunctionDeclaration = (fn: FunctionDeclaration): boolean =>
  hasExportModifier(fn) || hasModifier(fn, SyntaxKind.DefaultKeyword) || isHandlerName(fn.name?.text ?? "")

const boundaryVariableFunction = (
  declaration: VariableDeclaration,
): Array<BoundaryFunctionNode> => {
  const initializer = declaration.initializer
  if (initializer === undefined) return []
  const variableStatement = variableStatementOf(declaration)
  const boundaryLike =
    variableStatement !== undefined && hasExportModifier(variableStatement) ||
    isHandlerName(identifierText(declaration.name))
  if (!boundaryLike) return []
  if (isArrowFunction(initializer) || isFunctionExpression(initializer)) {
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
  const weakParameters = fn.parameters.flatMap(classifyWeakParameter)
  const parameterIngress = collectParameterIngressSources(fn, weakParameters)
  const parameterIngressDeclarations = new Set<Node>(
    parameterIngress.map((source) => source.declaration).filter(isPresent),
  )
  const bodyIngress = collectBodyIngressSources(fn, parameterIngressDeclarations)
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
  const name = identifierText(parameter.name)
  const typeNode = parameter.type
  const typeText = typeNode === undefined ? "<untyped>" : textOf(typeNode)
  // A default initializer means the inferred type comes from an internal
  // expression (`authPath = getAuthPath()`), not from untrusted callers.
  if (typeNode === undefined) {
    return parameter.initializer !== undefined ? [] : [{ name, typeText, reason: "untyped" }]
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
  if (typeNode.kind === SyntaxKind.AnyKeyword) return new Set(["any"])
  if (typeNode.kind === SyntaxKind.UnknownKeyword) return new Set(["unknown"])
  if (isParenthesizedTypeNode(typeNode)) {
    return collectUntrustedDataKinds(typeNode.type)
  }
  if (isFunctionShapedTypeNode(typeNode)) return new Set()
  if (isArrayTypeNode(typeNode)) {
    return collectUntrustedDataKinds(typeNode.elementType)
  }
  if (isUnionTypeNode(typeNode) || isIntersectionTypeNode(typeNode)) {
    return mergeUnsafeKinds(typeNode.types.map(collectUntrustedDataKinds))
  }
  if (isTypeReferenceNode(typeNode)) {
    const argumentsToInspect = dataBearingTypeArguments(typeNode)
    return mergeUnsafeKinds(argumentsToInspect.map(collectUntrustedDataKinds))
  }
  return mergeUnsafeKinds(
    childrenOf(typeNode).filter(isTypeNodeLike).map(collectUntrustedDataKinds),
  )
}

const dataBearingTypeArguments = (
  typeNode: import("../tsgo-api.js").TypeReferenceNode,
): ReadonlyArray<TypeNode> => {
  const typeName = textOf(typeNode.typeName)
  const args = [...(typeNode.typeArguments ?? [])]
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
  ...(isIdentifier(typeNode) ? [typeNode.text] : []),
  ...collectKind(typeNode, isIdentifier).map((identifier) =>
    textOf(identifier)
  ),
]

const isFunctionShapedTypeNode = (typeNode: Node): boolean => {
  if (isParenthesizedTypeNode(typeNode)) {
    return isFunctionShapedTypeNode(typeNode.type)
  }
  if (isUnionTypeNode(typeNode) || isIntersectionTypeNode(typeNode)) {
    return typeNode.types.every(isFunctionShapedTypeNode)
  }
  return isFunctionTypeNode(typeNode) || isConstructorTypeNode(typeNode)
}

const collectParameterIngressSources = (
  fn: BoundaryFunctionNode,
  weakParameters: ReadonlyArray<WeakBoundaryParameter>,
): ReadonlyArray<InternalIngressSource> => {
  const weakByName = new Map(weakParameters.map((parameter) => [parameter.name, parameter]))
  return fn.parameters.flatMap((parameter) => {
    const weak = weakByName.get(identifierText(parameter.name))
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
  parameterIngressDeclarations: ReadonlySet<Node>,
): ReadonlyArray<InternalIngressSource> => {
  const sources: Array<InternalIngressSource> = []
  for (const access of collectKind(fn, isPropertyAccessExpression)) {
    if (!isDirectlyWithinFunction(access, fn) || !isEnvironmentAccess(access)) continue
    const parentAccess = isPropertyAccessExpression(access.parent) ? access.parent : undefined
    if (parentAccess !== undefined && isEnvironmentAccess(parentAccess)) continue
    sources.push(internalIngressSource("environment", access, fn))
  }
  for (const call of collectKind(fn, isCallExpression)) {
    if (!isDirectlyWithinFunction(call, fn)) continue
    const kind = classifyIngressCall(call, parameterIngressDeclarations)
    if (kind !== undefined) sources.push(internalIngressSource(kind, call, fn))
  }
  return sources.sort((left, right) => left.node.getStart(left.node.getSourceFile()) - right.node.getStart(right.node.getSourceFile()))
}

const internalIngressSource = (
  kind: BoundaryIngressKind,
  node: Node,
  fn: BoundaryFunctionNode,
): InternalIngressSource => ({
  public: {
    kind,
    evidence: `${kind} source ${textOf(node)}`,
  },
  node,
  declaration: sourceHoldingDeclaration(node, fn),
})

const sourceHoldingDeclaration = (
  node: Node,
  fn: BoundaryFunctionNode,
): VariableDeclaration | undefined => {
  const declaration = firstAncestor(node, isVariableDeclaration)
  return declaration !== undefined && isDirectlyWithinFunction(declaration, fn)
    ? declaration
    : undefined
}

const isEnvironmentAccess = (node: Node): boolean => {
  const text = textOf(node)
  const root = calleeRootIdentifier(node)
  if (root === undefined) return false
  if (text === "process.env" || text.startsWith("process.env.")) {
    return textOf(root) === "process" &&
      (
        isUnshadowedAmbientGlobal(root) ||
        ["process", "node:process"].includes(importModuleSpecifier(root) ?? "")
      )
  }
  if (text === "Bun.env" || text.startsWith("Bun.env.")) {
    return textOf(root) === "Bun" && isUnshadowedAmbientGlobal(root)
  }
  return false
}

const classifyIngressCall = (
  call: CallExpression,
  parameterIngressDeclarations: ReadonlySet<Node>,
): BoundaryIngressKind | undefined => {
  const callee = normalizeCallText(textOf(call.expression))
  if (isParsedWireIngressCall(call, parameterIngressDeclarations)) return "parsed-wire"

  const moduleSpecifier = importModuleSpecifier(call.expression)
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
  if (moduleSpecifier === "electron" && IPC_READ_MEMBERS.has(member)) return "ipc"
  if (
    moduleSpecifier !== undefined &&
    isExternalPackageSpecifier(moduleSpecifier) &&
    callReturnsUntrustedData(call)
  ) return "external-sdk"
  return undefined
}

const isParsedWireIngressCall = (
  call: CallExpression,
  parameterIngressDeclarations: ReadonlySet<Node>,
): boolean => {
  const expression = call.expression
  if (!isPropertyAccessExpression(expression)) return false
  const member = normalizeCallText(propertyNameText(expression.name))
  if (
    member === "parse" &&
    normalizeCallText(textOf(expression.expression)) === "json" &&
    hasUnshadowedGlobalRoot(expression, "JSON")
  ) return true
  if (member !== "json") return false
  const receiver = expression.expression
  if (nodeReferencesDeclaration(receiver, parameterIngressDeclarations)) return true
  const receiverType = textOf(receiver)
  return /(?:^|[.<(, ])(?:Body|Request|Response)(?:$|[.>,) ])/u.test(receiverType)
}

const hasUnshadowedGlobalRoot = (
  expression: Node,
  expectedName: string,
): boolean => {
  const root = calleeRootIdentifier(expression)
  return root !== undefined && textOf(root) === expectedName && isUnshadowedAmbientGlobal(root)
}

const isUnshadowedAmbientGlobal = (identifier: Identifier): boolean => {
  const sourceFile = identifier.getSourceFile()
  let shadowed = false
  walkDescendants(sourceFile, (node) => {
    if (!isIdentifier(node) || node.text !== identifier.text || node === identifier) return
    if (isVariableDeclaration(node.parent) && node.parent.name === node) shadowed = true
    if (isFunctionDeclaration(node.parent) && node.parent.name === node) shadowed = true
  })
  return !shadowed
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
  "execfilesync",
  "execsync",
])

const IPC_READ_MEMBERS: ReadonlySet<string> = new Set([
  "invoke",
  "sendsync",
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
  const specifier = importModuleSpecifier(call.expression)
  return specifier !== undefined && isExternalPackageSpecifier(specifier)
}

const importModuleSpecifier = (expression: Node): string | undefined => {
  const root = calleeRootIdentifier(expression)
  if (root === undefined) return undefined
  const sourceFile = root.getSourceFile()
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement)) continue
    const clause = statement.importClause
    if (clause?.name?.text === root.text) return moduleSpecifierText(statement)
    const named = clause?.namedBindings
    if (named !== undefined && "elements" in named) {
      for (const element of named.elements) {
        const local = isIdentifier(element.name) ? element.name.text : textOf(element.name)
        if (local === root.text) return moduleSpecifierText(statement)
      }
    }
  }
  return undefined
}

const moduleSpecifierText = (declaration: import("../tsgo-api.js").ImportDeclaration): string | undefined => {
  const specifier = declaration.moduleSpecifier
  return specifier === undefined ? undefined : textOf(specifier).replace(/^[\"']|[\"']$/g, "")
}

const calleeRootIdentifier = (expression: Node): Identifier | undefined => {
  if (isIdentifier(expression)) return expression
  if (isPropertyAccessExpression(expression)) {
    return calleeRootIdentifier(expression.expression)
  }
  if (isCallExpression(expression)) return calleeRootIdentifier(expression.expression)
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
    isTerminalOutputType(fn.type) &&
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
    isRawCarrierOutputType(fn.type)
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
  const returnType = fn.type
  return returnType !== undefined &&
    isTypePredicateNode(returnType) &&
    hasRuntimeRefinement(fn, ingressDeclarations)
}

const hasRuntimeRefinement = (
  fn: BoundaryFunctionNode,
  ingressDeclarations: ReadonlySet<Node>,
): boolean => {
  for (const expression of collectKind(fn, isTypeOfExpression)) {
    if (
      isDirectlyWithinFunction(expression, fn) &&
      nodeReferencesDeclaration(expression, ingressDeclarations)
    ) return true
  }
  for (const expression of collectKind(fn, isBinaryExpression)) {
    if (!isDirectlyWithinFunction(expression, fn)) continue
    const operator = expression.operatorToken.kind
    if (
      (operator === SyntaxKind.InstanceOfKeyword || operator === SyntaxKind.InKeyword) &&
      nodeReferencesDeclaration(expression, ingressDeclarations)
    ) return true
  }
  return collectKind(fn, isCallExpression).some((call) =>
    isDirectlyWithinFunction(call, fn) &&
    normalizeCallText(textOf(call.expression)) === "array.isarray" &&
    callReferencesDeclaration(call, ingressDeclarations)
  )
}

const isTerminalOutputType = (typeNode: TypeNode | undefined): boolean => {
  if (typeNode === undefined) return false
  if (isParenthesizedTypeNode(typeNode)) return isTerminalOutputType(typeNode.type)
  if (isUnionTypeNode(typeNode) || isIntersectionTypeNode(typeNode)) {
    return typeNode.types.every(isTerminalOutputType)
  }
  if (isLiteralTypeNode(typeNode)) return true
  if (isTypeReferenceNode(typeNode)) {
    const name = textOf(typeNode.typeName)
    if (["Promise", "Readonly", "Awaited"].includes(name)) {
      const args = [...(typeNode.typeArguments ?? [])]
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
  ]).has(typeNode.kind)
}

const isRawCarrierOutputType = (typeNode: TypeNode | undefined): boolean => {
  if (typeNode === undefined) return false
  if (isParenthesizedTypeNode(typeNode)) {
    return isRawCarrierOutputType(typeNode.type)
  }
  if (isUnionTypeNode(typeNode) || isIntersectionTypeNode(typeNode)) {
    return typeNode.types.every((member) =>
      isRawCarrierOutputType(member) || isTerminalOutputType(member)
    )
  }
  if (!isTypeReferenceNode(typeNode)) return false
  const name = textOf(typeNode.typeName)
  if (["Promise", "Readonly", "Awaited"].includes(name)) {
    const args = [...(typeNode.typeArguments ?? [])]
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
  collectKind(fn, isCallExpression).some((call) => {
    if (!isDirectlyWithinFunction(call, fn)) return false
    const callee = normalizeCallText(textOf(call.expression))
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
  fn.parameters.some((parameter) => {
    const typeNode = parameter.type
    if (typeNode === undefined || !isTypeReferenceNode(typeNode)) return false
    const args = [...(typeNode.typeArguments ?? [])]
    return textOf(typeNode.typeName) === typeName &&
      args.length > channelIndex &&
      collectUntrustedDataKinds(args[0]!).size === 0 &&
      collectUnsafeKeywordsUnbounded(args[channelIndex]!).size > 0
  })

const collectUnsafeKeywordsUnbounded = (
  node: Node,
): ReadonlySet<"any" | "unknown"> => {
  const kinds = new Set<"any" | "unknown">()
  if (node.kind === SyntaxKind.AnyKeyword) kinds.add("any")
  if (node.kind === SyntaxKind.UnknownKeyword) kinds.add("unknown")
  for (const child of childrenOf(node)) {
    for (const kind of collectUnsafeKeywordsUnbounded(child)) kinds.add(kind)
  }
  return kinds
}

const isEffectTypeName = (name: string): boolean => name === "Effect.Effect"
const isEitherTypeName = (name: string): boolean => name === "Either.Either"

const hasTypedInputProjection = (fn: BoundaryFunctionNode): boolean => {
  const typedParameters = new Set<Node>(
    fn.parameters.filter((parameter) => parameter.type !== undefined),
  )
  if (typedParameters.size === 0) return false
  return collectKind(fn, isCallExpression).some((call) => {
    if (!isDirectlyWithinFunction(call, fn)) return false
    const expression = call.expression
    return isPropertyAccessExpression(expression) &&
      propertyNameText(expression.name) === "map" &&
      nodeReferencesDeclaration(expression.expression, typedParameters)
  })
}

const isPresent = <T>(value: T | undefined): value is T => value !== undefined

const collectKind = <T extends Node>(root: Node, predicate: (node: Node) => node is T): ReadonlyArray<T> => {
  const results: Array<T> = []
  walkDescendants(root, (node) => {
    if (predicate(node)) results.push(node)
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

const startLine = (node: Node): number => {
  const sourceFile = node.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

const variableStatementOf = (declaration: VariableDeclaration) => {
  const parent = declaration.parent.parent
  return isVariableStatement(parent) ? parent : undefined
}

const isTypeNodeLike = (node: Node): node is TypeNode => true
