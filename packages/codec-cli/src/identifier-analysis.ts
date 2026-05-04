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
  readonly package: string
  readonly file: string
  readonly line?: number
  readonly tokens: ReadonlyArray<string>
  readonly pattern: IdentifierPattern
}

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
    getDeclarations: () => Array<{ getName: () => string; getStartLineNumber: () => number }>
  }>
  readonly getDescendants: () => Array<{
    getKindName: () => string
    getName?: () => string
    getStartLineNumber: () => number
  }>
  readonly getExportedDeclarations: () => Map<string, Array<NamedDeclarationLike>>
  readonly getFilePath: () => string
  readonly getBaseName: () => string
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

  for (const statement of sourceFile.getVariableStatements()) {
    if (statement.getDeclarationKind() !== "const") continue
    for (const declaration of statement.getDeclarations()) {
      pushOccurrence(occurrences, packages, worktreePath, sourceFile, declaration.getName(), "const", declaration)
    }
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
): void => {
  if (name === undefined || name.length === 0) return

  occurrences.push({
    name,
    kind,
    package: locatePackageForFile(packages, sourceFile.getFilePath(), worktreePath),
    file: relative(worktreePath, sourceFile.getFilePath()) || sourceFile.getBaseName(),
    line: node.getStartLineNumber(),
    tokens: splitIdentifierTokens(name),
    pattern: inferCasingPattern(name),
  })
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
