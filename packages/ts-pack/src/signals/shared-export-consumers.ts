import { type SourceFile, ts } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver } from "../graph/module-graph.js"
import {
  packageDisplayName,
  packageForFile,
} from "./shared-workspace.js"

export interface ExportConsumer {
  readonly consumerFile: string
  readonly consumerPackage: string | undefined
  readonly exportName: string | "*"
  readonly kind: "import" | "dynamic-import" | "re-export"
}

export const buildExportConsumerIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlyMap<string, ReadonlyArray<ExportConsumer>> => {
  const fileSet = new Set<string>(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const index = new Map<string, Array<ExportConsumer>>()
  const resolver = createModuleResolver(sourceFiles, packages)

  for (const sourceFile of sourceFiles) {
    recordFileConsumers({ sourceFile, packages, fileSet, resolver, index })
  }

  return index
}

type ModuleResolver = ReturnType<typeof createModuleResolver>
type ExportConsumerIndex = Map<string, Array<ExportConsumer>>

interface ExportConsumerContext {
  readonly sourceFile: SourceFile
  readonly packages: ReadonlyArray<PackageInfo>
  readonly fileSet: ReadonlySet<string>
  readonly resolver: ModuleResolver
  readonly index: ExportConsumerIndex
}

const recordFileConsumers = (context: ExportConsumerContext): void => {
  recordStaticImportConsumers(context)
  recordDynamicImportConsumers(context)
  recordReExportConsumers(context)
}

const recordStaticImportConsumers = (context: ExportConsumerContext): void => {
  const consumer = consumerIdentity(context)

  for (const statement of context.sourceFile.compilerNode.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const targetFile = resolvedTargetFile(context, consumer.file, statement.moduleSpecifier)
    if (targetFile === undefined) continue

    const importClause = statement.importClause
    if (importClause?.name !== undefined) {
      addConsumer(context.index, targetFile, "default", consumer, "import")
    }
    recordNamedImportConsumers(context.index, targetFile, consumer, importClause?.namedBindings)
  }
}

const recordNamedImportConsumers = (
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  namedBindings: ts.NamedImportBindings | undefined,
): void => {
  if (namedBindings === undefined) return
  if (ts.isNamespaceImport(namedBindings)) {
    addConsumer(index, targetFile, "*", consumer, "import")
    return
  }
  for (const element of namedBindings.elements) {
    addConsumer(index, targetFile, (element.propertyName ?? element.name).text, consumer, "import")
  }
}

const recordDynamicImportConsumers = (context: ExportConsumerContext): void => {
  const consumer = consumerIdentity(context)

  forEachCompilerNode(context.sourceFile.compilerNode, (node) => {
    if (!ts.isCallExpression(node)) return
    if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return
    const specifier = node.arguments[0]
    if (specifier === undefined || !ts.isStringLiteral(specifier)) return

    const targetFile = resolvedTargetFile(context, consumer.file, specifier)
    if (targetFile !== undefined) {
      addConsumer(context.index, targetFile, "*", consumer, "dynamic-import")
    }
  })
}

const recordReExportConsumers = (context: ExportConsumerContext): void => {
  const consumer = consumerIdentity(context)

  for (const statement of context.sourceFile.compilerNode.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    const targetFile = resolvedTargetFile(context, consumer.file, statement.moduleSpecifier)
    if (targetFile === undefined) continue
    recordExportClauseConsumers(context.index, targetFile, consumer, statement.exportClause)
  }
}

const recordExportClauseConsumers = (
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  exportClause: ts.ExportDeclaration["exportClause"],
): void => {
  if (exportClause === undefined || ts.isNamespaceExport(exportClause)) {
    addConsumer(index, targetFile, "*", consumer, "re-export")
    return
  }
  for (const specifier of exportClause.elements) {
    addConsumer(index, targetFile, (specifier.propertyName ?? specifier.name).text, consumer, "re-export")
  }
}

interface ConsumerIdentity {
  readonly file: string
  readonly package: string | undefined
}

const consumerIdentity = (context: ExportConsumerContext): ConsumerIdentity => {
  const file = context.sourceFile.getFilePath()
  return {
    file,
    package: packageDisplayName(packageForFile(file, context.packages)),
  }
}

const resolvedTargetFile = (
  context: ExportConsumerContext,
  consumerFile: string,
  specifierNode: ts.Expression | undefined,
): string | undefined => {
  const specifier = moduleSpecifierText(specifierNode)
  if (specifier === undefined) return undefined
  const targetFile = resolveModuleSpecifier(context.resolver, consumerFile, specifier)
  return targetFile !== undefined && context.fileSet.has(targetFile) ? targetFile : undefined
}

const addConsumer = (
  index: ExportConsumerIndex,
  targetFile: string,
  exportName: string | "*",
  consumer: ConsumerIdentity,
  kind: ExportConsumer["kind"],
): void => {
  const bucket = index.get(targetFile) ?? []
  bucket.push({
    consumerFile: consumer.file,
    consumerPackage: consumer.package,
    exportName,
    kind,
  })
  index.set(targetFile, bucket)
}

const moduleSpecifierText = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined

const resolveModuleSpecifier = (
  resolver: ReturnType<typeof createModuleResolver>,
  sourcePath: string,
  specifier: string,
): string | undefined =>
  resolver.resolve(sourcePath, {
    getModuleSpecifierValue: () => specifier,
  } as Parameters<typeof resolver.resolve>[1])

const forEachCompilerNode = (root: ts.Node, visit: (node: ts.Node) => void): void => {
  const walk = (node: ts.Node): void => {
    visit(node)
    ts.forEachChild(node, walk)
  }
  walk(root)
}
