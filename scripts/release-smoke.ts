#!/usr/bin/env bun

import { cp, lstat, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  SCORE_PARITY_PROVENANCE_NORMALIZATION,
  assertCompleteScoreParity,
  assertNpmPlatformContract,
  assertPublishedExportContract,
  type MetaPackageManifest,
  type NpmPackMetadata,
  type PlatformPackageManifest,
  type PublishedExportsContract,
  type PublishedPackageManifest,
} from "./release-contracts.ts"

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

const platformPackageDirs = [
  "packages/npm/pulsar-darwin-arm64",
  "packages/npm/pulsar-darwin-x64",
  "packages/npm/pulsar-linux-arm64",
  "packages/npm/pulsar-linux-x64",
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
  readonly readiness?: unknown
  readonly weighted_mean?: unknown
  readonly minimum?: unknown
  readonly signal_metadata?: unknown
  readonly signal_diagnostics?: unknown
  readonly hard_gate_status?: unknown
  readonly hard_gate_violations?: unknown
  readonly [key: string]: unknown
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
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      ...(options.env ?? {}),
    },
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

const assertPublishedExports = async (): Promise<number> => {
  const contract = await readJson<PublishedExportsContract>(EXPORT_CONTRACT_PATH)
  const packages: Array<{
    readonly manifest: PublishedPackageManifest
    readonly pack: NpmPackMetadata
  }> = []
  for (const packageDir of publishedLibraryDirs) {
    const manifest = await readJson<PublishedPackageManifest>(
      join(REPO_ROOT, packageDir, "package.json"),
    )
    const result = await runChecked(
      `dry-run pack ${manifest.name}`,
      ["npm", "pack", "--json", "--dry-run", `./${packageDir}`],
      { cwd: REPO_ROOT },
    )
    const packed = parseJson<ReadonlyArray<NpmPackMetadata>>(
      `dry-run pack ${manifest.name}`,
      result,
    )[0]
    if (packed === undefined) throw new Error(`npm pack returned no metadata for ${manifest.name}`)
    packages.push({ manifest, pack: packed })
  }
  return assertPublishedExportContract(contract, packages)
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
    ["fixture git commit", ["git", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]],
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

const assertScoreContract = (label: string, score: ScoreJson): ReadonlyArray<string> => {
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
  if (typeof score.categories !== "object" || score.categories === null) {
    throw new Error(`${label} omitted category scores`)
  }
  if (
    typeof score.readiness !== "object" ||
    score.readiness === null ||
    typeof (score.readiness as { readonly score?: unknown }).score !== "number"
  ) {
    throw new Error(`${label} omitted readiness score`)
  }
  if (
    typeof score.weighted_mean !== "number" ||
    typeof score.minimum !== "object" ||
    score.minimum === null ||
    typeof (score.minimum as { readonly score?: unknown }).score !== "number"
  ) {
    throw new Error(`${label} omitted aggregate score values`)
  }
  return registry
}

const packNpmArtifact = async (
  packageDir: string,
  packDir: string,
): Promise<{ readonly manifest: { readonly name: string }; readonly tarball: string }> => {
  const manifest = await readJson<{ readonly name: string }>(
    join(REPO_ROOT, packageDir, "package.json"),
  )
  const result = await runChecked(
    `pack ${manifest.name}`,
    ["npm", "pack", "--json", "--pack-destination", packDir, `./${packageDir}`],
    { cwd: REPO_ROOT },
  )
  const packed = parseJson<ReadonlyArray<NpmPackMetadata>>(`pack ${manifest.name}`, result)[0]
  const filename = packed?.filename
  if (filename === undefined) throw new Error(`npm pack returned no filename for ${manifest.name}`)
  return { manifest, tarball: join(packDir, filename) }
}

const packNpmArtifacts = async (
  root: string,
): Promise<{ readonly metaTarball: string; readonly hostTarball: string }> => {
  const packDir = join(root, "packs")
  await mkdir(packDir, { recursive: true })
  const hostPackageDir = platformPackageDirs.find((packageDir) => packageDir.endsWith(HOST_TARGET))
  if (hostPackageDir === undefined) {
    throw new Error(`No npm platform package directory supports ${HOST_TARGET}`)
  }
  const [meta, host] = await Promise.all([
    packNpmArtifact("packages/npm/pulsar", packDir),
    packNpmArtifact(hostPackageDir, packDir),
  ])
  if (meta.manifest.name !== "@skastr0/pulsar" || host.manifest.name !== hostPackageName) {
    throw new Error(`Packed unexpected npm artifacts ${meta.manifest.name} and ${host.manifest.name}`)
  }
  return { metaTarball: meta.tarball, hostTarball: host.tarball }
}

const installNpmArtifact = async (
  root: string,
  supportedPlatformPackages: ReadonlyArray<string>,
): Promise<string> => {
  const { metaTarball, hostTarball } = await packNpmArtifacts(root)
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
        },
        overrides: {
          [hostPackageName]: `file:${hostTarball}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  await runChecked(
    "clean npm optional-dependency install",
    [
      "npm",
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(root, "npm-cache"),
    ],
    { cwd: installRoot },
  )

  const lock = await readJson<{
    readonly packages?: Readonly<
      Record<
        string,
        {
          readonly optional?: unknown
          readonly optionalDependencies?: Readonly<Record<string, unknown>>
        }
      >
    >
  }>(join(installRoot, "package-lock.json"))
  const metaLock = lock.packages?.["node_modules/@skastr0/pulsar"]
  const hostLock = lock.packages?.[`node_modules/${hostPackageName}`]
  if (metaLock?.optionalDependencies?.[hostPackageName] === undefined || hostLock?.optional !== true) {
    throw new Error(`npm did not resolve ${hostPackageName} through the meta optional dependency`)
  }
  for (const packageName of supportedPlatformPackages) {
    const installedManifest = join(
      installRoot,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    )
    if ((await Bun.file(installedManifest).exists()) !== (packageName === hostPackageName)) {
      throw new Error(`Clean npm install selected an unexpected platform package ${packageName}`)
    }
  }

  const publicBin = join(installRoot, "node_modules", ".bin", "pulsar")
  if (!(await lstat(publicBin)).isSymbolicLink()) {
    throw new Error("Clean npm install did not create the public node_modules/.bin/pulsar link")
  }
  return publicBin
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
  const rootManifest = await readJson<{ readonly version: string }>(
    join(REPO_ROOT, "package.json"),
  )
  const publishedExportTargetCount = await assertPublishedExports()
  const metaManifest = await readJson<MetaPackageManifest>(
    join(REPO_ROOT, "packages", "npm", "pulsar", "package.json"),
  )
  const platformManifests = await Promise.all(
    platformPackageDirs.map((packageDir) =>
      readJson<PlatformPackageManifest>(join(REPO_ROOT, packageDir, "package.json")),
    ),
  )
  const supportedPlatformPackages = assertNpmPlatformContract({
    rootVersion: rootManifest.version,
    meta: metaManifest,
    platforms: platformManifests,
  })
  if (!supportedPlatformPackages.includes(hostPackageName)) {
    throw new Error(`Supported npm platform packages omit host target ${hostPackageName}`)
  }
  const commit = await git(["rev-parse", "HEAD"])
  const dirty = (await git(["status", "--porcelain"])) !== ""
  const fixturePath = await initializeFixture(tempRoot)
  const npmLauncher = RUN_NPM
    ? await installNpmArtifact(tempRoot, supportedPlatformPackages)
    : undefined

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
      : [{ label: "npm", command: [npmLauncher] }]),
  ]

  let reference:
    | {
        readonly label: string
        readonly score: ScoreJson
        readonly registry: ReadonlyArray<string>
      }
    | undefined
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
    const score = parseJson<ScoreJson>(`${variant.label} semantic score`, scoreResult)
    const registry = assertScoreContract(variant.label, score)
    if (reference === undefined) reference = { label: variant.label, score, registry }
    else {
      assertCompleteScoreParity(variant.label, reference.label, reference.score, score)
      if (registry.length !== reference.registry.length) {
        throw new Error(
          `${variant.label} registry count ${registry.length} diverged from ${reference.label} ${reference.registry.length}`,
        )
      }
    }
  }

  if (reference === undefined) throw new Error("Release smoke ran no variants")
  console.log(
    `Release smoke passed: ${variants.map(({ label }) => label).join(" = ")}; ` +
      `${reference.registry.length} registry signals; ${publishedExportTargetCount} packed export targets; ` +
      `complete score JSON identical; provenance normalization: ` +
      `${SCORE_PARITY_PROVENANCE_NORMALIZATION.length === 0 ? "none" : SCORE_PARITY_PROVENANCE_NORMALIZATION.join(", ")}; ` +
      `${rootManifest.version}@${commit.slice(0, 12)}${dirty ? " dirty" : " clean"}`,
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
