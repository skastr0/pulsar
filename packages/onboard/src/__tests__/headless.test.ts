import { expect, test } from "bun:test"
import { runOnboardHeadless } from "../headless.js"
import type { OnboardInput, ScanResult } from "../types.js"

const scan: ScanResult = {
  band: "yellow",
  score: 0.42,
  driver: "TS-LD-01",
  topPressures: [{ id: "TS-LD-01-cyclomatic-complexity", score: 0.2, category: "legibility-decay" }],
  signals: [{ id: "TS-LD-01-cyclomatic-complexity", score: 0.2, findingCount: 0, findings: [] }],
}

test("headless onboarding applies no catalog defaults and awaits structured output", async () => {
  let output = ""
  let outputFinished = false
  let writeCalled = false
  let scanCalls = 0
  let previewCalled = false
  const input: OnboardInput = {
    repoPath: "/repo",
    detection: {
      languages: ["TypeScript"],
      frameworks: ["Next.js"],
      fileCount: 1,
      contributors: 1,
      visibility: "private",
      repoPath: "/repo",
    },
    detectedPacks: [{ id: "nextjs", label: "Next", reason: "detected" }],
    catalog: [],
    scan: async () => {
      scanCalls += 1
      return scan
    },
    preview: async (plan) => {
      previewCalled = true
      return { before: scan, after: scan, receipts: [] }
    },
    writeConfig: async (plan) => {
      writeCalled = true
      return { written: ["/repo/.pulsar/vector.json"], receipts: [], baseline: plan.baseline }
    },
    writeOutput: async (contents) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      output = contents
      outputFinished = true
    },
    phase: "beta",
    onExit: () => {},
  }

  expect(await runOnboardHeadless(input)).toBe(0)
  expect(outputFinished).toBe(true)
  expect(writeCalled).toBe(false)
  expect(previewCalled).toBe(false)
  expect(scanCalls).toBe(1)
  expect(JSON.parse(output)).toMatchObject({
    mode: "preview-only",
    choices: [],
    enabledPacks: [],
    baseline: "not-provided",
    before: { score: 0.42 },
    after: { score: 0.42 },
    written: [],
  })
})
