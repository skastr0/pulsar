import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import type { ChangedHunk } from "./context.js"
import {
  CommitNotFound,
  GitRevListFailed,
  WorktreeCreateFailed,
  WorktreeRemoveFailed,
  type ScoringEngineError,
} from "./errors.js"
import {
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  CANONICAL_GLOSSARY_RELATIVE_PATH,
} from "./reference-data-loader.js"

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
      if (!isPulsarSource(path)) continue
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
      if (!isPulsarSource(path)) continue
      const blobSha = meta.split(" ")[2]
      if (blobSha === undefined) continue
      entriesByPath.set(path, blobSha)
    }

    const changedPaths = yield* collectDirtyPulsarPaths(repoPath)
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
      ":!.pulsar/cache",
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
    isPulsarSource(hunk.file),
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
      ":!.pulsar/cache",
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
          .filter((path) => path.length > 0 && isPulsarSource(path)),
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

/**
 * Resolve `git rev-list <from>..<to> --reverse` — returns commit SHAs in
 * oldest → newest order so score-range streaming mirrors natural history.
 * Includes `to` and excludes `from` (same as git's two-dot range).
 */
export const resolveRange = (
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

const collectDirtyPulsarPaths = Effect.fn("ScoringEngine.collectDirtyPulsarPaths")(
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
        ":!.pulsar/cache",
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
        ":!.pulsar/cache",
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
          .filter((path) => path.length > 0 && isPulsarSource(path)),
      ),
    ].sort((left, right) => left.localeCompare(right))
  },
)

const isPulsarSource = (path: string): boolean =>
  path === CANONICAL_CONVENTIONS_RELATIVE_PATH ||
  path === CANONICAL_GLOSSARY_RELATIVE_PATH ||
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
