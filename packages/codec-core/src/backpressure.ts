import { CATEGORIES, type Category } from "./category.js"
import { evaluateGoodhart, type GoodhartAssessment } from "./goodhart.js"
import { type TimeSeriesEntry } from "./time-series.js"
import { backpressureConfigOf, type TasteVector } from "./vector.js"

export type BackpressureLevel = "green" | "yellow" | "red"

export interface CategoryBackpressure {
  readonly level: BackpressureLevel
  readonly currentScore: number
  readonly trajectorySlope: number
  readonly triggers: ReadonlyArray<string>
}

export interface BackpressureOutput {
  readonly overall: BackpressureLevel
  readonly byCategory: Record<Category, CategoryBackpressure>
  readonly rationale: ReadonlyArray<string>
  readonly trajectoryDays: number
  readonly goodhart: GoodhartAssessment
}

export interface BackpressureTrendEntry {
  readonly sha: string
  readonly timestamp: string
  readonly overall: BackpressureLevel
  readonly weightedMean: number
  readonly hardGateStatus: "pass" | "fail"
}

export const evaluateBackpressure = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: TasteVector | undefined,
): BackpressureOutput => {
  const config = backpressureConfigOf(vector)
  const latest = entries.at(-1)
  const goodhart = evaluateGoodhart(entries, vector)

  if (latest === undefined) {
    return {
      overall: config.empty_series_level,
      byCategory: emptyCategoryOutput(config.empty_series_level),
      rationale: [
        "No score time series exists yet.",
        "Backpressure falls back to a cautious default until evidence is recorded.",
      ],
      trajectoryDays: config.trajectory_days,
      goodhart,
    }
  }

  const windowEntries = selectWindow(entries, latest.timestamp, config.trajectory_days)
  const slopeThreshold = -config.thresholds.degrading_window_drop / config.trajectory_days
  const byCategory = CATEGORIES.reduce<Record<Category, CategoryBackpressure>>(
    (acc, category) => {
      const currentScore = latest.observerOutput.categories[category].score
      const trajectorySlope = computeTrajectorySlope(windowEntries, category)
      const triggers: Array<string> = []
      let level: BackpressureLevel = "green"

      if (currentScore < config.thresholds.yellow_min_score) {
        level = "red"
        triggers.push(
          `${category} score ${currentScore.toFixed(2)} is below ${config.thresholds.yellow_min_score.toFixed(2)}`,
        )
      } else if (currentScore < config.thresholds.green_min_score) {
        level = "yellow"
        triggers.push(
          `${category} score ${currentScore.toFixed(2)} is below the green floor ${config.thresholds.green_min_score.toFixed(2)}`,
        )
      }

      if (trajectorySlope <= slopeThreshold) {
        if (level === "green") level = "yellow"
        triggers.push(
          `${category} slope ${trajectorySlope.toFixed(3)} / day is degrading faster than the allowed trend`,
        )
      }

      acc[category] = { level, currentScore, trajectorySlope, triggers }
      return acc
    },
    {
      "architectural-drift": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
      "dependency-entropy": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
      "abstraction-bloat": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
      "legibility-decay": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
      "generated-slop": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
      "review-pain": {
        level: "green",
        currentScore: 1,
        trajectorySlope: 0,
        triggers: [],
      },
    },
  )

  const rationale: Array<string> = []
  let overall = worstLevel(CATEGORIES.map((category) => byCategory[category].level))

  if (latest.observerOutput.hard_gate_status === "fail") {
    overall = "red"
    rationale.push("Hard-gate violations are present in the latest observation.")
  }

  if (
    latest.observerOutput.minimum !== undefined &&
    latest.observerOutput.minimum.score < config.thresholds.red_min_dimension
  ) {
    overall = "red"
    rationale.push(
      `Minimum dimension ${latest.observerOutput.minimum.signal} fell to ${latest.observerOutput.minimum.score.toFixed(2)}.`,
    )
  }

  if (windowEntries.length < 2) {
    rationale.push(
      `Only ${windowEntries.length} observation(s) fall inside the ${config.trajectory_days}-day trend window.`,
    )
  }

  for (const category of CATEGORIES) {
    for (const trigger of byCategory[category].triggers) {
      rationale.push(trigger)
    }
  }

  if (goodhart.suspicion === "high") {
    overall = "red"
    rationale.push(...goodhart.rationale)
  } else if (goodhart.suspicion === "elevated") {
    overall = overall === "green" ? "yellow" : overall
    rationale.push(...goodhart.rationale)
  }

  return {
    overall,
    byCategory,
    rationale,
    trajectoryDays: config.trajectory_days,
    goodhart,
  }
}

export const evaluateBackpressureTrend = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: TasteVector | undefined,
): ReadonlyArray<BackpressureTrendEntry> =>
  entries.map((entry, index) => {
    const prefix = entries.slice(0, index + 1)
    const output = evaluateBackpressure(prefix, vector)
    return {
      sha: entry.sha,
      timestamp: entry.timestamp,
      overall: output.overall,
      weightedMean: entry.observerOutput.weighted_mean,
      hardGateStatus: entry.observerOutput.hard_gate_status,
    }
  })

const emptyCategoryOutput = (
  level: BackpressureLevel,
): Record<Category, CategoryBackpressure> => ({
  "architectural-drift": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
  "dependency-entropy": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
  "abstraction-bloat": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
  "legibility-decay": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
  "generated-slop": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
  "review-pain": {
    level,
    currentScore: 1,
    trajectorySlope: 0,
    triggers: ["No history yet."],
  },
})

const selectWindow = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  latestTimestamp: string,
  trajectoryDays: number,
): ReadonlyArray<TimeSeriesEntry> => {
  const cutoff = Date.parse(latestTimestamp) - trajectoryDays * 24 * 60 * 60 * 1000
  const withinWindow = entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff)
  return withinWindow.length === 0 ? [entries.at(-1)!] : withinWindow
}

const computeTrajectorySlope = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  category: Category,
): number => {
  if (entries.length < 2) return 0

  const firstTime = Date.parse(entries[0]!.timestamp)
  const points = entries.map((entry) => ({
    x: (Date.parse(entry.timestamp) - firstTime) / (24 * 60 * 60 * 1000),
    y: entry.observerOutput.categories[category].score,
  }))
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  const numerator = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
    0,
  )
  const denominator = points.reduce(
    (sum, point) => sum + (point.x - meanX) * (point.x - meanX),
    0,
  )
  return denominator === 0 ? 0 : numerator / denominator
}

const worstLevel = (levels: ReadonlyArray<BackpressureLevel>): BackpressureLevel => {
  if (levels.includes("red")) return "red"
  if (levels.includes("yellow")) return "yellow"
  return "green"
}
