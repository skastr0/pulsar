import {
  type AsExpression,
  type ExpressionWithTypeArguments,
  type ExportDeclaration,
  Node,
  type Project,
  type SatisfiesExpression,
  SyntaxKind,
  type InterfaceDeclaration,
  type SourceFile,
  type TypeNode,
  type VariableDeclaration,
} from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver, type ModuleResolver } from "../graph/module-graph.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { hasExportModifier } from "./shared-ts-morph-modifiers.js"
import { declarationKey, resolveReferenceLikeDeclarations } from "./shared-type-analysis.js"

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
  readonly singleImplementationPressure: number
  readonly deadInterfacePressure: number
  readonly diagnosticLimit: number
}

interface TsAb04AnalysisConfig {
  readonly exclude_globs: ReadonlyArray<string>
  readonly test_globs: ReadonlyArray<string>
  readonly public_entry_globs: ReadonlyArray<string>
  readonly top_n_diagnostics: number
}

type ImplementationKind = "class" | "object-literal"

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

export const computeInterfaceImplementationRatio = (
  project: Project,
  config: TsAb04AnalysisConfig,
  packages: ReadonlyArray<PackageInfo> = [],
): TsAb04Output => {
  const { productionFiles, testFiles } = selectInterfaceAnalysisFiles(project, config)
  const candidateInterfaces = collectCandidateInterfaces(productionFiles, config, packages)
  const prodImplementations = buildImplementationIndex(productionFiles)
  const testImplementations = buildImplementationIndex(testFiles)
  const accumulator = buildInterfaceImplementationAccumulator(
    candidateInterfaces,
    prodImplementations,
    testImplementations,
  )
  return buildInterfaceImplementationOutput(
    accumulator,
    normalizeDiagnosticLimit(config.top_n_diagnostics),
  )
}

const selectInterfaceAnalysisFiles = (
  project: Project,
  config: TsAb04AnalysisConfig,
): SourceFileGroups => {
  const sourceFiles = project
    .getSourceFiles()
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
  return {
    productionFiles: sourceFiles.filter(
      (sourceFile) => !matchesAnyGlob(sourceFile.getFilePath(), config.test_globs),
    ),
    testFiles: sourceFiles.filter((sourceFile) =>
      matchesAnyGlob(sourceFile.getFilePath(), config.test_globs),
    ),
  }
}

