import { dirname, normalize, resolve } from "node:path"
import type {
  ExportDeclaration,
  ImportDeclaration,
  Project,
  SourceFile,
} from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { isExcluded } from "../signals/shared-globs.js"
import {
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageForFile,
} from "../signals/shared-workspace.js"

export interface ModuleGraphOptions {
  readonly excludeGlobs: ReadonlyArray<string>
  readonly includeExportEdges?: boolean
  readonly packages?: ReadonlyArray<PackageInfo>
}

export interface ModuleGraph {
  readonly sourceFiles: ReadonlyArray<SourceFile>
  readonly fileSet: ReadonlySet<string>
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>
  readonly reverseDependencies: ReadonlyMap<string, ReadonlySet<string>>
  readonly fileToPackage: ReadonlyMap<string, PackageInfo | undefined>
}

export const buildModuleGraph = (
  project: Project,
  options: ModuleGraphOptions,
): ModuleGraph => {
  const sourceFiles = project
    .getSourceFiles()
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), options.excludeGlobs))
  const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const dependencies = new Map<string, Set<string>>()
  const reverseDependencies = new Map<string, Set<string>>()
  const fileToPackage = new Map<string, PackageInfo | undefined>()
  const resolver = createModuleResolver(sourceFiles, options.packages ?? [])
  const includeExportEdges = options.includeExportEdges === true
  const packageLookupEnabled = (options.packages?.length ?? 0) > 0

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath()
    dependencies.set(filePath, collectTargets(sourceFile, resolver, includeExportEdges))
    reverseDependencies.set(filePath, new Set())
    if (packageLookupEnabled) {
      fileToPackage.set(filePath, packageForFile(filePath, options.packages ?? []))
    }
  }

  for (const [from, targets] of dependencies) {
    for (const to of targets) {
      reverseDependencies.get(to)?.add(from)
    }
  }

  return {
    sourceFiles,
    fileSet,
    dependencies,
    reverseDependencies,
    fileToPackage,
  }
}

const collectTargets = (
  sourceFile: SourceFile,
  resolver: ModuleResolver,
  includeExportEdges: boolean,
): Set<string> => {
  const sourcePath = sourceFile.getFilePath()
  const targets = new Set<string>()

  for (const declaration of sourceFile.getImportDeclarations()) {
    const targetPath = resolver.resolve(sourcePath, declaration)
    if (targetPath === undefined || targetPath === sourcePath) continue
    targets.add(targetPath)
  }

  if (includeExportEdges) {
    for (const declaration of sourceFile.getExportDeclarations()) {
      const targetPath = resolver.resolve(sourcePath, declaration)
      if (targetPath === undefined || targetPath === sourcePath) continue
      targets.add(targetPath)
    }
  }

  return targets
}

type ModuleDeclaration = ImportDeclaration | ExportDeclaration

type ModuleResolver = {
  readonly resolve: (sourcePath: string, declaration: ModuleDeclaration) => string | undefined
}

const createModuleResolver = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ModuleResolver => {
  const pathLookup = buildPathLookup(sourceFiles)
  const workspacePackageNames = packages
    .map((pkg) => pkg.manifest?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort((left, right) => right.length - left.length)

  return {
    resolve: (sourcePath, declaration) => {
      const specifier = declaration.getModuleSpecifierValue()
      if (specifier === undefined) {
        return undefined
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        return resolveRelativeSpecifier(sourcePath, specifier, pathLookup)
      }

      const packageSpecifier = normalizePackageSpecifier(specifier)
      if (packageSpecifier === undefined || isBuiltinModuleName(packageSpecifier)) {
        return undefined
      }

      const workspaceResolved = resolveWorkspaceSpecifier(
        specifier,
        workspacePackageNames,
        packages,
        pathLookup,
      )
      if (workspaceResolved !== undefined) {
        return workspaceResolved
      }

      return undefined
    },
  }
}

const buildPathLookup = (sourceFiles: ReadonlyArray<SourceFile>): ReadonlyMap<string, string> => {
  const lookup = new Map<string, string>()

  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    const withoutExtension = stripKnownExtension(filePath)
    lookup.set(filePath, filePath)
    lookup.set(withoutExtension, filePath)

    if (withoutExtension.endsWith("/index")) {
      lookup.set(withoutExtension.slice(0, -"/index".length), filePath)
    }
  }

  return lookup
}

const resolveRelativeSpecifier = (
  sourcePath: string,
  specifier: string,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  const resolved = normalizePath(resolve(dirname(sourcePath), specifier))
  return lookupResolvedPath(resolved, pathLookup)
}

const resolveWorkspaceSpecifier = (
  specifier: string,
  workspacePackageNames: ReadonlyArray<string>,
  packages: ReadonlyArray<PackageInfo>,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  const packageName = workspacePackageNames.find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  )
  if (packageName === undefined) return undefined

  const pkg = packages.find((entry) => entry.manifest?.name === packageName)
  if (pkg === undefined) return undefined

  const subpath = specifier === packageName ? "" : specifier.slice(packageName.length + 1)
  const candidates = subpath.length === 0
    ? [resolve(pkg.path, "src/index"), resolve(pkg.path, "index")]
    : [
        resolve(pkg.path, "src", subpath),
        resolve(pkg.path, subpath),
      ]

  for (const candidate of candidates) {
    const resolved = lookupResolvedPath(normalizePath(candidate), pathLookup)
    if (resolved !== undefined) {
      return resolved
    }
  }

  return undefined
}

const lookupResolvedPath = (
  candidate: string,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined => pathLookup.get(candidate) ?? pathLookup.get(stripRuntimeExtension(candidate))

const stripKnownExtension = (path: string): string =>
  path.replace(/\.(?:[cm]?tsx?|[cm]?jsx?)$/u, "")

const stripRuntimeExtension = (path: string): string =>
  path.replace(/\.(?:[cm]?jsx?)$/u, "")

const normalizePath = (path: string): string => normalize(path).replace(/\\/g, "/")
