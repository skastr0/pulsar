import type { RustSyntaxNode } from "./syn-walker.js"
import { namedChildrenOf, parseVisibility } from "./rust-analysis-syntax.js"
import type { RustFactCollections, RustNodeFactContext } from "./rust-analysis-types.js"

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
    case "use_wildcard": {
      const base = namedChildrenOf(node)[0]
      const baseSegments = base === undefined ? [] : segmentsFromScopedNode(base)
      return [[...prefix, ...baseSegments, "*"]]
    }
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

export const recordRustUseFacts = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
): void => {
  if (node.type !== "use_declaration") return
  const flattened = flattenUseSegments(node)
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
