import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  ScoringEngineLayer,
  ScoringEngineTag,
  SignalContextTag,
  buildRegistry,
  collectWorktreeChangedHunks,
  createTimeSeriesServices,
  decodePulsarVector,
  makeResolvedCalibrationContext,
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  observe,
  runSignal,
  validateVectorAgainstRegistry,
  CalibrationContextTag,
  isActive as vectorIsActive,
  type ObserverOutput,
  type Registry,
  type RepoFacts,
  type ResolvedCalibrationContext,
  type SignalRunResult,
  type PulsarVector,
} from "@skastr0/pulsar-core"
import {
  decodeProjectModuleManifest,
  fingerprintProjectModuleManifest,
  loadEnabledProjectModules,
} from "@skastr0/pulsar-project-module-sdk"
import { RS_PACK_SIGNALS, RustProjectLayer } from "@skastr0/pulsar-rs-pack"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"
import { simpleGit } from "simple-git"

/**
 * The pulsar registry ships both TS and Rust packs, but each repo only
 * activates the packs that have local source evidence.
 */
export const PULSAR_SIGNALS = [...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]
export const PULSAR_SHARED_SIGNALS = SHARED_SIGNALS

export const isReservedRustSignalId = (signalId: string): boolean => signalId.startsWith("RS-")

export const formatReservedRustSignalMessage = (signalId: string): string =>
  `Signal ${signalId} is not implemented yet. The Rust pack now supports RS-AD-* and RS-LD-* batch 1, but this signal still belongs to a later Rust work item.`

export interface PulsarRuntimeOptions {
  readonly timeSeries?: {
    readonly enabled?: boolean
  }
  readonly tsProject?: {
    readonly productionOnly?: boolean
  }
  readonly observer?: {
    readonly profile?: boolean
  }
}

export const buildPulsarRegistry = (repoPath?: string) =>
  Effect.gen(function* () {
    if (repoPath === undefined) {
      return (yield* buildRegistry([...PULSAR_SHARED_SIGNALS, ...PULSAR_SIGNALS])) as Registry
    }

    const repoRoot = yield* resolveRepoRoot(repoPath)
    const signals = yield* detectPulsarSignals(repoRoot)
    return (yield* buildRegistry([...PULSAR_SHARED_SIGNALS, ...signals])) as Registry
  })

