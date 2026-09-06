import {
  SyntaxKind,
  isArrowFunction,
  isAwaitExpression,
  isArrayBindingPattern,
  isBindingElement,
  isBlock,
  isCallExpression,
  isCaseClause,
  isCatchClause,
  isClassDeclaration,
  isConstructorDeclaration,
  isDefaultClause,
  isElementAccessExpression,
  isEnumDeclaration,
  isExportDeclaration,
  isExportSpecifier,
  isGetAccessorDeclaration,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isModuleBlock,
  isNumericLiteral,
  isNamespaceExport,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isParameter,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignature,
  isQualifiedName,
  isSetAccessorDeclaration,
  isSourceFile,
  isStringLiteral,
  isSwitchStatement,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  type CallExpression,
  type Expression,
  type Identifier,
  type Node,
  type ObjectBindingPattern,
  type SourceFile,
} from "../tsgo-api.js"
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
  const fileSet = new Set<string>(sourceFiles.map((sourceFile) => sourceFile.fileName))
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

  for (const statement of context.sourceFile.statements) {
    if (!isImportDeclaration(statement)) continue
    const targetFile = resolvedTargetFile(context, consumer.file, statement.moduleSpecifier)
    if (targetFile === undefined) continue

    const importClause = statement.importClause
    if (importClause?.name !== undefined) {
      addConsumer(context.index, targetFile, "default", consumer, "import")
    }
    recordNamedImportConsumers(
      context.sourceFile,
      context.index,
      targetFile,
      consumer,
      importClause?.namedBindings,
    )
  }
}

const recordNamedImportConsumers = (
  sourceFile: SourceFile,
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  namedBindings: import("../tsgo-api.js").ImportClause["namedBindings"] | undefined,
): void => {
  if (namedBindings === undefined) return
  if (isNamespaceImport(namedBindings)) {
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

  forEachCompilerNode(context.sourceFile, (node) => {
    if (!isCallExpression(node)) return
    if (node.expression.kind !== SyntaxKind.ImportKeyword) return
    const specifier = node.arguments[0]
    if (specifier === undefined || !isStringLiteral(specifier)) return

    const targetFile = resolvedTargetFile(context, consumer.file, specifier)
    if (targetFile !== undefined) {
      addConsumersForUsage(
        context.index,
        targetFile,
        consumer,
        "dynamic-import",
        dynamicImportExportUsage(context.sourceFile, node),
      )
    }
  })
}

const recordReExportConsumers = (context: ExportConsumerContext): void => {
  const consumer = consumerIdentity(context)

  for (const statement of context.sourceFile.statements) {
    if (!isExportDeclaration(statement)) continue
    const targetFile = resolvedTargetFile(context, consumer.file, statement.moduleSpecifier)
    if (targetFile === undefined) continue
    recordExportClauseConsumers(context.index, targetFile, consumer, statement.exportClause)
  }
}

const recordExportClauseConsumers = (
  index: ExportConsumerIndex,
  targetFile: string,
  consumer: ConsumerIdentity,
  exportClause: import("../tsgo-api.js").ExportDeclaration["exportClause"],
): void => {
  if (exportClause === undefined || isNamespaceExport(exportClause)) {
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
  const file = context.sourceFile.fileName
  return {
    file,
    package: packageDisplayName(packageForFile(file, context.packages)),
  }
}

const resolvedTargetFile = (
  context: ExportConsumerContext,
  consumerFile: string,
  specifierNode: Expression | undefined,
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
  root: Node,
  namespaceBinding: Identifier,
): ExportUsage => {
  const namespaceName = namespaceBinding.text
  const names = new Set<string>()
  let opaque = false

  forEachCompilerNode(root, (node) => {
    if (!isIdentifier(node) || node.text !== namespaceName) return
    const parent = node.parent
    if (parent === undefined) return
    if (isDeclarationName(node)) return
    if (isNamespaceImport(parent) && parent.name === node) return
    if (isShadowedReference(node, root, namespaceBinding)) return

    if (isPropertyAccessExpression(parent)) {
      if (parent.expression === node) names.add(parent.name.text)
      return
    }

    if (isElementAccessExpression(parent)) {
      if (parent.expression !== node) return
      const name = stringLiteralText(parent.argumentExpression)
      if (name === undefined) opaque = true
      else names.add(name)
      return
    }

    if (isQualifiedName(parent)) {
      if (parent.left === node) names.add(parent.right.text)
      return
    }

    opaque = true
  })

  return { names, opaque }
}

const dynamicImportExportUsage = (
  sourceFile: SourceFile,
  importCall: CallExpression,
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
  importCall: CallExpression,
): string | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent !== undefined &&
    isPropertyAccessExpression(parent) &&
    parent.expression === current &&
    parent.name.text !== "then"
  ) {
    return parent.name.text
  }
  if (
    parent !== undefined &&
    isElementAccessExpression(parent) &&
    parent.expression === current
  ) {
    return stringLiteralText(parent.argumentExpression)
  }
  return undefined
}

const dynamicImportThenUsage = (
  importCall: CallExpression,
): ExportUsage | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent === undefined ||
    !isPropertyAccessExpression(parent) ||
    parent.expression !== current ||
    parent.name.text !== "then"
  ) {
    return undefined
  }
  const thenCall = parent.parent
  if (
    thenCall === undefined ||
    !isCallExpression(thenCall) ||
    thenCall.expression !== parent
  ) {
    return undefined
  }
  const callback = thenCall.arguments[0]
  if (
    callback === undefined ||
    !(isArrowFunction(callback) || isFunctionExpression(callback))
  ) {
    return undefined
  }
  const parameter = callback.parameters[0]
  if (parameter === undefined) return { names: new Set(), opaque: false }
  if (isIdentifier(parameter.name)) {
    return namespaceExportUsage(callback.body, parameter.name)
  }
  if (isObjectBindingPattern(parameter.name)) {
    return objectBindingExportUsage(parameter.name)
  }
  return { names: new Set(), opaque: true }
}

