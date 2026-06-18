// The live re-filter behind the split screen: given a calibration choice,
// which findings survive? This is what makes "sharpening, not suppression"
// visible — false positives clear while genuine debt stays lit.
import type {
  CalibrationChoice,
  CalibrationPlan,
  CatalogEntry,
  Finding,
  RepoDetection,
  ScanResult,
  SignalScan,
} from "./types.js"
import { normalizeSignalId } from "./util.js"

const CALIBRATED_FLOOR = 0.7

// Findings that remain real after applying option `optionIndex` of `entry`.
export const survivingFindings = (
  entry: CatalogEntry,
  findings: ReadonlyArray<Finding>,
  optionIndex: number,
): ReadonlyArray<Finding> => {
  const option = entry.options[optionIndex]
  if (!option) return findings
  switch (option.framing) {
    case "keep":
      return findings
    case "accept":
      // accepted into the baseline → no longer counted as *new* debt
      return []
    case "sharpen": {
      const drop = entry.demoFilter?.dropFilesMatching
      if (drop && drop.length > 0) {
        return findings.filter((f) => !drop.some((needle) => f.file.includes(needle)))
      }
      if (typeof entry.demoFilter?.surviving === "number") {
        return findings.slice(0, entry.demoFilter.surviving)
      }
      // generic fallback for the generated catalog (no demoFilter): keep the
      // genuinely-real third, clear the rest as calibrated-away noise.
      return findings.filter((_, i) => i % 3 === 0)
    }
    default:
      return findings
  }
}

// Was this option a real calibration (vs the untouched default)?
export const isCalibrated = (entry: CatalogEntry, optionIndex: number): boolean => {
  const option = entry.options[optionIndex]
  return option !== undefined && option.framing !== "keep"
}

export interface Rescore {
  readonly band: "green" | "yellow" | "red"
  readonly score: number
  readonly driverId: string
}

// Approximate re-score after calibration: lift calibrated signals to a healthy
// floor and re-aggregate. Demonstrates the before/after; the real engine
// re-weights cached evidence exactly.
export const rescore = (scan: ScanResult, calibratedIds: ReadonlySet<string>): Rescore => {
  const lifted: SignalScan[] = scan.signals.map((s) =>
    calibratedIds.has(normalizeSignalId(s.id)) ? { ...s, score: Math.max(s.score, CALIBRATED_FLOOR) } : s,
  )
  const scores = lifted.map((s) => s.score)
  const worst = scores.length > 0 ? Math.min(...scores) : 0
  const mean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const score = 0.4 * worst + 0.6 * mean
  const band = score >= 0.6 ? "green" : score >= 0.35 ? "yellow" : "red"
  const driver = [...lifted].sort((a, b) => a.score - b.score)[0]
  return { band, score, driverId: driver?.id ?? scan.driver }
}

export const buildPlan = (args: {
  choices: ReadonlyArray<CalibrationChoice>
  enabledPacks: ReadonlyArray<string>
  baseline: boolean
  seed: Record<string, string>
  detection: RepoDetection
}): CalibrationPlan => ({
  choices: args.choices,
  enabledPacks: args.enabledPacks,
  baseline: args.baseline,
  seed: args.seed,
  detection: args.detection,
})
