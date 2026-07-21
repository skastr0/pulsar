// Standalone interactive dev runner: `bun packages/onboard/src/dev.tsx`
// Launches the onboarding TUI against the demo dataset. Run in a real terminal.
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCatalog } from "./catalog.js"
import { demoDetection, demoPacks, demoScan } from "./demo.js"
import { makeDemoWriteConfig } from "./demo-write.js"
import { runOnboardTui } from "./mount.js"
import type { OnboardInput } from "./types.js"

const root = join(tmpdir(), "pulsar-onboard-demo")

const input: OnboardInput = {
  repoPath: root,
  detection: demoDetection,
  detectedPacks: demoPacks,
  catalog: loadCatalog(),
  scan: demoScan,
  preview: async () => {
    const scan = await demoScan()
    return { before: scan, after: scan, receipts: [] }
  },
  writeConfig: makeDemoWriteConfig(root),
  writeOutput: async (contents) => {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(contents, (error) => error ? reject(error) : resolve())
    })
  },
  phase: "beta",
  onExit: () => {},
}

await runOnboardTui(input)
