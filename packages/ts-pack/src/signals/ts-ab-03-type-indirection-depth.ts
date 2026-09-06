import { SignalComputeError, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import { scoreThresholdViolationShare } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { hasExportModifier, textOf } from "../ast.js"
import {
  isClassDeclaration,
  isEnumDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isTypeAliasDeclaration,
  type SourceFile,
} from "../tsgo-api.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import { isExcluded } from "./shared-globs.js"
import {
  type DepthResult,
  type TrackedDeclaration,
  buildLocalAliasMap,
  createWalkContext,
  measureDeclaration,
  buildTypeIndex,
} from "./ts-ab-03-indirection-walker.js"

export const TsAb03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_depth: Schema.Number,
  max_traversal_steps: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type TsAb03Config = typeof TsAb03Config.Type

interface TypeIndirectionEntry {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly depth: number
  readonly exported: boolean
  readonly chain: ReadonlyArray<string>
  readonly cycle: boolean
  readonly truncated: boolean
}

interface TsAb03Output {
  readonly declarations: ReadonlyArray<TypeIndirectionEntry>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly repoDistribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<TypeIndirectionEntry>
  readonly maxDepth: number
  readonly traversalCap: number
  readonly diagnosticLimit: number
}

export const TsAb03: Signal<TsAb03Config, TsAb03Output, TsAnalysisTag> = {
  id: "TS-AB-03-type-indirection-depth",
  title: "Type indirection depth",
  aliases: ["TS-AB-03"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  evidenceClass: "statistical",
  cacheVersion: "type-indirection-depth-v2-diagnostic-limit-v1",
  configSchema: TsAb03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    max_depth: 4,
    max_traversal_steps: 16,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (fileContext) => fileContext.sourceFile).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-AB-03-type-indirection-depth",
            message: cause.message,
            cause,
          }),
        ),
      )
      const result = yield* Effect.try({
        try: (): TsAb03Output => {
          const declarations: Array<TypeIndirectionEntry> = []
          const byFile = new Map<string, Array<number>>()
          const typeIndex = buildTypeIndex(sourceFiles)

          for (const sourceFile of sourceFiles) {
            const file = sourceFile.fileName
            if (isExcluded(file, config.exclude_globs)) continue

            const localAliases = buildLocalAliasMap(sourceFile)
            const aliasDepthCache = new Map<string, DepthResult>()
            for (const declaration of collectTrackedDeclarations(sourceFile)) {
              const result = measureDeclaration(
                declaration,
                createWalkContext(config.max_traversal_steps, localAliases, aliasDepthCache, typeIndex),
              )
              declarations.push({
                file,
                name: declaration.name === undefined ? "<anonymous>" : (isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)),
                line: sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1,
                depth: result.depth,
                exported: isExportedDeclaration(declaration),
                chain: result.chain,
                cycle: result.cycle,
                truncated: result.truncated,
              })
              const bucket = byFile.get(file) ?? []
              bucket.push(result.depth)
              byFile.set(file, bucket)
            }
          }

          declarations.sort(compareIndirectionEntries)

          const byFileSummary = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFile) {
            byFileSummary.set(file, summarize(values))
          }

          return {
            declarations,
            byFile: byFileSummary,
            repoDistribution: summarize(declarations.map((entry) => entry.depth)),
            overThreshold: declarations.filter((entry) => entry.depth > config.max_depth),
            maxDepth: config.max_depth,
            traversalCap: config.max_traversal_steps,
            diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-03-type-indirection-depth",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    return scoreThresholdViolationShare(out.declarations.length, out.overThreshold.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: typeIndirectionSeverity(entry, out.maxDepth),
      message:
        `Type indirection \`${entry.name}\` resolves through ${entry.depth} layers: ` +
        entry.chain.join(" → "),
      location: { file: entry.file, line: entry.line },
      data: {
        ...entry,
        maxDepth: out.maxDepth,
        traversalCap: out.traversalCap,
      },
    })),
}

const collectTrackedDeclarations = (
  sourceFile: SourceFile,
): ReadonlyArray<TrackedDeclaration> => {
  const results: Array<TrackedDeclaration> = []
  for (const statement of sourceFile.statements) {
    if (isTypeAliasDeclaration(statement)) results.push(statement)
    if (isInterfaceDeclaration(statement) && hasExportModifier(statement)) results.push(statement)
    if (isClassDeclaration(statement) && hasExportModifier(statement)) results.push(statement)
    if (isEnumDeclaration(statement) && hasExportModifier(statement)) results.push(statement)
  }
  return results
}

const isExportedDeclaration = (node: TrackedDeclaration): boolean =>
  !isTypeAliasDeclaration(node) || hasExportModifier(node)

const typeIndirectionSeverity = (
  entry: TypeIndirectionEntry,
  maxDepth: number,
): "warn" | "info" =>
  entry.exported || entry.depth >= maxDepth + 2 ? "warn" : "info"

const compareIndirectionEntries = (
  left: TypeIndirectionEntry,
  right: TypeIndirectionEntry,
): number => {
  if (right.depth !== left.depth) {
    return right.depth - left.depth
  }
  if (left.file !== right.file) {
    return left.file.localeCompare(right.file)
  }
  return left.line - right.line
}

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
