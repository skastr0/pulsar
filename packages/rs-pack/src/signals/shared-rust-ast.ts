import { relative } from "node:path"
import type { ChangedHunk } from "@skastr0/pulsar-core/signal"
import type { RustManifestInfo, RustProject } from "../project.js"
import type { RustSyntaxNode } from "../syn-walker.js"
import { normalizePath } from "./shared-globs.js"

export const DEFAULT_RUST_EXCLUDE_GLOBS = [
  "**/target/**",
  "**/tests/**",
  "**/examples/**",
  "**/benches/**",
] as const

interface RustFileScope {
  readonly file: string
  readonly crateName: string
  readonly manifest: RustManifestInfo | undefined
  readonly baseModuleSegments: ReadonlyArray<string>
  readonly relativeModulePath: string
  readonly modulePath: string
}

interface AttributedNodeVisit {
  readonly node: RustSyntaxNode
  readonly ancestors: ReadonlyArray<RustSyntaxNode>
  readonly attachedAttributes: ReadonlyArray<RustSyntaxNode>
  readonly testGated: boolean
}

export const namedChildrenOf = (node: RustSyntaxNode): ReadonlyArray<RustSyntaxNode> =>
  node.namedChildren.filter((child): child is RustSyntaxNode => child !== null)

export const firstNamedChild = (
  node: RustSyntaxNode,
  type: string,
): RustSyntaxNode | undefined => namedChildrenOf(node).find((child) => child.type === type)

export const allNamedChildren = (
  node: RustSyntaxNode,
  type: string,
): ReadonlyArray<RustSyntaxNode> => namedChildrenOf(node).filter((child) => child.type === type)

const toModulePath = (crateName: string, relativeModulePath: string): string =>
  `${crateName}::${relativeModulePath}`

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
  const relativePath = normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile

  if (relativePath === "src/lib.rs") return ["crate"]
  if (relativePath === "src/main.rs") return ["bin", manifest.packageName ?? manifest.name]
  if (relativePath.startsWith("src/bin/")) {
    return ["bin", ...splitModulePath(relativePath.slice("src/bin/".length))]
  }
  if (relativePath.startsWith("src/")) {
    return ["crate", ...splitModulePath(relativePath.slice("src/".length))]
  }
  if (relativePath.startsWith("tests/")) {
    return ["tests", ...splitModulePath(relativePath.slice("tests/".length))]
  }
  if (relativePath.startsWith("examples/")) {
    return ["examples", ...splitModulePath(relativePath.slice("examples/".length))]
  }
  if (relativePath.startsWith("benches/")) {
    return ["benches", ...splitModulePath(relativePath.slice("benches/".length))]
  }
  return ["crate", ...splitModulePath(relativePath)]
}

const resolveManifestForFile = (
  filePath: string,
  manifests: ReadonlyArray<RustManifestInfo>,
): RustManifestInfo | undefined => {
  const normalizedFile = normalizePath(filePath)
  return manifests
    .slice()
    .sort((left, right) => normalizePath(right.path).length - normalizePath(left.path).length)
    .find((manifest) => normalizedFile.startsWith(`${normalizePath(manifest.path)}/`))
}

export const resolveRustFileScope = (
  project: RustProject,
  file: string,
): RustFileScope => {
  const manifest = resolveManifestForFile(file, project.manifests)
  const crateName = manifest?.packageName ?? manifest?.name ?? "crate"
  const baseModuleSegments = moduleSegmentsFromFile(file, manifest)
  const relativeModulePath = baseModuleSegments.join("::")
  return {
    file,
    crateName,
    manifest,
    baseModuleSegments,
    relativeModulePath,
    modulePath: toModulePath(crateName, relativeModulePath),
  }
}

export const modulePathForAncestors = (
  scope: RustFileScope,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): { readonly relativeModulePath: string; readonly modulePath: string } => {
  const inlineSegments = ancestors
    .filter((ancestor) => ancestor.type === "mod_item")
    .map((ancestor) => firstNamedChild(ancestor, "identifier")?.text)
    .filter((name): name is string => name !== undefined)
  const relativeModulePath = [...scope.baseModuleSegments, ...inlineSegments].join("::")
  return {
    relativeModulePath,
    modulePath: toModulePath(scope.crateName, relativeModulePath),
  }
}

export const isCfgTestAttribute = (value: RustSyntaxNode | string): boolean => {
  const text = typeof value === "string" ? value : value.text
  return /#\s*!?\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(text)
}

export const walkAttributedNodes = (
  root: RustSyntaxNode,
  visit: (entry: AttributedNodeVisit) => void,
): void => {
  const walkContainer = (
    node: RustSyntaxNode,
    ancestors: ReadonlyArray<RustSyntaxNode>,
    inheritedTestGated: boolean,
  ): void => {
    let pendingAttributes: Array<RustSyntaxNode> = []
    for (const child of namedChildrenOf(node)) {
      if (child.type === "attribute_item" || child.type === "inner_attribute_item") {
        pendingAttributes.push(child)
        continue
      }

      const childAncestors = [...ancestors, node]
      const testGated = inheritedTestGated || pendingAttributes.some(isCfgTestAttribute)
      visit({
        node: child,
        ancestors: childAncestors,
        attachedAttributes: pendingAttributes,
        testGated,
      })
      walkContainer(child, childAncestors, testGated)
      pendingAttributes = []
    }
  }

  walkContainer(root, [], false)
}

export const lineRangeOverlapsChangedHunks = (
  file: string,
  startLine: number,
  endLine: number,
  worktreePath: string,
  hunks: ReadonlyArray<ChangedHunk>,
): boolean => {
  if (hunks.length === 0) return true
  const normalizedFile = normalizePath(file)
  const relativeFile = normalizePath(relative(worktreePath, file))

  return hunks.some((hunk) => {
    const hunkFile = normalizePath(hunk.file)
    if (hunkFile !== normalizedFile && hunkFile !== relativeFile) return false
    const hunkStart = hunk.newStart
    const hunkEnd = hunk.newLines === 0 ? hunk.newStart : hunk.newStart + hunk.newLines - 1
    return startLine <= hunkEnd && endLine >= hunkStart
  })
}