const collectCandidateInterfaces = (
  productionFiles: ReadonlyArray<SourceFile>,
  config: TsAb04AnalysisConfig,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlyArray<InterfaceDeclaration> => {
  const publicInterfaces = buildPublicInterfaceKeySet(
    productionFiles,
    config.public_entry_globs,
    packages,
  )
  return productionFiles
    .flatMap((sourceFile) => sourceFile.getInterfaces())
    .filter((iface) => !publicInterfaces.has(interfaceKey(iface)))
}

const buildInterfaceImplementationAccumulator = (
  candidateInterfaces: ReadonlyArray<InterfaceDeclaration>,
  prodImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  testImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
): InterfaceImplementationAccumulator => {
  const accumulator: InterfaceImplementationAccumulator = {
    pairs: [],
    deadInterfaces: [],
    totalInterfaces: 0,
  }
  for (const iface of candidateInterfaces) {
    addInterfaceImplementationFinding(iface, prodImplementations, testImplementations, accumulator)
  }
  return accumulator
}

const addInterfaceImplementationFinding = (
  iface: InterfaceDeclaration,
  prodImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  testImplementations: ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>>,
  accumulator: InterfaceImplementationAccumulator,
): void => {
  const key = interfaceKey(iface)
  const productionImplementations = prodImplementations.get(key) ?? []
  const hasTestSubstitute = (testImplementations.get(key) ?? []).length > 0
  if (
    productionImplementations.length > 0 &&
    productionImplementations.every(isObjectLiteralImplementation) &&
    hasStructuralTypeUsage(iface)
  ) {
    return
  }
  if (productionImplementations.length === 0) {
    addDeadInterfaceFinding(iface, accumulator)
    return
  }

  accumulator.totalInterfaces += 1
  if (productionImplementations.length !== 1) return
  const implementation = productionImplementations[0]!
  accumulator.pairs.push({
    interfaceFile: iface.getSourceFile().getFilePath(),
    interfaceName: iface.getName(),
    implementationFile: implementation.file,
    implementationName: implementation.name,
    hasTestSubstitute,
  })
}

const addDeadInterfaceFinding = (
  iface: InterfaceDeclaration,
  accumulator: InterfaceImplementationAccumulator,
): void => {
  if (hasStructuralTypeUsage(iface)) return
  accumulator.totalInterfaces += 1
  accumulator.deadInterfaces.push({
    interfaceFile: iface.getSourceFile().getFilePath(),
    interfaceName: iface.getName(),
    line: iface.getStartLineNumber(),
  })
}

const buildInterfaceImplementationOutput = (
  accumulator: InterfaceImplementationAccumulator,
  diagnosticLimit: number,
): TsAb04Output => {
  const flaggedPairs = accumulator.pairs
    .filter((pair) => !pair.hasTestSubstitute)
    .sort(compareSingleImplPairs)
  const totalInterfaces = accumulator.totalInterfaces
  const ratio = totalInterfaces === 0 ? 0 : flaggedPairs.length / totalInterfaces
  const deadInterfaceRatio =
    totalInterfaces === 0 ? 0 : accumulator.deadInterfaces.length / totalInterfaces

  return {
    pairs: accumulator.pairs,
    flaggedPairs,
    totalInterfaces,
    ratio,
    deadInterfaces: accumulator.deadInterfaces.sort(compareDeadInterfaces),
    deadInterfaceRatio,
    singleImplementationPressure: Math.min(1, ratio / 0.5),
    deadInterfacePressure: Math.min(0.25, deadInterfaceRatio * 0.25),
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
): ReadonlySet<string> => {
  const sourceFileByPath = new Map(
    sourceFiles.map((sourceFile) => [sourceFile.getFilePath(), sourceFile] as const),
  )
  const resolver = createModuleResolver(sourceFiles, packages)
  const publicKeys = new Set<string>()
  const visited = new Set<string>()

  for (const sourceFile of sourceFiles) {
    if (!matchesAnyGlob(sourceFile.getFilePath(), publicEntryGlobs)) continue
    collectPublicInterfacesFromExports(sourceFile, sourceFileByPath, resolver, publicKeys, visited)
  }

  return publicKeys
}

const collectPublicInterfacesFromExports = (
  sourceFile: SourceFile,
  sourceFileByPath: ReadonlyMap<string, SourceFile>,
  resolver: ModuleResolver,
  publicKeys: Set<string>,
  visited: Set<string>,
): void => {
  const file = sourceFile.getFilePath()
  if (visited.has(file)) return
  visited.add(file)

  for (const iface of sourceFile.getInterfaces()) {
    if (hasExportModifier(iface)) {
      publicKeys.add(interfaceKey(iface))
    }
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    const targetPath = resolver.resolve(file, declaration)
    const targetFile = targetPath === undefined ? undefined : sourceFileByPath.get(targetPath)
    const namedExports = declaration.getNamedExports()

    if (targetFile === undefined) continue

    if (namedExports.length > 0) {
      for (const specifier of namedExports) {
        collectPublicInterfaceFromNamedExport(
          specifier.getName(),
          targetFile,
          sourceFileByPath,
          resolver,
          publicKeys,
          visited,
        )
      }
      continue
    }

    collectPublicInterfacesFromExports(targetFile, sourceFileByPath, resolver, publicKeys, visited)
  }
}

const interfaceKey = (iface: InterfaceDeclaration): string => declarationKey(iface)

const collectPublicInterfaceFromNamedExport = (
  exportName: string,
  sourceFile: SourceFile,
  sourceFileByPath: ReadonlyMap<string, SourceFile>,
  resolver: ModuleResolver,
  publicKeys: Set<string>,
  visited: Set<string>,
): void => {
  const iface = sourceFile.getInterface(exportName)
  if (iface !== undefined) {
    publicKeys.add(interfaceKey(iface))
    return
  }

  const exportKey = `${sourceFile.getFilePath()}:${exportName}`
  if (visited.has(exportKey)) return
  visited.add(exportKey)

  for (const declaration of sourceFile.getExportDeclarations()) {
    const targetExportName = matchingNamedExport(declaration, exportName)
    if (targetExportName === undefined) continue

    const targetPath = resolver.resolve(sourceFile.getFilePath(), declaration)
    const targetFile = targetPath === undefined ? undefined : sourceFileByPath.get(targetPath)
    if (targetFile === undefined) continue

    collectPublicInterfaceFromNamedExport(
      targetExportName,
      targetFile,
      sourceFileByPath,
      resolver,
      publicKeys,
      visited,
    )
  }
}

const matchingNamedExport = (
  declaration: ExportDeclaration,
  exportName: string,
): string | undefined => {
  for (const specifier of declaration.getNamedExports()) {
    const exportedName = specifier.getAliasNode()?.getText() ?? specifier.getName()
    if (exportedName === exportName) return specifier.getName()
  }
  return undefined
}

const hasStructuralTypeUsage = (iface: InterfaceDeclaration): boolean => {
  const nameNode = iface.getNameNode()
  return iface.findReferencesAsNodes().some((reference) => {
    if (
      reference.getSourceFile().getFilePath() === iface.getSourceFile().getFilePath() &&
      reference.getStart() === nameNode.getStart()
    ) {
      return false
    }
    return isStructuralUsageReference(reference)
  })
}

const isStructuralUsageReference = (reference: Node): boolean =>
  !isImplementationReference(reference) && !isNonObjectAssertionReference(reference)

const isImplementationReference = (reference: Node): boolean =>
  isClassImplementsReference(reference) || isTypedObjectLiteralReference(reference)

const isClassImplementsReference = (reference: Node): boolean => {
  const heritageExpression = reference.getFirstAncestorByKind(
    SyntaxKind.ExpressionWithTypeArguments,
  )
  const heritageClause = heritageExpression?.getParentIfKind(SyntaxKind.HeritageClause)
  return heritageClause?.getToken() === SyntaxKind.ImplementsKeyword
}

const isTypedObjectLiteralReference = (reference: Node): boolean => {
  const assertion = objectLiteralAssertionReference(reference)
  if (assertion !== undefined) return true

  const variableDeclaration = reference.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (variableDeclaration === undefined) return false
  const initializer = variableDeclaration.getInitializer()
  if (
    initializer === undefined ||
    !Node.isObjectLiteralExpression(unwrapParenthesizedExpression(initializer))
  ) {
    return false
  }
  const typeNode = variableDeclaration.getTypeNode()
  if (typeNode === undefined) return false
  return reference.getStart() >= typeNode.getStart() && reference.getEnd() <= typeNode.getEnd()
}

const isNonObjectAssertionReference = (reference: Node): boolean => {
  const assertion = assertionReference(reference)
  if (assertion === undefined) return false
  const expression = unwrapParenthesizedExpression(assertion.getExpression())
  return !Node.isObjectLiteralExpression(expression) && !isConsumedAssertion(assertion)
}

const objectLiteralAssertionReference = (
  reference: Node,
): AsExpression | SatisfiesExpression | undefined => {
  const assertion = assertionReference(reference)
  if (assertion === undefined) return undefined
  const expression = unwrapParenthesizedExpression(assertion.getExpression())
  return Node.isObjectLiteralExpression(expression) ? assertion : undefined
}

const assertionReference = (
  reference: Node,
): AsExpression | SatisfiesExpression | undefined => {
  const assertion = reference.getFirstAncestor(
    (node): node is AsExpression | SatisfiesExpression =>
      Node.isAsExpression(node) || Node.isSatisfiesExpression(node),
  )
  const typeNode = assertion?.getTypeNode()
  if (typeNode === undefined) return undefined
  return reference.getStart() >= typeNode.getStart() && reference.getEnd() <= typeNode.getEnd()
    ? assertion
    : undefined
}

const isConsumedAssertion = (assertion: AsExpression | SatisfiesExpression): boolean =>
  assertionFeedsPropertyAccess(assertion) || assertionVariableIsUsed(assertion)

const assertionFeedsPropertyAccess = (assertion: AsExpression | SatisfiesExpression): boolean => {
  const parent = assertion.getParent()
  if (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) {
    const expression = parent.getExpression()
    return (
      expression.getStart() === assertion.getStart() &&
      expression.getEnd() === assertion.getEnd()
    )
  }
  return false
}

const assertionVariableIsUsed = (assertion: AsExpression | SatisfiesExpression): boolean => {
  const variableDeclaration = assertion.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (variableDeclaration === undefined) return false
  const initializer = variableDeclaration.getInitializer()
  if (initializer === undefined || !containsNode(initializer, assertion)) return false

  const nameNode = variableDeclaration.getNameNode()
  if (!Node.isIdentifier(nameNode)) return false
  return nameNode.findReferencesAsNodes().some((reference) => reference !== nameNode)
}

const containsNode = (container: Node, node: Node): boolean =>
  node.getStart() >= container.getStart() && node.getEnd() <= container.getEnd()

const buildImplementationIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
): ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>> => {
  const byInterfaceKey = new Map<string, Map<string, ImplementationDescriptor>>()

  const add = (interfaceKey: string, descriptor: ImplementationDescriptor): void => {
    const bucket =
      byInterfaceKey.get(interfaceKey) ?? new Map<string, ImplementationDescriptor>()
    bucket.set(`${descriptor.file}:${descriptor.name}`, descriptor)
    byInterfaceKey.set(interfaceKey, bucket)
  }

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()

    for (const classDeclaration of sourceFile.getClasses()) {
      const name = classDeclaration.getName() ?? "<anonymous-class>"
      for (const heritage of classDeclaration.getImplements()) {
        for (const key of resolveInterfaceKeysFromReference(heritage)) {
          add(key, { file, name, kind: "class" })
        }
      }
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const substituteType = objectLiteralSubstituteTypeNode(declaration)
      if (substituteType === undefined) continue
      for (const key of resolveInterfaceKeysFromTypeNode(substituteType)) {
        add(key, {
          file,
          name: declaration.getName(),
          kind: "object-literal",
        })
      }
    }
  }

  return new Map(
    [...byInterfaceKey.entries()].map(([key, descriptors]) => [
      key,
      [...descriptors.values()].sort(compareImplementationDescriptors),
    ]),
  )
}

