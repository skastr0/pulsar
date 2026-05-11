import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { CommitNotFound } from "./errors.js"
import { isPulsarSource } from "./scoring-engine-git-paths.js"
import { runGit } from "./scoring-engine-git-run.js"

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

export const computeWorktreeContentHash = Effect.fn(
  "ScoringEngine.computeWorktreeContentHash",
)(function* (repoPath: string) {
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
})

export const computeGitRevisionContextHash = Effect.fn(
  "ScoringEngine.computeGitRevisionContextHash",
)(function* (repoPath: string) {
  const facts: Array<string> = []
  const head = yield* optionalGit(repoPath, ["rev-parse", "HEAD"])
  facts.push(`head=${head ?? "missing"}`)

  const branch = yield* optionalGit(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  facts.push(`branch=${branch ?? "detached"}`)

  const upstream = yield* optionalGit(repoPath, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ])
  facts.push(`upstream=${upstream ?? "none"}`)

  if (upstream !== undefined) {
    const upstreamSha = yield* optionalGit(repoPath, ["rev-parse", upstream])
    const mergeBase = yield* optionalGit(repoPath, ["merge-base", "HEAD", upstream])
    facts.push(`upstreamSha=${upstreamSha ?? "missing"}`)
    facts.push(`mergeBase=${mergeBase ?? "missing"}`)
  }

  const hash = createHash("sha256")
  hash.update(facts.join("\n"))
  return hash.digest("hex")
})

const optionalGit = (
  repoPath: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const result = yield* Effect.either(
      runGit(repoPath, args, { onFail: (message) => new Error(message) }),
    )
    if (result._tag === "Left") return undefined
    const value = result.right.trim()
    return value.length === 0 ? undefined : value
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