export const loadPulsarVectorFromPath = (vectorPath: string | undefined) =>
  Effect.gen(function* () {
    if (vectorPath === undefined) return undefined

    const absolutePath = resolve(vectorPath)
    const raw = yield* Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read pulsar vector at ${absolutePath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse pulsar vector JSON at ${absolutePath}: ${String(cause)}`),
    })

    return yield* decodePulsarVector(parsed)
  })

export const resolveRepoRoot = (repoPath: string) =>
  Effect.gen(function* () {
    const absolutePath = resolve(repoPath)
    if (!existsSync(absolutePath)) {
      return yield* Effect.fail(new Error(`Path does not exist: ${absolutePath}`))
    }

    const git = simpleGit(absolutePath)
    const root = yield* Effect.tryPromise({
      try: () => git.revparse(["--show-toplevel"]),
      catch: (cause) =>
        new Error(`Failed to resolve git worktree root for ${absolutePath}: ${String(cause)}`),
    })
    return root.trim()
  })

export const readHeadSha = (repoRoot: string) => resolveGitRef(repoRoot, "HEAD")

export const resolveGitRef = (repoRoot: string, ref: string) =>
  Effect.gen(function* () {
    const git = simpleGit(repoRoot)
    const resolved = yield* Effect.tryPromise({
      try: () => git.revparse([ref]),
      catch: (cause) => new Error(`git rev-parse ${ref} failed: ${String(cause)}`),
    })
    return resolved.trim()
  })

export const withDetachedWorktreeAtRef = <A, E>(
  repoPath: string,
  ref: string,
  run: (ctx: {
    repoRoot: string
    resolvedSha: string
    worktreePath: string
  }) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E | Error, never> =>
  Effect.scoped(
    Effect.gen(function* () {
      const repoRoot = yield* resolveRepoRoot(repoPath)
      const resolvedSha = yield* resolveGitRef(repoRoot, ref)
      const worktreePath = yield* acquireDetachedWorktree(repoRoot, resolvedSha)
      return yield* run({ repoRoot, resolvedSha, worktreePath })
    }),
  )

export const runSignalInWorktree = (
  repoPath: string,
  signalId: string,
  vector?: PulsarVector,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const registry: Registry = yield* buildPulsarRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstPulsarSignals(vector, repoRoot)
    }

    const EnvLayer = yield* buildWorktreeEnvLayer(repoRoot, gitSha, signalId)
    const result = yield* (Effect.provide(
      runSignal(registry, signalId, vector),
      EnvLayer,
    ) as Effect.Effect<SignalRunResult, unknown, never>)

    return { repoRoot, gitSha, registry, result }
  })

export const observeWorktree = (
  repoPath: string,
  vector?: PulsarVector,
  options?: PulsarRuntimeOptions,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const { registry, engine, timeSeries, calibrationContext } = yield* makePulsarRuntime(
      repoRoot,
      vector,
      options,
    )
    const result = yield* engine.observeWorktree(repoRoot, gitSha)

    return { repoRoot, gitSha, registry, result, timeSeries, calibrationContext }
  })

export const makePulsarRuntime = (
  repoPath: string,
  vector?: PulsarVector,
  options?: PulsarRuntimeOptions,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const registry: Registry = yield* buildPulsarRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstPulsarSignals(vector, repoRoot)
    }

    const timeSeries =
      options?.timeSeries?.enabled === true
        ? createTimeSeriesServices(repoRoot)
        : undefined
    const calibrationContext = yield* loadProjectModuleCalibrationContext(repoRoot)

    const activePacks = collectActiveLanguagePacks(registry, vector)
    const EngineLayer = ScoringEngineLayer(
      registry,
      (worktreePath): Layer.Layer<any, any, never> =>
        Layer.mergeAll(
          activePacks.typescript
            ? TsProjectLayer(worktreePath, options?.tsProject)
            : Layer.empty,
          activePacks.rust ? RustProjectLayer(worktreePath) : Layer.empty,
        ) as Layer.Layer<any, any, never>,
      vector,
      {
        ...(timeSeries === undefined ? {} : { timeSeriesWriter: timeSeries.writer }),
        cacheConfig: { cacheDir: join(repoRoot, ".pulsar", "cache") },
        ...(options?.observer?.profile === true ? { observerProfile: true } : {}),
        ...(calibrationContext === undefined ? {} : { calibrationContext }),
        calibrationContextForWorktree: loadProjectModuleCalibrationContext,
      },
    )
    const engine = yield* Effect.provide(ScoringEngineTag, EngineLayer)
    return { registry, engine, timeSeries, calibrationContext }
  })

export const loadProjectModuleCalibrationContext = (
  repoRoot: string,
): Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never> =>
  Effect.gen(function* () {
    const manifestPath = join(repoRoot, ".pulsar", "project-modules.json")
    if (!existsSync(manifestPath)) return undefined

    const raw = yield* Effect.tryPromise({
      try: () => readFile(manifestPath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read project module manifest at ${manifestPath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse project module manifest JSON at ${manifestPath}: ${String(cause)}`),
    })
    const manifest = yield* decodeProjectModuleManifest(parsed)
    const loadedModules = yield* loadEnabledProjectModules(manifest, { repoRoot })
    const manifestFingerprint = fingerprintProjectModuleManifest(manifest)
    const repoFacts: RepoFacts = {
      repoRoot,
      fingerprint: `project-modules:${manifestFingerprint}`,
      detectedTechnologies: [],
      sourceExtensions: [],
      metadata: {
        manifestPath,
        manifestFingerprint,
        declaredModuleCount: manifest.modules.length,
        activeModuleCount: loadedModules.length,
      },
    }

    return makeResolvedCalibrationContext({
      repoFacts,
      activeModules: loadedModules.map((module) => module.activeModule),
      processors: loadedModules.flatMap((module) => module.processors),
    })
  })

const collectActiveLanguagePacks = (
  registry: Registry,
  vector: PulsarVector | undefined,
): { readonly typescript: boolean; readonly rust: boolean } => {
  let typescript = false
  let rust = false
  for (const signal of registry.sorted) {
    if (!vectorIsActive(signal.id, vector)) continue
    if (signal.id.startsWith("TS-")) typescript = true
    if (signal.id.startsWith("RS-")) rust = true
  }
  return { typescript, rust }
}

