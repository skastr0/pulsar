import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
import { fileExists } from "./shared-history-files.js"
import { execGit } from "./shared-history-git.js"
import { resolveCurrentHistoryPath } from "./shared-history-renames.js"

const COMMIT_AUTHOR_PREFIX = "__commit__\0"

interface AuthorLogParseState {
  currentAuthor: string | undefined
  readonly byFile: Map<string, Array<string>>
  readonly filesInCommit: Set<string>
  readonly renameTargets: Map<string, string>
}

interface NameStatusEntry {
  readonly status: string
  readonly firstPath: string
  readonly secondPath: string
}

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

  const raw = await execGit(
    repoPath,
    authorHistoryLogArgs(config, sinceIso, untilIso, pathspecs),
  )
  return collectTouchedFileAuthorsFromLog(raw, config)
}

const authorHistoryLogArgs = (
  config: SharedHistoryFilterConfig,
  sinceIso: string,
  untilIso: string,
  pathspecs: ReadonlyArray<string>,
): ReadonlyArray<string> => [
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
]

const collectTouchedFileAuthorsFromLog = (
  raw: string,
  config: SharedHistoryFilterConfig,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const state = createAuthorLogParseState()
  for (const line of raw.split("\n")) {
    ingestAuthorHistoryLine(state, line, config)
  }
  flushAuthorCommit(state)
  return state.byFile
}

const createAuthorLogParseState = (): AuthorLogParseState => ({
  currentAuthor: undefined,
  byFile: new Map(),
  filesInCommit: new Set(),
  renameTargets: new Map(),
})

const ingestAuthorHistoryLine = (
  state: AuthorLogParseState,
  line: string,
  config: SharedHistoryFilterConfig,
): void => {
  if (line.startsWith(COMMIT_AUTHOR_PREFIX)) {
    flushAuthorCommit(state)
    state.currentAuthor = line.slice(COMMIT_AUTHOR_PREFIX.length).trim()
    return
  }

  const entry = parseNameStatusEntry(line)
  if (entry === undefined) return
  if (entry.status.startsWith("R")) {
    recordRenameTarget(state, entry, config)
    return
  }
  recordTouchedPath(state, entry, config)
}

const flushAuthorCommit = (state: AuthorLogParseState): void => {
  if (state.currentAuthor === undefined) return
  for (const file of state.filesInCommit) {
    const authors = state.byFile.get(file) ?? []
    authors.push(state.currentAuthor)
    state.byFile.set(file, authors)
  }
  state.filesInCommit.clear()
}

const parseNameStatusEntry = (line: string): NameStatusEntry | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  const [status = "", firstPath = "", secondPath = ""] = trimmed.split("\t")
  if (firstPath.length === 0) return undefined
  return { status, firstPath, secondPath }
}

const recordRenameTarget = (
  state: AuthorLogParseState,
  entry: NameStatusEntry,
  config: SharedHistoryFilterConfig,
): void => {
  if (entry.secondPath.length === 0) return
  const currentPath = resolveCurrentHistoryPath(entry.secondPath, state.renameTargets)
  if (isIncludedHistoryPath(currentPath, config)) {
    state.renameTargets.set(entry.firstPath, currentPath)
  }
}

const recordTouchedPath = (
  state: AuthorLogParseState,
  entry: NameStatusEntry,
  config: SharedHistoryFilterConfig,
): void => {
  const candidatePath =
    entry.status.startsWith("C") && entry.secondPath.length > 0
      ? entry.secondPath
      : entry.firstPath
  const currentPath = resolveCurrentHistoryPath(candidatePath, state.renameTargets)
  if (isIncludedHistoryPath(currentPath, config)) {
    state.filesInCommit.add(currentPath)
  }
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
