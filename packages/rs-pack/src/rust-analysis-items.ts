import type { RustSyntaxNode } from "./syn-walker.js"
import { toModulePath } from "./rust-analysis-modules.js"
import { itemKind, itemName, parseVisibility } from "./rust-analysis-syntax.js"
import type {
  RustFactCollections,
  RustItemFact,
  RustModuleFact,
  RustNodeFactContext,
  RustVisibility,
} from "./rust-analysis-types.js"

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

export const recordRustItemFact = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
  addIdentifier: (
    identifiers: Array<RustFactCollections["identifiers"][number]>,
    fact: Omit<RustFactCollections["identifiers"][number], "tokens">,
  ) => void,
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
