import { buildPlan } from "./calibration.js"
import type { OnboardInput } from "./types.js"
import { normalizeSignalId } from "./util.js"

// Agent / non-TTY path: apply only explicitly supplied answers, preview the
// exact vector through the real observer, persist it, then await JSON output.
export const runOnboardHeadless = async (input: OnboardInput): Promise<number> => {
  const answers = input.headlessAnswers ?? {}

  const plan = buildPlan({
    choices: answers.choices ?? [],
    enabledPacks: answers.enabledPacks ?? [],
    baseline: answers.baseline ?? "not-provided",
    seed: answers.seed ?? {},
    detection: input.detection,
  })
  const preview = await input.preview(plan)
  const result = await input.writeConfig(plan)

  await input.writeOutput(
    JSON.stringify(
      {
        before: {
          band: preview.before.band,
          score: preview.before.score,
          driver: preview.before.driver,
        },
        after: {
          band: preview.after.band,
          score: preview.after.score,
          driver: preview.after.driver,
        },
        activeSignals: preview.before.signals.length,
        topPressures: preview.before.topPressures
          .slice(0, 10)
          .map((p) => ({ id: normalizeSignalId(p.id), score: p.score })),
        choices: plan.choices,
        receipts: result.receipts,
        enabledPacks: plan.enabledPacks,
        baseline: result.baseline,
        written: result.written,
      },
      null,
      2,
    ) + "\n",
  )
  return 0
}
