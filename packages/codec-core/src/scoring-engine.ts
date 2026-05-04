import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import {
  InMemoryCacheLayer,
  SignalCacheTag,
  cacheKeyString,
  type CacheKey,
  type CacheConfig,
} from "./cache.js"
import { DiskBackedCacheLayer } from "./cache-disk.js"
import {
  CalibrationContextTag,
  type ResolvedCalibrationContext,
} from "./calibration.js"
import {
  type ChangedHunk,
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
} from "./context.js"
import {
  CommitNotFound,
  GitRevListFailed,
  WorktreeCreateFailed,
  WorktreeRemoveFailed,
  type ScoringEngineError,
  type SignalError,
} from "./errors.js"
import { observe, type ObserverOutput } from "./observer.js"
import { loadCanonicalReferenceDataEntries } from "./reference-data-loader.js"
import type { Registry } from "./registry.js"
import { runSignal, type SignalRunResult } from "./runner.js"
import { type TimeSeriesWriter } from "./time-series.js"
import {
  isActive as vectorIsActive,
  resolvedConfig as vectorResolvedConfig,
  type TasteVector,
} from "./vector.js"

/**
 * TC-017 first cut: commit-level scoring engine with a content-hash cache
 * and ephemeral git worktrees.
 *
 * Scope (per the 2026-04-18 narrowing in the work item):
 *   - scoreCommit(repoPath, sha, signalId) => SignalRunResult
 *   - scoreRange(repoPath, fromSha, toSha, signalId, { concurrency })
 *   - In-memory cache keyed by (signalId, contentHash, configHash)
 *   - Parallel dispatch via Effect.forEach with configurable concurrency
 *   - Scope-bound worktree lifecycle (cleanup on interruption)
 *
 * Deferred (see work item):
 *   - Hunk-level incremental re-scoring (AC-3)
 *   - Persistent disk cache (AC-5)
 *   - 500-commit <5-min benchmark (AC-7)
 *   - Observer integration with all active signals (TC-021/TC-022)
 */
export class ScoringEngineTag extends Context.Tag("@taste-codec/core/ScoringEngine")<
  ScoringEngineTag,
  {
    readonly scoreCommit: (
      repoPath: string,
      sha: string,
      signalId: string,
    ) => Effect.Effect<SignalRunResult, SignalError | ScoringEngineError, never>
    readonly scoreRange: (
      repoPath: string,
      fromSha: string,
      toSha: string,
      signalId: string,
      options?: { concurrency?: number },
    ) => Effect.Effect<
      ReadonlyArray<{ sha: string; result: SignalRunResult }>,
      SignalError | ScoringEngineError,
      never
    >
    readonly observeCommit: (
      repoPath: string,
      sha: string,
    ) => Effect.Effect<ObserverOutput, ScoringEngineError, never>
    readonly observeWorktree: (
      repoPath: string,
      headSha: string,
      options?: { readonly changedHunks?: ReadonlyArray<ChangedHunk> },
    ) => Effect.Effect<ObserverOutput, ScoringEngineError, never>
    readonly observeRange: (
      repoPath: string,
      fromSha: string,
      toSha: string,
      options?: { concurrency?: number },
    ) => Effect.Effect<
      ReadonlyArray<{ sha: string; result: ObserverOutput }>,
      ScoringEngineError,
      never
    >
  }
>() {}

/**
 * Layer factory contract for per-worktree resources like the ts-morph
 * Project. The engine lives in core and must not import language packs
 * directly — callers pass this factory when building the engine layer.
 *
 * The returned layer can itself fail; any errors surface as a fiber
 * defect today. Packs that need typed failures can wire them through
 * `Layer.catchAll` before passing the factory.
 */
export type PackLayerFactory = (worktreePath: string) => Layer.Layer<never, never, never> | Layer.Layer<any, any, never>

/**
 * SHA-256 over the sorted list of per-file (blob SHA, path) pairs at a
 * given commit, filtered to language-pack source files. Deterministic for
 * a given tree — two commits with identical tracked TS / Rust content share
 * a hash regardless of the commit message or parents.
 */
