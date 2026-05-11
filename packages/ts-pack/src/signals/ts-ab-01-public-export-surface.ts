import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import {
  Node,
  type ClassDeclaration,
  type FunctionDeclaration,
  type SourceFile,
  type Statement,
  type VariableStatement,
} from "ts-morph"
import { createModuleResolver, type ModuleResolver } from "../graph/module-graph.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { hasDefaultModifier, hasExportModifier } from "./shared-ts-morph-modifiers.js"

export const TsAb01Config = Schema.Struct({
  public_export_globs: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  // Threshold, in exports, beyond which a file's surface is penalized.
  surface_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsAb01Config = typeof TsAb01Config.Type

export interface FileSurface {
  readonly total: number
  readonly weightedTotal: number
  readonly byKind: Readonly<Record<string, number>>
  readonly sourceFileCount: number
  readonly topSources: ReadonlyArray<{ readonly file: string; readonly count: number }>
}

export interface TsAb01Output {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly totalPublicExports: number
  readonly largestSurface:
    | { readonly file: string; readonly total: number }
    | undefined
  /**
   * The threshold used at compute time. Captured in output so the
   * pure `score` function can apply the log-scale penalty without
   * reaching back into config.
   */
  readonly surfaceThreshold: number
}

/**
 * TS-AB-01 — public export surface area.
 *
 * Counts exported symbols per "public" file (conventionally a barrel
 * such as `packages/*\/src/index.ts`) classified by kind. The count is
 * symbol-based, not statement-based: `export * from "./x"` resolves the
 * target module's exported declarations and counts the re-exported
 * symbols individually.
 *
 * This is Tier 1: same tree -> same count.
 *
 * Threshold defaults:
 * - public_export_globs: ["**\/src/index.ts", "**\/index.ts"] —
 *   catchall convention for barrel files in monorepos and single-
 *   package layouts. Override to narrow in project pulsar vectors.
 * - surface_threshold: 50 — a file exporting 50+ public symbols is
 *   consistently a case of "everything is exported" rather than an
 *   intentional curated API; log-scale penalty above that.
 */
export const TsAb01: Signal<TsAb01Config, TsAb01Output, TsProjectTag> = {
  id: "TS-AB-01-public-export-surface",
  title: "Public export surface",
  aliases: ["TS-AB-01"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb01Config,
  defaultConfig: {
    public_export_globs: ["**/src/index.ts", "**/index.ts"],
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/docs/**",
      "**/examples/**",
      "**/prototypes/**",
      "**/explorations/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
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
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    surface_threshold: 50,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb01Output => {
          const allSourceFiles = project
            .getSourceFiles()
            .filter((sf) => !isExcluded(sf.getFilePath(), config.exclude_globs))
          const sourceFiles = allSourceFiles.filter((sf) =>
            matchesAnyGlob(sf.getFilePath(), config.public_export_globs),
          )
          const sourceFileByPath = new Map(
            allSourceFiles.map((sourceFile) => [sourceFile.getFilePath(), sourceFile] as const),
          )
          const resolver = createModuleResolver(allSourceFiles, [])
          const exportIndex = new ExportSurfaceIndex(sourceFileByPath, resolver)

          const byFile = new Map<string, FileSurface>()
          let totalPublicExports = 0
          let largest: { file: string; total: number } | undefined

          for (const sf of sourceFiles) {
            const surface = countExports(sf, exportIndex)
            byFile.set(sf.getFilePath(), surface)
            totalPublicExports += surface.total
            if (largest === undefined || surface.total > largest.total) {
              largest = { file: sf.getFilePath(), total: surface.total }
            }
          }

          return {
            byFile,
            totalPublicExports,
            largestSurface: largest,
            surfaceThreshold: config.surface_threshold,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-01-public-export-surface",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.byFile.size === 0) return 1
    // Log-scale penalty on the worst offender. Below the threshold the
    // score stays at 1; doubling the threshold drops roughly 0.15;
    // 10x the threshold drops 0.5. Using the max rather than the mean
    // surfaces a single runaway file instead of letting small tidy
    // barrels mask it.
    const worst =
      out.largestSurface === undefined
        ? 0
        : out.byFile.get(out.largestSurface.file)?.weightedTotal ?? out.largestSurface.total
    if (worst <= 0) return 1
    const ratio = worst / Math.max(1, out.surfaceThreshold)
    if (ratio <= 1) return 1
    return Math.max(0, 1 - Math.log10(ratio) * 0.5)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const entries = [...out.byFile.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
    return entries.map(([file, surface]) => ({
      severity: surface.weightedTotal > out.surfaceThreshold ? ("warn" as const) : ("info" as const),
      message:
        `Public export surface: ${file} exports ${surface.total} symbols ` +
        `(weighted ${formatWeightedSurface(surface.weightedTotal)}, ${runtimeExportCount(surface)} runtime, ` +
        `${typeOnlyExportCount(surface)} type-only, ${surface.sourceFileCount} source modules)`,
      location: { file },
      data: {
        file,
        total: surface.total,
        weightedTotal: surface.weightedTotal,
        byKind: { ...surface.byKind },
        sourceFileCount: surface.sourceFileCount,
        topSources: surface.topSources.map((source) => ({ ...source })),
      },
    }))
  },
}

/* ------------------------------------------------------------------ */
/* Export counting                                                     */
/* ------------------------------------------------------------------ */

type ExportSymbolInfo = {
  readonly publicName: string
  readonly kind: string
  readonly sourceFile: string
}

class ExportSurfaceIndex {
  private readonly cache = new Map<string, ReadonlyMap<string, ExportSymbolInfo>>()

  constructor(
    private readonly sourceFileByPath: ReadonlyMap<string, SourceFile>,
    private readonly resolver: ModuleResolver,
  ) {}

  exportsFor(sourceFile: SourceFile): ReadonlyMap<string, ExportSymbolInfo> {
    const path = sourceFile.getFilePath()
    const cached = this.cache.get(path)
    if (cached !== undefined) return cached

    const pending = new Map<string, ExportSymbolInfo>()
    this.cache.set(path, pending)
    this.collectInto(sourceFile, pending)
    return pending
  }

  private collectInto(sourceFile: SourceFile, exports: Map<string, ExportSymbolInfo>): void {
    const sourcePath = sourceFile.getFilePath()
    const importedSymbols = this.importedSymbolsFor(sourceFile)

    for (const statement of sourceFile.getStatements()) {
      if (this.collectDeclarationExport(statement, sourcePath, exports)) continue

      if (Node.isExportDeclaration(statement)) {
        this.collectExportDeclaration(statement, sourceFile, exports, importedSymbols)
        continue
      }
    }
  }

  private collectDeclarationExport(
    statement: Statement,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): boolean {
    if (Node.isFunctionDeclaration(statement)) {
      this.collectNamedOrDefaultExport(statement, "function", sourcePath, exports)
      return true
    }
    if (Node.isClassDeclaration(statement)) {
      this.collectNamedOrDefaultExport(statement, "class", sourcePath, exports)
      return true
    }
    if (Node.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "interface", sourcePath, exports)
      return true
    }
    if (Node.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "type", sourcePath, exports)
      return true
    }
    if (Node.isEnumDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "enum", sourcePath, exports)
      return true
    }
    if (Node.isModuleDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "namespace", sourcePath, exports)
      return true
    }
    if (Node.isVariableStatement(statement) && hasExportModifier(statement)) {
      this.collectVariableExports(statement, sourcePath, exports)
      return true
    }
    if (Node.isExportAssignment(statement)) {
      this.collectExportAssignment(statement, sourcePath, exports)
      return true
    }
    return false
  }

  private collectNamedOrDefaultExport(
    statement: FunctionDeclaration | ClassDeclaration,
    kind: string,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    if (hasDefaultModifier(statement)) {
      exports.set("default", { publicName: "default", kind: "default", sourceFile: sourcePath })
      return
    }
    if (!hasExportModifier(statement)) return
    this.collectNamedExport(statement.getName(), kind, sourcePath, exports)
  }

  private collectNamedExport(
    name: string | undefined,
    kind: string,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    if (name !== undefined) {
      exports.set(name, { publicName: name, kind, sourceFile: sourcePath })
    }
  }

  private collectVariableExports(
    statement: VariableStatement,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    const kind = declarationKind(statement)
    for (const declaration of statement.getDeclarations()) {
      const name = declaration.getName()
      exports.set(name, { publicName: name, kind, sourceFile: sourcePath })
    }
  }

  private collectExportAssignment(
    statement: import("ts-morph").ExportAssignment,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    const kind = statement.isExportEquals() ? "export-equals" : "default"
    const publicName = statement.isExportEquals() ? "export=" : "default"
    exports.set(publicName, { publicName, kind, sourceFile: sourcePath })
  }

  private collectExportDeclaration(
    declaration: import("ts-morph").ExportDeclaration,
    sourceFile: SourceFile,
    exports: Map<string, ExportSymbolInfo>,
    importedSymbols: ReadonlyMap<string, ExportSymbolInfo>,
  ): void {
    const sourcePath = sourceFile.getFilePath()
    const targetPath = this.resolver.resolve(sourcePath, declaration)
    const targetFile = targetPath === undefined ? undefined : this.sourceFileByPath.get(targetPath)
    const targetExports = targetFile === undefined ? new Map<string, ExportSymbolInfo>() : this.exportsFor(targetFile)
    const namedExports = declaration.getNamedExports()
    const namespaceExport = declaration.getNamespaceExport()

    if (namespaceExport !== undefined) {
      const publicName = namespaceExport.getName()
      exports.set(publicName, {
        publicName,
        kind: "namespace",
        sourceFile: targetPath ?? sourcePath,
      })
      return
    }

    if (namedExports.length > 0) {
      for (const specifier of namedExports) {
        const exportedName = specifier.getAliasNode()?.getText() ?? specifier.getName()
        const importedName = specifier.getName()
        if (targetFile === undefined) {
          const imported = importedSymbols.get(importedName)
          exports.set(exportedName, {
            publicName: exportedName,
            kind: declaration.isTypeOnly() ? "type" : (imported?.kind ?? "re-export"),
            sourceFile: imported?.sourceFile ?? sourcePath,
          })
          continue
        }
        const target = targetExports.get(importedName)
        exports.set(exportedName, {
          publicName: exportedName,
          kind: target?.kind ?? "re-export",
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }
      return
    }

    if (targetFile !== undefined) {
      for (const [name, target] of targetExports) {
        if (name === "default") continue
        exports.set(name, target)
      }
    }
  }

  private importedSymbolsFor(sourceFile: SourceFile): ReadonlyMap<string, ExportSymbolInfo> {
    const sourcePath = sourceFile.getFilePath()
    const imported = new Map<string, ExportSymbolInfo>()

    for (const declaration of sourceFile.getImportDeclarations()) {
      const targetPath = this.resolver.resolve(sourcePath, declaration)
      const targetFile = targetPath === undefined ? undefined : this.sourceFileByPath.get(targetPath)
      const targetExports = targetFile === undefined ? new Map<string, ExportSymbolInfo>() : this.exportsFor(targetFile)
      const declarationTypeOnly = declaration.isTypeOnly() || declaration.getImportClause()?.isTypeOnly() === true

      const defaultImport = declaration.getDefaultImport()
      if (defaultImport !== undefined) {
        const target = targetExports.get("default")
        imported.set(defaultImport.getText(), {
          publicName: defaultImport.getText(),
          kind: declarationTypeOnly ? "type" : (target?.kind ?? "default"),
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }

      const namespaceImport = declaration.getNamespaceImport()
      if (namespaceImport !== undefined) {
        imported.set(namespaceImport.getText(), {
          publicName: namespaceImport.getText(),
          kind: declarationTypeOnly ? "type" : "namespace",
          sourceFile: targetPath ?? sourcePath,
        })
      }

      for (const specifier of declaration.getNamedImports()) {
        const publicName = specifier.getAliasNode()?.getText() ?? specifier.getName()
        const importedName = specifier.getName()
        const target = targetExports.get(importedName)
        const typeOnly = declarationTypeOnly || specifier.isTypeOnly()
        imported.set(publicName, {
          publicName,
          kind: typeOnly ? "type" : (target?.kind ?? "re-export"),
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }
    }

    return imported
  }
}

const countExports = (sf: SourceFile, exportIndex: ExportSurfaceIndex): FileSurface => {
  const byKind: Record<string, number> = {}
  const sourceCounts = new Map<string, number>()
  const bump = (kind: string): void => {
    byKind[kind] = (byKind[kind] ?? 0) + 1
  }

  for (const symbol of exportIndex.exportsFor(sf).values()) {
    bump(symbol.kind)
    if (symbol.sourceFile === sf.getFilePath()) continue
    sourceCounts.set(symbol.sourceFile, (sourceCounts.get(symbol.sourceFile) ?? 0) + 1)
  }

  const total = Object.values(byKind).reduce((acc, n) => acc + n, 0)
  const weightedTotal = Object.entries(byKind).reduce(
    (acc, [kind, count]) => acc + exportKindWeight(kind) * count,
    0,
  )
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([file, count]) => ({ file, count }))

  return {
    total,
    weightedTotal,
    byKind,
    sourceFileCount: sourceCounts.size,
    topSources,
  }
}

const exportKindWeight = (kind: string): number =>
  kind === "type" || kind === "interface" ? 0.25 : 1

const runtimeExportCount = (surface: FileSurface): number =>
  Object.entries(surface.byKind).reduce(
    (sum, [kind, count]) => sum + (exportKindWeight(kind) === 1 ? count : 0),
    0,
  )

const typeOnlyExportCount = (surface: FileSurface): number =>
  (surface.byKind.type ?? 0) + (surface.byKind.interface ?? 0)

const formatWeightedSurface = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)

const declarationKind = (statement: VariableStatement): string => {
  const kind = statement.getDeclarationKind()
  if (kind === "let") return "let"
  if (kind === "var") return "var"
  return "const"
}
