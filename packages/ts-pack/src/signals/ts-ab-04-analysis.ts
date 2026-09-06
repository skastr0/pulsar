import { firstAncestor, hasExportModifier, textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrayBindingPattern,
  isArrowFunction,
  isAsExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExpressionWithTypeArguments,
  isFunctionDeclaration,
  isFunctionExpression,
  isHeritageClause,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isIntersectionTypeNode,
  isMethodDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isParenthesizedTypeNode,
  isPropertyAccessExpression,
  isReturnStatement,
  isSatisfiesExpression,
  isTypeNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  isVariableDeclaration,
  type AsExpression,
  type ClassDeclaration,
  type ClassExpression,
  type ExportDeclaration,
  type ExpressionWithTypeArguments,
  type FunctionDeclaration,
  type FunctionExpression,
  type ImportTypeNode,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type Node,
  type SatisfiesExpression,
  type SourceFile,
  type TypeNode,
  type TypeQueryNode,
  type TypeReferenceNode,
  type VariableDeclaration,
} from "../tsgo-api.js"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver, type ModuleResolver } from "../graph/module-graph.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  collectTypeReferenceLikeNodes,
  declarationKey,
  resolveReferenceLikeName,
} from "./shared-type-analysis.js"

export interface SingleImplPair {
  readonly interfaceFile: string
  readonly interfaceName: string
  readonly implementationFile: string
  readonly implementationName: string
  readonly hasTestSubstitute: boolean
}

export interface DeadInterface {
  readonly interfaceFile: string
  readonly interfaceName: string
  readonly line: number
}

export interface TsAb04Output {
  readonly pairs: ReadonlyArray<SingleImplPair>
  readonly flaggedPairs: ReadonlyArray<SingleImplPair>
  readonly totalInterfaces: number
  readonly ratio: number
  readonly deadInterfaces: ReadonlyArray<DeadInterface>
  readonly deadInterfaceRatio: number
  readonly minInterfaceEvidence: number
  readonly deadInterfaceEvidenceFactor: number
  readonly singleImplementationPressure: number
  readonly deadInterfacePressure: number
  readonly diagnosticLimit: number
}

interface TsAb04AnalysisConfig {
  readonly exclude_globs: ReadonlyArray<string>
  readonly test_globs: ReadonlyArray<string>
  readonly public_entry_globs: ReadonlyArray<string>
  readonly min_interface_evidence: number
  readonly top_n_diagnostics: number
}

type ImplementationKind = "class" | "object-literal"
type ClassImplementationNode = ClassDeclaration | ClassExpression
type CallableImplementationNode =
  | import("../tsgo-api.js").ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration

type ImplementationDescriptor = {
  readonly file: string
  readonly name: string
  readonly kind: ImplementationKind
}

interface SourceFileGroups {
  readonly productionFiles: ReadonlyArray<SourceFile>
  readonly testFiles: ReadonlyArray<SourceFile>
}

interface InterfaceImplementationAccumulator {
  readonly pairs: Array<SingleImplPair>
  readonly deadInterfaces: Array<DeadInterface>
  totalInterfaces: number
}

interface InterfaceIndex {
  readonly interfacesByFile: ReadonlyMap<string, ReadonlyMap<string, InterfaceDeclaration>>
  readonly sourceFileByPath: ReadonlyMap<string, SourceFile>
  readonly resolver: ModuleResolver
}

