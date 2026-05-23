import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
import { fileExists } from "./shared-history-files.js"
import { execGit } from "./shared-history-git.js"

export const listAuthorsByTouchedFileInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> => {
  const pathspecs = sourcePathspecs(config.includeExtensions)
  if (pathspecs.length === 0) {
    return new Map()
  }

  const raw = await execGit(repoPath, [
    "log",
    "--use-mailmap",
    ...(config.maxCommits !== undefined && config.maxCommits > 0
      ? [`--max-count=${Math.floor(config.maxCommits)}`]
      : []),
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--name-status",
    "--find-renames=100%",
    "--diff-filter=ACMRT",
    "--format=__commit__%x00%aN <%aE>",
    "--",
    ...pathspecs,
  ])

  let currentAuthor: string | undefined
  const byFile = new Map<string, Array<string>>()
  const filesInCommit = new Set<string>()
  const renameTargets = new Map<string, string>()

  const resolvePath = (path: string): string => {
    let current = path
    const seen = new Set<string>()
    while (!seen.has(current)) {
      seen.add(current)
      const target = renameTargets.get(current)
      if (target === undefined) return current
      current = target
    }
    return current
  }

  const flushCommit = (): void => {
    if (currentAuthor === undefined) return
    for (const file of filesInCommit) {
      const authors = byFile.get(file) ?? []
      authors.push(currentAuthor)
      byFile.set(file, authors)
    }
    filesInCommit.clear()
  }

  for (const line of raw.split("\n")) {
    if (line.startsWith("__commit__\0")) {
      flushCommit()
      currentAuthor = line.slice("__commit__\0".length).trim()
      continue
    }

    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [status = "", firstPath = "", secondPath = ""] = trimmed.split("\t")
    if (firstPath.length === 0) continue

    if (status.startsWith("R")) {
      if (secondPath.length === 0) continue
      const currentPath = resolvePath(secondPath)
      if (isIncludedHistoryPath(currentPath, config)) {
        renameTargets.set(firstPath, currentPath)
      }
      continue
    }

    const currentPath = resolvePath(status.startsWith("C") && secondPath.length > 0
      ? secondPath
      : firstPath)
    if (!isIncludedHistoryPath(currentPath, config)) continue
    filesInCommit.add(currentPath)
  }

  flushCommit()
  return byFile
}

export const loadAuthorAliases = async (
  repoPath: string,
): Promise<ReadonlyMap<string, string>> => {
  const filePath = join(repoPath, ".pulsar", "author-aliases.json")
  if (!(await fileExists(filePath))) {
    return new Map()
  }

  const raw = await readFile(filePath, "utf8")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const aliases = new Map<string, string>()

  for (const [alias, canonical] of Object.entries(parsed)) {
    if (typeof canonical !== "string") continue
    aliases.set(normalizeAuthorKey(alias), canonical.trim())
  }

  return aliases
}

const normalizeAuthorKey = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLowerCase()

export const normalizeAuthor = (
  rawAuthor: string,
  aliases: ReadonlyMap<string, string>,
): string => {
  const trimmed = rawAuthor.trim().replace(/\s+/g, " ")
  const nameOnly = trimmed.replace(/\s*<[^>]+>\s*$/, "").trim()
  const emailOnly = /<([^>]+)>/.exec(trimmed)?.[1]?.trim()
  const candidates = [trimmed, nameOnly, emailOnly]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .map(normalizeAuthorKey)

  for (const candidate of candidates) {
    const alias = aliases.get(candidate)
    if (alias !== undefined) return alias
  }

  return nameOnly.length > 0 ? nameOnly : trimmed
}
