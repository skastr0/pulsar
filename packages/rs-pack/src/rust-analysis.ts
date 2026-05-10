import { parseRustFile, type RustSyntaxNode, walkRustTree } from "./syn-walker.js"
import type { RustManifestInfo, RustProject } from "./project.js"

export interface RustVisibility {
  readonly kind: "pub" | "pub-crate" | "pub-super" | "pub-in-path" | "private"
  readonly path?: string
}

export interface RustModuleFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly visibility: RustVisibility
}

export interface RustItemFact {
  readonly kind:
    | "fn"
    | "struct"
    | "enum"
    | "trait"
    | "impl"
    | "mod"
    | "const"
    | "static"
    | "type"
  readonly name: string
  readonly visibility: RustVisibility
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
}

export interface RustUseFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly visibility: RustVisibility
  readonly path: string
  readonly segments: ReadonlyArray<string>
}

export interface RustMatchFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly functionName: string
  readonly armCount: number
  readonly catchAllArmCount: number
  readonly hasCatchAll: boolean
}

export interface RustIdentifierFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly kind: "item" | "function" | "parameter"
  readonly name: string
  readonly tokens: ReadonlyArray<string>
}

export interface RustFunctionFact {
  readonly crateName: string
  readonly file: string
  readonly line: number
  readonly relativeModulePath: string
  readonly modulePath: string
  readonly name: string
  readonly visibility: RustVisibility
  readonly isUnsafeFn: boolean
  readonly unsafeBlockCount: number
  readonly rawPointerParamCount: number
  readonly rawPointerReturn: boolean
  readonly lifetimeParamCount: number
  readonly lifetimeBoundCount: number
  readonly lifetimeInputCount: number
  readonly lifetimeOutputCount: number
  readonly lifetimeConstraintCount: number
  readonly returnTypeText: string | undefined
  readonly resultErrorType: string | undefined
  readonly complexity: number
}

export interface RustAnalysis {
  readonly modules: ReadonlyArray<RustModuleFact>
  readonly items: ReadonlyArray<RustItemFact>
  readonly uses: ReadonlyArray<RustUseFact>
  readonly functions: ReadonlyArray<RustFunctionFact>
  readonly matches: ReadonlyArray<RustMatchFact>
  readonly identifiers: ReadonlyArray<RustIdentifierFact>
  readonly modulesByPath: ReadonlyMap<string, RustModuleFact>
  readonly itemsByModuleAndName: ReadonlyMap<string, RustItemFact>
}

interface RustFactCollections {
  readonly modules: Array<RustModuleFact>
  readonly items: Array<RustItemFact>
  readonly uses: Array<RustUseFact>
  readonly functions: Array<RustFunctionFact>
  readonly matches: Array<RustMatchFact>
  readonly identifiers: Array<RustIdentifierFact>
  readonly modulesByPath: Map<string, RustModuleFact>
  readonly itemsByModuleAndName: Map<string, RustItemFact>
}

interface RustFileFactContext {
  readonly manifest: RustManifestInfo | undefined
  readonly crateName: string
  readonly file: string
  readonly baseModuleSegments: ReadonlyArray<string>
}

interface RustNodeFactContext {
  readonly crateName: string
  readonly file: string
  readonly relativeModulePath: string
  readonly modulePath: string
}

const ROOT_VISIBILITY: RustVisibility = { kind: "pub" }

const SURFACE_ITEM_TYPES = new Set<RustItemFact["kind"]>([
  "fn",
  "struct",
  "enum",
  "trait",
  "mod",
  "const",
  "static",
  "type",
])

const BRANCHING_NODE_TYPES = new Set([
  "if_expression",
  "for_expression",
  "while_expression",
  "loop_expression",
])

const normalizePath = (path: string): string => path.replaceAll("\\", "/")

const namedChildrenOf = (node: RustSyntaxNode): ReadonlyArray<RustSyntaxNode> =>
  node.namedChildren.filter((child): child is RustSyntaxNode => child !== null)

const walkNode = (
  node: RustSyntaxNode,
  visit: (node: RustSyntaxNode, ancestors: ReadonlyArray<RustSyntaxNode>) => void,
  ancestors: ReadonlyArray<RustSyntaxNode> = [],
): void => {
  visit(node, ancestors)
  const nextAncestors = [...ancestors, node]
  for (const child of namedChildrenOf(node)) {
    walkNode(child, visit, nextAncestors)
  }
}

const toModulePath = (crateName: string, relativeModulePath: string): string =>
  `${crateName}::${relativeModulePath}`