export const computeInterfaceImplementationRatio = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsAb04AnalysisConfig,
  packages: ReadonlyArray<PackageInfo> = [],
): TsAb04Output => {
  const { productionFiles, testFiles } = selectInterfaceAnalysisFiles(sourceFiles, config)
  const index = buildInterfaceIndex([...productionFiles, ...testFiles], packages)
  const candidateInterfaces = collectCandidateInterfaces(productionFiles, config, packages, index)
  const prodImplementations = buildImplementationIndex(productionFiles, index)
  const testImplementations = buildImplementationIndex(testFiles, index)
  const knownStructuralUsageKeys = collectKnownStructuralUsageKeys([
    ...productionFiles,
    ...testFiles,
  ], index)
  const accumulator = buildInterfaceImplementationAccumulator(
    candidateInterfaces,
    prodImplementations,
    testImplementations,
    knownStructuralUsageKeys,
  )
  return buildInterfaceImplementationOutput(
    accumulator,
    normalizeDiagnosticLimit(config.top_n_diagnostics),
    normalizeMinInterfaceEvidence(config.min_interface_evidence),
  )
}

const selectInterfaceAnalysisFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsAb04AnalysisConfig,
): SourceFileGroups => {
  const selected = sourceFiles.filter((sourceFile) => !isExcluded(sourceFile.fileName, config.exclude_globs))
  return {
    productionFiles: selected.filter(
      (sourceFile) => !matchesAnyGlob(sourceFile.fileName, config.test_globs),
    ),
    testFiles: selected.filter((sourceFile) =>
      matchesAnyGlob(sourceFile.fileName, config.test_globs),
    ),
  }
}

const collectCandidateInterfaces = (
  productionFiles: ReadonlyArray<SourceFile>,
  config: TsAb04AnalysisConfig,
  packages: ReadonlyArray<PackageInfo>,
  index: InterfaceIndex,
): ReadonlyArray<InterfaceDeclaration> => {
  const publicInterfaces = buildPublicInterfaceKeySet(
    productionFiles,
    config.public_entry_globs,
    packages,
    index,
  )
  return productionFiles
    .flatMap(collectInterfaces)
    .filter((iface) => !publicInterfaces.has(interfaceKey(iface)))
}

const buildInterfaceImplementationAccumulator = (
  candidateInterfaces: ReadonlyArray<InterfaceDeclaration>,
  prodImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  testImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  knownStructuralUsageKeys: ReadonlySet<string>,
): InterfaceImplementationAccumulator => {
  const accumulator: InterfaceImplementationAccumulator = {
    pairs: [],
    deadInterfaces: [],
    totalInterfaces: 0,
  }
  for (const iface of candidateInterfaces) {
    addInterfaceImplementationFinding(
      iface,
      prodImplementations,
      testImplementations,
      knownStructuralUsageKeys,
      accumulator,
    )
  }
  return accumulator
}

const addInterfaceImplementationFinding = (
  iface: InterfaceDeclaration,
  prodImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  testImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  knownStructuralUsageKeys: ReadonlySet<string>,
  accumulator: InterfaceImplementationAccumulator,
): void => {
  const key = interfaceKey(iface)
  const productionImplementations = prodImplementations.get(key) ?? []
  const hasTestSubstitute = (testImplementations.get(key) ?? []).length > 0
  if (
    productionImplementations.length > 0 &&
    productionImplementations.every(isObjectLiteralImplementation) &&
    hasStructuralTypeUsage(iface, knownStructuralUsageKeys)
  ) {
    return
  }
  if (productionImplementations.length === 0) {
    addDeadInterfaceFinding(iface, knownStructuralUsageKeys, accumulator)
    return
  }

  accumulator.totalInterfaces += 1
  if (productionImplementations.length !== 1) return
  const implementation = productionImplementations[0]!
  accumulator.pairs.push({
    interfaceFile: iface.getSourceFile().fileName,
    interfaceName: iface.name.text,
    implementationFile: implementation.file,
    implementationName: implementation.name,
    hasTestSubstitute,
  })
}

const addDeadInterfaceFinding = (
  iface: InterfaceDeclaration,
  knownStructuralUsageKeys: ReadonlySet<string>,
  accumulator: InterfaceImplementationAccumulator,
): void => {
  if (hasStructuralTypeUsage(iface, knownStructuralUsageKeys)) return
  accumulator.totalInterfaces += 1
  accumulator.deadInterfaces.push({
    interfaceFile: iface.getSourceFile().fileName,
    interfaceName: iface.name.text,
    line: startLine(iface),
  })
}

