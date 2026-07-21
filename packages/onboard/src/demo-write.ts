import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type {
  CalibrationPlan,
  CalibrationReceipt,
  CalibrationWriteResult,
} from "./types.js"

// A real writeConfig that emits a plausible .pulsar/ under `root`. Used by the
// standalone dev runners. The CLI provides its own writer backed by the real
// vector / conventions / project-modules schemas.
export const makeDemoWriteConfig =
  (root: string) =>
  async (plan: CalibrationPlan): Promise<CalibrationWriteResult> => {
    if (plan.baseline === "accept") {
      throw new Error("The standalone demo cannot create a production baseline; run `pulsar onboard` instead")
    }
    const dir = join(root, ".pulsar")
    mkdirSync(dir, { recursive: true })
    const files: string[] = []

    const overrides: Record<string, { active?: boolean; weight?: number; config?: Record<string, unknown> }> = {}
    const receipts: CalibrationReceipt[] = []
    for (const choice of plan.choices) {
      switch (choice.action.kind) {
        case "keep-default":
          receipts.push({ ...choice, status: "kept", detail: "Repository default kept; no override written" })
          break
        case "unsupported":
          receipts.push({ ...choice, status: "unapplied", detail: choice.action.reason })
          break
        case "vector-config":
          overrides[choice.signalId] = { config: { [choice.action.key]: choice.action.value } }
          receipts.push({ ...choice, status: "applied", detail: `Set config.${choice.action.key}` })
          break
        case "vector-weight":
          overrides[choice.signalId] = { weight: choice.action.value }
          receipts.push({ ...choice, status: "applied", detail: `Set weight to ${choice.action.value}` })
          break
        case "vector-active":
          overrides[choice.signalId] = { active: choice.action.value }
          receipts.push({ ...choice, status: "applied", detail: `Set active to ${choice.action.value}` })
          break
        case "enable-pack":
          receipts.push({ ...choice, status: "applied", detail: `Enabled ${choice.action.packId}` })
          break
        case "baseline-accept":
          throw new Error("The standalone demo cannot create a production baseline")
      }
    }

    const vector = {
      id: "repo",
      domain: plan.seed.shape ?? "app",
      signal_overrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))),
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

    return { written: files, receipts, baseline: plan.baseline }
  }
