import { normalize, resolve } from "node:path"
import type { SourceFile } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  stripKnownExtension,
  stripRuntimeExtension,
} from "./shared-path-extensions.js"

export const publicEntrypointSourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  publicEntryGlobs: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const publicFiles = new Set<string>(packageEntrypointSourceFiles(sourceFiles, packages))
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath()
    if (matchesAnyGlob(filePath, publicEntryGlobs)) {
      publicFiles.add(filePath)
    }
  }
  return publicFiles
}

const packageEntrypointSourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlySet<string> => {
  const sourcePathLookup = new Map<string, string>()
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    sourcePathLookup.set(filePath, filePath)
    sourcePathLookup.set(stripKnownExtension(filePath), filePath)
  }

  const entrypointFiles = new Set<string>()
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    if (isAgentToolEntrypoint(filePath)) {
      entrypointFiles.add(filePath)
    }
  }

  for (const pkg of packages) {
    for (const entrypoint of pkg.manifest?.entrypoints ?? []) {
      const resolvedEntrypoint = resolveEntrypointSourceFile(pkg.path, entrypoint, sourcePathLookup)
      if (resolvedEntrypoint !== undefined) {
        entrypointFiles.add(resolvedEntrypoint)
      }
    }
  }
  return entrypointFiles
}

const resolveEntrypointSourceFile = (
  packagePath: string,
  entrypoint: string,
  sourcePathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  if (entrypoint.startsWith("#") || /^[a-z]+:/iu.test(entrypoint)) {
    return undefined
  }

  const normalized = normalizePath(resolve(packagePath, entrypoint))
  for (const candidate of entrypointSourceCandidates(normalized)) {
    const resolved = sourcePathLookup.get(candidate) ?? sourcePathLookup.get(stripKnownExtension(candidate))
    if (resolved !== undefined) return resolved
  }
  return undefined
}

const entrypointSourceCandidates = (entrypointPath: string): ReadonlyArray<string> => {
  const candidates = new Set<string>([entrypointPath])
  const withoutRuntimeExtension = stripRuntimeExtension(entrypointPath)
  candidates.add(withoutRuntimeExtension)

  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    candidates.add(`${withoutRuntimeExtension}${extension}`)
  }

  const sourcePath = entrypointPath.replace(/\/dist\//u, "/src/")
  candidates.add(sourcePath)
  const sourceWithoutRuntimeExtension = stripRuntimeExtension(sourcePath)
  candidates.add(sourceWithoutRuntimeExtension)
  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    candidates.add(`${sourceWithoutRuntimeExtension}${extension}`)
  }

  return [...candidates]
}

const isAgentToolEntrypoint = (path: string): boolean =>
  /\/\.opencode\/tools?\/[^/]+\.[cm]?tsx?$/u.test(path) ||
  /\/\.opencode\/plugins\/[^/]+\.[cm]?tsx?$/u.test(path) ||
  /\/\.pi\/extensions\/[^/]+\.[cm]?tsx?$/u.test(path)

const normalizePath = (path: string): string => normalize(path).replace(/\\/g, "/")
