import type { Project, SourceFile } from "ts-morph"
import {
  inferCasingPattern,
  splitIdentifierTokens,
  type IdentifierPattern,
} from "../casing.js"
import { isExcluded } from "./shared-globs.js"

export type IdentifierDeclarationKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"

export interface IdentifierDeclaration {
  readonly file: string
  readonly line: number
  readonly kind: IdentifierDeclarationKind
  readonly name: string
  readonly tokens: ReadonlyArray<string>
  readonly pattern: IdentifierPattern
}

interface NamedDeclarationLike {
  readonly getStartLineNumber: () => number
}

const IDENTIFIER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const collectIdentifierDeclarations = (
  project: Project,
  excludeGlobs: ReadonlyArray<string>,
): ReadonlyArray<IdentifierDeclaration> => {
  const identifiers: Array<IdentifierDeclaration> = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(filePath, excludeGlobs)) continue

    collectNamedDeclarations(identifiers, sourceFile)
  }

  return identifiers.sort(compareIdentifierDeclarations)
}

const collectNamedDeclarations = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
): void => {
  for (const declaration of sourceFile.getFunctions()) {
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "function",
      declaration,
    )
  }

  for (const declaration of sourceFile.getClasses()) {
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "class",
      declaration,
    )
  }

  for (const declaration of sourceFile.getInterfaces()) {
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "interface",
      declaration,
    )
  }

  for (const declaration of sourceFile.getTypeAliases()) {
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "type",
      declaration,
    )
  }

  for (const declaration of sourceFile.getEnums()) {
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "enum",
      declaration,
    )
  }

  for (const statement of sourceFile.getVariableStatements()) {
    if (statement.getDeclarationKind() !== "const") continue

    for (const declaration of statement.getDeclarations()) {
      pushIdentifierDeclaration(
        identifiers,
        sourceFile,
        declaration.getName(),
        "const",
        declaration,
      )
    }
  }
}

const pushIdentifierDeclaration = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
  name: string | undefined,
  kind: IdentifierDeclarationKind,
  declaration: NamedDeclarationLike,
): void => {
  if (name === undefined || !IDENTIFIER_NAME_PATTERN.test(name)) return

  identifiers.push({
    file: sourceFile.getFilePath(),
    line: declaration.getStartLineNumber(),
    kind,
    name,
    tokens: splitIdentifierTokens(name),
    pattern: inferCasingPattern(name),
  })
}

const compareIdentifierDeclarations = (
  left: IdentifierDeclaration,
  right: IdentifierDeclaration,
): number => {
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  if (left.line !== right.line) return left.line - right.line
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.name.localeCompare(right.name)
}
