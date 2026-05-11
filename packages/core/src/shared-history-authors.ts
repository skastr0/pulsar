import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  isIncludedHistoryPath,
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
  const raw = await execGit(repoPath, [
    "log",
    "--use-mailmap",
    ...(config.maxCommits !== undefined && config.maxCommits > 0
      ? [`--max-count=${Math.floor(config.maxCommits)}`]
      : []),
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--name-only",
    "--format=__commit__%x00%aN <%aE>",
  ])

  let currentAuthor: string | undefined
  const byFile = new Map<string, Array<string>>()
  const filesInCommit = new Set<string>()

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
    if (!isIncludedHistoryPath(trimmed, config)) continue
    filesInCommit.add(trimmed)
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

export const normalizeAuthorKey = (value: string): string =>
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
