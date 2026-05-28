import { type RustProject } from "../project.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import {
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import type { UnsafeSite, UnsafeSiteKind } from "./rs-ld-01-unsafe-model.js"

export const collectUnsafeSites = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlyArray<UnsafeSite>> => {
  const sites: Array<UnsafeSite> = []
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated) return
      const site = unsafeSiteFromNode(file, scope, node, ancestors)
      if (site !== undefined) sites.push(site)
    })
  }
  return sites.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.kind.localeCompare(right.kind) ||
      (left.name ?? "").localeCompare(right.name ?? ""),
  )
}

const unsafeSiteFromNode = (
  file: string,
  scope: ReturnType<typeof resolveRustFileScope>,
  node: RustSyntaxNode,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): UnsafeSite | undefined => {
  const kind = unsafeSiteKind(node, ancestors)
  if (kind === undefined) return undefined
  const { modulePath } = modulePathForAncestors(scope, ancestors)
  const name = unsafeSiteName(node, kind)
  return {
    kind,
    module: modulePath,
    file,
    line: node.startPosition.row + 1,
    name,
    functionName: kind === "unsafe_block" ? nearestFunctionName(ancestors) : name,
  }
}

const unsafeSiteKind = (
  node: RustSyntaxNode,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): UnsafeSiteKind | undefined => {
  if (node.type === "unsafe_block") return "unsafe_block"
  if (node.type === "function_item" && hasUnsafeFunctionModifier(node)) return "unsafe_function"
  if (node.type === "function_signature_item" && hasAncestor(ancestors, "foreign_mod_item")) {
    return "foreign_function"
  }
  if (node.type === "function_signature_item" && hasUnsafeFunctionModifier(node)) {
    return "unsafe_function_signature"
  }
  if (node.type === "trait_item" && /\bunsafe\s+trait\b/.test(node.text)) return "unsafe_trait"
  if (node.type === "impl_item" && /^\s*unsafe\s+impl\b/.test(node.text)) return "unsafe_impl"
  if (node.type === "static_item" && firstNamedChild(node, "mutable_specifier") !== undefined) {
    return "static_mut"
  }
  return undefined
}

const unsafeSiteName = (node: RustSyntaxNode, kind: UnsafeSiteKind): string | undefined => {
  if (kind === "unsafe_impl") return node.text.split("{")[0]?.trim()
  return (
    firstNamedChild(node, "identifier")?.text ??
    firstNamedChild(node, "type_identifier")?.text
  )
}

const hasUnsafeFunctionModifier = (node: RustSyntaxNode): boolean =>
  (firstNamedChild(node, "function_modifiers")?.text ?? "").includes("unsafe")

const hasAncestor = (ancestors: ReadonlyArray<RustSyntaxNode>, type: string): boolean =>
  ancestors.some((ancestor) => ancestor.type === type)

const nearestFunctionName = (ancestors: ReadonlyArray<RustSyntaxNode>): string | undefined => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    if (ancestor.type === "function_item" || ancestor.type === "function_signature_item") {
      return firstNamedChild(ancestor, "identifier")?.text
    }
  }
  return undefined
}

