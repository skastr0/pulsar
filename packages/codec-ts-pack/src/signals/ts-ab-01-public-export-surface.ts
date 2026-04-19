import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"

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
  readonly byKind: Readonly<Record<string, number>>
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
 *   package layouts. Override to narrow in project taste vectors.
 * - surface_threshold: 50 — a file exporting 50+ public symbols is
 *   consistently a case of "everything is exported" rather than an
 *   intentional curated API; log-scale penalty above that.
 */
export const TsAb01: Signal<TsAb01Config, TsAb01Output, TsProjectTag> = {
  id: "TS-AB-01",
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb01Config,
  defaultConfig: {
    public_export_globs: ["**/src/index.ts", "**/index.ts"],
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
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
          const sourceFiles = project
            .getSourceFiles()
            .filter((sf) => {
              const p = sf.getFilePath()
              if (isExcluded(p, config.exclude_globs)) return false
              return matchesAnyGlob(p, config.public_export_globs)
            })

          const byFile = new Map<string, FileSurface>()
          let totalPublicExports = 0
          let largest: { file: string; total: number } | undefined

          for (const sf of sourceFiles) {
            const surface = countExports(sf)
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
            signalId: "TS-AB-01",
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
    const worst = out.largestSurface?.total ?? 0
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
      severity: "info" as const,
      message: `Public export surface: ${file} exports ${surface.total} symbols`,
      location: { file },
      data: {
        file,
        total: surface.total,
        byKind: { ...surface.byKind },
      },
    }))
  },
}

/* ------------------------------------------------------------------ */
/* Export counting                                                     */
/* ------------------------------------------------------------------ */

const countExports = (sf: SourceFile): FileSurface => {
  const byKind: Record<string, number> = {}
  const bump = (kind: string): void => {
    byKind[kind] = (byKind[kind] ?? 0) + 1
  }

  const exportedDeclarations = sf.getExportedDeclarations()
  let sawDefault = false

  for (const [exportName, declarations] of exportedDeclarations) {
    if (exportName === "default") {
      sawDefault = true
      bump("default")
      continue
    }
    bump(classifyExportedSymbol(declarations))
  }

  // `export default ...` can surface as a default export assignment in
  // cases where the resolved declaration map is absent or incomplete.
  if (!sawDefault && sf.getExportAssignments().some((a) => !a.isExportEquals())) {
    bump("default")
  }

  // `export =` (rare but legal in CJS interop).
  if (sf.getExportAssignments().some((a) => a.isExportEquals())) {
    bump("export-equals")
  }

  const total = Object.values(byKind).reduce((acc, n) => acc + n, 0)
  return { total, byKind }
}

const classifyExportedSymbol = (declarations: ReadonlyArray<Node>): string => {
  for (const declaration of declarations) {
    if (Node.isFunctionDeclaration(declaration)) return "function"
    if (Node.isClassDeclaration(declaration)) return "class"
    if (Node.isInterfaceDeclaration(declaration)) return "interface"
    if (Node.isTypeAliasDeclaration(declaration)) return "type"
    if (Node.isEnumDeclaration(declaration)) return "enum"
    if (Node.isModuleDeclaration(declaration)) return "namespace"
    if (Node.isSourceFile(declaration)) return "namespace"
    if (Node.isVariableDeclaration(declaration)) {
      const statement = declaration.getVariableStatement()
      if (statement?.getDeclarationKind() === "let") return "let"
      if (statement?.getDeclarationKind() === "var") return "var"
      return "const"
    }
    if (Node.isExportAssignment(declaration)) {
      return declaration.isExportEquals() ? "export-equals" : "default"
    }
  }

  return "re-export"
}

/* ------------------------------------------------------------------ */
/* Glob matching                                                       */
/* ------------------------------------------------------------------ */

const matchesAnyGlob = (path: string, globs: ReadonlyArray<string>): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

const matchesGlob = (path: string, glob: string): boolean => {
  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  return regex.test(path)
}