const typeChild = (node: RustSyntaxNode): RustSyntaxNode | undefined =>
  namedChildrenOf(node).find((child) =>
    [
      "primitive_type",
      "reference_type",
      "pointer_type",
      "generic_type",
      "tuple_type",
      "type_identifier",
      "scoped_type_identifier",
      "unit_type",
      "array_type",
      "function_type",
      "dynamic_type",
      "slice_type",
      "bounded_type",
    ].includes(child.type),
  )

const firstNamedChild = (
  node: RustSyntaxNode,
  type: string,
): RustSyntaxNode | undefined => namedChildrenOf(node).find((child) => child.type === type)

const allNamedChildren = (node: RustSyntaxNode, type: string): ReadonlyArray<RustSyntaxNode> =>
  namedChildrenOf(node).filter((child) => child.type === type)

const itemName = (node: RustSyntaxNode): string | undefined => {
  switch (node.type) {
    case "function_item":
    case "const_item":
    case "static_item":
    case "mod_item":
      return firstNamedChild(node, "identifier")?.text
    case "struct_item":
    case "enum_item":
    case "trait_item":
    case "type_item":
      return (
        firstNamedChild(node, "type_identifier")?.text ?? firstNamedChild(node, "identifier")?.text
      )
    case "impl_item":
      return firstNamedChild(node, "type_identifier")?.text ?? typeChild(node)?.text
    default:
      return undefined
  }
}

const parseVisibility = (node: RustSyntaxNode): RustVisibility => {
  const modifier = firstNamedChild(node, "visibility_modifier")
  if (modifier === undefined) return { kind: "private" }
  const text = modifier.text.trim()
  if (text === "pub") return { kind: "pub" }
  if (text === "pub(crate)") return { kind: "pub-crate" }
  if (text === "pub(super)") return { kind: "pub-super" }
  if (text.startsWith("pub(in ") && text.endsWith(")")) {
    return {
      kind: "pub-in-path",
      path: text.slice("pub(in ".length, -1).trim(),
    }
  }
  return { kind: "private" }
}

export const isExternallyVisible = (visibility: RustVisibility): boolean =>
  visibility.kind === "pub"

const splitModulePath = (relativePath: string): Array<string> => {
  const withoutExtension = relativePath.replace(/\.rs$/, "")
  if (withoutExtension.endsWith("/mod")) {
    const parent = withoutExtension.slice(0, -"/mod".length)
    return parent.length === 0 ? [] : parent.split("/")
  }
  return withoutExtension.length === 0 ? [] : withoutExtension.split("/")
}

const moduleSegmentsFromFile = (
  filePath: string,
  manifest: RustManifestInfo | undefined,
): Array<string> => {
  if (manifest === undefined) return []
  const normalizedFile = normalizePath(filePath)
  const normalizedRoot = normalizePath(manifest.path)
  const relative = normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile

  if (relative === "src/lib.rs") return ["crate"]
  if (relative === "src/main.rs") return ["bin", manifest.packageName ?? manifest.name]
  if (relative.startsWith("src/bin/")) {
    return ["bin", ...splitModulePath(relative.slice("src/bin/".length))]
  }
  if (relative.startsWith("src/")) {
    return ["crate", ...splitModulePath(relative.slice("src/".length))]
  }
  if (relative.startsWith("tests/")) {
    return ["tests", ...splitModulePath(relative.slice("tests/".length))]
  }
  if (relative.startsWith("examples/")) {
    return ["examples", ...splitModulePath(relative.slice("examples/".length))]
  }
  if (relative.startsWith("benches/")) {
    return ["benches", ...splitModulePath(relative.slice("benches/".length))]
  }
  return ["crate", ...splitModulePath(relative)]
}

const resolveManifestForFile = (
  filePath: string,
  manifests: ReadonlyArray<RustManifestInfo>,
): RustManifestInfo | undefined => {
  const normalizedFile = normalizePath(filePath)
  return manifests
    .slice()
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)
    .find((manifest) => normalizedFile.startsWith(`${normalizePath(manifest.path)}/`))
}

const collectInlineModuleSegments = (ancestors: ReadonlyArray<RustSyntaxNode>): Array<string> =>
  ancestors
    .filter((ancestor) => ancestor.type === "mod_item")
    .map((ancestor) => firstNamedChild(ancestor, "identifier")?.text)
    .filter((name): name is string => name !== undefined)

