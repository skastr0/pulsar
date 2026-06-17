// Standalone headless dev runner: `bun packages/onboard/src/dev-headless.ts`
// Exercises the full data flow (scan -> plan -> writeConfig -> JSON) with no TUI.
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCatalog } from "./catalog.js"
import { demoDetection, demoPacks, demoScan, withDemoFilters } from "./demo.js"
import { makeDemoWriteConfig } from "./demo-write.js"
import { runOnboardHeadless } from "./headless.js"
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

process.exit(await runOnboardHeadless(input))
