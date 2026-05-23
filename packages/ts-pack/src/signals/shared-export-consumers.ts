import { type SourceFile, ts } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver } from "../graph/module-graph.js"
import { forEachCompilerNode } from "./shared-compiler-node-traversal.js"
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

interface ExportUsage {
  readonly names: ReadonlySet<string>
  readonly opaque: boolean
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
    recordNamedImportConsumers(
      context.sourceFile.compilerNode,
      context.index,
      targetFile,
      consumer,
      importClause?.namedBindings,
    )
  }
}

const recordNamedImportConsumers = (
  sourceFile: ts.SourceFile,
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  namedBindings: ts.NamedImportBindings | undefined,
): void => {
  if (namedBindings === undefined) return
  if (ts.isNamespaceImport(namedBindings)) {
    addConsumersForUsage(
      index,
      targetFile,
      consumer,
      "import",
      namespaceExportUsage(sourceFile, namedBindings.name),
    )
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
      addConsumersForUsage(
        context.index,
        targetFile,
        consumer,
        "dynamic-import",
        dynamicImportExportUsage(context.sourceFile.compilerNode, node),
      )
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

const addConsumersForUsage = (
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  kind: ExportConsumer["kind"],
  usage: ExportUsage,
): void => {
  if (usage.opaque) {
    addConsumer(index, targetFile, "*", consumer, kind)
    return
  }
  for (const name of [...usage.names].sort((left, right) => left.localeCompare(right))) {
    addConsumer(index, targetFile, name, consumer, kind)
  }
}

const namespaceExportUsage = (
  root: ts.Node,
  namespaceBinding: ts.Identifier,
): ExportUsage => {
  const namespaceName = namespaceBinding.text
  const names = new Set<string>()
  let opaque = false

  forEachCompilerNode(root, (node) => {
    if (!ts.isIdentifier(node) || node.text !== namespaceName) return
    const parent = node.parent
    if (parent === undefined) return
    if (isDeclarationName(node)) return
    if (ts.isNamespaceImport(parent) && parent.name === node) return
    if (isShadowedReference(node, root, namespaceBinding)) return

    if (ts.isPropertyAccessExpression(parent)) {
      if (parent.expression === node) names.add(parent.name.text)
      return
    }

    if (ts.isElementAccessExpression(parent)) {
      if (parent.expression !== node) return
      const name = stringLiteralText(parent.argumentExpression)
      if (name === undefined) opaque = true
      else names.add(name)
      return
    }

    if (ts.isQualifiedName(parent)) {
      if (parent.left === node) names.add(parent.right.text)
      return
    }

    opaque = true
  })

  return { names, opaque }
}

const dynamicImportExportUsage = (
  sourceFile: ts.SourceFile,
  importCall: ts.CallExpression,
): ExportUsage => {
  const directName = directDynamicImportAccessName(importCall)
  if (directName !== undefined) return { names: new Set([directName]), opaque: false }

  const thenUsage = dynamicImportThenUsage(importCall)
  if (thenUsage !== undefined) return thenUsage

  const boundName = dynamicImportBoundNamespaceName(importCall)
  if (boundName !== undefined) return namespaceExportUsage(sourceFile, boundName)

  return { names: new Set(), opaque: true }
}

const directDynamicImportAccessName = (
  importCall: ts.CallExpression,
): string | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent !== undefined &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === current &&
    parent.name.text !== "then"
  ) {
    return parent.name.text
  }
  if (
    parent !== undefined &&
    ts.isElementAccessExpression(parent) &&
    parent.expression === current
  ) {
    return stringLiteralText(parent.argumentExpression)
  }
  return undefined
}

const dynamicImportThenUsage = (
  importCall: ts.CallExpression,
): ExportUsage | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent === undefined ||
    !ts.isPropertyAccessExpression(parent) ||
    parent.expression !== current ||
    parent.name.text !== "then"
  ) {
    return undefined
  }
  const thenCall = parent.parent
  if (
    thenCall === undefined ||
    !ts.isCallExpression(thenCall) ||
    thenCall.expression !== parent
  ) {
    return undefined
  }
  const callback = thenCall.arguments[0]
  if (
    callback === undefined ||
    !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
  ) {
    return undefined
  }
  const parameter = callback.parameters[0]
  if (parameter === undefined) return { names: new Set(), opaque: false }
  if (ts.isIdentifier(parameter.name)) {
    return namespaceExportUsage(callback.body, parameter.name)
  }
  if (ts.isObjectBindingPattern(parameter.name)) {
    return objectBindingExportUsage(parameter.name)
  }
  return { names: new Set(), opaque: true }
}