const buildInterfaceImplementationOutput = (
  accumulator: InterfaceImplementationAccumulator,
  diagnosticLimit: number,
  minInterfaceEvidence: number,
): TsAb04Output => {
  const flaggedPairs = accumulator.pairs
    .filter((pair) => !pair.hasTestSubstitute)
    .sort(compareSingleImplPairs)
  const totalInterfaces = accumulator.totalInterfaces
  const ratio = totalInterfaces === 0 ? 0 : flaggedPairs.length / totalInterfaces
  const deadInterfaceRatio =
    totalInterfaces === 0 ? 0 : accumulator.deadInterfaces.length / totalInterfaces
  const deadInterfaceEvidenceFactor = Math.min(1, totalInterfaces / minInterfaceEvidence)

  return {
    pairs: accumulator.pairs,
    flaggedPairs,
    totalInterfaces,
    ratio,
    deadInterfaces: accumulator.deadInterfaces.sort(compareDeadInterfaces),
    deadInterfaceRatio,
    minInterfaceEvidence,
    deadInterfaceEvidenceFactor,
    singleImplementationPressure:
      Math.min(1, ratio / 0.5) * deadInterfaceEvidenceFactor,
    deadInterfacePressure: Math.min(
      0.25,
      deadInterfaceRatio * 0.25 * deadInterfaceEvidenceFactor,
    ),
    diagnosticLimit,
  }
}

const compareSingleImplPairs = (left: SingleImplPair, right: SingleImplPair): number => {
  const interfaceCompare = left.interfaceFile.localeCompare(right.interfaceFile)
  if (interfaceCompare !== 0) return interfaceCompare
  return left.interfaceName.localeCompare(right.interfaceName)
}

const compareDeadInterfaces = (left: DeadInterface, right: DeadInterface): number => {
  const fileCompare = left.interfaceFile.localeCompare(right.interfaceFile)
  if (fileCompare !== 0) return fileCompare
  return left.interfaceName.localeCompare(right.interfaceName)
}

const buildPublicInterfaceKeySet = (
  sourceFiles: ReadonlyArray<SourceFile>,
  publicEntryGlobs: ReadonlyArray<string>,
  packages: ReadonlyArray<PackageInfo>,
  index: InterfaceIndex,
): ReadonlySet<string> => {
  const publicKeys = new Set<string>()
  const visited = new Set<string>()

  for (const sourceFile of sourceFiles) {
    if (!matchesAnyGlob(sourceFile.fileName, publicEntryGlobs)) continue
    collectPublicInterfacesFromExports(sourceFile, index, publicKeys, visited)
  }

  return publicKeys
}

const collectPublicInterfacesFromExports = (
  sourceFile: SourceFile,
  index: InterfaceIndex,
  publicKeys: Set<string>,
  visited: Set<string>,
): void => {
  const file = sourceFile.fileName
  if (visited.has(file)) return
  visited.add(file)

  for (const iface of collectInterfaces(sourceFile)) {
    if (hasExportModifier(iface)) {
      publicKeys.add(interfaceKey(iface))
    }
  }

  for (const statement of sourceFile.statements) {
    if (!isExportDeclaration(statement)) continue
    const namedExports = namedExportSpecifiers(statement)

    if (statement.moduleSpecifier === undefined) {
      for (const specifier of namedExports) {
        const localName = exportSpecifierLocalName(specifier)
        const iface = index.interfacesByFile.get(file)?.get(localName)
        if (iface !== undefined) publicKeys.add(interfaceKey(iface))
      }
      continue
    }

    const targetPath = index.resolver.resolve(file, statement)
    const targetFile = targetPath === undefined ? undefined : index.sourceFileByPath.get(targetPath)
    if (targetFile === undefined) continue

    if (namedExports.length > 0) {
      for (const specifier of namedExports) {
        collectPublicInterfaceFromNamedExport(
          exportSpecifierLocalName(specifier),
          targetFile,
          index,
          publicKeys,
          visited,
        )
      }
      continue
    }

    collectPublicInterfacesFromExports(targetFile, index, publicKeys, visited)
  }
}

