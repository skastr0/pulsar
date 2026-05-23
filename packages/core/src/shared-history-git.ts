import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"

const execFileAsync = promisify(execFile)

export const readHeadDate = async (repoPath: string): Promise<Date> => {
  const raw = await execGit(repoPath, ["log", "-1", "--format=%cI", "HEAD"])
  return new Date(raw.trim())
}

export const listTrackedFiles = async (
  repoPath: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyArray<string>> => {
  const raw = await execGit(repoPath, ["ls-files"])
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => isIncludedHistoryPath(line, config))
}

export const countCommitsInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config?: SharedHistoryFilterConfig,
): Promise<number> => {
  const pathspecs = config === undefined ? [] : sourcePathspecs(config.includeExtensions)
  if (config !== undefined && pathspecs.length === 0) return 0

  const raw = await execGit(repoPath, [
    "rev-list",
    "--count",
    "--no-merges",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "HEAD",
    "--",
    ...pathspecs,
  ])
  const count = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(count) ? count : 0
}

export const readFileAtCommit = async (
  repoPath: string,
  sha: string,
  relativePath: string,
): Promise<string | undefined> => {
  try {
    return await execGit(repoPath, ["show", `${sha}:${relativePath}`])
  } catch {
    return undefined
  }
}

export const execGit = async (
  repoPath: string,
  args: ReadonlyArray<string>,
): Promise<string> => {
  const result = await execFileAsync("git", [...args], {
    cwd: repoPath,
    maxBuffer: 256 * 1024 * 1024,
  })
  return result.stdout
}