const segmentsFromScopedNode = (node: RustSyntaxNode): Array<string> => {
  switch (node.type) {
    case "identifier":
    case "crate":
    case "self":
    case "super":
      return [node.text]
    case "scoped_identifier":
    case "scoped_type_identifier":
      return namedChildrenOf(node).flatMap((child) => segmentsFromScopedNode(child))
    default:
      return []
  }
}

const flattenUseSegments = (
  node: RustSyntaxNode,
  prefix: ReadonlyArray<string> = [],
): Array<ReadonlyArray<string>> => {
  switch (node.type) {
    case "use_declaration":
      return namedChildrenOf(node).flatMap((child) =>
        child.type === "visibility_modifier" ? [] : flattenUseSegments(child, prefix),
      )
    case "use_as_clause": {
      const target = namedChildrenOf(node)[0]
      return target === undefined ? [] : flattenUseSegments(target, prefix)
    }
    case "scoped_use_list": {
      const children = namedChildrenOf(node)
      const base = children[0]
      const rest = children[1]
      const nextPrefix =
        base === undefined ? [...prefix] : [...prefix, ...segmentsFromScopedNode(base)]
      return rest === undefined ? [nextPrefix] : flattenUseSegments(rest, nextPrefix)
    }
    case "use_list":
      return namedChildrenOf(node).flatMap((child) => flattenUseSegments(child, prefix))
    case "use_wildcard":
      return [[...prefix, "*"]]
    case "identifier":
    case "crate":
    case "self":
    case "super":
    case "scoped_identifier":
    case "scoped_type_identifier":
      return [[...prefix, ...segmentsFromScopedNode(node)]]
    default:
      return []
  }
}

const returnTypeOfFunction = (node: RustSyntaxNode): RustSyntaxNode | undefined => {
  const namedChildren = namedChildrenOf(node)
  const parametersIndex = namedChildren.findIndex((child) => child.type === "parameters")
  if (parametersIndex === -1) return undefined
  return namedChildren.slice(parametersIndex + 1).find(
    (child) => child.type !== "where_clause" && child.type !== "block",
  )
}

const lifetimeCountInNode = (node: RustSyntaxNode | undefined): number => {
  if (node === undefined) return 0
  let count = 0
  walkNode(node, (current) => {
    if (current.type === "lifetime") count += 1
  })
  return count
}

const resultErrorType = (returnType: RustSyntaxNode | undefined): string | undefined => {
  if (returnType?.type !== "generic_type") return undefined
  const target = namedChildrenOf(returnType)[0]?.text ?? ""
  if (!target.endsWith("Result")) return undefined
  const typeArguments = firstNamedChild(returnType, "type_arguments")
  const args = typeArguments === undefined ? [] : namedChildrenOf(typeArguments)
  return args[1]?.text
}

const countUnsafeBlocks = (node: RustSyntaxNode): number => {
  let count = 0
  walkNode(node, (current) => {
    if (current.type === "unsafe_block") count += 1
  })
  return count
}

const countRawPointerParams = (node: RustSyntaxNode): number =>
  allNamedChildren(firstNamedChild(node, "parameters") ?? node, "parameter").filter((parameter) =>
    walkAny(parameter, (current) => current.type === "pointer_type"),
  ).length

const walkAny = (
  node: RustSyntaxNode,
  predicate: (node: RustSyntaxNode) => boolean,
): boolean => {
  if (predicate(node)) return true
  return namedChildrenOf(node).some((child) => walkAny(child, predicate))
}

const cyclomaticComplexity = (node: RustSyntaxNode): number => {
  let complexity = 1
  walkNode(node, (current) => {
    if (current.id === node.id) return
    if (BRANCHING_NODE_TYPES.has(current.type)) {
      complexity += 1
      return
    }
    if (current.type === "match_arm") {
      complexity += 1
      return
    }
    if (current.type === "binary_expression" && /&&|\|\|/.test(current.text)) {
      complexity += 1
    }
  })
  return complexity
}

const matchFactFromNode = (
  node: RustSyntaxNode,
  crateName: string,
  file: string,
  relativeModulePath: string,
  functionName: string,
): RustMatchFact => {
  const arms = allNamedChildren(firstNamedChild(node, "match_block") ?? node, "match_arm")
  const catchAllArmCount = arms.filter((arm) => {
    const pattern = firstNamedChild(arm, "match_pattern")
    if (pattern === undefined) return false
    const text = pattern.text.trim()
    return text === "_" || text.startsWith("_ if")
  }).length
  return {
    crateName,
    file,
    line: node.startPosition.row + 1,
    relativeModulePath,
    modulePath: toModulePath(crateName, relativeModulePath),
    functionName,
    armCount: arms.length,
    catchAllArmCount,
    hasCatchAll: catchAllArmCount > 0,
  }
}