export const computeContentHash = Effect.fn("ScoringEngine.computeContentHash")(
  function* (repoPath: string, sha: string) {
    yield* Effect.annotateCurrentSpan("sha", sha)
    const out = yield* runGit(repoPath, ["ls-tree", "-r", sha], {
      onFail: (msg) =>
        new CommitNotFound({ repoPath, sha, message: `git ls-tree failed: ${msg}` }),
    })
    const entries: Array<string> = []
    for (const line of out.split("\n")) {
      if (line.length === 0) continue
      // Format: <mode> <type> <sha>\t<path>
      const tabIdx = line.indexOf("\t")
      if (tabIdx === -1) continue
      const meta = line.slice(0, tabIdx)
      const path = line.slice(tabIdx + 1)
      if (!isCodecSource(path)) continue
      const parts = meta.split(" ")
      const blobSha = parts[2]
      if (blobSha === undefined) continue
      entries.push(`${blobSha}\t${path}`)
    }
    entries.sort()
    const hash = createHash("sha256")
    hash.update(entries.join("\n"))
    return hash.digest("hex")
  },
)

export const computeWorktreeContentHash = Effect.fn("ScoringEngine.computeWorktreeContentHash")(
  function* (repoPath: string) {
    const baseOut = yield* runGit(repoPath, ["ls-tree", "-r", "HEAD"], {
      onFail: (msg) =>
        new CommitNotFound({
          repoPath,
          sha: "HEAD",
          message: `git ls-tree HEAD failed: ${msg}`,
        }),
    })
    const entriesByPath = new Map<string, string>()
    for (const line of baseOut.split("\n")) {
      if (line.length === 0) continue
      const tabIdx = line.indexOf("\t")
      if (tabIdx === -1) continue
      const meta = line.slice(0, tabIdx)
      const path = line.slice(tabIdx + 1)
      if (!isCodecSource(path)) continue
      const blobSha = meta.split(" ")[2]
      if (blobSha === undefined) continue
      entriesByPath.set(path, blobSha)
    }

    const changedPaths = yield* collectDirtyCodecPaths(repoPath)
    for (const path of changedPaths) {
      const content = yield* Effect.either(
        Effect.tryPromise({
          try: () => readFile(join(repoPath, path)),
          catch: (cause) => cause,
        }),
      )
      if (content._tag === "Left") {
        entriesByPath.delete(path)
        continue
      }
      entriesByPath.set(path, `worktree:${createHash("sha256").update(content.right).digest("hex")}`)
    }

    const entries = [...entriesByPath.entries()]
      .map(([path, contentId]) => `${contentId}\t${path}`)
      .sort((left, right) => left.localeCompare(right))
    const hash = createHash("sha256")
    hash.update(entries.join("\n"))
    return hash.digest("hex")
  },
)

const collectDirtyCodecPaths = Effect.fn("ScoringEngine.collectDirtyCodecPaths")(
  function* (repoPath: string) {
    const changed = yield* runGit(
      repoPath,
      [
        "diff",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "HEAD",
        "--",
        ".",
        ":!.taste-codec/cache",
      ],
      {
        onFail: (msg) =>
          new CommitNotFound({
            repoPath,
            sha: "WORKTREE",
            message: `git diff --name-only HEAD failed: ${msg}`,
          }),
      },
    )
    const untracked = yield* runGit(
      repoPath,
      [
        "ls-files",
        "-z",
        "--others",
        "--exclude-standard",
        "--",
        ".",
        ":!.taste-codec/cache",
      ],
      {
        onFail: (msg) =>
          new CommitNotFound({
            repoPath,
            sha: "WORKTREE",
            message: `git ls-files --others failed: ${msg}`,
          }),
      },
    )

    return [
      ...new Set(
        `${changed}\0${untracked}`
          .split("\0")
          .map((path) => path.trim())
          .filter((path) => path.length > 0 && isCodecSource(path)),
      ),
    ].sort((left, right) => left.localeCompare(right))
  },
)

