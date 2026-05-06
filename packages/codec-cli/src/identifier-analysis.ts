import { relative } from "node:path"
import type { GlossaryIdentifierKind } from "@taste-codec/core"
import {
  inferCasingPattern,
  splitIdentifierTokens,
  type IdentifierPattern,
} from "@taste-codec/ts-pack"
import { Effect } from "effect"
import { type PackageInfo, discoverPackages, makeTsProject } from "@taste-codec/ts-pack"

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

export type ConstIdentifierContext = "local" | "module-constant" | "schema-type-object"

export interface IdentifierCollectionOptions {
  readonly includeParameters: boolean
}

interface NamedDeclarationLike {
  readonly getStartLineNumber: () => number
}

interface SourceFileLike {
  readonly isDeclarationFile: () => boolean
  readonly getFunctions: () => Array<{ getName: () => string | undefined; getStartLineNumber: () => number }>
  readonly getClasses: () => Array<{ getName: () => string | undefined; getStartLineNumber: () => number }>
  readonly getInterfaces: () => Array<{ getName: () => string; getStartLineNumber: () => number }>
  readonly getTypeAliases: () => Array<{ getName: () => string; getStartLineNumber: () => number }>
  readonly getEnums: () => Array<{ getName: () => string; getStartLineNumber: () => number }>
  readonly getVariableStatements: () => Array<{
    getDeclarationKind: () => string
    getDeclarations: () => Array<{
      getName: () => string
      getStartLineNumber: () => number
      getInitializer?: () => NodeLike | undefined
      getParent?: () => NodeLike | undefined
      getVariableStatement?: () => { getDeclarationKind: () => string } | undefined
    }>
  }>
  readonly getDescendants: () => Array<{
    getKindName: () => string
    getName?: () => string
    getStartLineNumber: () => number
    getInitializer?: () => NodeLike | undefined
    getParent?: () => NodeLike | undefined
    getVariableStatement?: () => { getDeclarationKind: () => string } | undefined
  }>
  readonly getExportedDeclarations: () => Map<string, Array<NamedDeclarationLike>>
  readonly getFilePath: () => string
  readonly getBaseName: () => string
}

interface NodeLike {
  readonly getKindName?: () => string
  readonly getParent?: () => NodeLike | undefined
  readonly getExpression?: () => NodeLike | undefined
  readonly getText?: () => string
}

export const collectIdentifiers = (
  worktreePath: string,
  opts: IdentifierCollectionOptions,
): Effect.Effect<ReadonlyArray<IdentifierOccurrence>> =>
  Effect.gen(function* () {
    const [project, packages] = yield* Effect.all([
      makeTsProject(worktreePath),
      discoverPackages(worktreePath),
    ])

    const occurrences: Array<IdentifierOccurrence> = []
    for (const sourceFile of project.getSourceFiles() as Array<any>) {
      if (sourceFile.isDeclarationFile()) continue
      collectNamedDeclarations(occurrences, sourceFile, packages, worktreePath)
      if (opts.includeParameters) {
        collectParameters(occurrences, sourceFile, packages, worktreePath)
      }
      collectExportedSymbols(occurrences, sourceFile, packages, worktreePath)
    }

    return occurrences.sort(compareIdentifierOccurrences)
  })

const collectNamedDeclarations = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): void => {
  for (const declaration of sourceFile.getFunctions()) {
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "function", declaration)
  }

  for (const declaration of sourceFile.getClasses()) {
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "class", declaration)
  }

  for (const declaration of sourceFile.getInterfaces()) {
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "interface", declaration)
  }

  for (const declaration of sourceFile.getTypeAliases()) {
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "type", declaration)
  }

  for (const declaration of sourceFile.getEnums()) {
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "enum", declaration)
  }

  for (const declaration of sourceFile.getDescendants()) {
    if (declaration.getKindName() !== "VariableDeclaration") continue
    if (declaration.getVariableStatement?.()?.getDeclarationKind() !== "const") continue
    const name = typeof declaration.getName === "function" ? declaration.getName() : undefined
    if (name === undefined) continue
    pushOccurrence(
      occurrences,
      packages,
      worktreePath,
      sourceFile,
      name,
      "const",
      declaration,
      classifyConstContext(declaration as {
        getName: () => string
        getInitializer?: () => NodeLike | undefined
        getParent?: () => NodeLike | undefined
      }),
    )
  }
}

