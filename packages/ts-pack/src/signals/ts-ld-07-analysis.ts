import { type SourceFile, ts } from "ts-morph"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"
import type {
  TsLd07Config,
  TsLd07Output,
  UnsafeTypeFileSummary,
  UnsafeTypeKind,
  UnsafeTypeOccurrence,
} from "./ts-ld-07-unsafe-type-erosion.js"

type LocalUnsafeTypeOccurrence = Omit<UnsafeTypeOccurrence, "file">

type ReturnTypeOwner =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionTypeNode
  | ts.MethodSignature
  | ts.CallSignatureDeclaration
  | ts.ConstructSignatureDeclaration

type FunctionBoundaryOwner =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionTypeNode
  | ts.MethodSignature
  | ts.CallSignatureDeclaration
  | ts.ConstructSignatureDeclaration

type BoundaryDeclaration =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration

const BASE_WEIGHT_BY_KIND: Record<UnsafeTypeKind, number> = {
  parameter: 3,
  return: 3,
  property: 2.5,
  variable: 2,
  "type-alias": 2.5,
  assertion: 2,
  heritage: 2,
  unknown: 1,
}

const BOUNDARY_MULTIPLIER = 2

export const computeUnsafeTypeErosionOutput = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsLd07Config,
): TsLd07Output => {
  const byFile = new Map<string, UnsafeTypeFileSummary>()
  const occurrences: Array<UnsafeTypeOccurrence> = []
  let analyzedFiles = 0
  let analyzedLines = 0

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(file, config.exclude_globs)) continue

    analyzedFiles += 1
    analyzedLines += countNonEmptyLines(sourceFile)

    const fileOccurrences = collectUnsafeTypeOccurrences(sourceFile)
      .map((occurrence) => ({ ...occurrence, file }))
      .sort(compareUnsafeOccurrences)

    if (fileOccurrences.length === 0) continue

    occurrences.push(...fileOccurrences)
    byFile.set(file, summarizeFileOccurrences(fileOccurrences))
  }

  occurrences.sort(compareUnsafeOccurrences)

  return buildUnsafeTypeOutput(byFile, occurrences, analyzedFiles, analyzedLines, config)
}