const collectParameterIdentifiers = (node: RustSyntaxNode): Array<string> =>
  allNamedChildren(firstNamedChild(node, "parameters") ?? node, "parameter")
    .map((parameter) => firstNamedChild(parameter, "identifier")?.text)
    .filter((name): name is string => name !== undefined)

export const tokenizeIdentifier = (value: string): ReadonlyArray<string> => {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
}

const addIdentifier = (
  identifiers: Array<RustIdentifierFact>,
  fact: Omit<RustIdentifierFact, "tokens">,
): void => {
  identifiers.push({ ...fact, tokens: tokenizeIdentifier(fact.name) })
}

const itemKind = (node: RustSyntaxNode): RustItemFact["kind"] | undefined => {
  switch (node.type) {
    case "function_item":
      return "fn"
    case "struct_item":
      return "struct"
    case "enum_item":
      return "enum"
    case "trait_item":
      return "trait"
    case "impl_item":
      return "impl"
    case "mod_item":
      return "mod"
    case "const_item":
      return "const"
    case "static_item":
      return "static"
    case "type_item":
      return "type"
    default:
      return undefined
  }
}

export const collectRustProjectFacts = async (
  project: RustProject,
): Promise<RustAnalysis> => {
  const manifests = project.manifests.filter(
    (manifest) => manifest.packageName !== undefined,
  )
  const collections = emptyRustFactCollections()

  for (const file of project.sourceFiles) {
    await collectRustFileFacts(file, manifests, collections)
  }

  return {
    modules: collections.modules,
    items: collections.items,
    uses: collections.uses,
    functions: collections.functions,
    matches: collections.matches,
    identifiers: collections.identifiers,
    modulesByPath: collections.modulesByPath,
    itemsByModuleAndName: collections.itemsByModuleAndName,
  }
}

const emptyRustFactCollections = (): RustFactCollections => ({
  modules: [],
  items: [],
  uses: [],
  functions: [],
  matches: [],
  identifiers: [],
  modulesByPath: new Map(),
  itemsByModuleAndName: new Map(),
})

const collectRustFileFacts = async (
  file: string,
  manifests: ReadonlyArray<RustManifestInfo>,
  collections: RustFactCollections,
): Promise<void> => {
  const context = rustFileFactContext(file, manifests)
  ensureRootModule(context, collections)
  const tree = await parseRustFile(file)
  walkRustTree(tree, (node, ancestors) =>
    recordRustNodeFacts(node, rustNodeFactContext(context, ancestors), collections),
  )
}

const rustFileFactContext = (
  file: string,
  manifests: ReadonlyArray<RustManifestInfo>,
): RustFileFactContext => {
  const manifest = resolveManifestForFile(file, manifests)
  return {
    manifest,
    crateName: manifest?.packageName ?? manifest?.name ?? "crate",
    file,
    baseModuleSegments: moduleSegmentsFromFile(file, manifest),
  }
}

const ensureRootModule = (
  context: RustFileFactContext,
  collections: RustFactCollections,
): void => {
  const relativeModulePath = context.baseModuleSegments.join("::")
  const modulePath = toModulePath(context.crateName, relativeModulePath)
  if (collections.modulesByPath.has(modulePath)) return
  const rootModule: RustModuleFact = {
    crateName: context.crateName,
    file: context.file,
    line: 1,
    relativeModulePath,
    modulePath,
    visibility: ROOT_VISIBILITY,
  }
  collections.modules.push(rootModule)
  collections.modulesByPath.set(modulePath, rootModule)
}

const rustNodeFactContext = (
  fileContext: RustFileFactContext,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): RustNodeFactContext => {
  const relativeModuleSegments = [
    ...fileContext.baseModuleSegments,
    ...collectInlineModuleSegments(ancestors),
  ]
  const relativeModulePath = relativeModuleSegments.join("::")
  return {
    crateName: fileContext.crateName,
    file: fileContext.file,
    relativeModulePath,
    modulePath: toModulePath(fileContext.crateName, relativeModulePath),
  }
}

const recordRustNodeFacts = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  recordRustUseFacts(node, context, collections)
  recordRustItemFact(node, context, collections)
  recordRustFunctionFact(node, context, collections)
}

