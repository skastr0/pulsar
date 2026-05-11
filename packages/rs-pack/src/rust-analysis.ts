import { parseRustFile, type RustSyntaxNode, walkRustTree } from "./syn-walker.js"
import type { RustManifestInfo, RustProject } from "./project.js"
import { recordRustFunctionFact } from "./rust-analysis-functions.js"
import {
  collectInlineModuleSegments,
  moduleSegmentsFromFile,
  resolveManifestForFile,
  toModulePath,
} from "./rust-analysis-modules.js"
import {
  firstNamedChild,
  itemKind,
  itemName,
  namedChildrenOf,
  parseVisibility,
  tokenizeIdentifier,
} from "./rust-analysis-syntax.js"
import type {
  RustAnalysis,
  RustFactCollections,
  RustFileFactContext,
  RustIdentifierFact,
  RustItemFact,
  RustModuleFact,
  RustNodeFactContext,
  RustVisibility,
} from "./rust-analysis-types.js"
export type {
  RustAnalysis,
  RustFunctionFact,
  RustIdentifierFact,
  RustItemFact,
  RustMatchFact,
  RustModuleFact,
  RustUseFact,
  RustVisibility,
} from "./rust-analysis-types.js"
export { tokenizeIdentifier } from "./rust-analysis-syntax.js"

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

export const isExternallyVisible = (visibility: RustVisibility): boolean =>
  visibility.kind === "pub"

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

const addIdentifier = (
  identifiers: Array<RustIdentifierFact>,
  fact: Omit<RustIdentifierFact, "tokens">,
): void => {
  identifiers.push({ ...fact, tokens: tokenizeIdentifier(fact.name) })
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
  recordRustFunctionFact(node, context, collections, addIdentifier)
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
