#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const DIST_DIR = join(REPO_ROOT, "dist")
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  readonly version?: string
}
const version = packageJson.version ?? "0.0.0"

const packageBuildOrder = [
  "packages/core",
  "packages/project-module-sdk",
  "packages/shared-signals",
  "packages/ts-pack",
  "packages/rs-pack",
  "packages/project-module-nextjs",
  "packages/cli",
] as const

const binaryTargets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
] as const

const cleanPackage = async (packagePath: string): Promise<void> => {
  await rm(join(REPO_ROOT, packagePath, "dist"), { recursive: true, force: true })
  await rm(join(REPO_ROOT, packagePath, ".turbo"), { recursive: true, force: true })
  await rm(join(REPO_ROOT, packagePath, "tsconfig.tsbuildinfo"), {
    force: true,
  })
}

const run = async (
  label: string,
  command: ReadonlyArray<string>,
  cwd = REPO_ROOT,
): Promise<void> => {
  console.log(`\n${label}`)
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error(`${label} failed with exit code ${exitCode}`)
    process.exit(exitCode)
  }
}

console.log("Cleaning CLI package dependency outputs...")
await rm(DIST_DIR, { recursive: true, force: true })
await mkdir(DIST_DIR, { recursive: true })
for (const packagePath of packageBuildOrder) {
  await cleanPackage(packagePath)
}

console.log("\nBuilding Pulsar CLI package dependency chain...")
for (const packagePath of packageBuildOrder) {
  await run(`Building ${packagePath}`, ["bun", "run", "build"], join(REPO_ROOT, packagePath))
}

console.log(`\nCompiling Pulsar CLI v${version} binaries...`)
for (const { platform, arch } of binaryTargets) {
  const target = `${platform}-${arch}`
  const outfile = join(DIST_DIR, `pulsar-${target}`)
  console.log(`Compiling ${target}...`)
  const buildResult = await Bun.build({
    target: "bun",
    compile: {
      target: `bun-${platform}-${arch}`,
      outfile,
    },
    entrypoints: [join(REPO_ROOT, "packages", "cli", "src", "bin.ts")],
    minify: true,
  })

  if (!buildResult.success) {
    console.error(`Failed to compile ${target}`)
    for (const log of buildResult.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  await run(`Marking executable ${target}`, ["chmod", "+x", outfile])
}

console.log(`
Build complete.

To install locally:
  bun run install:local
`)
