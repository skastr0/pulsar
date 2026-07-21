#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { mkdir, readFile, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const DIST_DIR = join(REPO_ROOT, "dist")
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

const versionedPackageDirs = [
  ...packageBuildOrder,
  "packages/signal-test-support",
  "packages/npm/pulsar",
  "packages/npm/pulsar-darwin-arm64",
  "packages/npm/pulsar-darwin-x64",
  "packages/npm/pulsar-linux-arm64",
  "packages/npm/pulsar-linux-x64",
] as const

interface VersionedManifest {
  readonly name: string
  readonly version: string
}

const readManifest = (packageDir: string): VersionedManifest => {
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, packageDir, "package.json"), "utf8"),
  ) as Partial<VersionedManifest>
  if (manifest.name === undefined || manifest.version === undefined) {
    throw new Error(`${packageDir}/package.json must declare name and version`)
  }
  return { name: manifest.name, version: manifest.version }
}

const rootManifest = readManifest(".")
const version = rootManifest.version
const versionMismatches = versionedPackageDirs
  .map((packageDir) => ({ packageDir, manifest: readManifest(packageDir) }))
  .filter(({ manifest }) => manifest.version !== version)
if (versionMismatches.length > 0) {
  throw new Error(
    `Release version ${version} does not match:\n${versionMismatches
      .map(({ packageDir, manifest }) => `- ${manifest.name}@${manifest.version} (${packageDir})`)
      .join("\n")}`,
  )
}

const git = (args: ReadonlyArray<string>): string => {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

const buildCommit = git(["rev-parse", "HEAD"])
if (!/^[0-9a-f]{40}$/.test(buildCommit)) {
  throw new Error(`Build commit is not a full Git SHA: ${buildCommit}`)
}
const buildDirty = git(["status", "--porcelain"]) !== ""

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

const assertBuildIdentityEmbedded = async (
  outfile: string,
  target: string,
): Promise<void> => {
  const executable = await readFile(outfile)
  for (const [label, value] of [
    ["version", version],
    ["commit", buildCommit],
    ["target", target],
  ] as const) {
    if (executable.indexOf(Buffer.from(value)) === -1) {
      throw new Error(`${target} executable does not embed build ${label} ${value}`)
    }
  }
  console.log(`Verified embedded build identity for ${target}`)
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

console.log(
  `\nCompiling Pulsar CLI v${version} binaries from ${buildCommit}${buildDirty ? " (dirty)" : ""}...`,
)
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
    define: {
      __PULSAR_BUILD_COMMIT__: JSON.stringify(buildCommit),
      __PULSAR_BUILD_DIRTY__: JSON.stringify(buildDirty),
      __PULSAR_BUILD_TARGET__: JSON.stringify(target),
      __PULSAR_ARTIFACT_KIND__: JSON.stringify("native"),
    },
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
  await assertBuildIdentityEmbedded(outfile, target)
}

await run("Smoke-testing source/native onboarding parity and native TUI", [
  "bun",
  "scripts/onboard-smoke.ts",
  "--tui",
])

await run("Smoke-testing dist-less development execution", [
  "bun",
  "scripts/dev-shim-smoke.ts",
])

await run("Smoke-testing source/native release semantics and provenance", [
  "bun",
  "scripts/release-smoke.ts",
])

console.log(`
Build complete.

To install locally:
  bun run install:local
`)
