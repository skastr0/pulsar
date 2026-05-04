import { execFile } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { matchesAnyGlob } from "./globs.js"

const execFileAsync = promisify(execFile)

export interface SharedHistoryFilterConfig {
  readonly includeExtensions: ReadonlyArray<string>
  readonly excludeGlobs: ReadonlyArray<string>
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

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

export const listAuthorsByTouchedFileInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> => {
  const raw = await execGit(repoPath, [
    "log",
    "--use-mailmap",
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
    if (!hasIncludedExtension(trimmed, config.includeExtensions)) continue
    if (matchesAnyGlob(trimmed, config.excludeGlobs)) continue
    filesInCommit.add(trimmed)
  }

  flushCommit()
  return byFile
}

export const listAddedLinesByFileInMatureWindow = async (
  repoPath: string,
  introductionStartIso: string,
  maturityCutoffIso: string,
  horizonEndIso: string,
  config: SharedHistoryFilterConfig,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> => {
  const pathspecs = sourcePathspecs(config.includeExtensions)
  const raw = await execGit(repoPath, [
    "log",
    "--no-merges",
    `--since=${introductionStartIso}`,
    `--until=${horizonEndIso}`,
    "--format=__commit__%x00%cI",
    "--unified=0",
    "--no-ext-diff",
    "--find-renames=100%",
    "-p",
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  ])

  const maturityCutoffTime = new Date(maturityCutoffIso).getTime()
  const addedByFile = new Map<string, Array<string>>()
  const renameMap = new Map<string, string>()
  let commitAddsEligible = false
  let currentFile: string | undefined
  let pendingRenameFrom: string | undefined

  for (const line of raw.split("\n")) {
    if (line.startsWith("__commit__\0")) {
      const dateIso = line.slice("__commit__\0".length).trim()
      commitAddsEligible = new Date(dateIso).getTime() <= maturityCutoffTime
      currentFile = undefined
      pendingRenameFrom = undefined
      continue
    }

    if (line.startsWith("diff --git ")) {
      currentFile = parseDiffTargetPath(line)
      pendingRenameFrom = undefined
      continue
    }

    if (line.startsWith("rename from ")) {
      pendingRenameFrom = line.slice("rename from ".length).trim()
      continue
    }

    if (line.startsWith("rename to ")) {
      const renamedTo = line.slice("rename to ".length).trim()
      if (pendingRenameFrom !== undefined && renamedTo.length > 0) {
        renameMap.set(pendingRenameFrom, renamedTo)
      }
      pendingRenameFrom = undefined
      continue
    }

    if (!commitAddsEligible) continue
    if (currentFile === undefined) continue
    if (!hasIncludedExtension(currentFile, config.includeExtensions)) continue
    if (matchesAnyGlob(currentFile, config.excludeGlobs)) continue
    if (!line.startsWith("+") || line.startsWith("+++")) continue

    const content = line.slice(1)
    if (content.trim().length === 0) continue
    const lines = addedByFile.get(currentFile) ?? []
    lines.push(content)
    addedByFile.set(currentFile, lines)
  }

  const remapped = new Map<string, Array<string>>()
  for (const [file, lines] of addedByFile) {
    const currentFilePath = resolveRename(file, renameMap)
    if (!hasIncludedExtension(currentFilePath, config.includeExtensions)) continue
    if (matchesAnyGlob(currentFilePath, config.excludeGlobs)) continue
    const existing = remapped.get(currentFilePath) ?? []
    existing.push(...lines)
    remapped.set(currentFilePath, existing)
  }

  return remapped
}

export const listAddedLineCountInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
  config: SharedHistoryFilterConfig,
): Promise<number> => {
  const pathspecs = sourcePathspecs(config.includeExtensions)
  const raw = await execGit(repoPath, [
    "log",
    "--no-merges",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--pretty=format:__commit__",
    "--numstat",
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  ])

  let total = 0
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed === "__commit__") continue
    const [addedRaw, , file] = trimmed.split(/\s+/, 3)
    if (addedRaw === undefined || file === undefined || addedRaw === "-") continue
    if (!hasIncludedExtension(file, config.includeExtensions)) continue
    if (matchesAnyGlob(file, config.excludeGlobs)) continue
    const added = Number.parseInt(addedRaw, 10)
    if (Number.isFinite(added)) total += added
  }
  return total
}

export const countCommitsInWindow = async (
  repoPath: string,
  sinceIso: string,
  untilIso: string,
): Promise<number> => {
  const raw = await execGit(repoPath, [
    "rev-list",
    "--count",
    "--no-merges",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "HEAD",
    "--",
  ])
  const count = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(count) ? count : 0
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

const parseDiffTargetPath = (line: string): string | undefined => {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
  return match?.[2]
}

const resolveRename = (
  file: string,
  renameMap: ReadonlyMap<string, string>,
): string => {
  let current = file
  const seen = new Set<string>()

  while (!seen.has(current)) {
    seen.add(current)
    const next = renameMap.get(current)
    if (next === undefined) return current
    current = next
  }

  return current
}

const sourcePathspecs = (
  includeExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  includeExtensions.flatMap((extension) => [
    `:(glob)*${extension}`,
    `:(glob)**/*${extension}`,
  ])
