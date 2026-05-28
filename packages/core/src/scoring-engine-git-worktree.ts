import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { Effect } from "effect"
import {
  WorktreeCreateFailed,
  WorktreeRemoveFailed,
  type ScoringEngineError,
} from "./errors.js"
import { hasNodeErrorCode } from "./node-error.js"
import { runGit } from "./scoring-engine-git-run.js"

export const canUseCurrentWorktreeForCommit = (
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
          ":!.pulsar/cache",
        ],
        {
          onFail: (message) => new Error(message),
        },
      ),
    )
    if (status._tag === "Left") return false
    return status.right.trim().length === 0
  })

/**
 * Acquire a worktree at the given commit. Tears it down on scope exit —
 * whether via normal completion, failure, or interruption.
 */
export const acquireWorktree = (
  repoPath: string,
  sha: string,
): Effect.Effect<string, ScoringEngineError, import("effect/Scope").Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const prefix = join(tmpdir(), `pulsar-worktree-${sha.slice(0, 12)}-`)
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
      yield* Effect.tryPromise({
        try: () => linkDependencyDirectories(repoPath, dir),
        catch: (cause) =>
          new WorktreeCreateFailed({
            repoPath,
            sha,
            message: `dependency link failed: ${String(cause)}`,
          }),
      })
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

const linkDependencyDirectories = async (
  repoPath: string,
  worktreePath: string,
): Promise<void> => {
  const dependencyDirs = await collectDependencyDirectories(repoPath)
  for (const dependencyDir of dependencyDirs) {
    await linkDependencyDirectory(repoPath, worktreePath, dependencyDir)
  }
}

const linkDependencyDirectory = async (
  repoPath: string,
  worktreePath: string,
  dependencyDir: string,
): Promise<void> => {
  const target = join(worktreePath, relative(repoPath, dependencyDir))
  await mkdir(dirname(target), { recursive: true })
  try {
    await symlink(dependencyDir, target, "dir")
  } catch (cause) {
    if (!hasNodeErrorCode(cause, "EEXIST")) throw cause
  }
}

const collectDependencyDirectories = async (repoPath: string): Promise<ReadonlyArray<string>> => {
  const directories: Array<string> = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (entry.name === "node_modules") {
        directories.push(path)
        continue
      }
      if (SKIPPED_DEPENDENCY_SCAN_DIRS.has(entry.name)) continue
      await visit(path, depth + 1)
    }
  }
  await visit(repoPath, 0)
  return directories.sort((left, right) => left.localeCompare(right))
}

const SKIPPED_DEPENDENCY_SCAN_DIRS = new Set([
  ".git",
  ".pulsar",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
])
