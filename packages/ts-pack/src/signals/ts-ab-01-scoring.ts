import type { FileSurface } from "./ts-ab-01-export-collection.js"

interface PublicExportScoreOutput {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly largestSurface:
    | { readonly file: string; readonly total: number }
    | undefined
  readonly surfaceThreshold: number
}

export const scorePublicExportSurface = (out: PublicExportScoreOutput): number => {
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
}
