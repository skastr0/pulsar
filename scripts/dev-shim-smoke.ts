#!/usr/bin/env bun

import { copyFile, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const DEV_SHIM = join("scripts", "pulsar-dev.ts")
const CURRENT_UNTRACKED_FILES = [DEV_SHIM, join("scripts", "dev-shim-smoke.ts")] as const

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

const run = async (
  command: ReadonlyArray<string>,
  cwd: string,
): Promise<CommandResult> => {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

const runChecked = async (
  label: string,
  command: ReadonlyArray<string>,
  cwd: string,
): Promise<CommandResult> => {
  const result = await run(command, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit ${result.exitCode}\n${result.stderr || result.stdout}`)
  }
  return result
}

const copySourceSnapshot = async (destination: string): Promise<void> => {
  const tracked = await runChecked(
    "list tracked source files",
    ["git", "ls-files", "-z"],
    REPO_ROOT,
  )
  const files = new Set([
    ...tracked.stdout.split("\0").filter((path) => path !== ""),
    ...CURRENT_UNTRACKED_FILES,
  ])

  for (const relativePath of files) {
    const source = join(REPO_ROOT, relativePath)
    const target = join(destination, relativePath)
    await mkdir(dirname(target), { recursive: true })
    try {
      const link = await readlink(source)
      await symlink(link, target)
    } catch {
      await copyFile(source, target)
    }
  }
}

const assertVersion = (label: string, result: CommandResult, version: string): void => {
  if (result.stdout.trim() !== version) {
    throw new Error(`${label} reported ${JSON.stringify(result.stdout.trim())}; expected ${version}`)
  }
}

const tempRoot = await mkdtemp(join(tmpdir(), "pulsar-dev-shim-"))
try {
  const repoPath = join(tempRoot, "repo")
  await mkdir(repoPath, { recursive: true })
  await copySourceSnapshot(repoPath)
  const rootManifest = await Bun.file(join(repoPath, "package.json")).json() as {
    readonly version: string
  }

  const cleanVersion = await runChecked(
    "dist-less development version",
    [process.execPath, DEV_SHIM, "--version"],
    repoPath,
  )
  assertVersion("dist-less development version", cleanVersion, rootManifest.version)

  const coreManifest = await Bun.file(join(repoPath, "packages", "core", "package.json")).json() as {
    readonly exports: Readonly<Record<string, { readonly default: string }>>
  }
  const coreRuntimeOutputs = Object.values(coreManifest.exports).map(({ default: target }) =>
    join(repoPath, "packages", "core", target)
  )
  const unresolved = coreRuntimeOutputs.filter((path) => !Bun.file(path).size)
  if (unresolved.length > 0) {
    throw new Error(`development shim missed core runtime exports:\n${unresolved.join("\n")}`)
  }

  const help = await runChecked(
    "dist-less development help",
    [process.execPath, DEV_SHIM, "score", "--help"],
    repoPath,
  )
  if (!help.stdout.includes("pulsar score [<repo-path>]")) {
    throw new Error("development shim did not execute the source CLI help path")
  }

  const staleBuildInfo = join(repoPath, "packages", "core", "tsconfig.tsbuildinfo")
  if (!Bun.file(staleBuildInfo).size) throw new Error("development build emitted no core tsbuildinfo")
  await rm(join(repoPath, "packages", "core", "dist"), { recursive: true, force: true })

  const staleVersion = await runChecked(
    "stale tsbuildinfo recovery",
    [process.execPath, DEV_SHIM, "--version"],
    repoPath,
  )
  assertVersion("stale tsbuildinfo recovery", staleVersion, rootManifest.version)
  if (!Bun.file(join(repoPath, "packages", "core", "dist", "signal-api.js")).size) {
    throw new Error("development shim did not rebuild a missing core export")
  }

  console.log(
    `Development shim smoke passed: ${coreRuntimeOutputs.length}/${coreRuntimeOutputs.length} core exports; dist-less source + stale tsbuildinfo recovery`,
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
