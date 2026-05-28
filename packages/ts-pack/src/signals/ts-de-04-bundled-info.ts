import { readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { mapWithConcurrency } from "../concurrency.js"
import { dependencyNamesOf, normalizePackageSpecifier } from "./shared-workspace.js"
import type { BundledPackageInfo } from "./ts-de-04-model.js"

export const isBundledCliSourceFile = (
  manifest: PackageManifest,
  packagePath: string,
  file: string,
): boolean => {
  if (Object.keys(manifest.bin ?? {}).length === 0) return false
  if (!hasBundledCliBuildPipeline(manifest)) return false

  const rel = relative(packagePath, file).split(sep).join("/")
  return (
    rel.startsWith("src/cli/") ||
    rel.startsWith("src/bundler/") ||
    rel.startsWith("cli/") ||
    rel.startsWith("bundler/")
  )
}

const hasBundledCliBuildPipeline = (manifest: PackageManifest): boolean => {
  const scriptText = Object.values(manifest.scripts).join("\n")
  const devDependencyNames = dependencyNamesOf(manifest, ["devDependencies"])
  return (
    /\b(?:build|bundle|prepack|pack)\b/.test(scriptText) &&
    ["@vercel/ncc", "bun", "esbuild", "rollup", "tsup", "webpack"].some((dependencyName) =>
      devDependencyNames.has(dependencyName),
    )
  )
}

export const readBundledInfoByPackage = async (
  packages: ReadonlyArray<PackageInfo>,
): Promise<ReadonlyMap<string, BundledPackageInfo>> => {
  const entries = await mapWithConcurrency(
    packages,
    8,
    async (pkg): Promise<[string, BundledPackageInfo]> => [
      pkg.path,
      await readBundledPackageInfo(pkg.path),
    ],
  )
  return new Map(entries)
}

const readBundledPackageInfo = async (packagePath: string): Promise<BundledPackageInfo> => {
  const configText = await readFirstExistingText([
    join(packagePath, "tsup.config.ts"),
    join(packagePath, "tsup.config.mts"),
    join(packagePath, "tsup.config.cts"),
    join(packagePath, "tsup.config.js"),
    join(packagePath, "tsup.config.mjs"),
    join(packagePath, "tsup.config.cjs"),
    join(packagePath, "esbuild.config.ts"),
    join(packagePath, "esbuild.config.mts"),
    join(packagePath, "esbuild.config.cts"),
    join(packagePath, "esbuild.config.js"),
    join(packagePath, "esbuild.config.mjs"),
    join(packagePath, "esbuild.config.cjs"),
    join(packagePath, "esbuild.ts"),
    join(packagePath, "esbuild.mts"),
    join(packagePath, "esbuild.cts"),
    join(packagePath, "esbuild.js"),
    join(packagePath, "esbuild.mjs"),
    join(packagePath, "esbuild.cjs"),
  ])

  if (configText === undefined || !/\bbundle\s*:\s*true\b/.test(configText)) {
    return {
      bundlesSource: false,
      externalPackageNames: new Set(),
      opaqueExternalConfig: false,
    }
  }

  return {
    bundlesSource: true,
    ...parseBundlerExternalPackageNames(configText),
  }
}

const readFirstExistingText = async (
  paths: ReadonlyArray<string>,
): Promise<string | undefined> => {
  for (const path of paths) {
    try {
      return await readFile(path, "utf8")
    } catch {
      continue
    }
  }
  return undefined
}

const parseBundlerExternalPackageNames = (
  configText: string,
): Pick<BundledPackageInfo, "externalPackageNames" | "opaqueExternalConfig"> => {
  const externalNames = new Set<string>()
  const externalMatch = /\bexternal\s*:\s*\[([\s\S]*?)\]/m.exec(configText)
  if (externalMatch === null) {
    return {
      externalPackageNames: externalNames,
      opaqueExternalConfig: hasOpaqueExternalConfig(configText),
    }
  }

  const externalBody = externalMatch[1]!
  const stringLiteralPattern = /["']([^"']+)["']/g
  for (const match of externalBody.matchAll(stringLiteralPattern)) {
    const dependencyName = normalizePackageSpecifier(match[1]!)
    if (dependencyName !== undefined) {
      externalNames.add(dependencyName)
    }
  }

  return {
    externalPackageNames: externalNames,
    opaqueExternalConfig: containsNonStringExternalEntry(externalBody),
  }
}

export const isBundledPackageSourceUsage = (
  owningPackage: PackageInfo,
  file: string,
  dependencyName: string,
  bundledInfo: BundledPackageInfo | undefined,
): boolean => {
  if (bundledInfo?.bundlesSource !== true) return false
  if (bundledInfo.opaqueExternalConfig) return false
  if (bundledInfo.externalPackageNames.has(dependencyName)) return false

  const rel = relative(owningPackage.path, file).split(sep).join("/")
  return rel.startsWith("src/") || isManifestEntrypoint(owningPackage.manifest, rel)
}

const containsNonStringExternalEntry = (externalBody: string): boolean => {
  const stripped = externalBody
    .replaceAll(/["'][^"']*["']/g, "")
    .replaceAll(/\/\/.*$/gm, "")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
  return stripped.split(",").some((entry) => entry.trim().length > 0)
}

const hasOpaqueExternalConfig = (configText: string): boolean =>
  /\bexternal\s*:/.test(configText) || /\bexternal\s*(?:,|\}\)|\})/.test(configText)

const isManifestEntrypoint = (
  manifest: PackageManifest | undefined,
  relativeFile: string,
): boolean => manifest?.entrypoints.some((entrypoint) =>
  normalizeEntrypoint(entrypoint) === relativeFile
) ?? false

const normalizeEntrypoint = (entrypoint: string): string =>
  entrypoint.replace(/^\.\//, "")