export const collectWorktreeChangedHunks = Effect.fn(
  "ScoringEngine.collectWorktreeChangedHunks",
)(function* (repoPath: string) {
  const diff = yield* runGit(
    repoPath,
    [
      "diff",
      "--unified=0",
      "--no-ext-diff",
      "HEAD",
      "--",
      ".",
      ":!.taste-codec/cache",
    ],
    {
      onFail: (msg) =>
        new CommitNotFound({
          repoPath,
          sha: "WORKTREE",
          message: `git diff HEAD failed: ${msg}`,
        }),
    },
  )
  const trackedHunks = parseChangedHunksFromUnifiedDiff(diff).filter((hunk) =>
    isCodecSource(hunk.file),
  )

  const untracked = yield* runGit(
    repoPath,
    [
      "ls-files",
      "-z",
      "--others",
      "--exclude-standard",
      "--",
      ".",
      ":!.taste-codec/cache",
    ],
    {
      onFail: (msg) =>
        new CommitNotFound({
          repoPath,
          sha: "WORKTREE",
          message: `git ls-files --others failed: ${msg}`,
        }),
    },
  )
  const untrackedHunks = yield* Effect.forEach(
    [
      ...new Set(
        untracked
          .split("\0")
          .map((path) => path.trim())
          .filter((path) => path.length > 0 && isCodecSource(path)),
      ),
    ].sort((left, right) => left.localeCompare(right)),
    (file) =>
      Effect.gen(function* () {
        const content = yield* Effect.either(
          Effect.tryPromise({
            try: () => readFile(join(repoPath, file), "utf8"),
            catch: (cause) => cause,
          }),
        )
        if (content._tag === "Left") {
          return undefined
        }
        return {
          file,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: countTextLines(content.right),
        } satisfies ChangedHunk
      }),
    { concurrency: 8 },
  )

  return [
    ...trackedHunks,
    ...untrackedHunks.filter((hunk): hunk is ChangedHunk => hunk !== undefined),
  ]
})

const isCodecSource = (path: string): boolean =>
  path.endsWith(".ts") ||
  path.endsWith(".tsx") ||
  path.endsWith("package.json") ||
  path.endsWith("tsconfig.json") ||
  path.endsWith("tsconfig.base.json") ||
  path.endsWith("bun.lock") ||
  path.endsWith("bun.lockb") ||
  path.endsWith("pnpm-lock.yaml") ||
  path.endsWith("package-lock.json") ||
  path.endsWith("yarn.lock") ||
  path.endsWith(".rs") ||
  path.endsWith("Cargo.toml") ||
  path.endsWith("Cargo.lock")

const parseChangedHunksFromUnifiedDiff = (diff: string): ReadonlyArray<ChangedHunk> => {
  const hunks: Array<ChangedHunk> = []
  let currentFile: string | undefined

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = normalizeDiffTargetPath(line.slice(4).trim())
      continue
    }

    if (!line.startsWith("@@ ") || currentFile === undefined) continue
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match === null) continue
    hunks.push({
      file: currentFile,
      oldStart: Number(match[1]),
      oldLines: Number(match[2] ?? 1),
      newStart: Number(match[3]),
      newLines: Number(match[4] ?? 1),
    })
  }

  return hunks
}

const normalizeDiffTargetPath = (target: string): string | undefined => {
  if (target === "/dev/null") return undefined
  if (target.startsWith("b/")) return target.slice(2)
  if (target.startsWith("a/")) return target.slice(2)
  return target
}

const countTextLines = (content: string): number => {
  if (content.length === 0) return 0
  const lines = content.split(/\r\n|\r|\n/)
  return content.endsWith("\n") || content.endsWith("\r") ? lines.length - 1 : lines.length
}

/**
 * SHA-256 over the stable JSON encoding of a signal's resolved config.
 * Config changes invalidate the score cache for that signal; content
 * changes invalidate it independently. Keys stay orthogonal.
 */
export const computeConfigHash = (
  signalId: string,
  registry: Registry,
  vector: TasteVector | undefined,
  calibrationFingerprint?: string,
): string => {
  const signal = registry.byId.get(signalId)
  const config = signal
    ? vectorResolvedConfig(signalId, signal.defaultConfig, vector)
    : undefined
  const payload: {
    readonly cacheVersion: string | null
    readonly config: unknown
    readonly calibrationFingerprint?: string
  } = {
    cacheVersion: signal?.cacheVersion ?? null,
    config: config ?? null,
  }
  const hash = createHash("sha256")
  if (calibrationFingerprint !== undefined) {
    hash.update(stableStringify({ ...payload, calibrationFingerprint }))
  } else {
    hash.update(stableStringify(payload))
  }
  return hash.digest("hex")
}

const OBSERVER_CACHE_SIGNAL_ID = "__observer__"

