import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CalibrationPlan } from "./types.js"

// A real writeConfig that emits a plausible .pulsar/ under `root`. Used by the
// standalone dev runners. The CLI provides its own writer backed by the real
// vector / conventions / project-modules schemas.
export const makeDemoWriteConfig =
  (root: string) =>
  async (plan: CalibrationPlan): Promise<string[]> => {
    const dir = join(root, ".pulsar")
    mkdirSync(dir, { recursive: true })
    const files: string[] = []

    const vector = {
      id: "repo",
      domain: plan.seed.shape ?? "app",
      signal_overrides: Object.fromEntries(plan.choices.map((c) => [c.signalId, {}])),
    }
    const vectorPath = join(dir, "vector.json")
    writeFileSync(vectorPath, JSON.stringify(vector, null, 2))
    files.push(vectorPath)

    if (plan.enabledPacks.length > 0) {
      const modulesPath = join(dir, "project-modules.json")
      writeFileSync(
        modulesPath,
        JSON.stringify(
          {
            schema: "pulsar/project-modules/v1",
            modules: plan.enabledPacks.map((id) => ({ id, kind: "builtin", enabled: true })),
          },
          null,
          2,
        ),
      )
      files.push(modulesPath)
    }

    if (plan.baseline) {
      const baselinePath = join(root, "pulsar-baseline.json")
      writeFileSync(baselinePath, JSON.stringify({ schema_version: 1, baseline: true }, null, 2))
      files.push(baselinePath)
    }

    return files
  }
