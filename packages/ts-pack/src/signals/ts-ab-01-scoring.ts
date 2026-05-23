import type { FileSurface } from "./ts-ab-01-export-collection.js"

interface PublicExportScoreOutput {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly surfaceThreshold: number
}

export const scorePublicExportSurface = (out: PublicExportScoreOutput): number => {
  if (out.byFile.size === 0) return 1
  // Log-scale penalty on the worst offender. Below the threshold the
  // score stays at 1; doubling the threshold drops roughly 0.15;
  // 10x the threshold drops 0.5. Using the max rather than the mean
  // surfaces a single runaway file instead of letting small tidy
  // barrels mask it.
  const worst = [...out.byFile.values()].reduce(
    (max, surface) => Math.max(max, surface.weightedTotal),
    0,
  )
  if (worst <= 0) return 1
  const ratio = worst / Math.max(1, out.surfaceThreshold)
  if (ratio <= 1) return 1
  return Math.max(0, 1 - Math.log10(ratio) * 0.5)
}