interface CachedObserverOutput {
  readonly categories: ObserverOutput["categories"]
  readonly minimum: ObserverOutput["minimum"]
  readonly weighted_mean: ObserverOutput["weighted_mean"]
  readonly hard_gate_status: ObserverOutput["hard_gate_status"]
  readonly hard_gate_violations: ObserverOutput["hard_gate_violations"]
  readonly inactiveSignals: ObserverOutput["inactiveSignals"]
  readonly signalResults: ReadonlyArray<SignalRunResult>
  readonly signalMetadata?: ObserverOutput["signalMetadata"]
  readonly calibration?: ObserverOutput["calibration"]
}

/**
 * Observer output depends on the full active signal set, each active
 * signal's resolved config, and each active signal weight. Cache keys
 * must therefore include more than one signal id's config hash.
 */
export const computeObserverConfigHash = (
  registry: Registry,
  vector: TasteVector | undefined,
  calibrationFingerprint?: string,
): string => {
  const activeSignals = registry.sorted
    .filter((signal) => vectorIsActive(signal.id, vector))
    .map((signal) => [
      signal.id,
      {
        config: vectorResolvedConfig(signal.id, signal.defaultConfig, vector),
        cacheVersion: signal.cacheVersion ?? null,
        weight: vector?.signal_overrides[signal.id]?.weight ?? 1,
      },
    ])
  const hash = createHash("sha256")
  hash.update(
    calibrationFingerprint === undefined
      ? stableStringify(activeSignals)
      : stableStringify({ activeSignals, calibrationFingerprint }),
  )
  return hash.digest("hex")
}

const toCachedObserverOutput = (result: ObserverOutput): CachedObserverOutput => ({
  categories: result.categories,
  minimum: result.minimum,
  weighted_mean: result.weighted_mean,
  hard_gate_status: result.hard_gate_status,
  hard_gate_violations: result.hard_gate_violations,
  inactiveSignals: result.inactiveSignals,
  signalResults: [...result.signalResults.values()],
  ...(result.signalMetadata !== undefined ? { signalMetadata: result.signalMetadata } : {}),
  ...(result.calibration !== undefined ? { calibration: result.calibration } : {}),
})

const fromCachedObserverOutput = (cached: CachedObserverOutput): ObserverOutput => ({
  categories: cached.categories,
  minimum: cached.minimum,
  weighted_mean: cached.weighted_mean,
  hard_gate_status: cached.hard_gate_status,
  hard_gate_violations: cached.hard_gate_violations,
  inactiveSignals: cached.inactiveSignals,
  signalResults: new Map(cached.signalResults.map((result) => [result.signalId, result])),
  ...(cached.signalMetadata !== undefined ? { signalMetadata: cached.signalMetadata } : {}),
  ...(cached.calibration !== undefined ? { calibration: cached.calibration } : {}),
})

/**
 * Deterministic JSON stringify — sorts object keys so logically equal
 * configs hash equal regardless of authoring order.
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${parts.join(",")}}`
}

const computeReferenceVersionHash = (referenceEntries: ReadonlyMap<string, unknown>): string => {
  const hash = createHash("sha256")
  const normalized = [...referenceEntries.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
  hash.update(stableStringify(normalized))
  return hash.digest("hex")
}

const hashChangedHunks = (changedHunks: ReadonlyArray<ChangedHunk>): string => {
  const normalized = [...changedHunks].sort((left, right) =>
    `${left.file}:${left.oldStart}:${left.newStart}`.localeCompare(
      `${right.file}:${right.oldStart}:${right.newStart}`,
    ),
  )
  return createHash("sha256").update(stableStringify(normalized)).digest("hex")
}

const mergeCachedResultMetadata = (
  result: SignalRunResult,
  cached: {
    readonly status: "hit" | "miss" | "stale"
    readonly effectiveConfidence?: number
    readonly entry?: {
      readonly tier: number
      readonly baseConfidence: number
      readonly computedAt: string
    }
  },
): SignalRunResult => {
  if (
    cached.effectiveConfidence === undefined ||
    cached.entry === undefined ||
    cached.entry.tier !== 3
  ) {
    return result
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      effectiveConfidence: cached.effectiveConfidence,
      baseConfidence: cached.entry.baseConfidence,
      computedAt: cached.entry.computedAt,
      stale: cached.status === "stale",
    },
  }
}

const nowMs = (): number => {
  if (typeof performance !== "undefined") return performance.now()
  return Date.now()
}

const roundRuntimeMs = (value: number): number => Math.max(0, Number(value.toFixed(2)))

const withRuntimeEnvironmentProfile = (
  output: ObserverOutput,
  environmentDurationMs: number,
): ObserverOutput => {
  if (output.runtimeProfile === undefined) return output

  const totalMs = roundRuntimeMs(environmentDurationMs)
  const observerMs = output.runtimeProfile.totalMs
  const setupMs = roundRuntimeMs(totalMs - observerMs)
  return {
    ...output,
    runtimeProfile: {
      ...output.runtimeProfile,
      totalMs,
      stages: {
        ...(output.runtimeProfile.stages ?? {}),
        "environment-setup": { durationMs: setupMs },
        observer: { durationMs: observerMs },
      },
    },
  }
}

/**
 * Build the scoring engine layer. The registry is frozen at layer
 * construction; the cache is created once and shared across every
 * commit scored by this engine instance.
 */
