// Standalone interactive dev runner: `bun packages/onboard/src/dev.tsx`
// Launches the onboarding TUI against the demo dataset. Run in a real terminal.
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCatalog } from "./catalog.js"
import { demoDetection, demoPacks, demoScan, withDemoFilters } from "./demo.js"
import { makeDemoWriteConfig } from "./demo-write.js"
import { runOnboardTui } from "./mount.js"
import type { OnboardInput } from "./types.js"

const root = join(tmpdir(), "pulsar-onboard-demo")

const input: OnboardInput = {
  repoPath: root,
  detection: demoDetection,
  detectedPacks: demoPacks,
  catalog: withDemoFilters(loadCatalog()),
  scan: demoScan,
  writeConfig: makeDemoWriteConfig(root),
  phase: "beta",
  onExit: () => {},
}

await runOnboardTui(input)
process.exit(0)
