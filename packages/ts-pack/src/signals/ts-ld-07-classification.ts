import { hasModifier, textOf } from "../ast.js"
import {
  SyntaxKind,
  isAsExpression,
  isClassDeclaration,
  isIdentifier,
  isParameter,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignature,
  isTypeAssertion,
  isArrowFunction,
  isCallSignatureDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isHeritageClause,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isMethodSignature,
  isPropertyDeclaration,
  isTypeAliasDeclaration,
  isTypeAssertionExpression,
  isVariableDeclaration,
  type AsExpression,
  type HeritageClause,
  type Node,
  type SourceFile,
  type TypeAssertion,
} from "../tsgo-api.js"
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
  const exportedNames = collectLocalExportedNames(sourceFile)
  const occurrences: Array<LocalUnsafeTypeOccurrence> = []

  const visit = (node: Node): void => {
    if (node.kind === SyntaxKind.AnyKeyword) {
      const classified = classifyAnyKeyword(node, sourceFile, exportedNames)
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
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

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return occurrences
}

const classifyAnyKeyword = (
  node: Node,
  sourceFile: SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> => {
  let current: Node | undefined = node.parent
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
  current: Node,
  node: Node,
  sourceFile: SourceFile,
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
  current: Node,
  sourceFile: SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isAsExpression(current) || isTypeAssertionExpression(current)
    ? {
        kind: "assertion",
        target: assertionTargetName(current, sourceFile),
        boundary: isBoundaryAssertion(current, exportedNames),
      }
    : undefined

const classifyAnyParameter = (
  current: Node,
  sourceFile: SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isParameter(current)
    ? {
        kind: "parameter",
        target: parameterName(current, sourceFile),
        boundary: isBoundaryParameter(current, exportedNames),
      }
    : undefined

const classifyAnyReturn = (
  current: Node,
  node: Node,
  sourceFile: SourceFile,
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
  current: Node,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isPropertySignature(current) || isPropertyDeclaration(current)
    ? {
        kind: "property",
        target: propertyNameText(current.name),
        boundary: isBoundaryProperty(current, exportedNames),
      }
    : undefined

const classifyAnyVariable = (
  current: Node,
  sourceFile: SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isVariableDeclaration(current)
    ? {
        kind: "variable",
        target: textOf(current.name, sourceFile),
        boundary: isBoundaryVariable(current, exportedNames),
      }
    : undefined

const classifyAnyTypeAlias = (
  current: Node,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isTypeAliasDeclaration(current)
    ? {
        kind: "type-alias",
        target: current.name.text,
        boundary: isBoundaryDeclaration(current, exportedNames),
      }
    : undefined

const classifyAnyHeritage = (
  current: Node,
  sourceFile: SourceFile,
  exportedNames: ReadonlySet<string>,
): Pick<LocalUnsafeTypeOccurrence, "kind" | "target" | "boundary"> | undefined =>
  isHeritageClause(current)
    ? {
        kind: "heritage",
        target: heritageOwnerName(current, sourceFile),
        boundary: isWithinExportedTypeSurface(current, exportedNames),
      }
    : undefined

const isAncestorOf = (ancestor: Node, node: Node): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

const parameterName = (
  parameter: ParameterDeclaration,
  sourceFile: SourceFile,
): string => textOf(parameter.name, sourceFile)

const functionLikeName = (
  owner: FunctionBoundaryOwner,
  sourceFile: SourceFile,
): string => {
  if (isFunctionDeclaration(owner) || isFunctionExpression(owner)) {
    return owner.name?.text ?? "<anonymous>"
  }
  if (isMethodDeclaration(owner) || isMethodSignature(owner)) {
    return propertyNameText(owner.name)
  }
  if (isArrowFunction(owner) || isFunctionTypeNode(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (isCallSignatureDeclaration(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<call signature>"
  }
  return nearestNamedDeclaration(owner, sourceFile) ?? "<construct signature>"
}

const nearestNamedDeclaration = (
  node: Node,
  sourceFile: SourceFile,
): string | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined && current !== sourceFile) {
    if (isVariableDeclaration(current)) return textOf(current.name, sourceFile)
    if (
      isTypeAliasDeclaration(current) ||
      isInterfaceDeclaration(current) ||
      isClassDeclaration(current)
    ) {
      return current.name?.text
    }
    if (isParameter(current)) return textOf(current.name, sourceFile)
    if (isPropertyAssignment(current) || isPropertySignature(current)) {
      return textOf(current.name, sourceFile)
    }
    current = current.parent
  }
  return undefined
}

const assertionTargetName = (
  assertion: AsExpression | TypeAssertion,
  sourceFile: SourceFile,
): string => {
  const expression = assertion.expression
  if (isIdentifier(expression) || isPropertyAccessExpression(expression)) {
    return textOf(expression, sourceFile)
  }
  return "<expression>"
}

const heritageOwnerName = (
  clause: HeritageClause,
  sourceFile: SourceFile,
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
