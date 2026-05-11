import { Node, type Project, type SourceFile, type VariableDeclaration } from "ts-morph"
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

  collectConstDeclarations(identifiers, sourceFile)
}

const collectConstDeclarations = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
): void => {
  for (const statement of sourceFile.getVariableStatements()) {
    if (statement.getDeclarationKind() !== "const") continue
    for (const declaration of statement.getDeclarations()) {
      pushConstDeclaration(identifiers, sourceFile, declaration)
    }
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return
    if (isDirectSourceFileConstDeclaration(node)) return
    if (node.getVariableStatement()?.getDeclarationKind() !== "const") return
    pushConstDeclaration(identifiers, sourceFile, node)
  })
}

const pushConstDeclaration = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
  declaration: VariableDeclaration,
): void => {
  pushIdentifierDeclaration(
    identifiers,
    sourceFile,
    declaration.getName(),
    "const",
    declaration,
    classifyConstContext(declaration),
  )
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
  if (!isDirectSourceFileConstDeclaration(declaration)) return "local"

  if (isSchemaOrTypeObjectConst(declaration)) return "schema-type-object"
  return "module-constant"
}

const isDirectSourceFileConstDeclaration = (declaration: VariableDeclaration): boolean => {
  const declarationList = declaration.getParent()
  if (!Node.isVariableDeclarationList(declarationList)) return false
  const statement = declarationList.getParent()
  if (!Node.isVariableStatement(statement)) return false
  return Node.isSourceFile(statement.getParent())
}

const isSchemaOrTypeObjectConst = (declaration: VariableDeclaration): boolean => {
  const name = declaration.getName()
  const initializer = declaration.getInitializer()
  const unwrappedInitializer = unwrapConstInitializer(initializer)
  if (inferCasingPattern(name) !== "PascalCase" || unwrappedInitializer === undefined) return false
  if (hasTypeLevelAnnotation(declaration)) return true
  if (Node.isArrowFunction(unwrappedInitializer) && hasTypeLevelText(unwrappedInitializer.getReturnTypeNode()?.getText())) {
    return true
  }
  if (!Node.isCallExpression(unwrappedInitializer)) return false

  const expressionText = unwrappedInitializer.getExpression().getText()
  return (
    /(^|\.)(array|effect|enum|extend|literal|object|pipe|record|schema|scoped|struct|succeed|type|union)$/i.test(expressionText) ||
    (name.endsWith("Layer") && expressionText.startsWith("Layer."))
  )
}

const hasTypeLevelAnnotation = (declaration: VariableDeclaration): boolean =>
  hasTypeLevelText(declaration.getTypeNode()?.getText())

const hasTypeLevelText = (text: string | undefined): boolean =>
  text !== undefined && /\b(Signal|Schema\.Schema|Layer\.Layer)\b/.test(text)

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
