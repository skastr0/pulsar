import { builtinModules } from "node:module"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { matchesAnyGlob } from "./shared-globs.js"

export interface BoundaryRule {
  readonly name: string
  readonly globs: ReadonlyArray<string>
}

export type DependencyGroupName =
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

export const packageForFile = (
  filePath: string,
  packages: ReadonlyArray<PackageInfo>,
): PackageInfo | undefined =>
  packages
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((pkg) => filePath === pkg.path || filePath.startsWith(`${pkg.path}/`))

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
  const withoutProtocol = specifier.startsWith("npm:") ? specifier.slice(4) : specifier
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

export const isBuiltinModuleName = (packageName: string): boolean =>
  packageName.startsWith("bun:") || NODE_BUILTINS.has(packageName)

export const boundaryOfFile = (
  filePath: string,
  rules: ReadonlyArray<BoundaryRule>,
): string | undefined => {
  const match = rules.find((rule) => matchesAnyGlob(filePath, rule.globs))
  return match?.name
}