const dynamicImportBoundNamespaceName = (
  importCall: ts.CallExpression,
): ts.Identifier | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent !== undefined &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === current &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name
  }
  return undefined
}

const objectBindingExportUsage = (
  pattern: ts.ObjectBindingPattern,
): ExportUsage => {
  const names = new Set<string>()
  let opaque = false
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) {
      opaque = true
      continue
    }
    const propertyName = element.propertyName
    if (propertyName === undefined) {
      if (ts.isIdentifier(element.name)) names.add(element.name.text)
      else opaque = true
      continue
    }
    const name = propertyNameText(propertyName)
    if (name === undefined) opaque = true
    else names.add(name)
  }
  return { names, opaque }
}

const unwrapExpressionNode = (node: ts.Expression): ts.Expression => {
  let current: ts.Expression = node
  while (
    current.parent !== undefined &&
    ((ts.isParenthesizedExpression(current.parent) && current.parent.expression === current) ||
      (ts.isAwaitExpression(current.parent) && current.parent.expression === current))
  ) {
    current = current.parent
  }
  return current
}

const propertyNameText = (node: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text
  }
  return undefined
}

const stringLiteralText = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined

const isDeclarationName = (node: ts.Identifier): boolean => {
  const parent = node.parent
  if (parent === undefined) return false
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isBindingElement(parent)
  ) {
    return parent.name === node
  }
  return false
}

const isShadowedReference = (
  node: ts.Identifier,
  root: ts.Node,
  namespaceBinding: ts.Identifier,
): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (declaresShadowingName(current, node, namespaceBinding)) return true
    if (current === root) return false
    current = current.parent
  }
  return false
}

const declaresShadowingName = (
  scope: ts.Node,
  reference: ts.Identifier,
  namespaceBinding: ts.Identifier,
): boolean => {
  const name = namespaceBinding.text
  const body = functionBody(scope)
  if (
    body !== undefined &&
    containsNode(body, reference) &&
    functionParameters(scope).some((parameter) =>
      bindingNameContains(parameter.name, name, namespaceBinding)
    )
  ) {
    return true
  }

  if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) || ts.isCaseBlock(scope)) {
    const statements = ts.isCaseBlock(scope)
      ? scope.clauses.flatMap((clause) => [...clause.statements])
      : [...scope.statements]
    if (statements.some((statement) => statementDeclaresName(statement, name, namespaceBinding))) {
      return true
    }
  }

  if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    return bindingNameContains(scope.variableDeclaration.name, name, namespaceBinding)
  }

  if ((ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && ts.isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }

  if (ts.isForStatement(scope) && scope.initializer !== undefined && ts.isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }

  return false
}

const statementDeclaresName = (
  statement: ts.Statement,
  name: string,
  namespaceBinding: ts.Identifier,
): boolean => {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined &&
    statement.name.text === name &&
    statement.name !== namespaceBinding
  ) {
    return true
  }
  return false
}

const functionBody = (node: ts.Node): ts.ConciseBody | ts.FunctionBody | undefined => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body
  }
  return undefined
}

const functionParameters = (node: ts.Node): ts.NodeArray<ts.ParameterDeclaration> => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.parameters
  }
  return ts.factory.createNodeArray()
}

const bindingNameContains = (
  bindingName: ts.BindingName,
  name: string,
  namespaceBinding: ts.Identifier,
): boolean => {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === name && bindingName !== namespaceBinding
  }
  return bindingName.elements.some((element) =>
    ts.isBindingElement(element) &&
    bindingNameContains(element.name, name, namespaceBinding)
  )
}

const containsNode = (container: ts.Node, node: ts.Node): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (current === container) return true
    current = current.parent
  }
  return false
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
