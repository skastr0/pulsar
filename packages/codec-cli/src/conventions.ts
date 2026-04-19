import {
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  decodeSchemaConventionsSync,
  type BoundaryConvention,
  type NamingConventions,
  type SchemaConventions,
} from "@taste-codec/core"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { Effect } from "effect"
import { type PackageInfo, discoverPackages } from "@taste-codec/ts-pack"
import { collectIdentifiers, type IdentifierOccurrence } from "./identifier-analysis.js"
import {
  CONVENTIONS_DRAFT_RELATIVE_PATH,
  promoteReferenceFile,
  readReferenceJson,
  resolveReferenceDataPath,
  writeReferenceJson,
} from "./reference-data-file.js"
import { resolveRepoRoot, withDetachedWorktreeAtRef } from "./runtime.js"

export interface ConventionsCommandOptions {
  readonly action: "extract" | "confirm"
  readonly repoPath: string
  readonly sha?: string
}

type NamingKind = keyof NamingConventions

const DEFAULT_NAMING_CONVENTIONS: NamingConventions = {
  function: "camelCase",
  class: "PascalCase",
  interface: "PascalCase",
  type: "PascalCase",
  const: "camelCase | UPPER_SNAKE_CASE",
  enum: "PascalCase",
}

export const runConventionsCommand = (opts: ConventionsCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action === "extract") {
      if (opts.sha === undefined) {
        return yield* Effect.fail(new Error("conventions extract requires --sha <ref>"))
      }
      return yield* runConventionsExtract(opts.repoPath, opts.sha)
    }

    return yield* runConventionsConfirm(opts.repoPath)
  })

const runConventionsExtract = (repoPath: string, sha: string) =>
  withDetachedWorktreeAtRef(repoPath, sha, ({ repoRoot, resolvedSha, worktreePath }) =>
    Effect.gen(function* () {
      const [identifiers, packages] = yield* Effect.all([
        collectIdentifiers(worktreePath, { includeParameters: false }),
        discoverPackages(worktreePath),
      ])
      const boundaries = yield* inferBoundaries(worktreePath, packages)

      const draft = decodeSchemaConventionsSync({
        schema_version: 1,
        extracted_at_sha: resolvedSha,
        boundaries,
        naming_conventions: inferNamingConventions(identifiers),
        architectural_rules: [],
      })

      const draftPath = yield* writeReferenceJson(
        repoRoot,
        CONVENTIONS_DRAFT_RELATIVE_PATH,
        draft,
      )

      console.log("")
      console.log(`  Conventions draft written: ${draftPath}`)
      console.log(`  SHA:                     ${resolvedSha}`)
      console.log(`  Boundaries:              ${Object.keys(draft.boundaries).length}`)
      console.log("  Architectural rules:     0 (user-authored; starts empty)")
      console.log("")
      return 0
    }),
  )

const runConventionsConfirm = (repoPath: string) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const rawDraft = yield* readReferenceJson(repoRoot, CONVENTIONS_DRAFT_RELATIVE_PATH)
    yield* Effect.try({
      try: () => decodeSchemaConventionsSync(rawDraft),
      catch: (cause) =>
        new Error(
          `Failed to decode conventions draft at ${resolveReferenceDataPath(repoRoot, CONVENTIONS_DRAFT_RELATIVE_PATH)}: ${String(cause)}`,
        ),
    })

    const canonicalPath = yield* promoteReferenceFile(
      repoRoot,
      CONVENTIONS_DRAFT_RELATIVE_PATH,
      CANONICAL_CONVENTIONS_RELATIVE_PATH,
    )

    console.log("")
    console.log(`  Conventions confirmed: ${canonicalPath}`)
    console.log("")
    return 0
  })

