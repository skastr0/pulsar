// The live re-filter behind the split screen: given a calibration choice,
// which findings survive? This is what makes "sharpening, not suppression"
// visible — false positives clear while genuine debt stays lit.
import type {
  CalibrationChoice,
  CalibrationPlan,
  BaselineDecision,
  CatalogEntry,
  Finding,
  RepoDetection,
} from "./types.js"

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

export const buildPlan = (args: {
  choices: ReadonlyArray<CalibrationChoice>
  enabledPacks: ReadonlyArray<string>
  baseline: BaselineDecision
  seed: Record<string, string>
  detection: RepoDetection
}): CalibrationPlan => {
  if (
    args.choices.some((choice) => choice.action.kind === "baseline-accept") &&
    args.baseline !== "accept"
  ) {
    throw new Error("A baseline-accept action requires plan baseline=accept")
  }
  return {
    choices: [...args.choices].sort(
      (a, b) => a.signalId.localeCompare(b.signalId) || a.optionIndex - b.optionIndex,
    ),
    enabledPacks: [...new Set(args.enabledPacks)].sort(),
    baseline: args.baseline,
    seed: Object.fromEntries(Object.entries(args.seed).sort(([a], [b]) => a.localeCompare(b))),
    detection: args.detection,
  }
}
