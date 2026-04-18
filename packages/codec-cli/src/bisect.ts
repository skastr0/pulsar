import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { Effect } from "effect"
import { makeScoringEngine } from "./runtime.js"

export interface BisectOptions {
  readonly signalId: string
  readonly fromSha: string
  readonly toSha: string
  readonly repoPath: string
  readonly concurrency: number
  readonly topCulprits: number
  readonly json: boolean
}

export interface CommitScore {
  readonly sha: string
  readonly score: number
  readonly diagnosticsCount: number
  readonly firstDiagnostic: string | undefined
}

export interface Culprit {
  readonly sha: string
  readonly prevSha: string
  readonly prevScore: number
  readonly newScore: number
  readonly drop: number
}

export interface BisectReport {
  readonly signalId: string
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly trajectory: ReadonlyArray<CommitScore>
  readonly culprits: ReadonlyArray<Culprit>
  readonly minScore: number
  readonly maxScore: number
  readonly finalScore: number
  readonly totalDrift: number
}

export const runBisectCommand = (opts: BisectOptions) =>
  Effect.gen(function* () {
    const repoPath = resolve(opts.repoPath)
    if (!existsSync(repoPath)) {
      return yield* Effect.fail(new Error(`Path does not exist: ${repoPath}`))
    }

    const engine = yield* makeScoringEngine()
    const started = Date.now()
    const results = yield* engine.scoreRange(
      repoPath,
      opts.fromSha,
      opts.toSha,
      opts.signalId,
      { concurrency: opts.concurrency },
    )
    const elapsedMs = Date.now() - started

    const trajectory = results.map(({ sha, result }) => ({
      sha,
      score: result.score,
      diagnosticsCount: result.diagnostics.length,
      firstDiagnostic: result.diagnostics[0]?.message,
    }))

    const culprits = findCulprits(trajectory, opts.topCulprits)
    const scores = trajectory.map((t) => t.score)
    const minScore = scores.length === 0 ? 1 : Math.min(...scores)
    const maxScore = scores.length === 0 ? 1 : Math.max(...scores)
    const finalScore = trajectory[trajectory.length - 1]?.score ?? 1
    const totalDrift = maxScore - finalScore

    const report: BisectReport = {
      signalId: opts.signalId,
      repoPath,
      fromSha: opts.fromSha,
      toSha: opts.toSha,
      trajectory,
      culprits,
      minScore,
      maxScore,
      finalScore,
      totalDrift,
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    printHumanReport(report, elapsedMs)
  })

/**
 * Rank the top-N commits by adjacent-pair score drop. Note: this
 * definition only surfaces commits where a single step introduced the
 * regression. Gradual drift across many commits (no single large step)
 * is captured by `totalDrift` in the report, not by this list.
 */
export const findCulprits = (
  trajectory: ReadonlyArray<CommitScore>,
  topN: number,
): ReadonlyArray<Culprit> => {
  const drops: Array<Culprit> = []
  for (let i = 1; i < trajectory.length; i += 1) {
    const prev = trajectory[i - 1]!
    const cur = trajectory[i]!
    const drop = prev.score - cur.score
    if (drop <= 0) continue
    drops.push({
      sha: cur.sha,
      prevSha: prev.sha,
      prevScore: prev.score,
      newScore: cur.score,
      drop,
    })
  }
  drops.sort((a, b) => b.drop - a.drop)
  return drops.slice(0, topN)
}

const printHumanReport = (report: BisectReport, elapsedMs: number): void => {
  const lines: Array<string> = []
  lines.push("")
  lines.push(`  Repo:    ${report.repoPath}`)
  lines.push(`  Signal:  ${report.signalId}`)
  lines.push(`  Range:   ${report.fromSha}..${report.toSha}`)
  lines.push(`  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`)
  lines.push("")
  lines.push(
    `  Scores:  min ${report.minScore.toFixed(3)}   max ${report.maxScore.toFixed(3)}   final ${report.finalScore.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  )
  lines.push("")
  lines.push("  Trajectory (oldest → newest):")
  for (const t of report.trajectory) {
    const bar = renderScoreBar(t.score)
    lines.push(`    ${t.sha.slice(0, 8)}  ${t.score.toFixed(3)}  ${bar}  (${t.diagnosticsCount} diag)`)
  }
  lines.push("")
  if (report.culprits.length === 0) {
    lines.push("  No score-degrading commits in range.")
  } else {
    lines.push(`  Top ${report.culprits.length} culprit commits (largest score drops):`)
    for (const c of report.culprits) {
      lines.push(
        `    ${c.sha.slice(0, 8)}  drop ${c.drop.toFixed(3)}   ${c.prevScore.toFixed(3)} → ${c.newScore.toFixed(3)}  (from ${c.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  for (const line of lines) console.log(line)
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}
