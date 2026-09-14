import { collectGitStdout, forEachGitLine } from "./shared-git.js"
import {
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"

export const readHeadDate = async (repoPath: string): Promise<Date> => {
  const raw = await execGit(repoPath, ["log", "-1", "--format=%cI", "HEAD"])
  return new Date(raw.trim())
}

export const listTrackedFiles = async (
  repoPath: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyArray<string>> => {
  const files: Array<string> = []
  await forEachGitLine(repoPath, ["ls-files"], (line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    if (!isIncludedHistoryPath(trimmed, config)) return
    files.push(trimmed)
  })
  return files
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
  } catch (error) {
    if (isGitMissingPathError(error, relativePath)) return undefined
    throw error
  }
}

const isGitMissingPathError = (error: unknown, relativePath: string): boolean => {
  const text = errorMessage(error)
  return (
    text.includes(`Path '${relativePath}' exists on disk, but not in`) ||
    text.includes(`path '${relativePath}' does not exist in`) ||
    text.includes(`Path '${relativePath}' does not exist in`) ||
    text.includes("exists on disk, but not in")
  )
}

const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === "string" && stderr.length > 0) return stderr
  }
  return String(error)
}

export const execGit = (
  repoPath: string,
  args: ReadonlyArray<string>,
): Promise<string> => collectGitStdout(repoPath, args)
