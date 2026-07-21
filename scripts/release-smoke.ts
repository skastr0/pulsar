#!/usr/bin/env bun

import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const SOURCE_ENTRY = join(REPO_ROOT, "packages", "cli", "src", "bin.ts")
const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "onboard-parity")
const EXPORT_CONTRACT_PATH = join(
  import.meta.dir,
  "fixtures",
  "published-default-exports.json",
)
const HOST_TARGET = `${process.platform}-${process.arch}`
const HOST_BINARY = join(REPO_ROOT, "dist", `pulsar-${HOST_TARGET}`)
const RUN_NPM = process.argv.includes("--npm")

const publishedLibraryDirs = [
  "packages/core",
  "packages/project-module-sdk",
  "packages/shared-signals",
  "packages/ts-pack",
  "packages/rs-pack",
  "packages/project-module-effect",
  "packages/project-module-convex",
  "packages/project-module-nextjs",
] as const

const npmPackageDirs = [
  "packages/npm/pulsar-darwin-arm64",
  "packages/npm/pulsar-darwin-x64",
  "packages/npm/pulsar-linux-arm64",
  "packages/npm/pulsar-linux-x64",
  "packages/npm/pulsar",
] as const

const hostPackageName = `@skastr0/pulsar-${HOST_TARGET}`

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface BuildInfo {
  readonly schema_version: "pulsar/build-info/v1"
  readonly version: string
  readonly commit: string
  readonly dirty: boolean | null
  readonly artifact: "source" | "native"
  readonly distribution: "source" | "native" | "npm"
  readonly target: string
}

interface ScoreJson {
  readonly observer_semantics?: unknown
  readonly categories?: unknown
  readonly signal_metadata?: unknown
  readonly signal_diagnostics?: unknown
  readonly hard_gate_status?: unknown
  readonly hard_gate_violations?: unknown
  readonly [key: string]: unknown
}

interface SemanticContract {
  readonly schema: {
    readonly observer_semantics: unknown
    readonly fields: ReadonlyArray<string>
  }
  readonly registry: ReadonlyArray<string>
  readonly findings: unknown
  readonly enforcement: {
    readonly status: unknown
    readonly violations: unknown
  }
}