const inferNamingConventions = (identifiers: ReadonlyArray<IdentifierOccurrence>): NamingConventions => {
  const grouped: { [K in NamingKind]: Array<IdentifierOccurrence> } = {
    function: [],
    class: [],
    interface: [],
    type: [],
    const: [],
    enum: [],
  }

  for (const identifier of identifiers) {
    if (identifier.kind === "function") grouped.function.push(identifier)
    if (identifier.kind === "class") grouped.class.push(identifier)
    if (identifier.kind === "interface") grouped.interface.push(identifier)
    if (identifier.kind === "type") grouped.type.push(identifier)
    if (identifier.kind === "const") grouped.const.push(identifier)
    if (identifier.kind === "enum") grouped.enum.push(identifier)
  }

  return {
    function: chooseConvention("function", grouped.function),
    class: chooseConvention("class", grouped.class),
    interface: chooseConvention("interface", grouped.interface),
    type: chooseConvention("type", grouped.type),
    const: chooseConvention("const", grouped.const),
    enum: chooseConvention("enum", grouped.enum),
  }
}

const chooseConvention = (
  kind: NamingKind,
  identifiers: ReadonlyArray<IdentifierOccurrence>,
): NamingConventions[NamingKind] => {
  const counts = new Map<string, number>()
  for (const identifier of identifiers) {
    if (identifier.pattern === "unrecognized") continue
    counts.set(identifier.pattern, (counts.get(identifier.pattern) ?? 0) + 1)
  }

  if (kind === "const") {
    const camelCaseCount = counts.get("camelCase") ?? 0
    const upperSnakeCount = counts.get("UPPER_SNAKE_CASE") ?? 0
    const recognizedKinds = [...counts.keys()]
    if (
      camelCaseCount > 0 &&
      upperSnakeCount > 0 &&
      recognizedKinds.every((pattern) => pattern === "camelCase" || pattern === "UPPER_SNAKE_CASE")
    ) {
      return "camelCase | UPPER_SNAKE_CASE"
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return (ranked[0]?.[0] as NamingConventions[NamingKind] | undefined) ?? DEFAULT_NAMING_CONVENTIONS[kind]
}

const inferBoundaries = (
  worktreePath: string,
  packages: ReadonlyArray<PackageInfo>,
): Effect.Effect<SchemaConventions["boundaries"], Error, never> =>
  Effect.forEach(
    [...packages].sort((a, b) => a.path.localeCompare(b.path)),
    (pkg) =>
      Effect.gen(function* () {
        const relPath = relative(worktreePath, pkg.path) || "."
        const packageJson = yield* readPackageJsonIfPresent(pkg.path)
        const visibility = inferVisibility(pkg.path, packageJson)
        const allowedImports = inferAllowedImports(packageJson)
        return [
          relPath,
          {
            visibility,
            allowed_imports: allowedImports,
          } satisfies BoundaryConvention,
        ] as const
      }),
  ).pipe(Effect.map((entries) => Object.fromEntries(entries) as SchemaConventions["boundaries"]))

const readPackageJsonIfPresent = (packageDir: string) =>
  Effect.gen(function* () {
    const packageJsonPath = join(packageDir, "package.json")
    if (!existsSync(packageJsonPath)) return undefined
    const raw = yield* Effect.tryPromise({
      try: () => readFile(packageJsonPath, "utf8"),
      catch: (cause) => new Error(`Failed to read ${packageJsonPath}: ${String(cause)}`),
    })
    return yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) => new Error(`Failed to parse ${packageJsonPath}: ${String(cause)}`),
    })
  })

const inferVisibility = (packageDir: string, packageJson: Record<string, unknown> | undefined) => {
  if (packageJson?.exports !== undefined) return "public-api" as const
  if (existsSync(join(packageDir, "src", "index.ts"))) return "public-api" as const
  if (existsSync(join(packageDir, "index.ts"))) return "public-api" as const
  return "internal" as const
}

const inferAllowedImports = (packageJson: Record<string, unknown> | undefined): Array<string> => {
  const dependencyBlocks = [
    packageJson?.dependencies,
    packageJson?.peerDependencies,
    packageJson?.optionalDependencies,
  ]

  return [...new Set(dependencyBlocks.flatMap((block) => objectKeys(block)))].sort((a, b) =>
    a.localeCompare(b),
  )
}

const objectKeys = (value: unknown): Array<string> =>
  value !== null && typeof value === "object" ? Object.keys(value as Record<string, unknown>) : []
