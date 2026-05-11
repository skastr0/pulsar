import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { simpleGit } from "simple-git"

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
