import type { RustManifestInfo } from "./project.js"
import type { RustSyntaxNode } from "./syn-walker.js"
import { firstNamedChild } from "./rust-analysis-syntax.js"

export const normalizePath = (path: string): string => path.replaceAll("\\", "/")

export const toModulePath = (crateName: string, relativeModulePath: string): string =>
  `${crateName}::${relativeModulePath}`

export const moduleSegmentsFromFile = (
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

export const resolveManifestForFile = (
  filePath: string,
  manifests: ReadonlyArray<RustManifestInfo>,
): RustManifestInfo | undefined => {
  const normalizedFile = normalizePath(filePath)
  return manifests
    .slice()
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)
    .find((manifest) => normalizedFile.startsWith(`${normalizePath(manifest.path)}/`))
}

export const collectInlineModuleSegments = (
  ancestors: ReadonlyArray<RustSyntaxNode>,
): Array<string> =>
  ancestors
    .filter((ancestor) => ancestor.type === "mod_item")
    .map((ancestor) => firstNamedChild(ancestor, "identifier")?.text)
    .filter((name): name is string => name !== undefined)

const splitModulePath = (relativePath: string): Array<string> => {
  const withoutExtension = relativePath.replace(/\.rs$/, "")
  if (withoutExtension.endsWith("/mod")) {
    const parent = withoutExtension.slice(0, -"/mod".length)
    return parent.length === 0 ? [] : parent.split("/")
  }
  return withoutExtension.length === 0 ? [] : withoutExtension.split("/")
}