const run = async (
  command: ReadonlyArray<string>,
  options: {
    readonly cwd: string
    readonly env?: Record<string, string | undefined>
  },
): Promise<CommandResult> => {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
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
  options: {
    readonly cwd: string
    readonly env?: Record<string, string | undefined>
  },
): Promise<CommandResult> => {
  const result = await run(command, options)
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit ${result.exitCode}\n${result.stderr || result.stdout}`)
  }
  return result
}

const git = async (args: ReadonlyArray<string>): Promise<string> =>
  (await runChecked(`git ${args.join(" ")}`, ["git", ...args], { cwd: REPO_ROOT })).stdout.trim()

const readJson = async <A>(path: string): Promise<A> =>
  JSON.parse(await Bun.file(path).text()) as A

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  )
}

const stableJson = (value: unknown): string => JSON.stringify(stable(value))

const assertEqual = (
  label: string,
  expectedLabel: string,
  expected: unknown,
  actual: unknown,
): void => {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `${label} diverged from ${expectedLabel}\nexpected: ${stableJson(expected)}\nactual:   ${stableJson(actual)}`,
    )
  }
}

const defaultExportMap = (exports: unknown): Readonly<Record<string, string>> => {
  if (typeof exports !== "object" || exports === null) return {}
  return Object.fromEntries(
    Object.entries(exports).flatMap(([subpath, conditions]) => {
      if (typeof conditions !== "object" || conditions === null) return []
      const target = (conditions as { readonly default?: unknown }).default
      return typeof target === "string" ? [[subpath, target] as const] : []
    }),
  )
}

const assertPublishedExports = async (): Promise<void> => {
  const contract = await readJson<{
    readonly schema_version: string
    readonly packages: Readonly<Record<string, Readonly<Record<string, string>>>>
  }>(EXPORT_CONTRACT_PATH)
  if (contract.schema_version !== "pulsar/published-default-exports/v1") {
    throw new Error(`Unsupported export contract ${contract.schema_version}`)
  }

  const actual: Record<string, Readonly<Record<string, string>>> = {}
  for (const packageDir of publishedLibraryDirs) {
    const manifest = await readJson<{
      readonly name: string
      readonly exports: unknown
    }>(join(REPO_ROOT, packageDir, "package.json"))
    const defaults = defaultExportMap(manifest.exports)
    actual[manifest.name] = defaults
    for (const target of Object.values(defaults)) {
      const artifact = join(REPO_ROOT, packageDir, target)
      if (!Bun.file(artifact).size) {
        throw new Error(`${manifest.name} export ${target} is missing from built output`)
      }
    }
  }
  assertEqual("published default exports", "checked-in contract", contract.packages, actual)
}

const initializeFixture = async (root: string): Promise<string> => {
  const repoPath = join(root, "fixture")
  await cp(FIXTURE_ROOT, repoPath, { recursive: true })
  const gitEnv = {
    GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
  }
  for (const [label, command] of [
    ["fixture git init", ["git", "init", "-q", "-b", "main"]],
    ["fixture git email", ["git", "config", "user.email", "pulsar@example.test"]],
    ["fixture git name", ["git", "config", "user.name", "Pulsar Fixture"]],
    ["fixture git add", ["git", "add", "."]],
    ["fixture git commit", ["git", "commit", "-qm", "fixture"]],
  ] as const) {
    await runChecked(label, command, { cwd: repoPath, env: gitEnv })
  }
  return repoPath
}

const parseJson = <A>(label: string, result: CommandResult): A => {
  if (result.stderr !== "") {
    throw new Error(`${label} wrote to stderr\n${result.stderr}`)
  }
  try {
    return JSON.parse(result.stdout) as A
  } catch (cause) {
    throw new Error(`${label} emitted invalid JSON: ${String(cause)}\n${result.stdout}`)
  }
}

const registryIds = (score: ScoreJson): ReadonlyArray<string> => {
  const metadataIds =
    typeof score.signal_metadata === "object" && score.signal_metadata !== null
      ? Object.keys(score.signal_metadata)
      : []
  const categoryIds =
    typeof score.categories === "object" && score.categories !== null
      ? Object.values(score.categories).flatMap((category) => {
          if (typeof category !== "object" || category === null) return []
          const signals = (category as { readonly signals?: unknown }).signals
          return typeof signals === "object" && signals !== null ? Object.keys(signals) : []
        })
      : []
  return [...new Set([...metadataIds, ...categoryIds])].sort()
}

const semanticContract = (label: string, score: ScoreJson): SemanticContract => {
  const registry = registryIds(score)
  if (score.observer_semantics !== "applicability-aware-readiness-v2") {
    throw new Error(`${label} emitted unsupported observer semantics ${String(score.observer_semantics)}`)
  }
  if (registry.length < 10) {
    throw new Error(`${label} exposed only ${registry.length} registered signals`)
  }
  if (typeof score.signal_diagnostics !== "object" || score.signal_diagnostics === null) {
    throw new Error(`${label} omitted signal diagnostics`)
  }
  if (score.hard_gate_status !== "pass" && score.hard_gate_status !== "fail") {
    throw new Error(`${label} omitted hard-gate enforcement status`)
  }
  if (!Array.isArray(score.hard_gate_violations)) {
    throw new Error(`${label} omitted hard-gate violations`)
  }
  return {
    schema: {
      observer_semantics: score.observer_semantics,
      fields: Object.keys(score).sort(),
    },
    registry,
    findings: score.signal_diagnostics,
    enforcement: {
      status: score.hard_gate_status,
      violations: score.hard_gate_violations,
    },
  }
}

const packNpmArtifacts = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const packDir = join(root, "packs")
  await mkdir(packDir, { recursive: true })
  const tarballs: Record<string, string> = {}
  for (const packageDir of npmPackageDirs) {
    const manifest = await readJson<{ readonly name: string }>(
      join(REPO_ROOT, packageDir, "package.json"),
    )
    const result = await runChecked(
      `pack ${manifest.name}`,
      [
        "npm",
        "pack",
        "--json",
        "--pack-destination",
        packDir,
        `./${packageDir}`,
      ],
      { cwd: REPO_ROOT },
    )
    const packed = JSON.parse(result.stdout) as ReadonlyArray<{ readonly filename?: string }>
    const filename = packed[0]?.filename
    if (filename === undefined) throw new Error(`npm pack returned no filename for ${manifest.name}`)
    tarballs[manifest.name] = join(packDir, filename)
  }
  return tarballs
}

const installNpmArtifact = async (root: string): Promise<string> => {
  const tarballs = await packNpmArtifacts(root)
  const metaTarball = tarballs["@skastr0/pulsar"]
  const hostTarball = tarballs[hostPackageName]
  if (metaTarball === undefined || hostTarball === undefined) {
    throw new Error(`Missing packed npm artifact for @skastr0/pulsar or ${hostPackageName}`)
  }

  const installRoot = join(root, "clean-install")
  await mkdir(installRoot, { recursive: true })
  await Bun.write(
    join(installRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "pulsar-release-smoke",
        private: true,
        version: "0.0.0",
        dependencies: {
          "@skastr0/pulsar": `file:${metaTarball}`,
          [hostPackageName]: `file:${hostTarball}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  await runChecked(
    "clean npm artifact install",
    ["npm", "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: installRoot },
  )
  const launcher = join(
    installRoot,
    "node_modules",
    "@skastr0",
    "pulsar",
    "bin",
    "pulsar.js",
  )
  if (!Bun.file(launcher).size) throw new Error("Clean npm install omitted the Pulsar launcher")
  return launcher
}

if (!Bun.file(HOST_BINARY).size) {
  throw new Error(`Host binary is missing: ${HOST_BINARY}`)
}
if (!(["darwin", "linux"] as ReadonlyArray<string>).includes(process.platform)) {
  throw new Error(`Unsupported release-smoke platform ${HOST_TARGET}`)
}
if (!(["arm64", "x64"] as ReadonlyArray<string>).includes(process.arch)) {
  throw new Error(`Unsupported release-smoke architecture ${HOST_TARGET}`)
}

const tempRoot = await mkdtemp(join(tmpdir(), "pulsar-release-smoke-"))
try {
  await assertPublishedExports()
  const rootManifest = await readJson<{ readonly version: string }>(
    join(REPO_ROOT, "package.json"),
  )
  const commit = await git(["rev-parse", "HEAD"])
  const dirty = (await git(["status", "--porcelain"])) !== ""
  const fixturePath = await initializeFixture(tempRoot)
  const npmLauncher = RUN_NPM ? await installNpmArtifact(tempRoot) : undefined

  const baseEnv = { CI: "1", NO_COLOR: "1" }
  const variants: ReadonlyArray<{
    readonly label: string
    readonly command: ReadonlyArray<string>
    readonly buildInfoEnv?: Record<string, string>
  }> = [
    {
      label: "source",
      command: [process.execPath, SOURCE_ENTRY],
      buildInfoEnv: {
        PULSAR_SOURCE_COMMIT: commit,
        PULSAR_SOURCE_DIRTY: String(dirty),
      },
    },
    { label: "native", command: [HOST_BINARY] },
    ...(npmLauncher === undefined
      ? []
      : [{ label: "npm", command: ["node", npmLauncher] }]),
  ]

  let reference: { readonly label: string; readonly semantics: SemanticContract } | undefined
  for (const variant of variants) {
    const buildInfoResult = await runChecked(
      `${variant.label} build info`,
      [...variant.command, "--build-info"],
      {
        cwd: fixturePath,
        env: { ...baseEnv, ...(variant.buildInfoEnv ?? {}) },
      },
    )
    const buildInfo = parseJson<BuildInfo>(`${variant.label} build info`, buildInfoResult)
    const expectedDistribution = variant.label
    if (
      buildInfo.schema_version !== "pulsar/build-info/v1" ||
      buildInfo.version !== rootManifest.version ||
      buildInfo.commit !== commit ||
      buildInfo.dirty !== dirty ||
      buildInfo.target !== HOST_TARGET ||
      buildInfo.distribution !== expectedDistribution ||
      buildInfo.artifact !== (variant.label === "source" ? "source" : "native")
    ) {
      throw new Error(`${variant.label} build identity mismatch: ${JSON.stringify(buildInfo)}`)
    }

    const scoreResult = await runChecked(
      `${variant.label} semantic score`,
      [...variant.command, "score", "--json", "--no-progress", fixturePath],
      {
        cwd: fixturePath,
        env: {
          ...baseEnv,
          ...(variant.buildInfoEnv ?? {}),
          PULSAR_STATE_HOME: join(tempRoot, `state-${variant.label}`),
        },
      },
    )
    const semantics = semanticContract(
      variant.label,
      parseJson<ScoreJson>(`${variant.label} semantic score`, scoreResult),
    )
    if (reference === undefined) reference = { label: variant.label, semantics }
    else assertEqual(`${variant.label} semantics`, reference.label, reference.semantics, semantics)
  }

  if (reference === undefined) throw new Error("Release smoke ran no variants")
  console.log(
    `Release smoke passed: ${variants.map(({ label }) => label).join(" = ")}; ` +
      `${reference.semantics.registry.length} registry signals; schema/findings/enforcement identical; ` +
      `${rootManifest.version}@${commit.slice(0, 12)}${dirty ? " dirty" : " clean"}`,
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
