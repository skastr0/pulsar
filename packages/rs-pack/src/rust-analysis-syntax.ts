import type { RustSyntaxNode } from "./syn-walker.js"
import type { RustItemFact, RustVisibility } from "./rust-analysis-types.js"

export const namedChildrenOf = (node: RustSyntaxNode): ReadonlyArray<RustSyntaxNode> =>
  node.namedChildren.filter((child): child is RustSyntaxNode => child !== null)

export const walkNode = (
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

export const typeChild = (node: RustSyntaxNode): RustSyntaxNode | undefined =>
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

export const firstNamedChild = (
  node: RustSyntaxNode,
  type: string,
): RustSyntaxNode | undefined => namedChildrenOf(node).find((child) => child.type === type)

export const allNamedChildren = (
  node: RustSyntaxNode,
  type: string,
): ReadonlyArray<RustSyntaxNode> => namedChildrenOf(node).filter((child) => child.type === type)

export const walkAny = (
  node: RustSyntaxNode,
  predicate: (node: RustSyntaxNode) => boolean,
): boolean => {
  if (predicate(node)) return true
  return namedChildrenOf(node).some((child) => walkAny(child, predicate))
}

export const itemName = (node: RustSyntaxNode): string | undefined => {
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

export const parseVisibility = (node: RustSyntaxNode): RustVisibility => {
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

export const itemKind = (node: RustSyntaxNode): RustItemFact["kind"] | undefined => {
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
