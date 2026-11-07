#!/usr/bin/env node
// Launcher: runs the platform package's native `pulsar`, which finds its engine at ../engine.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const packages = {
  "darwin-arm64": "@skastr0/pulsar-darwin-arm64",
  "linux-x64": "@skastr0/pulsar-linux-x64",
}
const key = `${process.platform}-${process.arch}`
const name = packages[key]
if (name === undefined) {
  console.error(`pulsar: no binary for ${key} in 0.4.0 (darwin-arm64 and linux-x64 only)`)
  process.exit(2)
}
let dir
try {
  dir = dirname(require.resolve(`${name}/package.json`))
} catch {
  console.error(`pulsar: missing platform package ${name}; reinstall @skastr0/pulsar with optional dependencies enabled`)
  process.exit(2)
}
const bin = join(dir, "bin", "pulsar")
if (!existsSync(bin) || !existsSync(join(dir, "engine", "pulsar-engine"))) {
  console.error(`pulsar: ${name} is incomplete (needs bin/pulsar and engine/pulsar-engine)`)
  process.exit(2)
}
const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" })
if (r.error) {
  console.error(`pulsar: ${r.error.message}`)
  process.exit(2)
}
if (r.signal) process.kill(process.pid, r.signal)
process.exit(r.status ?? 2)