const recordRustUseFacts = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  if (node.type !== "use_declaration") return
  const flattened = flattenUseSegments(node)
    .map((segments) => segments.filter((segment) => segment !== "self"))
    .filter((segments) => segments.length > 0)
  const visibility = parseVisibility(node)
  for (const segments of flattened) {
    collections.uses.push({
      ...context,
      line: node.startPosition.row + 1,
      visibility,
      path: segments.join("::"),
      segments,
    })
  }
}

const recordRustItemFact = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  const kind = itemKind(node)
  const name = kind === undefined ? undefined : itemName(node)
  if (kind === undefined || name === undefined) return

  const visibility = parseVisibility(node)
  const item: RustItemFact = {
    ...context,
    kind,
    name,
    visibility,
    line: node.startPosition.row + 1,
  }
  collections.items.push(item)
  if (SURFACE_ITEM_TYPES.has(kind)) {
    collections.itemsByModuleAndName.set(`${context.modulePath}::${name}`, item)
  }
  addIdentifier(collections.identifiers, {
    ...context,
    line: item.line,
    kind: kind === "fn" ? "function" : "item",
    name,
  })
  if (kind === "mod") {
    ensureInlineModule(node, context, name, visibility, collections)
  }
}

const ensureInlineModule = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  name: string,
  visibility: RustVisibility,
  collections: RustFactCollections,
): void => {
  const relativeModulePath =
    context.relativeModulePath.length === 0
      ? name
      : `${context.relativeModulePath}::${name}`
  const modulePath = toModulePath(context.crateName, relativeModulePath)
  if (collections.modulesByPath.has(modulePath)) return
  const moduleFact: RustModuleFact = {
    crateName: context.crateName,
    file: context.file,
    line: node.startPosition.row + 1,
    relativeModulePath,
    modulePath,
    visibility,
  }
  collections.modules.push(moduleFact)
  collections.modulesByPath.set(modulePath, moduleFact)
}

const recordRustFunctionFact = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  if (node.type !== "function_item") return
  const name = itemName(node) ?? "<anonymous>"
  collections.functions.push(rustFunctionFactFromNode(node, context, name))
  recordFunctionParameterIdentifiers(node, context, collections)
  recordFunctionMatchFacts(node, context, name, collections)
}

const rustFunctionFactFromNode = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  name: string,
): RustFunctionFact => {
  const returnType = returnTypeOfFunction(node)
  return {
    ...context,
    name,
    line: node.startPosition.row + 1,
    visibility: parseVisibility(node),
    isUnsafeFn: (firstNamedChild(node, "function_modifiers")?.text ?? "").includes("unsafe"),
    unsafeBlockCount: countUnsafeBlocks(node),
    rawPointerParamCount: countRawPointerParams(node),
    rawPointerReturn: walkAny(returnType ?? node, (current) => current.type === "pointer_type"),
    lifetimeParamCount: allNamedChildren(
      firstNamedChild(node, "type_parameters") ?? node,
      "lifetime_parameter",
    ).length,
    lifetimeBoundCount: lifetimeBoundCountOfFunction(node),
    lifetimeInputCount: lifetimeCountInNode(firstNamedChild(node, "parameters")),
    lifetimeOutputCount: lifetimeCountInNode(returnType),
    lifetimeConstraintCount: lifetimeCountInNode(firstNamedChild(node, "where_clause")),
    returnTypeText: returnType?.text,
    resultErrorType: resultErrorType(returnType),
    complexity: cyclomaticComplexity(node),
  }
}

const lifetimeBoundCountOfFunction = (node: RustSyntaxNode): number =>
  allNamedChildren(firstNamedChild(node, "type_parameters") ?? node, "lifetime_parameter")
    .map((lifetime) => lifetimeCountInNode(firstNamedChild(lifetime, "trait_bounds")))
    .reduce((sum, count) => sum + count, 0) +
  lifetimeCountInNode(firstNamedChild(node, "where_clause"))

const recordFunctionParameterIdentifiers = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  for (const parameterName of collectParameterIdentifiers(node)) {
    addIdentifier(collections.identifiers, {
      ...context,
      line: node.startPosition.row + 1,
      kind: "parameter",
      name: parameterName,
    })
  }
}

const recordFunctionMatchFacts = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  functionName: string,
  collections: RustFactCollections,
): void => {
  walkNode(node, (current) => {
    if (current.type !== "match_expression") return
    collections.matches.push(
      matchFactFromNode(
        current,
        context.crateName,
        context.file,
        context.relativeModulePath,
        functionName,
      ),
    )
  })
}
