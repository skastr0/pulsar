import { Node, SyntaxKind, type Project, type SourceFile, type VariableDeclaration } from "ts-morph"
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

export type ConstIdentifierContext = "local" | "module-constant" | "schema-type-object"

export interface IdentifierDeclaration {
  readonly file: string
  readonly line: number
  readonly kind: IdentifierDeclarationKind
  readonly constContext?: ConstIdentifierContext
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

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (declaration.getVariableStatement()?.getDeclarationKind() !== "const") continue
    pushIdentifierDeclaration(
      identifiers,
      sourceFile,
      declaration.getName(),
      "const",
      declaration,
      classifyConstContext(declaration),
    )
  }
}

const pushIdentifierDeclaration = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
  name: string | undefined,
  kind: IdentifierDeclarationKind,
  declaration: NamedDeclarationLike,
  constContext?: ConstIdentifierContext,
): void => {
  if (name === undefined || !IDENTIFIER_NAME_PATTERN.test(name)) return

  const identifier: IdentifierDeclaration = {
    file: sourceFile.getFilePath(),
    line: declaration.getStartLineNumber(),
    kind,
    name,
    tokens: splitIdentifierTokens(name),
    pattern: inferCasingPattern(name),
  }
  identifiers.push(
    constContext === undefined
      ? identifier
      : {
          ...identifier,
          constContext,
        },
  )
}

const classifyConstContext = (declaration: VariableDeclaration): ConstIdentifierContext => {
  if (!isTopLevelDeclaration(declaration)) return "local"

  const initializer = declaration.getInitializer()
  if (isSchemaOrTypeObjectConst(declaration.getName(), initializer)) return "schema-type-object"
  return inferCasingPattern(declaration.getName()) === "UPPER_SNAKE_CASE" ? "module-constant" : "local"
}

const isTopLevelDeclaration = (declaration: VariableDeclaration): boolean => {
  let node: Node | undefined = declaration.getParent()
  while (node !== undefined) {
    if (Node.isSourceFile(node)) return true
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      return false
    }
    node = node.getParent()
  }
  return true
}

const isSchemaOrTypeObjectConst = (
  name: string,
  initializer: Node | undefined,
): boolean => {
  const unwrappedInitializer = unwrapConstInitializer(initializer)
  if (inferCasingPattern(name) !== "PascalCase" || unwrappedInitializer === undefined) return false
  if (Node.isObjectLiteralExpression(unwrappedInitializer)) return true
  if (!Node.isCallExpression(unwrappedInitializer)) return false

  const expressionText = unwrappedInitializer.getExpression().getText()
  return /(^|\.)(object|schema|type|struct|record|union|literal|enum)$/i.test(expressionText)
}

const unwrapConstInitializer = (initializer: Node | undefined): Node | undefined => {
  let current = initializer
  while (current !== undefined) {
    if (
      !Node.isAsExpression(current) &&
      !Node.isSatisfiesExpression(current) &&
      !Node.isTypeAssertion(current)
    ) {
      return current
    }
    current = current.getExpression()
  }
  return current
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