const dynamicImportBoundNamespaceName = (
  importCall: CallExpression,
): Identifier | undefined => {
  const current = unwrapExpressionNode(importCall)
  const parent = current.parent
  if (
    parent !== undefined &&
    isVariableDeclaration(parent) &&
    parent.initializer === current &&
    isIdentifier(parent.name)
  ) {
    return parent.name
  }
  return undefined
}

const objectBindingExportUsage = (
  pattern: ObjectBindingPattern,
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
      if (element.name !== undefined && isIdentifier(element.name)) names.add(element.name.text)
      else opaque = true
      continue
    }
    const name = propertyNameText(propertyName as Node)
    if (name === undefined) opaque = true
    else names.add(name)
  }
  return { names, opaque }
}

const unwrapExpressionNode = (node: Expression): Expression => {
  let current: Expression = node
  while (
    current.parent !== undefined &&
    ((isParenthesizedExpression(current.parent) && current.parent.expression === current) ||
      (isAwaitExpression(current.parent) && current.parent.expression === current))
  ) {
    current = current.parent
  }
  return current
}

const propertyNameText = (node: Node): string | undefined => {
  if (isIdentifier(node) || isStringLiteral(node) || isNumericLiteral(node)) {
    return node.text
  }
  return undefined
}

const stringLiteralText = (node: Expression | undefined): string | undefined =>
  node !== undefined && isStringLiteralLike(node) ? propertyNameText(node) : undefined

const isDeclarationName = (node: Identifier): boolean => {
  const parent = node.parent
  if (parent === undefined) return false
  if (
    isVariableDeclaration(parent) ||
    isParameter(parent) ||
    isFunctionDeclaration(parent) ||
    isClassDeclaration(parent) ||
    isInterfaceDeclaration(parent) ||
    isTypeAliasDeclaration(parent) ||
    isEnumDeclaration(parent) ||
    isImportSpecifier(parent) ||
    isExportSpecifier(parent) ||
    isPropertyAssignment(parent) ||
    isPropertySignature(parent) ||
    isMethodDeclaration(parent) ||
    isBindingElement(parent)
  ) {
    return parent.name === node
  }
  return false
}

const isShadowedReference = (
  node: Identifier,
  root: Node,
  namespaceBinding: Identifier,
): boolean => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (declaresShadowingName(current, node, namespaceBinding)) return true
    if (current === root) return false
    current = current.parent
  }
  return false
}

const declaresShadowingName = (
  scope: Node,
  reference: Identifier,
  namespaceBinding: Identifier,
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

  if (isBlock(scope) || isSourceFile(scope) || isModuleBlock(scope) || isSwitchStatement(scope)) {
    const statements = isSwitchStatement(scope)
      ? scope.caseBlock.clauses.flatMap((clause) => [...clause.statements])
      : [...scope.statements]
    if (statements.some((statement) => statementDeclaresName(statement, name, namespaceBinding))) {
      return true
    }
  }

  if (isCatchClause(scope) && scope.variableDeclaration !== undefined) {
    return bindingNameContains(scope.variableDeclaration.name, name, namespaceBinding)
  }

  if ((isForOfStatement(scope) || isForInStatement(scope)) && isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }

  if (isForStatement(scope) && scope.initializer !== undefined && isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }

  return false
}

const statementDeclaresName = (
  statement: Node,
  name: string,
  namespaceBinding: Identifier,
): boolean => {
  if (isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNameContains(declaration.name, name, namespaceBinding)
    )
  }
  if (
    (isFunctionDeclaration(statement) || isClassDeclaration(statement)) &&
    statement.name !== undefined &&
    statement.name.text === name &&
    statement.name !== namespaceBinding
  ) {
    return true
  }
  return false
}

const functionBody = (node: Node): Node | undefined => {
  if (
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isArrowFunction(node) ||
    isMethodDeclaration(node) ||
    isConstructorDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isSetAccessorDeclaration(node)
  ) {
    return node.body
  }
  return undefined
}

const functionParameters = (node: Node): ReadonlyArray<import("../tsgo-api.js").ParameterDeclaration> => {
  if (
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isArrowFunction(node) ||
    isMethodDeclaration(node) ||
    isConstructorDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isSetAccessorDeclaration(node)
  ) {
    return node.parameters
  }
  return []
}

const bindingNameContains = (
  bindingName: Node | undefined,
  name: string,
  namespaceBinding: Identifier,
): boolean => {
  if (bindingName === undefined) return false
  if (isIdentifier(bindingName)) {
    return bindingName.text === name && bindingName !== namespaceBinding
  }
  if (!isObjectBindingPattern(bindingName) && !isArrayBindingPattern(bindingName)) return false
  return bindingName.elements.some((element) =>
    isBindingElement(element) &&
    element.name !== undefined &&
    bindingNameContains(element.name, name, namespaceBinding)
  )
}

const containsNode = (container: Node, node: Node): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (current === container) return true
    current = current.parent
  }
  return false
}


const isStringLiteralLike = (node: Node | undefined): boolean =>
  node !== undefined && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))

const moduleSpecifierText = (node: Expression | undefined): string | undefined =>
  node !== undefined && isStringLiteralLike(node) ? propertyNameText(node) : undefined

const resolveModuleSpecifier = (
  resolver: ReturnType<typeof createModuleResolver>,
  sourcePath: string,
  specifier: string,
): string | undefined =>
  resolver.resolveSpecifier(sourcePath, specifier)
