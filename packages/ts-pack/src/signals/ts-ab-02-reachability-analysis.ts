import {
  type TypeScriptCallExpressionFact,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
} from "@skastr0/pulsar-core"
import { normalize, resolve } from "node:path"
import { Node, type SourceFile } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import type { TsAb02Config } from "./ts-ab-02-unused-exports-reachability.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  buildExportConsumerIndex,
  collectExportBindings,
  type ExportConsumer,
} from "./shared-export-analysis.js"
import { packageDisplayName, packageForFile } from "./shared-workspace.js"
import {
  stripKnownExtension,
  stripRuntimeExtension,
} from "./shared-path-extensions.js"

export type ExportBinding = ReturnType<typeof collectExportBindings>[number]

export interface ReachabilityAnalysis {
  readonly bindings: ReadonlyArray<ExportBinding>
  readonly consumerLookup: ReadonlyMap<string, ConsumerLookup>
  readonly packageNameByFile: ReadonlyMap<string, string | undefined>
  readonly publicEntryFiles: ReadonlySet<string>
  readonly sourceFactsByFile: ReadonlyMap<string, TypeScriptSourceExportFacts>
}

export interface TypeScriptSourceExportFacts {
  readonly imports: ReadonlyArray<TypeScriptImportBindingFact>
  readonly localBindings: ReadonlyArray<TypeScriptLocalBindingFact>
  readonly exportSpecifiers: ReadonlyArray<TypeScriptExportSpecifierFact>
}

export interface ConsumerLookup {
  readonly named: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>
  readonly star: ReadonlyArray<ExportConsumer>
}

export const buildReachabilityAnalysis = (
  allSourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  config: TsAb02Config,
): ReachabilityAnalysis => {
  const sourceFiles = allSourceFiles
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
  const consumerIndex = buildExportConsumerIndex(sourceFiles, packages)
  const consumerLookup = buildConsumerLookupByFile(consumerIndex)
  const manifestEntrypointFiles = packageEntrypointSourceFiles(sourceFiles, packages)
  const publicEntryFiles = publicEntrypointSourceFiles(
    sourceFiles,
    manifestEntrypointFiles,
    config.public_entry_globs,
  )
  const packageNameByFile = new Map<string, string | undefined>(
    sourceFiles.map((sourceFile) => [
      sourceFile.getFilePath(),
      packageDisplayName(packageForFile(sourceFile.getFilePath(), packages)),
    ]),
  )

  return {
    bindings: sourceFiles.flatMap((sourceFile) => collectExportBindings(sourceFile)),
    consumerLookup,
    packageNameByFile,
    publicEntryFiles,
    sourceFactsByFile: new Map(sourceFiles.map((sourceFile) => [
      sourceFile.getFilePath(),
      collectSourceExportFacts(sourceFile),
    ])),
  }
}

export const declarationFactForExport = (
  exportName: string,
  declaration: Node,
): TypeScriptExportDeclarationFact => {
  const base = {
    declarationKind: declaration.getKindName(),
    exportName,
  }

  if (Node.isVariableDeclaration(declaration)) {
    const localName = identifierName(declaration.getNameNode())
    const initializerCall = callFact(declaration.getInitializer())
    return {
      ...base,
      ...(localName === undefined ? {} : { localName }),
      ...(initializerCall === undefined ? {} : { initializerCall }),
    }
  }

  if (Node.isExportAssignment(declaration)) {
    const expression = declaration.getExpression()
    const expressionIdentifier = identifierName(expression)
    const expressionCall = callFact(expression)
    return {
      ...base,
      ...(expressionIdentifier === undefined ? {} : { expressionIdentifier }),
      ...(expressionCall === undefined ? {} : { expressionCall }),
    }
  }

  const named = declaration as { getNameNode?: () => Node; getName?: () => string | undefined }
  const localName = named.getNameNode !== undefined
    ? identifierName(named.getNameNode())
    : named.getName?.()
  return {
    ...base,
    ...(localName === undefined ? {} : { localName }),
  }
}

export const isReExportedByPublicEntrypoint = (
  consumers: ReadonlyArray<ExportConsumer>,
  publicEntryFiles: ReadonlySet<string>,
): boolean =>
  consumers.some(
    (consumer) =>
      consumer.kind === "re-export" && publicEntryFiles.has(consumer.consumerFile),
  )