const interfaceKey = (iface: InterfaceDeclaration): string => declarationKey(iface)

const collectPublicInterfaceFromNamedExport = (
  exportName: string,
  sourceFile: SourceFile,
  index: InterfaceIndex,
  publicKeys: Set<string>,
  visited: Set<string>,
): void => {
  const iface = index.interfacesByFile.get(sourceFile.fileName)?.get(exportName)
  if (iface !== undefined) {
    publicKeys.add(interfaceKey(iface))
    return
  }

  const exportKey = `${sourceFile.fileName}:${exportName}`
  if (visited.has(exportKey)) return
  visited.add(exportKey)

  for (const statement of sourceFile.statements) {
    if (!isExportDeclaration(statement)) continue
    const targetExportName = matchingNamedExport(statement, exportName)
    if (targetExportName === undefined) continue

    const targetPath = index.resolver.resolve(sourceFile.fileName, statement)
    const targetFile = targetPath === undefined ? undefined : index.sourceFileByPath.get(targetPath)
    if (targetFile === undefined) continue

    collectPublicInterfaceFromNamedExport(
      targetExportName,
      targetFile,
      index,
      publicKeys,
      visited,
    )
  }
}

const matchingNamedExport = (
  declaration: ExportDeclaration,
  exportName: string,
): string | undefined => {
  for (const specifier of namedExportSpecifiers(declaration)) {
    const exportedName = identifierText(specifier.name)
    if (exportedName === exportName) return exportSpecifierLocalName(specifier)
  }
  return undefined
}

const collectKnownStructuralUsageKeys = (
  sourceFiles: ReadonlyArray<SourceFile>,
  index: InterfaceIndex,
): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (const sourceFile of sourceFiles) {
    for (const reference of collectTypeReferenceLikeNodes(sourceFile)) {
      if (!isStructuralUsageReference(referenceOccurrenceNode(reference))) continue
      for (const declaration of resolveInterfaceDeclarations(reference, index)) {
        keys.add(interfaceKey(declaration))
      }
    }
  }
  return keys
}

type TypeReferenceLikeNode = ReturnType<typeof collectTypeReferenceLikeNodes>[number]

const referenceOccurrenceNode = (reference: TypeReferenceLikeNode): Node => {
  if (isTypeReferenceNode(reference)) return reference.typeName
  if (isExpressionWithTypeArguments(reference)) return reference.expression
  if (isImportTypeNode(reference)) return reference.qualifier ?? reference
  return reference.exprName
}

const hasStructuralTypeUsage = (
  iface: InterfaceDeclaration,
  knownStructuralUsageKeys: ReadonlySet<string>,
): boolean => knownStructuralUsageKeys.has(interfaceKey(iface))

const isStructuralUsageReference = (reference: Node): boolean =>
  !isImplementationReference(reference) && !isNonObjectAssertionReference(reference)

const isImplementationReference = (reference: Node): boolean =>
  isClassImplementsReference(reference) || isTypedObjectLiteralReference(reference)

const isClassImplementsReference = (reference: Node): boolean => {
  const heritageExpression = firstAncestor(reference, isExpressionWithTypeArguments)
  if (heritageExpression === undefined || !isHeritageClause(heritageExpression.parent)) return false
  return heritageExpression.parent.token === SyntaxKind.ImplementsKeyword
}

const isTypedObjectLiteralReference = (reference: Node): boolean => {
  const assertion = objectLiteralAssertionReference(reference)
  if (assertion !== undefined) return !isConsumedAssertion(assertion)

  const variableDeclaration = firstAncestor(reference, isVariableDeclaration)
  if (variableDeclaration === undefined) return false
  const initializer = variableDeclaration.initializer
  if (
    initializer === undefined ||
    !isObjectLiteralExpression(unwrapParenthesizedExpression(initializer))
  ) {
    return false
  }
  const typeNode = variableDeclaration.type
  if (typeNode === undefined) return false
  return containsNode(typeNode, reference)
}

