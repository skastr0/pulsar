import { relative, sep } from "node:path"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { dependencyNamesOf } from "./shared-workspace.js"
import { matchesAnyGlob } from "./shared-globs.js"
import { escapeRegExp } from "./shared-regexp.js"
import { isBundledCliSourceFile } from "./ts-de-04-bundled-info.js"
import type {
  DependencyUsageContext,
  ManifestPackageInfo,
  TsDe04Config,
} from "./ts-de-04-model.js"

export const dependencyUsageContext = (
  owningPackage: ManifestPackageInfo,
  filePath: string,
  config: TsDe04Config,
): DependencyUsageContext => {
  const isToolingFile =
    isPackageToolingFile(owningPackage.path, filePath) ||
    isPackageScriptEntrypoint(owningPackage.manifest, owningPackage.path, filePath) ||
    isBundledCliSourceFile(owningPackage.manifest, owningPackage.path, filePath)
  return {
    filePath,
    isToolingFile,
    isProdFile: !isToolingFile && !matchesAnyGlob(filePath, config.test_globs),
  }
}

export const isDocusaurusApp = (manifest: PackageManifest): boolean => {
  const dependencyNames = dependencyNamesOf(manifest, ["dependencies", "devDependencies"])
  if (dependencyNames.has("@docusaurus/core") || dependencyNames.has("@docusaurus/preset-classic")) {
    return true
  }
  return Object.values(manifest.scripts).some((script) => /\bdocusaurus\b/.test(script))
}

export const isSvelteKitApp = (manifest: PackageManifest): boolean => {
  const dependencyNames = dependencyNamesOf(manifest, ["dependencies", "devDependencies"])
  if (dependencyNames.has("@sveltejs/kit")) return true
  return Object.values(manifest.scripts).some((script) => /\bsvelte-kit\b/.test(script))
}

export const isPackageToolingFile = (packagePath: string, file: string): boolean => {
  const rel = relative(packagePath, file).split(sep).join("/")
  if (rel.startsWith("script/") || rel.startsWith("scripts/")) return true
  return /\.(?:config|conf)\.(?:cjs|cts|js|mjs|mts|ts|tsx)$/.test(rel)
}

export const isPackageScriptEntrypoint = (
  manifest: PackageManifest,
  packagePath: string,
  file: string,
): boolean => {
  const rel = relative(packagePath, file).split(sep).join("/")
  if (rel.startsWith("..") || rel.startsWith("/")) return false
  const relPattern = escapeRegExp(rel)
  const optionalDotSlashRelPattern = `(?:\\./)?${relPattern}`
  const scriptEntrypointPattern = new RegExp(
    `(?:^|[\\s;&|()])(?:bun|node|tsx|ts-node)\\s+${optionalDotSlashRelPattern}(?=$|[\\s;&|()])`,
  )
  const directExecutablePattern = new RegExp(
    `(?:^|[\\s;&|()])${optionalDotSlashRelPattern}(?=$|[\\s;&|()])`,
  )
  return Object.values(manifest.scripts).some(
    (script) => scriptEntrypointPattern.test(script) || directExecutablePattern.test(script),
  )
}

export const manifestDeclaresDependency = (
  manifest: PackageManifest,
  dependencyName: string,
): boolean =>
  dependencyNamesOf(manifest, [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]).has(dependencyName)

export const createPackagePathMatcher = (
  packages: ReadonlyArray<PackageInfo>,
): ((filePath: string) => PackageInfo | undefined) => {
  const sortedPackages = [...packages].sort((left, right) => right.path.length - left.path.length)
  return (filePath: string): PackageInfo | undefined =>
    sortedPackages.find((pkg) => filePath === pkg.path || filePath.startsWith(`${pkg.path}/`))
}
