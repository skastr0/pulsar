import { relative } from "node:path"
import type { GlossaryIdentifierKind } from "@skastr0/pulsar-core/reference-data"
import {
  inferCasingPattern,
  splitIdentifierTokens,
  type IdentifierPattern,
  type PackageInfo,
  type Node,
  type SourceFile,
  type VariableDeclaration,
  discoverPackages,
  TsAnalysisLayer,
  TsAnalysisTag,
  isAsExpression,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isParameter,
  isSatisfiesExpression,
  isSourceFile as isTsSourceFile,
  isTypeAliasDeclaration,
  isTypeAssertionExpression,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  textOf,
  walkDescendants,
} from "@skastr0/pulsar-ts-pack"
import { Effect } from "effect"
import { compareSourceLocationThenFields } from "./source-location-field-order.js"

export interface IdentifierOccurrence {
  readonly name: string
  readonly kind: GlossaryIdentifierKind
  readonly constContext?: ConstIdentifierContext
  readonly package: string
  readonly file: string
  readonly line?: number
  readonly tokens: ReadonlyArray<string>
  readonly pattern: IdentifierPattern
}

type ConstIdentifierContext = "local" | "module-constant" | "schema-type-object"

interface IdentifierCollectionOptions {
  readonly includeParameters: boolean
  readonly includeLocalConstants?: boolean
}

export const collectIdentifiers = (
  worktreePath: string,
  opts: IdentifierCollectionOptions,
): Effect.Effect<ReadonlyArray<IdentifierOccurrence>> =>
  Effect.gen(function* () {
    const packages = yield* discoverPackages(worktreePath)
    const sourceFiles = yield* TsAnalysisTag.pipe(
      Effect.flatMap((analysis) => analysis.mapFiles(async (fileContext) => fileContext.sourceFile)),
      Effect.provide(TsAnalysisLayer(worktreePath)),
      Effect.orDie,
    )

    const occurrences: Array<IdentifierOccurrence> = []
    for (const sourceFile of sourceFiles) {
      if (sourceFile.isDeclarationFile) continue
      collectNamedDeclarations(occurrences, sourceFile, packages, worktreePath, opts)
      if (opts.includeParameters) {
        collectParameters(occurrences, sourceFile, packages, worktreePath)
      }
    }

    return occurrences.sort(compareIdentifierOccurrences)
  })

const collectNamedDeclarations = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFile,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  opts: IdentifierCollectionOptions,
): void => {
  for (const statement of sourceFile.statements) {
    if (isFunctionDeclaration(statement)) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, statement.name?.text, "function", statement)
    }
    if (isClassDeclaration(statement)) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, statement.name?.text, "class", statement)
    }
    if (isInterfaceDeclaration(statement)) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, statement.name.text, "interface", statement)
    }
    if (isTypeAliasDeclaration(statement)) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, statement.name.text, "type", statement)
    }
    if (isEnumDeclaration(statement)) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, statement.name.text, "enum", statement)
    }
    if (isVariableStatement(statement) && isConstList(statement.declarationList)) {
      for (const declaration of statement.declarationList.declarations) {
        pushConstOccurrence(occurrences, sourceFile, packages, worktreePath, declaration)
      }
    }
  }

  if (opts.includeLocalConstants !== true) return
  walkDescendants(sourceFile, (node) => {
    if (!isVariableDeclaration(node)) return
    if (isTopLevelConst(node)) return
    if (!isConstDeclaration(node)) return
    pushConstOccurrence(occurrences, sourceFile, packages, worktreePath, node)
  })
}

const collectParameters = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFile,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): void => {
  walkDescendants(sourceFile, (node) => {
    if (!isParameter(node) || !isIdentifier(node.name)) return
    if (!IDENTIFIER_NAME_PATTERN.test(node.name.text)) return
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, node.name.text, "parameter", node)
  })
}

const pushConstOccurrence = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFile,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  declaration: VariableDeclaration,
): void => {
  const name = isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)
  pushOccurrence(
    occurrences,
    packages,
    worktreePath,
    sourceFile,
    name,
    "const",
    declaration,
    classifyConstContext(declaration),
  )
}

const pushOccurrence = (
  occurrences: Array<IdentifierOccurrence>,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  sourceFile: SourceFile,
  name: string | undefined,
  kind: GlossaryIdentifierKind,
  node: Node,
  constContext?: ConstIdentifierContext,
): void => {
  if (name === undefined || name.length === 0) return
  const occurrence: IdentifierOccurrence = {
    name,
    kind,
    package: locatePackageForFile(packages, sourceFile.fileName, worktreePath),
    file: relative(worktreePath, sourceFile.fileName) || sourceFile.fileName,
    line: startLine(node),
    tokens: splitIdentifierTokens(name),
    pattern: inferCasingPattern(name),
  }
  occurrences.push(constContext === undefined ? occurrence : { ...occurrence, constContext })
}

const classifyConstContext = (declaration: VariableDeclaration): ConstIdentifierContext => {
  if (!isTopLevelConst(declaration)) return "local"
  if (isSchemaOrTypeObjectConst(declaration)) return "schema-type-object"
  const name = isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)
  return inferCasingPattern(name) === "UPPER_SNAKE_CASE" ? "module-constant" : "local"
}

const isTopLevelConst = (declaration: VariableDeclaration): boolean => {
  const list = declaration.parent
  if (!isVariableDeclarationList(list)) return false
  const statement = list.parent
  if (!isVariableStatement(statement)) return false
  return isTsSourceFile(statement.parent)
}

const isConstDeclaration = (declaration: VariableDeclaration): boolean => {
  const list = declaration.parent
  return isVariableDeclarationList(list) && isConstList(list)
}

const isConstList = (list: { readonly flags: number } & Node): boolean =>
  (list.flags & 2) !== 0 || textOf(list).trimStart().startsWith("const ")

const isSchemaOrTypeObjectConst = (declaration: VariableDeclaration): boolean => {
  const name = isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)
  const initializer = unwrapConstInitializer(declaration.initializer)
  if (inferCasingPattern(name) !== "PascalCase" || initializer === undefined) return false
  if (!isCallExpression(initializer)) return false
  return /(^|\.)(object|schema|type|struct|record|union|literal|enum)$/i.test(textOf(initializer.expression))
}

const unwrapConstInitializer = (initializer: Node | undefined): Node | undefined => {
  let current = initializer
  while (current !== undefined) {
    if (isAsExpression(current) || isSatisfiesExpression(current) || isTypeAssertionExpression(current)) {
      current = current.expression
      continue
    }
    return current
  }
  return current
}

const startLine = (node: Node): number => {
  const sourceFile = node.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

const locatePackageForFile = (
  packages: ReadonlyArray<PackageInfo>,
  filePath: string,
  worktreePath: string,
): string => {
  const match = [...packages]
    .sort((a, b) => b.path.length - a.path.length)
    .find((pkg) => filePath.startsWith(pkg.path))
  if (match === undefined) return "."
  return relative(worktreePath, match.path) || "."
}

const compareIdentifierOccurrences = (a: IdentifierOccurrence, b: IdentifierOccurrence): number =>
  compareSourceLocationThenFields(a, b, [(entry) => entry.kind, (entry) => entry.name])

const IDENTIFIER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