export const ScoringEngineLayer = (
  registry: Registry,
  packLayerFactory: PackLayerFactory,
  vector?: TasteVector,
  options?: {
    readonly timeSeriesWriter?: TimeSeriesWriter
    readonly cacheConfig?: CacheConfig
    readonly observerProfile?: boolean
    readonly calibrationContext?: ResolvedCalibrationContext
  },
): Layer.Layer<ScoringEngineTag> =>
  Layer.effect(
    ScoringEngineTag,
    Effect.gen(function* () {
      const cacheLayer =
        options?.cacheConfig !== undefined
          ? DiskBackedCacheLayer(options.cacheConfig)
          : InMemoryCacheLayer
      // Materialize a single cache instance that persists across calls.
      const cacheRef = yield* Effect.provide(
        Effect.gen(function* () {
          const c = yield* SignalCacheTag
          return c
        }),
        cacheLayer,
      )

      const makeEnvLayer = (
        worktreePath: string,
        sha: string,
        referenceEntries: ReadonlyMap<string, unknown>,
        changedHunks: ReadonlyArray<ChangedHunk> = [],
      ): Layer.Layer<any, any, never> => {
        const ContextLayer = Layer.succeed(SignalContextTag, {
          gitSha: sha,
          worktreePath,
          changedHunks,
        })
        const ReferenceLayer = Layer.succeed(
          ReferenceDataTag,
          makeReferenceData(referenceEntries),
        )
        const CacheShareLayer = Layer.succeed(SignalCacheTag, cacheRef)
        const CalibrationLayer =
          options?.calibrationContext === undefined
            ? Layer.empty
            : Layer.succeed(CalibrationContextTag, options.calibrationContext)
        const PackLayer = packLayerFactory(worktreePath)
        return Layer.mergeAll(
          ContextLayer,
          ReferenceLayer,
          CacheShareLayer,
          CalibrationLayer,
          PackLayer,
        )
      }

      const runWithEnvironment = <A, E>(
        worktreePath: string,
        sha: string,
        changedHunks: ReadonlyArray<ChangedHunk>,
        runInWorktree: (
          envLayer: Layer.Layer<any, any, never>,
          referenceEntries: ReadonlyMap<string, unknown>,
        ) => Effect.Effect<A, E, never>,
      ): Effect.Effect<A, E | ScoringEngineError, never> =>
        Effect.gen(function* () {
          yield* Effect.annotateCurrentSpan("worktreePath", worktreePath)
          const referenceEntries = yield* loadCanonicalReferenceDataEntries(worktreePath)
          const EnvLayer = makeEnvLayer(worktreePath, sha, referenceEntries, changedHunks)
          return yield* runInWorktree(EnvLayer, referenceEntries)
        })

      const withCommitEnvironment = <A, E>(
        repoPath: string,
        sha: string,
        runInWorktree: (
          envLayer: Layer.Layer<any, any, never>,
          referenceEntries: ReadonlyMap<string, unknown>,
        ) => Effect.Effect<A, E, never>,
      ): Effect.Effect<A, E | ScoringEngineError, never> =>
        Effect.gen(function* () {
          const useCurrentWorktree = yield* canUseCurrentWorktreeForCommit(repoPath, sha)
          if (useCurrentWorktree) {
            return yield* runWithEnvironment(repoPath, sha, [], runInWorktree)
          }

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const worktreePath = yield* acquireWorktree(repoPath, sha)
              return yield* runWithEnvironment(worktreePath, sha, [], runInWorktree)
            }),
          )
        })

      const observeWithCache = (
        key: CacheKey,
        runFresh: () => Effect.Effect<ObserverOutput, ScoringEngineError, never>,
      ): Effect.Effect<
        { readonly result: ObserverOutput; readonly cacheHit: boolean },
        ScoringEngineError,
        never
      > =>
        Effect.gen(function* () {
          const cached = yield* cacheRef.getTiered<CachedObserverOutput>(key, { tier: 1 })
          const profile = options?.observerProfile === true
          const cacheHit = !profile && (cached.status === "hit" || cached.status === "stale")
          if (cacheHit) {
            return { result: fromCachedObserverOutput(cached.value!), cacheHit }
          }

          const runtimeStartedAt = nowMs()
          const result = yield* runFresh().pipe(
            Effect.map((fresh) =>
              profile
                ? withRuntimeEnvironmentProfile(fresh, nowMs() - runtimeStartedAt)
                : fresh,
            ),
            Effect.tap((fresh) => {
              if (profile) return Effect.void
              return cacheRef.setTiered(key, toCachedObserverOutput(fresh), { tier: 1 })
            }),
          )

          return { result, cacheHit }
        })

      const scoreCommit = Effect.fn("ScoringEngine.scoreCommit")(
        function* (repoPath: string, sha: string, signalId: string) {
          yield* Effect.annotateCurrentSpan("sha", sha)
          yield* Effect.annotateCurrentSpan("signalId", signalId)

          const signal = registry.byId.get(signalId)
          const contentHash = yield* computeContentHash(repoPath, sha)
          const configHash = computeConfigHash(
            signalId,
            registry,
            vector,
            options?.calibrationContext?.fingerprint,
          )
          const key: CacheKey = { signalId, contentHash, configHash }

          if (signal === undefined || signal.tier === 1 || signal.tier === 1.5) {
            const cached = yield* cacheRef.getTiered<SignalRunResult>(key, {
              ...(signal !== undefined ? { tier: signal.tier } : {}),
            })
            if (cached.status === "hit" || cached.status === "stale") {
              yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
              yield* Effect.annotateCurrentSpan("cacheHit", true)
              return mergeCachedResultMetadata(cached.value!, cached)
            }
          }

          const result = yield* withCommitEnvironment(repoPath, sha, (EnvLayer, referenceEntries) =>
            Effect.gen(function* () {
              const tieredCached = yield* cacheRef.getTiered<SignalRunResult>(key, {
                ...(signal !== undefined ? { tier: signal.tier } : {}),
                ...(signal?.tier === 2
                  ? { refVersionHash: computeReferenceVersionHash(referenceEntries) }
                  : {}),
              })
              if (tieredCached.status === "hit" || tieredCached.status === "stale") {
                yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
                yield* Effect.annotateCurrentSpan("cacheHit", true)
                return mergeCachedResultMetadata(tieredCached.value!, tieredCached)
              }

              const fresh = yield* (Effect.provide(
                runSignal(registry, signalId, vector),
                EnvLayer,
              ) as Effect.Effect<SignalRunResult, SignalError, never>)

              yield* cacheRef.setTiered(key, fresh, {
                ...(signal !== undefined ? { tier: signal.tier } : {}),
                ...(signal?.tier === 2
                  ? { refVersionHash: computeReferenceVersionHash(referenceEntries) }
                  : {}),
              })
              return fresh
            }),
          )

          yield* Effect.annotateCurrentSpan("cacheHit", false)
          return result
        },
      )

      const scoreRange = Effect.fn("ScoringEngine.scoreRange")(
        function* (
          repoPath: string,
          fromSha: string,
          toSha: string,
          signalId: string,
          options?: { concurrency?: number },
        ) {
          yield* Effect.annotateCurrentSpan("fromSha", fromSha)
          yield* Effect.annotateCurrentSpan("toSha", toSha)
          yield* Effect.annotateCurrentSpan("signalId", signalId)

          const shas = yield* resolveRange(repoPath, fromSha, toSha)
          yield* Effect.annotateCurrentSpan("commitCount", shas.length)

          const concurrency = options?.concurrency ?? 4
          return yield* Effect.forEach(
            shas,
            (sha) =>
              scoreCommit(repoPath, sha, signalId).pipe(
                Effect.map((result) => ({ sha, result })),
              ),
            { concurrency },
          )
        },
      )

      const observeCommit = Effect.fn("ScoringEngine.observeCommit")(
        function* (repoPath: string, sha: string) {
          yield* Effect.annotateCurrentSpan("sha", sha)
          const contentHash = yield* computeContentHash(repoPath, sha)
          const configHash = computeObserverConfigHash(
            registry,
            vector,
            options?.calibrationContext?.fingerprint,
          )
          const key: CacheKey = {
            signalId: OBSERVER_CACHE_SIGNAL_ID,
            contentHash,
            configHash,
          }

          const profile = options?.observerProfile === true
          const { result, cacheHit } = yield* observeWithCache(key, () =>
            withCommitEnvironment(repoPath, sha, (EnvLayer) =>
              Effect.provide(observe(registry, vector, { profile }), EnvLayer) as Effect.Effect<
                ObserverOutput,
                never,
                never
              >,
            ),
          )

          yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
          yield* Effect.annotateCurrentSpan("cacheHit", cacheHit)
          if (options?.timeSeriesWriter !== undefined) {
            yield* options.timeSeriesWriter.appendObservation(sha, result)
          }
          return result
        },
      )

      const observeWorktree = Effect.fn("ScoringEngine.observeWorktree")(
        function* (
          repoPath: string,
          headSha: string,
          worktreeOptions?: { readonly changedHunks?: ReadonlyArray<ChangedHunk> },
        ) {
          yield* Effect.annotateCurrentSpan("sha", headSha)
          const cleanHead = yield* canUseCurrentWorktreeForCommit(repoPath, headSha)
          if (cleanHead) {
            return yield* observeCommit(repoPath, headSha)
          }

          const changedHunks =
            worktreeOptions?.changedHunks ?? (yield* collectWorktreeChangedHunks(repoPath))
          const contentHash = `${yield* computeWorktreeContentHash(repoPath)}:${hashChangedHunks(changedHunks)}`
          const configHash = computeObserverConfigHash(
            registry,
            vector,
            options?.calibrationContext?.fingerprint,
          )
          const key: CacheKey = {
            signalId: OBSERVER_CACHE_SIGNAL_ID,
            contentHash,
            configHash,
          }

          const profile = options?.observerProfile === true
          const { result, cacheHit } = yield* observeWithCache(key, () =>
            runWithEnvironment(repoPath, headSha, changedHunks, (EnvLayer) =>
              Effect.provide(observe(registry, vector, { profile }), EnvLayer) as Effect.Effect<
                ObserverOutput,
                never,
                never
              >,
            ),
          )

          yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
          yield* Effect.annotateCurrentSpan("cacheHit", cacheHit)
          return result
        },
      )

      const observeRange = Effect.fn("ScoringEngine.observeRange")(
        function* (
          repoPath: string,
          fromSha: string,
          toSha: string,
          options?: { concurrency?: number },
        ) {
          yield* Effect.annotateCurrentSpan("fromSha", fromSha)
          yield* Effect.annotateCurrentSpan("toSha", toSha)

          const shas = yield* resolveRange(repoPath, fromSha, toSha)
          yield* Effect.annotateCurrentSpan("commitCount", shas.length)

          const concurrency = options?.concurrency ?? 4
          return yield* Effect.forEach(
            shas,
            (sha) =>
              observeCommit(repoPath, sha).pipe(
                Effect.map((result) => ({ sha, result })),
              ),
            { concurrency },
          )
        },
      )

      return ScoringEngineTag.of({
        scoreCommit,
        scoreRange,
        observeCommit,
        observeWorktree,
        observeRange,
      })
    }),
  )

