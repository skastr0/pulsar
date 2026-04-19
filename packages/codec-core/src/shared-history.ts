import { execFile } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface SharedHistoryFilterConfig {
  readonly includeExtensions: ReadonlyArray<string>
  readonly excludeGlobs: ReadonlyArray<string>
}

export interface FileHistoryEntry {
  readonly sha: string
  readonly date: Date
  readonly pathAtCommit: string
  readonly renameOnly: boolean
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export const matchesGlob = (path: string, glob: string): boolean => {
  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  return regex.test(path)
}

export const matchesAnyGlob = (
  path: string,
  globs: ReadonlyArray<string>,
): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

export const hasIncludedExtension = (
  path: string,
  includeExtensions: ReadonlyArray<string>,
): boolean => includeExtensions.some((extension) => path.endsWith(extension))

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
    .filter((line) => hasIncludedExtension(line, config.includeExtensions))
    .filter((line) => !matchesAnyGlob(line, config.excludeGlobs))
}

export const listTouchedFilesInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyArray<string>> => {
  const raw = await execGit(repoPath, [
    "log",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--name-only",
    "--pretty=format:__commit__",
  ])
  const files = new Set<string>()
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed === "__commit__") continue
    if (!hasIncludedExtension(trimmed, config.includeExtensions)) continue
    if (matchesAnyGlob(trimmed, config.excludeGlobs)) continue
    files.add(trimmed)
  }
  return [...files].sort()
}

export const countFileLoc = async (absolutePath: string): Promise<number> => {
  const raw = await readFile(absolutePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
}

export const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await access(absolutePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export const loadAuthorAliases = async (
  repoPath: string,
): Promise<ReadonlyMap<string, string>> => {
  const filePath = join(repoPath, ".taste-codec", "author-aliases.json")
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

export const listAuthorsForFileInWindow = async (
  repoPath: string,
  relativePath: string,
  sinceIso: string,
  untilIso: string,
): Promise<ReadonlyArray<string>> => {
  const raw = await execGit(repoPath, [
    "log",
    "--follow",
    "--use-mailmap",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--format=%aN <%aE>",
    "--",
    relativePath,
  ])

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export const readFileHistory = async (
  repoPath: string,
  currentRelativePath: string,
): Promise<ReadonlyArray<FileHistoryEntry>> => {
  const raw = await execGit(repoPath, [
    "log",
    "--follow",
    "--no-merges",
    "--format=__commit__%H\t%cI",
    "--name-status",
    "--",
    currentRelativePath,
  ])

  let activePath = currentRelativePath
  let currentSha: string | undefined
  let currentDate: Date | undefined
  let currentNameStatus: Array<string> = []
  const entries: Array<FileHistoryEntry> = []

  const finalizeCurrent = (): void => {
    if (currentSha === undefined || currentDate === undefined) return
    entries.push({
      sha: currentSha,
      date: currentDate,
      pathAtCommit: activePath,
      renameOnly: currentNameStatus.length === 1 && currentNameStatus[0]?.startsWith("R") === true,
    })
    const renamedFrom = findRenameSource(currentNameStatus, activePath)
    if (renamedFrom !== undefined) {
      activePath = renamedFrom
    }
  }

  for (const line of raw.split("\n")) {
    if (line.startsWith("__commit__")) {
      finalizeCurrent()
      const meta = line.slice("__commit__".length).split("\t")
      currentSha = meta[0]?.trim()
      currentDate = new Date(meta[1]?.trim() ?? "")
      currentNameStatus = []
      continue
    }

    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    currentNameStatus.push(trimmed)
  }

  finalizeCurrent()
  return entries.reverse()
}

export const latestHistoryEntryAtOrBefore = (
  history: ReadonlyArray<FileHistoryEntry>,
  cutoff: Date,
): FileHistoryEntry | undefined => {
  let chosen: FileHistoryEntry | undefined
  for (const entry of history) {
    if (entry.date.getTime() <= cutoff.getTime()) {
      chosen = entry
      continue
    }
    break
  }
  return chosen
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

export const readAddedLinesForCommit = async (
  repoPath: string,
  sha: string,
  relativePath: string,
): Promise<ReadonlyArray<string>> => {
  const raw = await execGit(repoPath, [
    "show",
    "--format=",
    "--unified=0",
    "--no-ext-diff",
    "--find-renames=100%",
    sha,
    "--",
    relativePath,
  ])

  if (raw.includes("Binary files")) {
    return []
  }

  const added: Array<string> = []
  for (const line of raw.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue
    const content = line.slice(1)
    if (content.trim().length === 0) continue
    added.push(content)
  }
  return added
}

export const execGit = async (
  repoPath: string,
  args: ReadonlyArray<string>,
): Promise<string> => {
  const result = await execFileAsync("git", [...args], { cwd: repoPath })
  return result.stdout
}

const findRenameSource = (
  nameStatusLines: ReadonlyArray<string>,
  currentPath: string,
): string | undefined => {
  for (const line of nameStatusLines) {
    const parts = line.split("\t")
    if (parts.length < 3) continue
    if (!parts[0]?.startsWith("R")) continue
    const from = parts[1]?.trim()
    const to = parts[2]?.trim()
    if (from === undefined || to === undefined) continue
    if (to === currentPath) return from
  }
  return undefined
}