const objectLiteralSubstituteTypeNode = (
  declaration: VariableDeclaration,
): TypeNode | undefined => {
  const initializer = declaration.getInitializer()
  if (initializer === undefined) return undefined
  const initializerExpression = unwrapParenthesizedExpression(initializer)
  if (Node.isObjectLiteralExpression(initializerExpression)) return declaration.getTypeNode()

  const expression = objectLiteralAssertionExpression(initializerExpression)
  if (expression === undefined) return undefined
  return expression.getTypeNode()
}

const objectLiteralAssertionExpression = (
  node: Node,
): AsExpression | SatisfiesExpression | undefined => {
  if (!Node.isAsExpression(node) && !Node.isSatisfiesExpression(node)) return undefined
  const expression = unwrapParenthesizedExpression(node.getExpression())
  return Node.isObjectLiteralExpression(expression) ? node : undefined
}

const unwrapParenthesizedExpression = (node: Node): Node => {
  let current = node
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression()
  }
  return current
}

const resolveInterfaceKeysFromReference = (
  reference: ExpressionWithTypeArguments,
): ReadonlyArray<string> => interfaceKeysFromDeclarations(resolveReferenceLikeDeclarations(reference))

const resolveInterfaceKeysFromTypeNode = (
  typeNode: TypeNode | undefined,
): ReadonlyArray<string> => {
  if (typeNode === undefined) return []
  if (Node.isParenthesizedTypeNode(typeNode)) {
    return resolveInterfaceKeysFromTypeNode(typeNode.getTypeNode())
  }
  if (Node.isTypeReference(typeNode)) {
    return interfaceKeysFromDeclarations(resolveReferenceLikeDeclarations(typeNode))
  }
  return []
}

const interfaceKeysFromDeclarations = (declarations: ReadonlyArray<Node>): ReadonlyArray<string> =>
  declarations.filter(Node.isInterfaceDeclaration).map(interfaceKey)

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0

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