const canUseCurrentWorktreeForCommit = (
  repoPath: string,
  sha: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const head = yield* Effect.either(
      runGit(repoPath, ["rev-parse", "HEAD"], {
        onFail: (message) => new Error(message),
      }),
    )
    if (head._tag === "Left") return false
    if (head.right.trim() !== sha) return false

    const status = yield* Effect.either(
      runGit(
        repoPath,
        [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "--",
          ".",
          ":!.taste-codec/cache",
        ],
        {
          onFail: (message) => new Error(message),
        },
      ),
    )
    if (status._tag === "Left") return false
    return status.right.trim().length === 0
  })

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

/**
 * Acquire a worktree at the given commit. Tears it down on scope exit —
 * whether via normal completion, failure, or interruption.
 */
const acquireWorktree = (
  repoPath: string,
  sha: string,
): Effect.Effect<string, ScoringEngineError, import("effect/Scope").Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const prefix = join(tmpdir(), `taste-codec-worktree-${sha.slice(0, 12)}-`)
      const dir = yield* Effect.tryPromise({
        try: () => mkdtemp(prefix),
        catch: (cause) =>
          new WorktreeCreateFailed({
            repoPath,
            sha,
            message: `mkdtemp failed: ${String(cause)}`,
          }),
      })
      // `git worktree add` requires the target to not exist — mkdtemp
      // just created it, so remove before add.
      yield* Effect.tryPromise({
        try: () => rm(dir, { recursive: true, force: true }),
        catch: (cause) =>
          new WorktreeCreateFailed({
            repoPath,
            sha,
            message: `prep cleanup failed: ${String(cause)}`,
          }),
      })
      yield* runGit(repoPath, ["worktree", "prune"], {
        onFail: (msg) =>
          new WorktreeCreateFailed({
            repoPath,
            sha,
            message: `git worktree prune failed: ${msg}`,
          }),
      })
      yield* runGit(
        repoPath,
        ["worktree", "add", "--detach", "--force", dir, sha],
        {
          onFail: (msg) =>
            new WorktreeCreateFailed({ repoPath, sha, message: msg }),
        },
      )
      return dir
    }),
    (dir) =>
      Effect.gen(function* () {
        // Release must not fail loudly — swallow so interruption still
        // finalizes. We log a warning on remove failure.
        const removed = yield* Effect.either(
          runGit(repoPath, ["worktree", "remove", "--force", dir], {
            onFail: (msg) =>
              new WorktreeRemoveFailed({ worktreePath: dir, message: msg }),
          }),
        )
        if (removed._tag === "Left") {
          yield* Effect.logWarning(
            `worktree remove failed for ${dir}: ${removed.left.message}`,
          )
          // Best-effort filesystem cleanup when `git worktree remove` fails
          // (e.g. the worktree directory is gone already).
          yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
        }
        yield* Effect.either(
          runGit(repoPath, ["worktree", "prune"], {
            onFail: (msg) =>
              new WorktreeRemoveFailed({
                worktreePath: dir,
                message: `git worktree prune failed: ${msg}`,
              }),
          }),
        )
      }),
  )

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `git rev-list <from>..<to> --reverse` — returns commit SHAs in
 * oldest → newest order so score-range streaming mirrors natural history.
 * Includes `to` and excludes `from` (same as git's two-dot range).
 */
const resolveRange = (
  repoPath: string,
  fromSha: string,
  toSha: string,
): Effect.Effect<ReadonlyArray<string>, GitRevListFailed> =>
  Effect.gen(function* () {
    const out = yield* runGit(
      repoPath,
      ["rev-list", "--reverse", `${fromSha}..${toSha}`],
      {
        onFail: (msg) =>
          new GitRevListFailed({ repoPath, fromSha, toSha, message: msg }),
      },
    )
    const shas = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    return shas
  })

// ---------------------------------------------------------------------------
// Git subprocess runner
// ---------------------------------------------------------------------------

interface RunGitOpts<E> {
  readonly onFail: (message: string) => E
}

const runGit = <E>(
  cwd: string,
  args: ReadonlyArray<string>,
  opts: RunGitOpts<E>,
): Effect.Effect<string, E> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("git", args as Array<string>, { cwd })
        let stdout = ""
        let stderr = ""
        const onAbort = () => {
          child.kill("SIGTERM")
        }
        signal.addEventListener("abort", onAbort, { once: true })
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString()
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString()
        })
        child.on("error", (err) => {
          signal.removeEventListener("abort", onAbort)
          reject(err)
        })
        child.on("close", (code) => {
          signal.removeEventListener("abort", onAbort)
          if (code === 0) resolve(stdout)
          else
            reject(
              new Error(
                `git ${args.join(" ")} exited with code ${code}: ${stderr.trim()}`,
              ),
            )
        })
      }),
    catch: (cause) => opts.onFail(cause instanceof Error ? cause.message : String(cause)),
  })