const isNonObjectAssertionReference = (reference: Node): boolean => {
  const assertion = assertionReference(reference)
  if (assertion === undefined) return false
  const expression = unwrapParenthesizedExpression(assertion.expression)
  return !isObjectLiteralExpression(expression) && !isConsumedAssertion(assertion)
}

const objectLiteralAssertionReference = (
  reference: Node,
): AsExpression | SatisfiesExpression | undefined => {
  const assertion = assertionReference(reference)
  if (assertion === undefined) return undefined
  const expression = unwrapParenthesizedExpression(assertion.expression)
  return isObjectLiteralExpression(expression) ? assertion : undefined
}

const assertionReference = (
  reference: Node,
): AsExpression | SatisfiesExpression | undefined => {
  const assertion = firstAncestor(
    reference,
    (node): node is AsExpression | SatisfiesExpression =>
      isAsExpression(node) || isSatisfiesExpression(node),
  )
  const typeNode = assertion?.type
  if (typeNode === undefined) return undefined
  return containsNode(typeNode, reference) ? assertion : undefined
}

const isConsumedAssertion = (assertion: AsExpression | SatisfiesExpression): boolean =>
  assertionFeedsExpression(assertion) || assertionVariableIsUsed(assertion)

const assertionFeedsExpression = (assertion: AsExpression | SatisfiesExpression): boolean => {
  const expression = outermostParenthesizedExpression(assertion)
  const parent = expression.parent
  if (isPropertyAccessExpression(parent) || isElementAccessExpression(parent)) {
    return parent.expression === expression
  }
  if (isCallExpression(parent)) {
    return parent.arguments.some((argument) => argument === expression)
  }
  if (isReturnStatement(parent)) {
    return parent.expression === expression
  }
  return false
}

const outermostParenthesizedExpression = (node: Node): Node => {
  let current = node
  while (true) {
    const parent = current.parent
    if (parent === undefined || !isParenthesizedExpression(parent)) return current
    current = parent
  }
}

const assertionVariableIsUsed = (assertion: AsExpression | SatisfiesExpression): boolean => {
  const variableDeclaration = firstAncestor(assertion, isVariableDeclaration)
  if (variableDeclaration === undefined) return false
  const initializer = variableDeclaration.initializer
  if (initializer === undefined || !containsNode(initializer, assertion)) return false

  const nameNode = variableDeclaration.name
  if (isObjectBindingPattern(nameNode) || isArrayBindingPattern(nameNode)) return true
  if (!isIdentifier(nameNode)) return false
  return identifierHasValueUsage(nameNode)
}

const identifierHasValueUsage = (nameNode: import("../tsgo-api.js").Identifier): boolean => {
  const sourceFile = nameNode.getSourceFile()
  let used = false
  walkDescendants(sourceFile, (node) => {
    if (used) return "skip"
    if (!isIdentifier(node) || node === nameNode || node.text !== nameNode.text) return
    if (isTypeOnlyReference(node)) return
    used = true
    return "skip"
  })
  return used
}

const isTypeOnlyReference = (reference: Node): boolean =>
  firstAncestor(reference, isTypeNode) !== undefined

const containsNode = (container: Node, node: Node): boolean => {
  const sourceFile = container.getSourceFile()
  const containerStart = container.getStart(sourceFile)
  const nodeStart = node.getStart(node.getSourceFile())
  return nodeStart >= containerStart && node.end <= container.end
}

const buildImplementationIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
  index: InterfaceIndex,
): ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>> => {
  const byInterfaceKey = new Map<string, Map<string, ImplementationDescriptor>>()

  const add = (interfaceKey: string, descriptor: ImplementationDescriptor): void => {
    const bucket =
      byInterfaceKey.get(interfaceKey) ?? new Map<string, ImplementationDescriptor>()
    bucket.set(`${descriptor.file}:${descriptor.name}`, descriptor)
    byInterfaceKey.set(interfaceKey, bucket)
  }

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.fileName
    walkDescendants(sourceFile, (node) => {
      indexImplementationNode(node, file, index, add)
    })
  }

  return new Map(
    [...byInterfaceKey.entries()].map(([key, descriptors]) => [
      key,
      [...descriptors.values()].sort(compareImplementationDescriptors),
    ]),
  )
}

const indexImplementationNode = (
  node: Node,
  file: string,
  index: InterfaceIndex,
  add: (interfaceKey: string, descriptor: ImplementationDescriptor) => void,
): void => {
  if (isClassDeclaration(node) || isClassExpression(node)) {
    const name = classImplementationName(node)
    for (const heritage of implementsTypes(node)) {
      for (const key of resolveInterfaceKeysFromReference(heritage, index)) {
        add(key, { file, name, kind: "class" })
      }
    }
    return
  }

  if (isVariableDeclaration(node)) {
    const substituteType = objectLiteralSubstituteTypeNode(node)
    for (const key of resolveInterfaceKeysFromTypeNode(substituteType, index)) {
      add(key, { file, name: variableName(node), kind: "object-literal" })
    }
    return
  }

  const assertion = objectLiteralAssertionExpression(node)
  if (assertion !== undefined) {
    for (const key of resolveInterfaceKeysFromTypeNode(assertion.type, index)) {
      add(key, {
        file,
        name: objectLiteralAssertionImplementationName(assertion),
        kind: "object-literal",
      })
    }
    return
  }

  const annotatedReturn = returnAnnotatedObjectLiteralSource(node)
  if (annotatedReturn !== undefined) {
    for (const key of resolveInterfaceKeysFromTypeNode(annotatedReturn.typeNode, index)) {
      add(key, { file, name: annotatedReturn.name, kind: "object-literal" })
    }
  }
}

const objectLiteralAssertionImplementationName = (
  assertion: AsExpression | SatisfiesExpression,
): string => {
  const variableDeclaration = firstAncestor(assertion, isVariableDeclaration)
  if (variableDeclaration !== undefined) {
    const initializer = variableDeclaration.initializer
    if (initializer !== undefined && containsNode(initializer, assertion)) {
      return variableName(variableDeclaration)
    }
  }
  return `<object-literal:L${startLine(assertion)}>`
}

interface AnnotatedReturnSource {
  readonly typeNode: TypeNode
  readonly name: string
}

const returnAnnotatedObjectLiteralSource = (node: Node): AnnotatedReturnSource | undefined => {
  const callable = returnedObjectLiteralCallable(node)
  const typeNode = callable === undefined ? undefined : returnTypeNode(callable)
  if (callable === undefined || typeNode === undefined) return undefined
  return { typeNode, name: callableImplementationName(callable) }
}

const returnedObjectLiteralCallable = (node: Node): CallableImplementationNode | undefined => {
  if (isReturnStatement(node)) {
    const expression = node.expression
    if (expression === undefined) return undefined
    if (!isObjectLiteralExpression(unwrapParenthesizedExpression(expression))) {
      return undefined
    }
    return firstAncestor(node, isCallableImplementationNode)
  }
  if (isArrowFunction(node)) {
    return node.body !== undefined && isObjectLiteralExpression(unwrapParenthesizedExpression(node.body))
      ? node
      : undefined
  }
  return undefined
}

const isCallableImplementationNode = (node: Node): node is CallableImplementationNode =>
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isArrowFunction(node) ||
  isMethodDeclaration(node)

