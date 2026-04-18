import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Context, Effect, Layer, Option } from "effect"
import {
  InMemoryCacheLayer,
  SignalCacheTag,
  cacheKeyString,
  type CacheKey,
} from "./cache.js"
import {
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
import type { Registry } from "./registry.js"
import { runSignal, type SignalRunResult } from "./runner.js"
import { resolvedConfig as vectorResolvedConfig, type TasteVector } from "./vector.js"

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
 * given commit, filtered to TypeScript source files. Deterministic for
 * a given tree — two commits with identical `.ts`/`.tsx` content share
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
      if (!isTsSource(path)) continue
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

const isTsSource = (path: string): boolean =>
  path.endsWith(".ts") || path.endsWith(".tsx")

/**
 * SHA-256 over the stable JSON encoding of a signal's resolved config.
 * Config changes invalidate the score cache for that signal; content
 * changes invalidate it independently. Keys stay orthogonal.
 */
export const computeConfigHash = (
  signalId: string,
  registry: Registry,
  vector: TasteVector | undefined,
): string => {
  const signal = registry.byId.get(signalId)
  const config = signal
    ? vectorResolvedConfig(signalId, signal.defaultConfig, vector)
    : undefined
  const hash = createHash("sha256")
  hash.update(stableStringify(config ?? null))
  return hash.digest("hex")
}

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

/**
 * Build the scoring engine layer. The registry is frozen at layer
 * construction; the cache is created once and shared across every
 * commit scored by this engine instance.
 */
export const ScoringEngineLayer = (
  registry: Registry,
  packLayerFactory: PackLayerFactory,
  vector?: TasteVector,
): Layer.Layer<ScoringEngineTag> =>
  Layer.effect(
    ScoringEngineTag,
    Effect.gen(function* () {
      const cacheLayer = InMemoryCacheLayer
      // Materialize a single cache instance that persists across calls.
      const cacheRef = yield* Effect.provide(
        Effect.gen(function* () {
          const c = yield* SignalCacheTag
          return c
        }),
        cacheLayer,
      )

      const scoreCommit = Effect.fn("ScoringEngine.scoreCommit")(
        function* (repoPath: string, sha: string, signalId: string) {
          yield* Effect.annotateCurrentSpan("sha", sha)
          yield* Effect.annotateCurrentSpan("signalId", signalId)

          const contentHash = yield* computeContentHash(repoPath, sha)
          const configHash = computeConfigHash(signalId, registry, vector)
          const key: CacheKey = { signalId, contentHash, configHash }

          const cached = yield* cacheRef.get<SignalRunResult>(key)
          if (Option.isSome(cached)) {
            yield* Effect.annotateCurrentSpan("cacheKey", cacheKeyString(key))
            yield* Effect.annotateCurrentSpan("cacheHit", true)
            return cached.value
          }

          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const worktreePath = yield* acquireWorktree(repoPath, sha)
              yield* Effect.annotateCurrentSpan("worktreePath", worktreePath)

              const ContextLayer = Layer.succeed(SignalContextTag, {
                gitSha: sha,
                worktreePath,
                changedHunks: [],
              })
              const ReferenceLayer = Layer.succeed(
                ReferenceDataTag,
                makeReferenceData(new Map()),
              )
              const CacheShareLayer = Layer.succeed(SignalCacheTag, cacheRef)
              const PackLayer = packLayerFactory(worktreePath)
              const EnvLayer = Layer.mergeAll(
                ContextLayer,
                ReferenceLayer,
                CacheShareLayer,
                PackLayer,
              )

              const ran = yield* (
                Effect.provide(runSignal(registry, signalId, vector), EnvLayer) as Effect.Effect<
                  SignalRunResult,
                  SignalError,
                  never
                >
              )
              return ran
            }),
          )

          yield* cacheRef.set(key, result)
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

      return ScoringEngineTag.of({ scoreCommit, scoreRange })
    }),
  )

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