const buildWorktreeEnvLayer = (repoRoot: string, gitSha: string, signalId: string) =>
  Effect.gen(function* () {
    const referenceEntries = yield* loadCanonicalReferenceDataEntries(repoRoot)
    const changedHunks = yield* collectWorktreeChangedHunks(repoRoot)
    const calibrationContext = yield* loadProjectModuleCalibrationContext(repoRoot)
    const ContextLayer = Layer.succeed(SignalContextTag, {
      gitSha,
      worktreePath: repoRoot,
      changedHunks,
    })
    const ReferenceLayer = Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(referenceEntries),
    )
    const CalibrationLayer =
      calibrationContext === undefined
        ? Layer.empty
        : Layer.succeed(CalibrationContextTag, calibrationContext)

    return Layer.mergeAll(
      ContextLayer,
      ReferenceLayer,
      InMemoryCacheLayer,
      CalibrationLayer,
      signalId.startsWith("TS-")
        ? TsProjectLayer(repoRoot, { productionOnly: true })
        : Layer.empty,
      signalId.startsWith("RS-") ? RustProjectLayer(repoRoot) : Layer.empty,
    )
  })

const detectPulsarSignals = (repoRoot: string) =>
  Effect.gen(function* () {
    const git = simpleGit(repoRoot)
    const raw = yield* Effect.tryPromise({
      try: () =>
        git.raw(["ls-files", "--cached", "--others", "--exclude-standard"]),
      catch: (cause) =>
        new Error(`Failed to list repo files for signal detection: ${String(cause)}`),
    })
    const files = raw
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file.length > 0)

    const hasTypeScript = files.some(
      (file) => file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith("tsconfig.json"),
    )
    const hasRust = files.some((file) => isRustSignalPath(file))

    return [
      ...(hasTypeScript || hasRust ? PULSAR_SHARED_SIGNALS : []),
      ...(hasTypeScript ? TS_PACK_SIGNALS : []),
      ...(hasRust ? RS_PACK_SIGNALS : []),
    ]
  })

const isRustSignalPath = (file: string): boolean => {
  if (!(file.endsWith(".rs") || file.endsWith("Cargo.toml") || file.endsWith("Cargo.lock"))) {
    return false
  }
  return !(
    file.includes("/__tests__/fixtures/") ||
    file.includes("/dist/") ||
    file.includes("/target/") ||
    file.includes("/node_modules/")
  )
}

const validateVectorAgainstPulsarSignals = (
  vector: PulsarVector,
  repoRoot?: string,
) =>
  Effect.gen(function* () {
    const fullRegistry = yield* buildRegistry([
      ...PULSAR_SHARED_SIGNALS,
      ...PULSAR_SIGNALS,
    ])
    yield* validateVectorAgainstRegistry(vector, fullRegistry)
  })

const acquireDetachedWorktree = (
  repoRoot: string,
  sha: string,
): Effect.Effect<string, Error, import("effect/Scope").Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const prefix = join(tmpdir(), `pulsar-reference-${sha.slice(0, 12)}-`)
      const dir = yield* Effect.tryPromise({
        try: () => mkdtemp(prefix),
        catch: (cause) => new Error(`mkdtemp failed for ${sha}: ${String(cause)}`),
      })
      yield* Effect.tryPromise({
        try: () => rm(dir, { recursive: true, force: true }),
        catch: (cause) => new Error(`Failed to prepare detached worktree at ${dir}: ${String(cause)}`),
      })

      const git = simpleGit(repoRoot)
      yield* Effect.tryPromise({
        try: () => git.raw(["worktree", "add", "--detach", "--force", dir, sha]),
        catch: (cause) => new Error(`git worktree add ${sha} failed: ${String(cause)}`),
      })
      return dir
    }),
    (dir) =>
      Effect.gen(function* () {
        const git = simpleGit(repoRoot)
        const removed = yield* Effect.either(
          Effect.tryPromise({
            try: () => git.raw(["worktree", "remove", "--force", dir]),
            catch: (cause) => new Error(`git worktree remove failed for ${dir}: ${String(cause)}`),
          }),
        )
        if (removed._tag === "Left") {
          const cleanup = yield* Effect.either(
            Effect.tryPromise({
              try: () => rm(dir, { recursive: true, force: true }),
              catch: (cause) => new Error(`Failed to clean detached worktree ${dir}: ${String(cause)}`),
            }),
          )
          if (cleanup._tag === "Left") {
            yield* Effect.logWarning(cleanup.left.message)
          }
        }
      }),
  )