const callableImplementationName = (callable: CallableImplementationNode): string => {
  if (!isArrowFunction(callable) && callable.name !== undefined) {
    return identifierText(callable.name)
  }
  const variableDeclaration = firstAncestor(callable, isVariableDeclaration)
  if (variableDeclaration !== undefined) {
    const initializer = variableDeclaration.initializer
    if (initializer !== undefined && containsNode(initializer, callable)) {
      return variableName(variableDeclaration)
    }
  }
  return `<function:L${startLine(callable)}>`
}

const classImplementationName = (classNode: ClassImplementationNode): string => {
  if (classNode.name !== undefined) return classNode.name.text

  const variableDeclaration = firstAncestor(classNode, isVariableDeclaration)
  if (variableDeclaration === undefined) return "<anonymous-class>"
  const initializer = variableDeclaration.initializer
  if (initializer !== undefined && containsNode(initializer, classNode)) {
    return variableName(variableDeclaration)
  }
  return "<anonymous-class>"
}

const objectLiteralSubstituteTypeNode = (
  declaration: VariableDeclaration,
): TypeNode | undefined => {
  const initializer = declaration.initializer
  if (initializer === undefined) return undefined
  const initializerExpression = unwrapParenthesizedExpression(initializer)
  if (isObjectLiteralExpression(initializerExpression)) return declaration.type

  const expression = objectLiteralAssertionExpression(initializerExpression)
  if (expression === undefined) return undefined
  return expression.type
}

const objectLiteralAssertionExpression = (
  node: Node,
): AsExpression | SatisfiesExpression | undefined => {
  if (!isAsExpression(node) && !isSatisfiesExpression(node)) return undefined
  const expression = unwrapParenthesizedExpression(node.expression)
  return isObjectLiteralExpression(expression) ? node : undefined
}

const unwrapParenthesizedExpression = (node: Node): Node => {
  let current = node
  while (isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

const resolveInterfaceKeysFromReference = (
  reference: ExpressionWithTypeArguments,
  index: InterfaceIndex,
): ReadonlyArray<string> => resolveInterfaceDeclarations(reference, index).map(interfaceKey)

const resolveInterfaceKeysFromTypeNode = (
  typeNode: TypeNode | undefined,
  index: InterfaceIndex,
): ReadonlyArray<string> => {
  if (typeNode === undefined) return []
  if (isParenthesizedTypeNode(typeNode)) {
    return resolveInterfaceKeysFromTypeNode(typeNode.type, index)
  }
  if (isTypeReferenceNode(typeNode) || isImportTypeNode(typeNode) || isTypeQueryNode(typeNode)) {
    return resolveInterfaceDeclarations(typeNode, index).map(interfaceKey)
  }
  if (isIntersectionTypeNode(typeNode) || isUnionTypeNode(typeNode)) {
    return typeNode.types.flatMap((inner) => resolveInterfaceKeysFromTypeNode(inner, index))
  }
  return []
}

const resolveInterfaceDeclarations = (
  node: TypeReferenceNode | ExpressionWithTypeArguments | ImportTypeNode | TypeQueryNode,
  index: InterfaceIndex,
): ReadonlyArray<InterfaceDeclaration> => {
  const sourceFile = node.getSourceFile()
  const name = resolveReferenceLikeName(node)
  const parts = qualifiedNameParts(name)
  const localName = parts[0] ?? name
  const importedName = parts.length > 1 ? (parts[parts.length - 1] ?? name) : localName
  const local = lookupInterface(index, sourceFile.fileName, importedName)
  if (local !== undefined) return [local]
  const imported = importedInterfaceBinding(index, sourceFile, localName, importedName)
  if (imported !== undefined) {
    const resolved = lookupInterface(index, imported.targetFile, imported.importedName)
    if (resolved !== undefined) return [resolved]
  }
  return []
}

const lookupInterface = (
  index: InterfaceIndex,
  filePath: string,
  name: string,
): InterfaceDeclaration | undefined =>
  index.interfacesByFile.get(filePath)?.get(name)

const importedInterfaceBinding = (
  index: InterfaceIndex,
  sourceFile: SourceFile,
  localName: string,
  importedName: string,
): { readonly targetFile: string; readonly importedName: string } | undefined => {
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement)) continue
    const targetFile = index.resolver.resolve(sourceFile.fileName, statement)
    if (targetFile === undefined) continue
    const namedBindings = statement.importClause?.namedBindings
    if (namedBindings === undefined) continue
    if (isNamespaceImport(namedBindings) && identifierText(namedBindings.name) === localName) {
      return { targetFile, importedName }
    }
    if (!isNamedImports(namedBindings)) continue
    for (const element of namedBindings.elements) {
      const local = identifierText(element.name)
      if (local !== localName) continue
      const resolvedName = element.propertyName === undefined
        ? local
        : identifierText(element.propertyName)
      return { targetFile, importedName: resolvedName }
    }
  }
  return undefined
}

