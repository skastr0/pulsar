#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const TYPESCRIPT_ENTRY = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc")
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "src", "bin.ts")

const runtimePackageDirs = [
  "packages/core",
  "packages/project-module-sdk",
  "packages/project-module-effect",
  "packages/project-module-convex",
  "packages/shared-signals",
  "packages/ts-pack",
  "packages/rs-pack",
  "packages/project-module-nextjs",
  "packages/onboard",
  "packages/cli",
] as const

interface PackageManifest {
  readonly main?: string
  readonly exports?: unknown
}

const collectRuntimeExportTargets = (value: unknown, targets: Set<string>): void => {
  if (typeof value === "string") {
    if (value.startsWith("./dist/") && !value.endsWith(".d.ts") && !value.endsWith(".map")) {
      targets.add(value)
    }
    return
  }
  if (typeof value !== "object" || value === null) return
  for (const nested of Object.values(value)) collectRuntimeExportTargets(nested, targets)
}

const expectedRuntimeOutputs = (): ReadonlyArray<string> =>
  runtimePackageDirs.flatMap((packageDir) => {
    const manifestPath = join(REPO_ROOT, packageDir, "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest
    const targets = new Set<string>()
    if (manifest.main?.startsWith("./dist/") === true) targets.add(manifest.main)
    collectRuntimeExportTargets(manifest.exports, targets)
    return [...targets].map((target) => join(REPO_ROOT, packageDir, target))
  })

const runPreparation = async (
  label: string,
  command: ReadonlyArray<string>,
): Promise<void> => {
  console.error(`pulsar-dev: ${label}`)
  const proc = Bun.spawn(command, {
    cwd: REPO_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (stdout !== "") process.stderr.write(stdout)
  if (stderr !== "") process.stderr.write(stderr)
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`)
  }
}

const prepareWorkspace = async (): Promise<void> => {
  if (!existsSync(TYPESCRIPT_ENTRY)) {
    await runPreparation("installing locked workspace dependencies", [
      process.execPath,
      "install",
      "--frozen-lockfile",
    ])
  }

  const expected = expectedRuntimeOutputs()
  const missingBeforeBuild = expected.filter((path) => !existsSync(path))
  await runPreparation(
    missingBeforeBuild.length === 0
      ? "checking incremental project outputs"
      : `rebuilding ${missingBeforeBuild.length} missing runtime output(s)`,
    [
      process.execPath,
      TYPESCRIPT_ENTRY,
      "-b",
      ...(missingBeforeBuild.length === 0 ? [] : ["--force"]),
    ],
  )

  const missingAfterBuild = expected.filter((path) => !existsSync(path))
  if (missingAfterBuild.length > 0) {
    throw new Error(
      `TypeScript build completed without required runtime output(s):\n${missingAfterBuild
        .map((path) => `- ${path}`)
        .join("\n")}`,
    )
  }
}

const runCli = async (): Promise<number> => {
  await prepareWorkspace()
  const proc = Bun.spawn([process.execPath, CLI_ENTRY, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (proc.signalCode !== null) {
    process.kill(process.pid, proc.signalCode)
  }
  return exitCode
}

try {
  process.exitCode = await runCli()
} catch (cause) {
  console.error(`pulsar-dev: ${cause instanceof Error ? cause.message : String(cause)}`)
  process.exitCode = 1
}
