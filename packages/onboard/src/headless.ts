import { buildPlan } from "./calibration.js"
import { catalogById } from "./catalog.js"
import type { CalibrationChoice, OnboardInput } from "./types.js"
import { normalizeSignalId } from "./util.js"

// Agent / non-TTY path: run the scan, apply default calibration for the
// top-pressure signals (the engine's own ranking), write .pulsar, emit JSON.
export const runOnboardHeadless = async (input: OnboardInput): Promise<number> => {
  const byId = catalogById(input.catalog)
  const scan = await input.scan()

  // Default-calibrate EVERY active signal — a complete vector, not a top-N.
  const choices: CalibrationChoice[] = []
  const seen = new Set<string>()
  for (const s of scan.signals) {
    const norm = normalizeSignalId(s.id)
    if (seen.has(norm)) continue
    seen.add(norm)
    choices.push({ signalId: norm, optionIndex: byId.get(norm)?.defaultOptionIndex ?? 0 })
  }

  const plan = buildPlan({
    choices,
    enabledPacks: input.detectedPacks.map((p) => p.id),
    baseline: true,
    seed: {},
    detection: input.detection,
  })
  const written = await input.writeConfig(plan)

  process.stdout.write(
    JSON.stringify(
      {
        band: scan.band,
        score: scan.score,
        driver: scan.driver,
        activeSignals: scan.signals.length,
        topPressures: scan.topPressures.slice(0, 10).map((p) => ({ id: normalizeSignalId(p.id), score: p.score })),
        calibratedSignals: choices.map((c) => c.signalId),
        enabledPacks: plan.enabledPacks,
        baseline: plan.baseline,
        written,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
