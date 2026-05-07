import { relative } from "node:path"
import type { GlossaryIdentifierKind } from "@skastr0/pulsar-core"
import {
  inferCasingPattern,
  splitIdentifierTokens,
  type IdentifierPattern,
} from "@skastr0/pulsar-ts-pack"
import { Effect } from "effect"
import { type PackageInfo, discoverPackages, makeTsProject } from "@skastr0/pulsar-ts-pack"

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
  readonly includeLocalConstants?: boolean
}

interface NamedDeclarationLike {
  readonly getStartLineNumber: () => number
}

interface DescendantLike {
  readonly getKindName: () => string
  readonly getName?: () => string
  readonly getStartLineNumber: () => number
  readonly getInitializer?: () => NodeLike | undefined
  readonly getParent?: () => NodeLike | undefined
  readonly getVariableStatement?: () => { getDeclarationKind: () => string } | undefined
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
  readonly forEachDescendant?: (visit: (node: DescendantLike) => void) => void
  readonly getDescendants?: () => Array<DescendantLike>
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
      collectNamedDeclarations(occurrences, sourceFile, packages, worktreePath, opts)
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
  opts: IdentifierCollectionOptions,
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

  collectConstOccurrences(occurrences, sourceFile, packages, worktreePath, opts)
}

const collectConstOccurrences = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  opts: IdentifierCollectionOptions,
): void => {
  for (const statement of sourceFile.getVariableStatements()) {
    if (statement.getDeclarationKind() !== "const") continue
    for (const declaration of statement.getDeclarations()) {
      pushConstOccurrence(occurrences, sourceFile, packages, worktreePath, declaration)
    }
  }

  if (opts.includeLocalConstants !== true) return

  forEachSourceDescendant(sourceFile, (declaration) => {
    if (declaration.getKindName() !== "VariableDeclaration") return
    if (isDirectSourceFileConstDeclaration(declaration)) return
    if (declaration.getVariableStatement?.()?.getDeclarationKind() !== "const") return
    const name = typeof declaration.getName === "function" ? declaration.getName() : undefined
    if (name === undefined) return
    pushConstOccurrence(occurrences, sourceFile, packages, worktreePath, {
      getName: () => name,
      getStartLineNumber: () => declaration.getStartLineNumber(),
      getInitializer: () => declaration.getInitializer?.(),
      getParent: () => declaration.getParent?.(),
    })
  })
}

const pushConstOccurrence = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
  declaration: {
    readonly getName: () => string
    readonly getStartLineNumber: () => number
    readonly getInitializer?: () => NodeLike | undefined
    readonly getParent?: () => NodeLike | undefined
  },
): void => {
  pushOccurrence(
    occurrences,
    packages,
    worktreePath,
    sourceFile,
    declaration.getName(),
    "const",
    declaration,
    classifyConstContext(declaration),
  )
}

const collectParameters = (
  occurrences: Array<IdentifierOccurrence>,
  sourceFile: SourceFileLike,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): void => {
  forEachSourceDescendant(sourceFile, (parameter) => {
    if (parameter.getKindName() !== "Parameter") return
    const name = typeof parameter.getName === "function" ? parameter.getName() : undefined
    if (name === undefined || !IDENTIFIER_NAME_PATTERN.test(name)) return
    pushOccurrence(occurrences, packages, worktreePath, sourceFile, name, "parameter", parameter)
  })
}

const forEachSourceDescendant = (
  sourceFile: SourceFileLike,
  visit: (node: DescendantLike) => void,
): void => {
  if (sourceFile.forEachDescendant !== undefined) {
    sourceFile.forEachDescendant(visit)
    return
  }

  for (const node of sourceFile.getDescendants?.() ?? []) {
    visit(node)
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
  if (!isDirectSourceFileConstDeclaration(declaration)) return "local"

  const initializer = declaration.getInitializer?.()
  if (isSchemaOrTypeObjectConst(declaration.getName(), initializer)) return "schema-type-object"
  return inferCasingPattern(declaration.getName()) === "UPPER_SNAKE_CASE" ? "module-constant" : "local"
}

const isDirectSourceFileConstDeclaration = (
  declaration: { readonly getParent?: () => NodeLike | undefined },
): boolean => {
  const declarationList = declaration.getParent?.()
  if (declarationList?.getKindName?.() !== "VariableDeclarationList") return false
  const statement = declarationList.getParent?.()
  if (statement?.getKindName?.() !== "VariableStatement") return false
  return statement.getParent?.()?.getKindName?.() === "SourceFile"
}

const isSchemaOrTypeObjectConst = (name: string, initializer: NodeLike | undefined): boolean => {
  const unwrappedInitializer = unwrapConstInitializer(initializer)
  if (inferCasingPattern(name) !== "PascalCase" || unwrappedInitializer === undefined) return false

  const kind = unwrappedInitializer.getKindName?.()
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
