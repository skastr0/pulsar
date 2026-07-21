import type {
  CalibrationChoice,
  CalibrationPlan,
  BaselineDecision,
  RepoDetection,
} from "./types.js"

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
