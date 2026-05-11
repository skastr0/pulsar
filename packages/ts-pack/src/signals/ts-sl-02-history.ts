import { mapWithConcurrency } from "@skastr0/pulsar-core/signal"
import { simpleGit } from "simple-git"
import type { CloneGroup } from "./ts-sl-01-model.js"
import type { CloneMember } from "./ts-sl-02-inconsistent-clones.js"

type GitClient = ReturnType<typeof simpleGit>

export type CloneMemberWithHistory = Omit<CloneMember, "historyStatus"> & {
  readonly historyStatus: "ok" | "unknown"
  readonly timestamp: number
}

type CloneHistoryJob = {
  readonly group: CloneGroup
  readonly member: CloneGroup["members"][number]
}

type CloneHistoryResult = {
  readonly groupId: string
  readonly member: CloneMemberWithHistory
}

export const loadCloneHistoryByGroup = async (
  git: GitClient,
  worktreePath: string,
  groupsToAnalyze: ReadonlyArray<CloneGroup>,
  memberLimit: number,
): Promise<ReadonlyMap<string, ReadonlyArray<CloneMemberWithHistory>>> => {
  const historyResults = await loadCloneHistory(git, worktreePath, groupsToAnalyze, memberLimit)
  const membersByGroup = new Map<string, Array<CloneMemberWithHistory>>()
  for (const result of historyResults) {
    const existing = membersByGroup.get(result.groupId) ?? []
    existing.push(result.member)
    membersByGroup.set(result.groupId, existing)
  }
  return membersByGroup
}

export const getReferenceTime = async (
  git: GitClient,
  gitSha: string,
): Promise<number> => {
  try {
    const raw = await git.raw(["show", "-s", "--format=%ct", gitSha])
    const timestampSeconds = Number(raw.trim())
    if (Number.isFinite(timestampSeconds)) return timestampSeconds * 1000
  } catch {
    // Fall back to wall-clock time only when HEAD metadata is unavailable.
  }
  return Date.now()
}

export const calculateDistribution = (
  values: ReadonlyArray<number>,
): { min: number; max: number; mean: number; median: number } => {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const mean = values.reduce((a, b) => a + b, 0) / values.length

  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!

  return { min, max, mean, median }
}

const loadCloneHistory = async (
  git: GitClient,
  worktreePath: string,
  groupsToAnalyze: ReadonlyArray<CloneGroup>,
  memberLimit: number,
): Promise<Array<CloneHistoryResult>> => {
  const historyCache = new Map<string, Promise<HistoryResult>>()
  const jobs = groupsToAnalyze.flatMap((group) =>
    group.members.slice(0, memberLimit).map((member) => ({ group, member })),
  )

  return mapWithConcurrency(jobs, 4, (job) =>
    loadCloneMemberHistory(git, worktreePath, historyCache, job),
  )
}

const loadCloneMemberHistory = async (
  git: GitClient,
  worktreePath: string,
  historyCache: Map<string, Promise<HistoryResult>>,
  { group, member }: CloneHistoryJob,
): Promise<CloneHistoryResult> => {
  const cacheKey = `${member.file}:${member.startLine}:${member.endLine}`
  const history = await getOrCreate(historyCache, cacheKey, () =>
    getLastModifiedForRange(git, member.file, member.startLine, member.endLine, worktreePath),
  )

  return {
    groupId: group.groupId,
    member: {
      file: member.file,
      ...(member.name !== undefined ? { name: member.name } : {}),
      startLine: member.startLine,
      endLine: member.endLine,
      lastModifiedSha: history.sha,
      lastModifiedAt: history.date,
      historyStatus: history.status,
      timestamp: new Date(history.date).getTime(),
    },
  }
}

const getLastModifiedForRange = async (
  git: GitClient,
  filePath: string,
  startLine: number,
  endLine: number,
  worktreePath: string,
): Promise<HistoryResult> => {
  try {
    const relPath = filePath.startsWith(worktreePath) ? filePath.slice(worktreePath.length + 1) : filePath

    const blame = await git.raw([
      "blame",
      "-L",
      `${startLine},${endLine}`,
      "--porcelain",
      "--",
      relPath,
    ])

    const latest = parseLatestBlameRecord(blame)
    if (latest === undefined) {
      return unknownHistory()
    }

    return { ...latest, status: "ok" }
  } catch {
    return unknownHistory()
  }
}

interface HistoryResult {
  readonly sha: string
  readonly date: string
  readonly status: "ok" | "unknown"
}

const unknownHistory = (): HistoryResult => ({
  sha: "unknown",
  date: "1970-01-01T00:00:00.000Z",
  status: "unknown",
})

const parseLatestBlameRecord = (blame: string): { sha: string; date: string } | undefined => {
  let currentSha: string | undefined
  let latest: { sha: string; timestampSeconds: number } | undefined

  for (const line of blame.split("\n")) {
    const shaMatch = /^([0-9a-f]{40})\s/.exec(line)
    if (shaMatch !== null) {
      currentSha = shaMatch[1]
      continue
    }

    if (!line.startsWith("committer-time ") && !line.startsWith("author-time ")) continue
    if (currentSha === undefined) continue
    const timestampSeconds = Number(line.slice(line.indexOf(" ") + 1))
    if (!Number.isFinite(timestampSeconds)) continue
    if (latest === undefined || timestampSeconds > latest.timestampSeconds) {
      latest = { sha: currentSha, timestampSeconds }
    }
  }

  if (latest === undefined) return undefined
  return {
    sha: latest.sha,
    date: new Date(latest.timestampSeconds * 1000).toISOString(),
  }
}

const getOrCreate = <T>(
  cache: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> => {
  const existing = cache.get(key)
  if (existing !== undefined) return existing
  const created = factory()
  cache.set(key, created)
  return created
}
