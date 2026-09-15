#!/usr/bin/env bun

import { join } from "node:path"
import { runResourceBench } from "../../resource-bench.ts"

const outDir = process.argv[2]
const mode = process.argv[3]
if (outDir === undefined || mode === undefined) {
  console.error("Usage: bun scripts/fixtures/resource-bench/host.ts <out-dir> <mode>")
  process.exit(2)
}

const result = await runResourceBench({
  repo: join(outDir, "unused-repo"),
  outDir,
  preload: undefined,
  maxRssMiB: 4096,
  maxFootprintMiB: undefined,
  timeoutSeconds: 20,
  sampleIntervalMs: 50,
  command: [process.execPath, join(import.meta.dir, "child.ts"), mode],
  termGraceMs: 200,
  killWaitMs: 400,
})
process.stdout.write(`${JSON.stringify(result.metrics)}\n`)
process.exit(result.exitCode)