export const matchingConsumers = (
  lookup: ConsumerLookup | undefined,
  exportName: string,
): ReadonlyArray<ExportConsumer> => {
  if (lookup === undefined) return []
  const named = lookup.named.get(exportName) ?? []
  if (exportName === "default") return named
  if (named.length === 0) return lookup.star
  if (lookup.star.length === 0) return named
  return [...named, ...lookup.star]
}

const SOURCE_EXPORT_FACT_CACHE = new WeakMap<SourceFile, TypeScriptSourceExportFacts>()

const collectSourceExportFacts = (
  sourceFile: SourceFile,
): TypeScriptSourceExportFacts => {
  const cached = SOURCE_EXPORT_FACT_CACHE.get(sourceFile)
  if (cached !== undefined) return cached

  const facts: TypeScriptSourceExportFacts = {
    imports: importBindingFacts(sourceFile),
    localBindings: localBindingFacts(sourceFile),
    exportSpecifiers: exportSpecifierFacts(sourceFile),
  }
  SOURCE_EXPORT_FACT_CACHE.set(sourceFile, facts)
  return facts
}

const importBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptImportBindingFact> =>
  sourceFile.getImportDeclarations().flatMap((declaration) => {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    const bindings: Array<TypeScriptImportBindingFact> = []
    const defaultImport = declaration.getDefaultImport()
    if (defaultImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "default",
        importedName: "default",
        localName: defaultImport.getText(),
      })
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "namespace",
        importedName: "*",
        localName: namespaceImport.getText(),
      })
    }

    for (const namedImport of declaration.getNamedImports()) {
      bindings.push({
        moduleSpecifier,
        importKind: "named",
        importedName: namedImport.getNameNode().getText(),
        localName: namedImport.getAliasNode()?.getText() ?? namedImport.getNameNode().getText(),
      })
    }
    return bindings
  })

const localBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptLocalBindingFact> =>
  sourceFile.getVariableStatements()
    .flatMap((statement) => statement.getDeclarations())
    .map((declaration): TypeScriptLocalBindingFact | undefined => {
      const localName = identifierName(declaration.getNameNode())
      if (localName === undefined) return undefined
      const initializerCall = callFact(declaration.getInitializer())
      return {
        localName,
        ...(initializerCall === undefined ? {} : { initializerCall }),
      }
    })
    .filter((fact): fact is TypeScriptLocalBindingFact => fact !== undefined)

const exportSpecifierFacts = (
  sourceFile: SourceFile,
): ReadonlyArray<TypeScriptExportSpecifierFact> =>
  sourceFile.getExportDeclarations().flatMap((declaration) => {
    if (!declaration.hasNamedExports()) return []
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    return declaration.getNamedExports().map((specifier) => ({
      exportedName: specifier.getAliasNode()?.getText() ?? specifier.getNameNode().getText(),
      localName: specifier.getNameNode().getText(),
      ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
    }))
  })

const callFact = (node: Node | undefined): TypeScriptCallExpressionFact | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined
  const callee = node.getExpression()
  const calleeName = callCalleeName(callee)
  return {
    calleeText: callee.getText(),
    ...(calleeName === undefined ? {} : { calleeName }),
  }
}

const callCalleeName = (node: Node): string | undefined => {
  if (Node.isIdentifier(node)) return node.getText()
  if (Node.isPropertyAccessExpression(node)) return node.getNameNode().getText()
  return undefined
}

const identifierName = (node: Node): string | undefined =>
  Node.isIdentifier(node) ? node.getText() : undefined

const buildConsumerLookupByFile = (
  consumerIndex: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>,
): ReadonlyMap<string, ConsumerLookup> => {
  const lookupByFile = new Map<string, ConsumerLookup>()

  for (const [file, consumers] of consumerIndex) {
    const named = new Map<string, Array<ExportConsumer>>()
    const star: Array<ExportConsumer> = []

    for (const consumer of consumers) {
      if (consumer.exportName === "*") {
        star.push(consumer)
        continue
      }

      const bucket = named.get(consumer.exportName) ?? []
      bucket.push(consumer)
      named.set(consumer.exportName, bucket)
    }

    lookupByFile.set(file, { named, star })
  }

  return lookupByFile
}

const publicEntrypointSourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  manifestEntrypointFiles: ReadonlySet<string>,
  publicEntryGlobs: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const publicFiles = new Set<string>(manifestEntrypointFiles)
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
