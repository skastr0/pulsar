#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { mkdir, readFile, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const DIST_DIR = join(REPO_ROOT, "dist")
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  readonly version?: string
}
const version = packageJson.version ?? "0.0.0"

const packageBuildOrder = [
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

const binaryTargets = [
  { platform: "darwin", arch: "x64", nativeLibrary: "libopentui.dylib" },
  { platform: "darwin", arch: "arm64", nativeLibrary: "libopentui.dylib" },
  { platform: "linux", arch: "x64", nativeLibrary: "libopentui.so" },
  { platform: "linux", arch: "arm64", nativeLibrary: "libopentui.so" },
] as const

type BinaryTarget = (typeof binaryTargets)[number]

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

const resolveOpenTuiNativeLibrary = async ({
  platform,
  arch,
  nativeLibrary,
}: BinaryTarget): Promise<string> => {
  // Bun installs optional dependencies for the requested target rather than
  // the build host. OpenTUI's Bun export then imports this library as type:file,
  // which makes it eligible for standalone executable embedding.
  await run(`Installing ${platform}-${arch} optional dependencies`, [
    "bun",
    "install",
    "--frozen-lockfile",
    `--cpu=${arch}`,
    `--os=${platform}`,
  ])

  const onboardSourceDir = join(REPO_ROOT, "packages", "onboard", "src")
  const coreEntry = Bun.resolveSync("@opentui/core", onboardSourceDir)
  const nativePackage = `@opentui/core-${platform}-${arch}`
  const nativeEntry = Bun.resolveSync(nativePackage, dirname(coreEntry))
  const nativePath = join(dirname(nativeEntry), nativeLibrary)
  const nativeStats = await stat(nativePath)
  if (!nativeStats.isFile() || nativeStats.size === 0) {
    throw new Error(`${nativePackage} is missing ${nativeLibrary}`)
  }
  return nativePath
}

const assertNativeLibraryEmbedded = async (
  outfile: string,
  nativePath: string,
  target: string,
): Promise<void> => {
  const [executable, nativeLibrary] = await Promise.all([
    readFile(outfile),
    readFile(nativePath),
  ])
  if (executable.indexOf(nativeLibrary) === -1) {
    throw new Error(
      `${target} executable does not contain the target OpenTUI native library`,
    )
  }
  console.log(`Verified embedded OpenTUI native library for ${target}`)
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
for (const targetConfig of binaryTargets) {
  const { platform, arch } = targetConfig
  const target = `${platform}-${arch}`
  const outfile = join(DIST_DIR, `pulsar-${target}`)
  const nativePath = await resolveOpenTuiNativeLibrary(targetConfig)
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
  await assertNativeLibraryEmbedded(outfile, nativePath, target)
}

await run("Smoke-testing source/native onboarding parity and native TUI", [
  "bun",
  "scripts/onboard-smoke.ts",
  "--tui",
])

console.log(`
Build complete.

To install locally:
  bun run install:local
`)
