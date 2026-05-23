import {
  hasIncludedExtension,
  isIncludedHistoryPath,
  sourcePathspecs,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
import { execGit } from "./shared-history-git.js"
import { matchesAnyGlob } from "./globs.js"

interface MaturePatchCursor {
  commitAddsEligible: boolean
  currentFile: string | undefined
  pendingRenameFrom: string | undefined
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
    "--find-renames",
    "-p",
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  ])

  return parseMatureAddedLinesByFile(
    raw,
    new Date(maturityCutoffIso).getTime(),
    config,
  )
}

const parseMatureAddedLinesByFile = (
  rawPatchLog: string,
  maturityCutoffTime: number,
  config: SharedHistoryFilterConfig,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const addedByFile = new Map<string, Array<string>>()
  const renameMap = new Map<string, string>()
  const cursor: MaturePatchCursor = {
    commitAddsEligible: false,
    currentFile: undefined,
    pendingRenameFrom: undefined,
  }

  for (const line of rawPatchLog.split("\n")) {
    consumeMaturePatchLine(line, cursor, maturityCutoffTime, config, addedByFile, renameMap)
  }

  return remapAddedLinesByCurrentPath(addedByFile, renameMap, config)
}

const consumeMaturePatchLine = (
  line: string,
  cursor: MaturePatchCursor,
  maturityCutoffTime: number,
  config: SharedHistoryFilterConfig,
  addedByFile: Map<string, Array<string>>,
  renameMap: Map<string, string>,
): void => {
  if (line.startsWith("__commit__\0")) {
    startMaturePatchCommit(cursor, line, maturityCutoffTime)
    return
  }
  if (line.startsWith("diff --git ")) {
    cursor.currentFile = parseDiffTargetPath(line)
    cursor.pendingRenameFrom = undefined
    return
  }
  if (line.startsWith("rename from ")) {
    cursor.pendingRenameFrom = line.slice("rename from ".length).trim()
    return
  }
  if (line.startsWith("rename to ")) {
    recordMaturePatchRename(cursor, line, renameMap)
    return
  }
  recordMaturePatchAddedLine(line, cursor, config, addedByFile)
}

const startMaturePatchCommit = (
  cursor: MaturePatchCursor,
  line: string,
  maturityCutoffTime: number,
): void => {
  const dateIso = line.slice("__commit__\0".length).trim()
  cursor.commitAddsEligible = new Date(dateIso).getTime() <= maturityCutoffTime
  cursor.currentFile = undefined
  cursor.pendingRenameFrom = undefined
}

const recordMaturePatchRename = (
  cursor: MaturePatchCursor,
  line: string,
  renameMap: Map<string, string>,
): void => {
  const renamedTo = line.slice("rename to ".length).trim()
  if (cursor.pendingRenameFrom !== undefined && renamedTo.length > 0) {
    renameMap.set(cursor.pendingRenameFrom, renamedTo)
  }
  cursor.pendingRenameFrom = undefined
}

const recordMaturePatchAddedLine = (
  line: string,
  cursor: MaturePatchCursor,
  config: SharedHistoryFilterConfig,
  addedByFile: Map<string, Array<string>>,
): void => {
  if (cursor.currentFile === undefined) return
  if (!isEligibleMatureAddedLine(line, cursor, config)) return

  const content = line.slice(1)
  const lines = addedByFile.get(cursor.currentFile) ?? []
  lines.push(content)
  addedByFile.set(cursor.currentFile, lines)
}

const isEligibleMatureAddedLine = (
  line: string,
  cursor: MaturePatchCursor,
  config: SharedHistoryFilterConfig,
): boolean =>
  cursor.commitAddsEligible &&
  cursor.currentFile !== undefined &&
  isIncludedHistoryPath(cursor.currentFile, config) &&
  line.startsWith("+") &&
  !line.startsWith("+++") &&
  line.slice(1).trim().length > 0

const remapAddedLinesByCurrentPath = (
  addedByFile: ReadonlyMap<string, ReadonlyArray<string>>,
  renameMap: ReadonlyMap<string, string>,
  config: SharedHistoryFilterConfig,
): ReadonlyMap<string, ReadonlyArray<string>> => {
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
    if (!isIncludedHistoryPath(file, config)) continue
    const added = Number.parseInt(addedRaw, 10)
    if (Number.isFinite(added)) total += added
  }
  return total
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
