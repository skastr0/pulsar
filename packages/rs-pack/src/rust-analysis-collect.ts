import { parseRustFile, type RustSyntaxNode, walkRustTree } from "./syn-walker.js"
import type { RustManifestInfo, RustProject } from "./project.js"
import { recordRustFunctionFact } from "./rust-analysis-functions.js"
import { addRustIdentifierFact } from "./rust-analysis-identifiers.js"
import { recordRustItemFact } from "./rust-analysis-items.js"
import {
  collectInlineModuleSegments,
  moduleSegmentsFromFile,
  resolveManifestForFile,
  toModulePath,
} from "./rust-analysis-modules.js"
import { recordRustUseFacts } from "./rust-analysis-uses.js"
import type {
  RustAnalysis,
  RustFactCollections,
  RustFileFactContext,
  RustModuleFact,
  RustNodeFactContext,
  RustVisibility,
} from "./rust-analysis-types.js"

const ROOT_VISIBILITY: RustVisibility = { kind: "pub" }

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
  recordRustItemFact(node, context, collections, addRustIdentifierFact)
  recordRustFunctionFact(node, context, collections, addRustIdentifierFact)
}