const qualifiedNameParts = (name: string): ReadonlyArray<string> =>
  name.split(".").filter((part) => part.length > 0)

const collectInterfaces = (sourceFile: SourceFile): ReadonlyArray<InterfaceDeclaration> => {
  const interfaces: Array<InterfaceDeclaration> = []
  walkDescendants(sourceFile, (node) => {
    if (node.kind === SyntaxKind.InterfaceDeclaration) {
      interfaces.push(node as InterfaceDeclaration)
    }
  })
  return interfaces
}

const buildInterfaceIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): InterfaceIndex => {
  const interfacesByFile = new Map<string, Map<string, InterfaceDeclaration>>()
  const sourceFileByPath = new Map<string, SourceFile>()
  for (const sourceFile of sourceFiles) {
    sourceFileByPath.set(sourceFile.fileName, sourceFile)
    const interfaces = new Map<string, InterfaceDeclaration>()
    for (const iface of collectInterfaces(sourceFile)) {
      interfaces.set(iface.name.text, iface)
    }
    interfacesByFile.set(sourceFile.fileName, interfaces)
  }
  return {
    interfacesByFile,
    sourceFileByPath,
    resolver: createModuleResolver(sourceFiles, packages),
  }
}

const namedExportSpecifiers = (
  declaration: ExportDeclaration,
): ReadonlyArray<import("../tsgo-api.js").ExportSpecifier> =>
  declaration.exportClause !== undefined && isNamedExports(declaration.exportClause)
    ? [...declaration.exportClause.elements]
    : []

const exportSpecifierLocalName = (
  specifier: import("../tsgo-api.js").ExportSpecifier,
): string =>
  specifier.propertyName === undefined
    ? identifierText(specifier.name)
    : identifierText(specifier.propertyName)

const identifierText = (node: Node): string =>
  isIdentifier(node) ? node.text : textOf(node)

const variableName = (declaration: VariableDeclaration): string =>
  isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)

const implementsTypes = (
  node: ClassDeclaration | ClassExpression,
): ReadonlyArray<ExpressionWithTypeArguments> =>
  (node.heritageClauses ?? [])
    .filter((clause) => clause.token === SyntaxKind.ImplementsKeyword)
    .flatMap((clause) => [...clause.types])

const returnTypeNode = (callable: CallableImplementationNode): TypeNode | undefined =>
  "type" in callable ? callable.type : undefined

const startLine = (node: Node): number => {
  const sourceFile = node.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0

/**
 * An invalid floor degrades to 1, which keeps the dead-interface ratio at
 * full strength for any non-empty interface population (no evidence floor).
 */
const normalizeMinInterfaceEvidence = (minimum: number): number =>
  Number.isFinite(minimum) && minimum >= 1 ? Math.floor(minimum) : 1

const compareImplementationDescriptors = (
  left: ImplementationDescriptor,
  right: ImplementationDescriptor,
): number => {
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.name.localeCompare(right.name)
}

const isObjectLiteralImplementation = (descriptor: ImplementationDescriptor): boolean =>
  descriptor.kind === "object-literal"
