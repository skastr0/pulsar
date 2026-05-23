import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import { exportKindWeight, type FileSurface } from "./ts-ab-01-export-collection.js"

interface PublicExportDiagnosticsOutput {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly diagnosticLimit: number
  readonly surfaceThreshold: number
}

export const diagnosePublicExportSurface = (
  out: PublicExportDiagnosticsOutput,
): ReadonlyArray<Diagnostic> => {
  const entries = [...out.byFile.entries()]
    .sort((a, b) =>
      b[1].weightedTotal - a[1].weightedTotal ||
      b[1].total - a[1].total ||
      a[0].localeCompare(b[0]),
    )
    .slice(0, out.diagnosticLimit)
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
}

const runtimeExportCount = (surface: FileSurface): number =>
  Object.entries(surface.byKind).reduce(
    (sum, [kind, count]) => sum + (exportKindWeight(kind) === 1 ? count : 0),
    0,
  )

const typeOnlyExportCount = (surface: FileSurface): number =>
  (surface.byKind.type ?? 0) + (surface.byKind.interface ?? 0)

const formatWeightedSurface = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