const collectParameters = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): void => {
  for (const parameter of sourceFile.getDescendants()) {
    if (parameter.getKindName() !== "Parameter") continue
    const name = typeof parameter.getName === "function" ? parameter.getName() : undefined
    if (name === undefined || !IDENTIFIER_NAME_PATTERN.test(name)) continue
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, name, "parameter", parameter)
  }
}

const collectExportedSymbols = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): void => {
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    const firstDeclaration = declarations[0] ?? { getStartLineNumber: () => 1 }
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, name, "exported-symbol", firstDeclaration)
  }
}

const pushOccurrence = (
  occurrences: Array<IdentifierOccurrence>,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  sourceFile: SourceFileLike,
  name: string | undefined,
  kind: GlossaryIdentifierKind,
  node: NamedDeclarationLike,
  constContext?: ConstIdentifierContext,
): void => {
  if (name === undefined || name.length === 0) return

  const occurrence: IdentifierOccurrence = {
    name,
    kind,
    package: locatePackageForFile(packages, sourceFile.getFilePath(), worktreePath),
    file: relative(worktreePath, sourceFile.getFilePath()) || sourceFile.getBaseName(),
    line: node.getStartLineNumber(),
    tokens: splitIdentifierTokens(name),
    pattern: inferCasingPattern(name),
  }
  occurrences.push(
    constContext === undefined
      ? occurrence
      : {
          ...occurrence,
          constContext,
        },
  )
}

const classifyConstContext = (declaration: {
  readonly getName: () => string
  readonly getInitializer?: () => NodeLike | undefined
  readonly getParent?: () => NodeLike | undefined
}): ConstIdentifierContext => {
  if (!isTopLevelDeclaration(declaration)) return "local"

  const initializer = declaration.getInitializer?.()
  if (isSchemaOrTypeObjectConst(declaration.getName(), initializer)) return "schema-type-object"
  return inferCasingPattern(declaration.getName()) === "UPPER_SNAKE_CASE" ? "module-constant" : "local"
}

const isTopLevelDeclaration = (declaration: { readonly getParent?: () => NodeLike | undefined }): boolean => {
  let node = declaration.getParent?.()
  while (node !== undefined) {
    const kind = node.getKindName?.()
    if (kind === "SourceFile") return true
    if (kind === "FunctionDeclaration" || kind === "FunctionExpression" || kind === "ArrowFunction") return false
    if (kind === "MethodDeclaration" || kind === "Constructor" || kind === "GetAccessor" || kind === "SetAccessor") {
      return false
    }
    node = node.getParent?.()
  }
  return true
}

const isSchemaOrTypeObjectConst = (name: string, initializer: NodeLike | undefined): boolean => {
  const unwrappedInitializer = unwrapConstInitializer(initializer)
  if (inferCasingPattern(name) !== "PascalCase" || unwrappedInitializer === undefined) return false

  const kind = unwrappedInitializer.getKindName?.()
  if (kind === "ObjectLiteralExpression") return true
  if (kind !== "CallExpression") return false

  const expression = unwrappedInitializer.getExpression?.()
  const expressionText = expression?.getText?.() ?? ""
  return /(^|\.)(object|schema|type|struct|record|union|literal|enum)$/i.test(expressionText)
}

const unwrapConstInitializer = (initializer: NodeLike | undefined): NodeLike | undefined => {
  let current = initializer
  while (current !== undefined) {
    const kind = current.getKindName?.()
    if (kind !== "AsExpression" && kind !== "SatisfiesExpression" && kind !== "TypeAssertion") return current
    current = current.getExpression?.()
  }
  return current
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

const compareIdentifierOccurrences = (a: IdentifierOccurrence, b: IdentifierOccurrence): number => {
  if (a.file !== b.file) return a.file.localeCompare(b.file)
  if ((a.line ?? -1) !== (b.line ?? -1)) return (a.line ?? -1) - (b.line ?? -1)
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
  return a.name.localeCompare(b.name)
}

const IDENTIFIER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
