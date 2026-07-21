import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { OnboardApp } from "../app.js"
import type { OnboardInput, ScanResult } from "../types.js"

const scan: ScanResult = {
  band: "yellow",
  score: 0.42,
  driver: "TS-LD-01",
  topPressures: [{ id: "TS-LD-01", score: 0.2, category: "legibility-decay" }],
  signals: [{ id: "TS-LD-01", score: 0.2, findingCount: 0, findings: [] }],
}

test("typed calibration renders the exact catalog target as non-executable guidance", async () => {
  const input: OnboardInput = {
    repoPath: "/repo",
    detection: {
      languages: ["TypeScript"],
      frameworks: [],
      fileCount: 1,
      contributors: 1,
      visibility: "private",
      repoPath: "/repo",
    },
    detectedPacks: [],
    catalog: [
      {
        id: "TS-LD-01",
        title: "Cyclomatic complexity",
        pack: "typescript",
        category: "legibility-decay",
        measures: "Complexity",
        whyItMatters: "Review cost",
        evidence: "file-local",
        evidenceHint: "Functions",
        question: "What is true here?",
        options: [
          {
            label: "Set the repository threshold",
            summary: "Use a typed config action",
            calibrationKind: "vector-config",
            calibrationTarget: "signal_overrides.TS-LD-01.config.max_complexity",
            framing: "sharpen",
          },
        ],
        defaultOptionIndex: 0,
      },
    ],
    scan: async () => scan,
    preview: async () => ({ before: scan, after: scan, receipts: [] }),
    writeConfig: async (plan) => ({ written: [], receipts: [], baseline: plan.baseline }),
    writeOutput: async () => {},
    phase: "beta",
    onExit: () => {},
    __debugBeat: "calibration-value",
    __debugScan: scan,
  }

  const rendered = await testRender(<OnboardApp input={input} />, { width: 120, height: 30 })
  try {
    await act(async () => rendered.flush())
    expect(rendered.captureCharFrame()).toContain(
      "Catalog target (display only): signal_overrides.TS-LD-01.config.max_complexity",
    )
  } finally {
    act(() => rendered.renderer.destroy())
  }
})
