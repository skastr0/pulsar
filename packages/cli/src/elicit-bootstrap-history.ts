import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import type {
  RevealedPreferenceOutcome,
} from "@skastr0/pulsar-core/elicitation"
import { type ObserverOutput } from "@skastr0/pulsar-core/observer"
import { Effect } from "effect"
import { makePulsarRuntime } from "./runtime.js"
import type {
  CommitLogEntry,
  RevealedPreferenceCommitEvent,
  ScoredCommitLogEntry,
} from "./elicit-types.js"

const execFileAsync = promisify(execFile)
const REVISION_LOOKAHEAD = 3
const REVISION_OVERLAP_THRESHOLD = 0.5

export const loadRecentCommitHistory = (
  repoRoot: string,
  maxCommits: number,
): Effect.Effect<ReadonlyArray<CommitLogEntry>, Error, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        const result = await execFileAsync(
          "git",
          [
            "log",
            `--max-count=${maxCommits}`,
            "--reverse",
            "--format=%H%x1f%P%x1f%s%x1f%b%x1e",
            "HEAD",
          ],
          { cwd: repoRoot },
        )
        return result.stdout
      },
      catch: (cause) => new Error(`Failed to load git history: ${String(cause)}`),
    })

    const entries = raw
      .split("\x1e")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => {
        const [sha, parentsRaw, subject, body] = chunk.split("\x1f")
        const parents = (parentsRaw ?? "")
          .split(/\s+/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        const revertTarget = detectRevertTarget(subject ?? "", body ?? "")
        return {
          sha: sha ?? "",
          parents,
          subject: subject ?? "",
          body: body ?? "",
          revertTarget,
          isRevertCommit: /^revert\b/i.test(subject ?? "") || revertTarget !== undefined,
        }
      })
      .filter((entry) => entry.sha.length > 0)

    const withFiles = yield* Effect.forEach(entries, (entry) =>
      Effect.tryPromise({
        try: async () => {
          const result = await execFileAsync(
            "git",
            ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", entry.sha],
            { cwd: repoRoot },
          )
          return {
            ...entry,
            changedFiles: result.stdout
              .split("\n")
              .map((file) => file.trim())
              .filter((file) => file.length > 0),
          } satisfies CommitLogEntry
        },
        catch: (cause) => new Error(`Failed to read changed files for ${entry.sha}: ${String(cause)}`),
      }),
    )

    return withFiles.filter((entry) => entry.parents.length <= 1 && entry.changedFiles.length > 0)
  })

export const scoreCommitHistory = (
  repoRoot: string,
  baseVector: PulsarVector | undefined,
  commits: ReadonlyArray<CommitLogEntry>,
): Effect.Effect<ReadonlyArray<ScoredCommitLogEntry>, Error, never> =>
  Effect.gen(function* () {
    const { engine } = yield* makePulsarRuntime(repoRoot, baseVector).pipe(
      Effect.mapError((cause) => new Error(`Failed to build pulsar runtime: ${String(cause)}`)),
    )
    return yield* Effect.forEach(
      commits,
      (commit) =>
        engine.observeCommit(repoRoot, commit.sha).pipe(
          Effect.map((observer) => ({
            ...commit,
            observer,
          })),
          Effect.mapError((cause) => new Error(`Failed to score ${commit.sha}: ${String(cause)}`)),
        ),
      { concurrency: 1 },
    )
  })

export const classifyRevealedPreferenceEvents = (
  commits: ReadonlyArray<ScoredCommitLogEntry>,
): ReadonlyArray<RevealedPreferenceCommitEvent> => {
  const reverted = new Map<string, { relatedSha: string; confidence: number }>()
  for (const commit of commits) {
    if (commit.revertTarget === undefined) continue
    reverted.set(commit.revertTarget, { relatedSha: commit.sha, confidence: 0.95 })
  }

  const revised = new Map<string, { relatedSha: string; confidence: number }>()
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index]
    if (commit === undefined || commit.isRevertCommit || reverted.has(commit.sha)) continue
    const revision = detectRevisionFollowup(commit, commits.slice(index + 1, index + 1 + REVISION_LOOKAHEAD))
    if (revision !== undefined) revised.set(commit.sha, revision)
  }

  return commits.flatMap((commit) => {
    if (commit.isRevertCommit) return []

    const revertedEvent = reverted.get(commit.sha)
    if (revertedEvent !== undefined) {
      return [toRevealedPreferenceEvent(commit, "reverted", revertedEvent.confidence, revertedEvent.relatedSha, "revert-commit")]
    }

    const revisedEvent = revised.get(commit.sha)
    if (revisedEvent !== undefined) {
      return [toRevealedPreferenceEvent(commit, "revised", revisedEvent.confidence, revisedEvent.relatedSha, "followup-overlap")]
    }

    return [toRevealedPreferenceEvent(commit, "accepted", 1, undefined, "survived-history")]
  })
}

const detectRevisionFollowup = (
  commit: ScoredCommitLogEntry,
  lookahead: ReadonlyArray<ScoredCommitLogEntry>,
): { readonly relatedSha: string; readonly confidence: number } | undefined => {
  let best: { readonly relatedSha: string; readonly confidence: number } | undefined

  for (let index = 0; index < lookahead.length; index += 1) {
    const candidate = lookahead[index]
    if (candidate === undefined || candidate.isRevertCommit) continue
    const overlap = overlapRatio(commit.changedFiles, candidate.changedFiles)
    const hinted = revisionHint(candidate.subject)
    if (overlap < REVISION_OVERLAP_THRESHOLD && !hinted) continue

    const confidence = clamp(0.45 + overlap * 0.4 + (hinted ? 0.1 : 0) - index * 0.05, 0.55, 0.9)
    if (best === undefined || confidence > best.confidence) {
      best = { relatedSha: candidate.sha, confidence: round(confidence) }
    }
  }

  return best
}

const toRevealedPreferenceEvent = (
  commit: ScoredCommitLogEntry,
  outcome: RevealedPreferenceOutcome,
  confidence: number,
  relatedSha: string | undefined,
  detectedBy: RevealedPreferenceCommitEvent["detected_by"],
): RevealedPreferenceCommitEvent => ({
  id: commit.sha,
  sha: commit.sha,
  subject: commit.subject,
  outcome,
  signal_scores: collectSignalScores(commit.observer),
  confidence,
  ...(relatedSha !== undefined ? { related_sha: relatedSha } : {}),
  changed_files: [...commit.changedFiles],
  detected_by: detectedBy,
})

const collectSignalScores = (observer: ObserverOutput): Readonly<Record<string, number>> =>
  Object.fromEntries(
    [...observer.signalResults.entries()].map(([signalId, result]) => [signalId, round(result.score)]),
  )

const detectRevertTarget = (subject: string, body: string): string | undefined => {
  const match = /This reverts commit ([0-9a-f]{7,40})\.?/i.exec(`${subject}\n${body}`)
  return match?.[1]
}

const revisionHint = (subject: string): boolean =>
  /^(fixup!|squash!)/i.test(subject) ||
  /\b(cleanup|follow-?up|adjust|tweak|polish|refactor|address|revise|trim)\b/i.test(subject)

const overlapRatio = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): number => {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const overlap = [...leftSet].filter((file) => rightSet.has(file)).length
  return overlap / Math.min(leftSet.size, rightSet.size)
}

const round = (value: number): number => Number(value.toFixed(3))

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
