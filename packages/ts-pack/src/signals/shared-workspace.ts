import { builtinModules } from "node:module"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { nearestPackageForPath } from "../package-ownership.js"
import { matchesAnyGlob } from "./shared-globs.js"

export interface BoundaryRule {
  readonly name: string
  readonly globs: ReadonlyArray<string>
}

type DependencyGroupName =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies"

const NODE_BUILTINS = new Set(
  [
    ...builtinModules.flatMap((entry) => {
      const bare = entry.startsWith("node:") ? entry.slice(5) : entry
      return [bare, `node:${bare}`]
    }),
    "test",
    "node:test",
    "sqlite",
    "node:sqlite",
  ],
)

const NODE_MODULES_SEGMENT = "/node_modules/"

export const packageForFile = (
  filePath: string,
  packages: ReadonlyArray<PackageInfo>,
): PackageInfo | undefined =>
  // Files under node_modules belong to the external package installed
  // there (hoisted dependencies resolve to <root>/node_modules/*), never
  // to the workspace package whose directory happens to contain them.
  externalPackageNameForFile(filePath) === undefined
    ? nearestPackageForPath(filePath, packages)
    : undefined

/**
 * The external package that owns a file under node_modules, derived from
 * the path segments after the last node_modules directory (which is how
 * the module resolver attributes the file, including pnpm-style layouts).
 * Returns undefined for files outside node_modules.
 */
export const externalPackageNameForFile = (filePath: string): string | undefined => {
  const normalized = filePath.replaceAll("\\", "/")
  const markerIndex = normalized.lastIndexOf(NODE_MODULES_SEGMENT)
  if (markerIndex === -1) return undefined
  const segments = normalized
    .slice(markerIndex + NODE_MODULES_SEGMENT.length)
    .split("/")
    .filter((segment) => segment.length > 0)
  const [scopeOrName, scopedName] = segments
  if (scopeOrName === undefined) return undefined
  if (scopeOrName.startsWith("@")) {
    return scopedName === undefined ? undefined : `${scopeOrName}/${scopedName}`
  }
  return scopeOrName
}

export const packageDisplayName = (pkg: PackageInfo | undefined): string | undefined =>
  pkg?.manifest?.name ?? pkg?.name

export const workspacePackageNames = (
  packages: ReadonlyArray<PackageInfo>,
): ReadonlySet<string> =>
  new Set(
    packages
      .map((pkg) => pkg.manifest?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  )

export const dependencyNamesOf = (
  manifest: PackageManifest | undefined,
  groups: ReadonlyArray<DependencyGroupName>,
): ReadonlySet<string> => {
  if (manifest === undefined) return new Set<string>()
  const names = new Set<string>()
  for (const group of groups) {
    Object.keys(manifest[group]).forEach((name) => names.add(name))
  }
  return names
}

export const normalizePackageSpecifier = (specifier: string): string | undefined => {
  if (specifier.length === 0) return undefined
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return undefined
  }
  if (specifier.startsWith("@/")) return undefined
  if (specifier.startsWith("bun:")) return specifier
  const withoutProtocol = specifier.startsWith("npm:")
    ? stripNpmSpecifierVersion(specifier.slice(4))
    : specifier
  if (withoutProtocol.startsWith("node:")) {
    return withoutProtocol
  }
  if (withoutProtocol.includes(":")) return undefined

  const segments = withoutProtocol.split("/")
  if (withoutProtocol.startsWith("@")) {
    if (segments.length < 2) return withoutProtocol
    return `${segments[0]}/${segments[1]}`
  }
  return segments[0] === undefined ? undefined : segments[0]
}

const stripNpmSpecifierVersion = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    const versionIndex = specifier.indexOf("@", 1)
    return versionIndex === -1 ? specifier : specifier.slice(0, versionIndex)
  }
  const versionIndex = specifier.indexOf("@")
  return versionIndex === -1 ? specifier : specifier.slice(0, versionIndex)
}

export const isBuiltinModuleName = (packageName: string): boolean =>
  packageName.startsWith("bun:") || NODE_BUILTINS.has(packageName)

export const boundaryOfFile = (
  filePath: string,
  rules: ReadonlyArray<BoundaryRule>,
): string | undefined => {
  const match = rules.find((rule) => matchesAnyGlob(filePath, rule.globs))
  return match?.name
}
