import { join } from "node:path"
import {
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
import { forEachGitLine } from "./shared-git.js"

export interface SharedHistoryTouchedCommit {
  readonly sha: string
  readonly committedAt: Date
  readonly files: ReadonlyArray<string>
}

export const listTouchedCommitsInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyArray<SharedHistoryTouchedCommit>> => {
  const maxCommits = Math.max(1, Math.floor(config.maxCommits ?? 500))
  const pathspecs = sourcePathspecs(config.includeExtensions)
  const commits: Array<SharedHistoryTouchedCommit> = []
  let current:
    | {
        readonly sha: string
        readonly committedAt: Date
        readonly files: Set<string>
      }
    | undefined

  const flush = (): void => {
    if (current === undefined) return
    if (current.files.size === 0) return
    commits.push({
      sha: current.sha,
      committedAt: current.committedAt,
      files: [...current.files].sort((left, right) => left.localeCompare(right)),
    })
  }

  await forEachGitLine(repoPath, [
    "log",
    "--no-merges",
    `--max-count=${maxCommits}`,
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--format=__commit__%x00%H%x00%cI",
    "--name-only",
    "--find-renames=100%",
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  ], (line) => {
    if (line.startsWith("__commit__\0")) {
      flush()
      const [, sha, committedAt] = line.split("\0")
      current = {
        sha: sha ?? "",
        committedAt: new Date(committedAt ?? ""),
        files: new Set<string>(),
      }
      return
    }

    const relativePath = line.trim()
    if (relativePath.length === 0 || current === undefined) return
    if (!isIncludedHistoryPath(relativePath, config)) return
    current.files.add(join(repoPath, relativePath))
  })
  flush()

  return commits
}