const buildUnsafeTypeOutput = (
  byFile: ReadonlyMap<string, UnsafeTypeFileSummary>,
  occurrences: ReadonlyArray<UnsafeTypeOccurrence>,
  analyzedFiles: number,
  analyzedLines: number,
  config: TsLd07Config,
): TsLd07Output => {
  const weightedUnsafe = occurrences.reduce((sum, occurrence) => sum + occurrence.weight, 0)
  const boundaryOccurrences = occurrences.filter((occurrence) => occurrence.boundary).length
  const boundaryWeightedUnsafe = occurrences.reduce(
    (sum, occurrence) => sum + (occurrence.boundary ? occurrence.weight : 0),
    0,
  )
  const analyzedKloc = Math.max(1, analyzedLines / 1000)
  const densityPerKloc = weightedUnsafe / analyzedKloc

  return {
    byFile,
    occurrences,
    topOccurrences: occurrences.slice(0, config.top_n_diagnostics),
    totalOccurrences: occurrences.length,
    boundaryOccurrences,
    weightedUnsafe,
    boundaryWeightedUnsafe,
    analyzedFiles,
    analyzedLines,
    densityPerKloc,
    densityPressure: thresholdPressure(densityPerKloc, config.max_weighted_unsafe_per_kloc),
    boundaryPressure: thresholdPressure(
      boundaryWeightedUnsafe,
      config.max_boundary_weighted_unsafe,
    ),
    densityThreshold: config.max_weighted_unsafe_per_kloc,
    boundaryThreshold: config.max_boundary_weighted_unsafe,
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const thresholdPressure = (value: number, threshold: number): number =>
  threshold <= 0 ? 0 : value / threshold

export const collectUnsafeTypeOccurrences = (
  sourceFile: SourceFile,
): ReadonlyArray<LocalUnsafeTypeOccurrence> => {
  const compilerSourceFile = sourceFile.compilerNode
  const exportedNames = collectLocalExportedNames(compilerSourceFile)
  const occurrences: Array<LocalUnsafeTypeOccurrence> = []

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const classified = classifyAnyKeyword(node, compilerSourceFile, exportedNames)
      occurrences.push({
        ...classified,
        line:
          compilerSourceFile.getLineAndCharacterOfPosition(
            node.getStart(compilerSourceFile),
          ).line + 1,
        weight: unsafeTypeWeight(classified.kind, classified.boundary),
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return occurrences
}

const classifyAnyKeyword = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && current !== sourceFile) {
    const classified = classifyAnyKeywordAncestor(current, node, sourceFile, exportedNames)
    if (classified !== undefined) return classified
    current = current.parent
  }

  return {
    kind: "unknown",
    target: "<unknown>",
    boundary: false,
  }
}

const classifyAnyKeywordAncestor = (
  current: ts.Node,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  classifyAnyAssertion(current, sourceFile) ??
  classifyAnyParameter(current, sourceFile, exportedNames) ??
  classifyAnyReturn(current, node, sourceFile, exportedNames) ??
  classifyAnyProperty(current, exportedNames) ??
  classifyAnyVariable(current, sourceFile, exportedNames) ??
  classifyAnyTypeAlias(current, exportedNames) ??
  classifyAnyHeritage(current, sourceFile, exportedNames)

const classifyAnyAssertion = (
  current: ts.Node,
  sourceFile: ts.SourceFile,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    ? {
        kind: "assertion",
        target: assertionTargetName(current, sourceFile),
        boundary: false,
      }
    : undefined

const classifyAnyParameter = (
  current: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isParameter(current)
    ? {
        kind: "parameter",
        target: parameterName(current, sourceFile),
        boundary: isBoundaryParameter(current, exportedNames),
      }
    : undefined

const classifyAnyReturn = (
  current: ts.Node,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isReturnTypeOwner(current) && current.type !== undefined && isAncestorOf(current.type, node)
    ? {
        kind: "return",
        target: functionLikeName(current, sourceFile),
        boundary: isBoundaryFunctionOwner(current, exportedNames),
      }
    : undefined

const classifyAnyProperty = (
  current: ts.Node,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isPropertySignature(current) || ts.isPropertyDeclaration(current)
    ? {
        kind: "property",
        target: propertyNameText(current.name),
        boundary: isBoundaryProperty(current, exportedNames),
      }
    : undefined

const classifyAnyVariable = (
  current: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isVariableDeclaration(current)
    ? {
        kind: "variable",
        target: current.name.getText(sourceFile),
        boundary: isBoundaryVariable(current, exportedNames),
      }
    : undefined

const classifyAnyTypeAlias = (
  current: ts.Node,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isTypeAliasDeclaration(current)
    ? {
        kind: "type-alias",
        target: current.name.text,
        boundary: isBoundaryDeclaration(current, exportedNames),
      }
    : undefined

const classifyAnyHeritage = (
  current: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isHeritageClause(current)
    ? {
        kind: "heritage",
        target: heritageOwnerName(current, sourceFile),
        boundary: isWithinExportedTypeSurface(current, exportedNames),
      }
    : undefined

const collectLocalExportedNames = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    const name = topLevelDeclarationName(statement)
    if (
      name !== undefined &&
      (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
    ) {
      names.add(name)
      continue
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text)
      }
    }
  }

  return names
}

const topLevelDeclarationName = (node: ts.Node): string | undefined => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text
  }
  return undefined
}

const isReturnTypeOwner = (node: ts.Node): node is ReturnTypeOwner =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionTypeNode(node) ||
  ts.isMethodSignature(node) ||
  ts.isCallSignatureDeclaration(node) ||
  ts.isConstructSignatureDeclaration(node)

const isBoundaryParameter = (
  parameter: ts.ParameterDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const owner = parameter.parent
  if (isFunctionBoundaryOwner(owner)) return isBoundaryFunctionOwner(owner, exportedNames)
  return isWithinExportedTypeSurface(parameter, exportedNames)
}

const isBoundaryFunctionOwner = (
  owner: FunctionBoundaryOwner,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (ts.isFunctionDeclaration(owner)) {
    return isBoundaryDeclaration(owner, exportedNames)
  }

  if (ts.isMethodDeclaration(owner)) {
    return (
      isPublicClassMember(owner) &&
      ts.isClassDeclaration(owner.parent) &&
      isBoundaryClass(owner.parent, exportedNames)
    )
  }

  if (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) {
    const parent = owner.parent
    if (ts.isVariableDeclaration(parent)) return isBoundaryVariable(parent, exportedNames)
    if (ts.isPropertyAssignment(parent)) return isWithinExportedTypeSurface(parent, exportedNames)
    return ts.isExportAssignment(parent)
  }

  return isWithinExportedTypeSurface(owner, exportedNames)
}

const isFunctionBoundaryOwner = (node: ts.Node): node is FunctionBoundaryOwner =>
  isReturnTypeOwner(node)

const isBoundaryProperty = (
  property: ts.PropertyDeclaration | ts.PropertySignature,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (ts.isPropertyDeclaration(property)) {
    return isPublicClassMember(property) &&
      ts.isClassDeclaration(property.parent) &&
      isBoundaryClass(property.parent, exportedNames)
  }
  return isWithinExportedTypeSurface(property, exportedNames)
}

const isBoundaryVariable = (
  declaration: ts.VariableDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (!ts.isIdentifier(declaration.name)) return false
  const statement = declaration.parent.parent
  return (
    ts.isVariableStatement(statement) &&
    (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      exportedNames.has(declaration.name.text))
  )
}

const isBoundaryClass = (
  node: ts.ClassDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => isBoundaryDeclaration(node, exportedNames)

const isBoundaryDeclaration = (
  node: BoundaryDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (
    hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
    hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  ) {
    return true
  }
  return ts.isSourceFile(node.parent) && node.name !== undefined && exportedNames.has(node.name.text)
}

const isWithinExportedTypeSurface = (
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isClassDeclaration(current)
    ) {
      return isBoundaryDeclaration(current, exportedNames)
    }
    current = current.parent
  }
  return false
}

const isPublicClassMember = (node: ts.Node): boolean =>
  !hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
  !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)

const isAncestorOf = (ancestor: ts.Node, node: ts.Node): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

const parameterName = (
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): string => parameter.name.getText(sourceFile)

const functionLikeName = (
  owner: FunctionBoundaryOwner,
  sourceFile: ts.SourceFile,
): string => {
  if (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner)) {
    return owner.name?.text ?? "<anonymous>"
  }
  if (ts.isMethodDeclaration(owner) || ts.isMethodSignature(owner)) {
    return propertyNameText(owner.name)
  }
  if (ts.isArrowFunction(owner) || ts.isFunctionTypeNode(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (ts.isCallSignatureDeclaration(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<call signature>"
  }
  return nearestNamedDeclaration(owner, sourceFile) ?? "<construct signature>"
}

const nearestNamedDeclaration = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && current !== sourceFile) {
    if (ts.isVariableDeclaration(current)) return current.name.getText(sourceFile)
    if (
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isClassDeclaration(current)
    ) {
      return current.name?.text
    }
    if (ts.isPropertyAssignment(current) || ts.isPropertySignature(current)) {
      return current.name.getText(sourceFile)
    }
    current = current.parent
  }
  return undefined
}

const assertionTargetName = (
  assertion: ts.AsExpression | ts.TypeAssertion,
  sourceFile: ts.SourceFile,
): string => {
  const expression = assertion.expression
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    return expression.getText(sourceFile)
  }
  return "<expression>"
}

const heritageOwnerName = (
  clause: ts.HeritageClause,
  sourceFile: ts.SourceFile,
): string => nearestNamedDeclaration(clause, sourceFile) ?? "<heritage>"

const unsafeTypeWeight = (kind: UnsafeTypeKind, boundary: boolean): number => {
  const base = BASE_WEIGHT_BY_KIND[kind]
  return boundary ? base * BOUNDARY_MULTIPLIER : base
}

export const summarizeFileOccurrences = (
  occurrences: ReadonlyArray<UnsafeTypeOccurrence>,
): UnsafeTypeFileSummary => ({
  occurrences: occurrences.length,
  boundaryOccurrences: occurrences.filter((occurrence) => occurrence.boundary).length,
  weightedUnsafe: occurrences.reduce((sum, occurrence) => sum + occurrence.weight, 0),
  boundaryWeightedUnsafe: occurrences.reduce(
    (sum, occurrence) => sum + (occurrence.boundary ? occurrence.weight : 0),
    0,
  ),
})

export const countNonEmptyLines = (sourceFile: SourceFile): number =>
  sourceFile.getFullText().split(/\r?\n/u).filter((line) => line.trim() !== "").length

export const compareUnsafeOccurrences = (
  left: UnsafeTypeOccurrence,
  right: UnsafeTypeOccurrence,
): number => {
  if (left.boundary !== right.boundary) return left.boundary ? -1 : 1
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.line - right.line
}
