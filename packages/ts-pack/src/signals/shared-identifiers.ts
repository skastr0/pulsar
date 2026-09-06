import {
  inferCasingPattern,
  splitIdentifierTokens,
  type IdentifierPattern,
} from "../casing.js"
import {
  compareDiagnosticOrderProperties,
  type DiagnosticOrderProperties,
} from "./shared-diagnostic-order.js"
import { isExcluded } from "./shared-globs.js"
import { textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isAsExpression,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isSatisfiesExpression,
  isSourceFile,
  isTypeAliasDeclaration,
  isTypeAssertionExpression,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  type Node,
  type SourceFile,
  type VariableDeclaration,
} from "../tsgo-api.js"

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

const IDENTIFIER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const collectIdentifierDeclarationsFromFile = (
  sourceFile: SourceFile,
  excludeGlobs: ReadonlyArray<string>,
): ReadonlyArray<IdentifierDeclaration> => {
  const identifiers: Array<IdentifierDeclaration> = []
  if (sourceFile.isDeclarationFile || isExcluded(sourceFile.fileName, excludeGlobs)) {
    return identifiers
  }
  walkDescendants(sourceFile, (node) => {
    if (isFunctionDeclaration(node) && node.name !== undefined) {
      pushIdentifierDeclaration(identifiers, sourceFile, node.name.text, "function", node)
      return
    }
    if (isClassDeclaration(node) && node.name !== undefined) {
      pushIdentifierDeclaration(identifiers, sourceFile, node.name.text, "class", node)
      return
    }
    if (isInterfaceDeclaration(node)) {
      pushIdentifierDeclaration(identifiers, sourceFile, node.name.text, "interface", node)
      return
    }
    if (isTypeAliasDeclaration(node)) {
      pushIdentifierDeclaration(identifiers, sourceFile, node.name.text, "type", node)
      return
    }
    if (isEnumDeclaration(node)) {
      pushIdentifierDeclaration(identifiers, sourceFile, node.name.text, "enum", node)
      return
    }
    if (isVariableDeclaration(node) && isConstDeclaration(node)) {
      pushConstDeclaration(identifiers, sourceFile, node)
    }
  })
  return identifiers.sort(compareIdentifierDeclarations)
}

const pushConstDeclaration = (
  identifiers: Array<IdentifierDeclaration>,
  sourceFile: SourceFile,
  declaration: VariableDeclaration,
): void => {
  pushIdentifierDeclaration(
    identifiers,
    sourceFile,
    isIdentifier(declaration.name) ? declaration.name.text : undefined,
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
  declaration: Node,
  constContext?: ConstIdentifierContext,
): void => {
  if (name === undefined || !IDENTIFIER_NAME_PATTERN.test(name)) return

  const identifier: IdentifierDeclaration = {
    file: sourceFile.fileName,
    line: sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1,
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
  const declarationList = declaration.parent
  if (!isVariableDeclarationList(declarationList)) return false
  const statement = declarationList.parent
  if (!isVariableStatement(statement)) return false
  return isSourceFile(statement.parent)
}

const isSchemaOrTypeObjectConst = (declaration: VariableDeclaration): boolean => {
  const name = isIdentifier(declaration.name) ? declaration.name.text : ""
  const initializer = declaration.initializer
  const unwrappedInitializer = unwrapConstInitializer(initializer)
  if (inferCasingPattern(name) !== "PascalCase" || unwrappedInitializer === undefined) return false
  if (hasTypeLevelAnnotation(declaration)) return true
  if (isArrowFunction(unwrappedInitializer) && hasTypeLevelText(unwrappedInitializer.type ? textOf(unwrappedInitializer.type) : undefined)) {
    return true
  }
  if (!isCallExpression(unwrappedInitializer)) return false

  const expressionText = textOf(unwrappedInitializer.expression)
  return (
    expressionText === "Schema" ||
    expressionText.startsWith("Schema.") ||
    (name.endsWith("Schema") && /(^|\.)(array|enum|extend|literal|object|record|schema|struct|type|union)$/i.test(expressionText)) ||
    (name.endsWith("Schema") && expressionText === "pipe") ||
    (name.endsWith("Layer") && expressionText.startsWith("Layer."))
  )
}

const hasTypeLevelAnnotation = (declaration: VariableDeclaration): boolean =>
  hasTypeLevelText(declaration.type === undefined ? undefined : textOf(declaration.type))

const hasTypeLevelText = (text: string | undefined): boolean =>
  text !== undefined && /\b(Signal|Schema\.Schema|Layer\.Layer)\b/.test(text)

const unwrapConstInitializer = (initializer: Node | undefined): Node | undefined => {
  let current = initializer
  while (current !== undefined) {
    if (
      !isAsExpression(current) &&
      !isSatisfiesExpression(current) &&
      !isTypeAssertionExpression(current)
    ) {
      return current
    }
    current = current.expression
  }
  return current
}

const isConstDeclaration = (declaration: VariableDeclaration): boolean => {
  const list = declaration.parent
  if (!isVariableDeclarationList(list)) return false
  return (list.flags & 2) !== 0 || textOf(list).startsWith("const ")
}

const compareIdentifierDeclarations = (
  left: IdentifierDeclaration,
  right: IdentifierDeclaration,
): number => compareDiagnosticOrderProperties(left, right, IDENTIFIER_DECLARATION_ORDER)

const IDENTIFIER_DECLARATION_ORDER = {
  file: "file",
  line: "line",
  kind: "kind",
  label: "name",
} satisfies DiagnosticOrderProperties<IdentifierDeclaration>
