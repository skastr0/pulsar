import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import type { ChangedHunk } from "./context.js"
import { CommitNotFound } from "./errors.js"
import { isPulsarSource } from "./scoring-engine-git-paths.js"
import { runGit } from "./scoring-engine-git-run.js"

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

export const collectChangedHunksForRange = Effect.fn(
  "ScoringEngine.collectChangedHunksForRange",
)(function* (repoPath: string, fromRef: string, toRef: string) {
  const diff = yield* runGit(
    repoPath,
    [
      "diff",
      "--unified=0",
      "--no-ext-diff",
      fromRef,
      toRef,
      "--",
      ".",
      ":!.pulsar/cache",
    ],
    {
      onFail: (msg) =>
        new CommitNotFound({
          repoPath,
          sha: `${fromRef}..${toRef}`,
          message: `git diff ${fromRef} ${toRef} failed: ${msg}`,
        }),
    },
  )
  return parseChangedHunksFromUnifiedDiff(diff).filter((hunk) =>
    isPulsarSource(hunk.file),
  )
})

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
