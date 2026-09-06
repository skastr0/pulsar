import { dirname, normalize, resolve } from "node:path"
import { walkDescendants } from "../ast.js"
import type { PackageInfo } from "../discovery.js"
import { isExcluded } from "../signals/shared-globs.js"
import {
  isExportDeclaration,
  isImportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "../tsgo-api.js"
import {
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageForFile,
} from "../signals/shared-workspace.js"
import {
  stripKnownExtension,
  stripRuntimeExtension,
} from "../signals/shared-path-extensions.js"
import {
  isTypeOnlyModuleDeclaration,
  localIdentifierUsageByName,
  valueImportBindingNames,
} from "../signals/shared-module-usage.js"

interface ModuleGraphOptions {
  readonly excludeGlobs: ReadonlyArray<string>
  readonly includeExportEdges?: boolean
  readonly includeSelfEdges?: boolean
  readonly packages?: ReadonlyArray<PackageInfo>
}

interface ModuleGraph {
  readonly sourceFiles: ReadonlyArray<SourceFile>
  readonly fileSet: ReadonlySet<string>
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>
  readonly reverseDependencies: ReadonlyMap<string, ReadonlySet<string>>
  readonly fileToPackage: ReadonlyMap<string, PackageInfo | undefined>
}

export const buildModuleGraphFromFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  options: ModuleGraphOptions,
): ModuleGraph => {
  const selected = sourceFiles.filter((sourceFile) => !isExcluded(sourceFile.fileName, options.excludeGlobs))
  const fileSet = new Set(selected.map((sourceFile) => sourceFile.fileName))
  const sourceFileByPath = new Map(
    selected.map((sourceFile) => [sourceFile.fileName, sourceFile] as const),
  )
  const dependencies = new Map<string, Set<string>>()
  const reverseDependencies = new Map<string, Set<string>>()
  const fileToPackage = new Map<string, PackageInfo | undefined>()
  const resolver = createModuleResolver(selected, options.packages ?? [])
  const includeExportEdges = options.includeExportEdges === true
  const includeSelfEdges = options.includeSelfEdges === true
  const packageLookupEnabled = (options.packages?.length ?? 0) > 0

  for (const sourceFile of selected) {
    const filePath = sourceFile.fileName
    dependencies.set(
      filePath,
      collectTargets(sourceFile, resolver, includeExportEdges, includeSelfEdges, sourceFileByPath),
    )
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
    sourceFiles: selected,
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
  includeSelfEdges: boolean,
  sourceFileByPath: ReadonlyMap<string, SourceFile>,
): Set<string> => {
  const sourcePath = sourceFile.fileName
  const targets = new Set<string>()
  const importDeclarations = importDeclarationsOf(sourceFile)
  const valueBindingNames = valueImportBindingNames(importDeclarations)
  let identifierUsage: ReturnType<typeof localIdentifierUsageByName> | undefined
  const getIdentifierUsage = (): ReturnType<typeof localIdentifierUsageByName> => {
    identifierUsage ??= localIdentifierUsageByName(sourceFile, valueBindingNames)
    return identifierUsage
  }

  for (const declaration of importDeclarations) {
    if (isTypeOnlyModuleDeclaration(declaration, getIdentifierUsage)) continue
    const targetPath = resolver.resolve(sourcePath, declaration)
    if (targetPath === undefined) continue
    if (targetPath === sourcePath && !includeSelfEdges) continue
    targets.add(targetPath)
  }

  if (includeExportEdges) {
    for (const declaration of exportDeclarationsOf(sourceFile)) {
      const targetPath = resolver.resolve(sourcePath, declaration)
      if (targetPath === undefined) continue
      if (targetPath === sourcePath) continue
      if (
        isTypeOnlyModuleDeclaration(
          declaration,
          getIdentifierUsage,
          () => sourceFileByPath.get(targetPath),
        )
      ) continue
      targets.add(targetPath)
    }
  }

  return targets
}

type ModuleDeclaration = ImportDeclaration | ExportDeclaration

export type ModuleResolver = {
  readonly resolve: (sourcePath: string, declaration: ModuleDeclaration) => string | undefined
  readonly resolveSpecifier: (sourcePath: string, specifier: string) => string | undefined
}

export const createModuleResolver = (
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
      const specifier = moduleSpecifierOf(declaration)
      if (specifier === undefined) {
        return undefined
      }
      return resolveSpecifierPath(sourcePath, specifier, packages, workspacePackageNames, pathLookup)
    },
    resolveSpecifier: (sourcePath, specifier) =>
      resolveSpecifierPath(sourcePath, specifier, packages, workspacePackageNames, pathLookup),
  }
}

const resolveSpecifierPath = (
  sourcePath: string,
  specifier: string,
  packages: ReadonlyArray<PackageInfo>,
  workspacePackageNames: ReadonlyArray<string>,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return resolveRelativeSpecifier(sourcePath, specifier, pathLookup)
  }

  const packageSrcAliasResolved = resolvePackageSrcAlias(
    sourcePath,
    specifier,
    packages,
    pathLookup,
  )
  if (packageSrcAliasResolved !== undefined) {
    return packageSrcAliasResolved
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
}

const resolvePackageSrcAlias = (
  sourcePath: string,
  specifier: string,
  packages: ReadonlyArray<PackageInfo>,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  if (!specifier.startsWith("@/")) return undefined
  const pkg = packageForFile(sourcePath, packages)
  if (pkg === undefined) return undefined
  return lookupResolvedPath(normalizePath(resolve(pkg.path, "src", specifier.slice(2))), pathLookup)
}

const buildPathLookup = (sourceFiles: ReadonlyArray<SourceFile>): ReadonlyMap<string, string> => {
  const lookup = new Map<string, string>()

  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.fileName)
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

const normalizePath = (path: string): string => normalize(path).replace(/\\/g, "/")

const importDeclarationsOf = (sourceFile: SourceFile): ReadonlyArray<ImportDeclaration> => {
  const declarations: Array<ImportDeclaration> = []
  walkDescendants(sourceFile, (node) => {
    if (isImportDeclaration(node)) declarations.push(node)
  })
  return declarations
}

const exportDeclarationsOf = (sourceFile: SourceFile): ReadonlyArray<ExportDeclaration> => {
  const declarations: Array<ExportDeclaration> = []
  walkDescendants(sourceFile, (node) => {
    if (isExportDeclaration(node)) declarations.push(node)
  })
  return declarations
}

const moduleSpecifierOf = (declaration: ImportDeclaration | ExportDeclaration): string | undefined => {
  const specifier = declaration.moduleSpecifier
  if (specifier === undefined) return undefined
  if (isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier)) return specifier.text
  return undefined
}
