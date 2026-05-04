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
  decodeTasteVector,
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  observe,
  runSignal,
  validateVectorAgainstRegistry,
  isActive as vectorIsActive,
  type ObserverOutput,
  type Registry,
  type SignalRunResult,
  type TasteVector,
} from "@taste-codec/core"
import { RS_PACK_SIGNALS, RustProjectLayer } from "@taste-codec/rs-pack"
import { SHARED_SIGNALS } from "@taste-codec/shared-signals"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@taste-codec/ts-pack"
import { Effect, Layer } from "effect"
import { simpleGit } from "simple-git"

/**
 * The codec registry ships both TS and Rust packs, but each repo only
 * activates the packs that have local source evidence.
 */
export const CODEC_SIGNALS = [...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]
export const CODEC_SHARED_SIGNALS = SHARED_SIGNALS

export const isReservedRustSignalId = (signalId: string): boolean => signalId.startsWith("RS-")

export const formatReservedRustSignalMessage = (signalId: string): string =>
  `Signal ${signalId} is not implemented yet. The Rust pack now supports RS-AD-* and RS-LD-* batch 1, but this signal still belongs to a later Rust work item.`

export interface CodecRuntimeOptions {
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

export const buildCodecRegistry = (repoPath?: string) =>
  Effect.gen(function* () {
    if (repoPath === undefined) {
      return (yield* buildRegistry([...CODEC_SHARED_SIGNALS, ...CODEC_SIGNALS])) as Registry
    }

    const repoRoot = yield* resolveRepoRoot(repoPath)
    const signals = yield* detectCodecSignals(repoRoot)
    return (yield* buildRegistry([...CODEC_SHARED_SIGNALS, ...signals])) as Registry
  })

export const loadTasteVectorFromPath = (vectorPath: string | undefined) =>
  Effect.gen(function* () {
    if (vectorPath === undefined) return undefined

    const absolutePath = resolve(vectorPath)
    const raw = yield* Effect.tryPromise({
      try: () => readFile(absolutePath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read taste vector at ${absolutePath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse taste vector JSON at ${absolutePath}: ${String(cause)}`),
    })

    return yield* decodeTasteVector(parsed)
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
  vector?: TasteVector,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const registry: Registry = yield* buildCodecRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstCodecSignals(vector, repoRoot)
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
  vector?: TasteVector,
  options?: CodecRuntimeOptions,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const gitSha = yield* readHeadSha(repoRoot)
    const { registry, engine, timeSeries } = yield* makeCodecRuntime(
      repoRoot,
      vector,
      options,
    )
    const result = yield* engine.observeWorktree(repoRoot, gitSha)

    return { repoRoot, gitSha, registry, result, timeSeries }
  })

export const makeCodecRuntime = (
  repoPath: string,
  vector?: TasteVector,
  options?: CodecRuntimeOptions,
) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const registry: Registry = yield* buildCodecRegistry(repoRoot)
    if (vector !== undefined) {
      yield* validateVectorAgainstCodecSignals(vector, repoRoot)
    }

    const timeSeries =
      options?.timeSeries?.enabled === true
        ? createTimeSeriesServices(repoRoot)
        : undefined

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
        cacheConfig: { cacheDir: join(repoRoot, ".taste-codec", "cache") },
        ...(options?.observer?.profile === true ? { observerProfile: true } : {}),
      },
    )
    const engine = yield* Effect.provide(ScoringEngineTag, EngineLayer)
    return { registry, engine, timeSeries }
  })

const collectActiveLanguagePacks = (
  registry: Registry,
  vector: TasteVector | undefined,
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
    const ContextLayer = Layer.succeed(SignalContextTag, {
      gitSha,
      worktreePath: repoRoot,
      changedHunks,
    })
    const ReferenceLayer = Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(referenceEntries),
    )

    return Layer.mergeAll(
      ContextLayer,
      ReferenceLayer,
      InMemoryCacheLayer,
      signalId.startsWith("TS-")
        ? TsProjectLayer(repoRoot, { productionOnly: true })
        : Layer.empty,
      signalId.startsWith("RS-") ? RustProjectLayer(repoRoot) : Layer.empty,
    )
  })

const detectCodecSignals = (repoRoot: string) =>
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
      ...(hasTypeScript || hasRust ? CODEC_SHARED_SIGNALS : []),
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

const validateVectorAgainstCodecSignals = (
  vector: TasteVector,
  repoRoot?: string,
) =>
  Effect.gen(function* () {
    const fullRegistry = yield* buildRegistry([
      ...CODEC_SHARED_SIGNALS,
      ...CODEC_SIGNALS,
    ])
    yield* validateVectorAgainstRegistry(vector, fullRegistry)
  })

const acquireDetachedWorktree = (
  repoRoot: string,
  sha: string,
): Effect.Effect<string, Error, import("effect/Scope").Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const prefix = join(tmpdir(), `taste-codec-reference-${sha.slice(0, 12)}-`)
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
