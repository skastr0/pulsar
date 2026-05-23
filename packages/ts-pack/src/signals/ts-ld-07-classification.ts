import { type SourceFile, ts } from "ts-morph"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import {
  collectLocalExportedNames,
  type FunctionBoundaryOwner,
  isBoundaryDeclaration,
  isBoundaryAssertion,
  isBoundaryFunctionOwner,
  isBoundaryParameter,
  isBoundaryProperty,
  isBoundaryVariable,
  isReturnTypeOwner,
  isWithinExportedTypeSurface,
} from "./ts-ld-07-boundary.js"
import type {
  UnsafeTypeKind,
  UnsafeTypeOccurrence,
} from "./ts-ld-07-unsafe-type-erosion.js"

type LocalUnsafeTypeOccurrence = Omit<UnsafeTypeOccurrence, "file">

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

export const collectUnsafeTypeOccurrences = (
  sourceFile: SourceFile,
): ReadonlyArray<LocalUnsafeTypeOccurrence> => {
  const compilerSourceFile = sourceFile.compilerNode
  const exportedNames = collectLocalExportedNames(compilerSourceFile)
  const occurrences: Array<LocalUnsafeTypeOccurrence> = []

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const classified = classifyAnyKeyword(node, compilerSourceFile, exportedNames)
      const position = compilerSourceFile.getLineAndCharacterOfPosition(
        node.getStart(compilerSourceFile),
      )
      const line = position.line + 1
      const column = position.character + 1
      const baseWeight = unsafeTypeWeight(classified.kind, classified.boundary)
      occurrences.push({
        ...classified,
        findingId: unsafeTypeFindingId(line, column, classified.kind, classified.target),
        line,
        severity: classified.boundary ? "warn" : "info",
        visible: true,
        baseWeight,
        weight: baseWeight,
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
  classifyAnyAssertion(current, sourceFile, exportedNames) ??
  classifyAnyParameter(current, sourceFile, exportedNames) ??
  classifyAnyReturn(current, node, sourceFile, exportedNames) ??
  classifyAnyProperty(current, exportedNames) ??
  classifyAnyVariable(current, sourceFile, exportedNames) ??
  classifyAnyTypeAlias(current, exportedNames) ??
  classifyAnyHeritage(current, sourceFile, exportedNames)

const classifyAnyAssertion = (
  current: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
    ? {
        kind: "assertion",
        target: assertionTargetName(current, sourceFile),
        boundary: isBoundaryAssertion(current, exportedNames),
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
    if (ts.isParameter(current)) return current.name.getText(sourceFile)
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

const unsafeTypeFindingId = (
  line: number,
  column: number,
  kind: UnsafeTypeKind,
  target: string,
): string => `${line}:${column}:${kind}:${target}`
