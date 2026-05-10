import { CATEGORIES, type Category } from "./category.js"
import { evaluateGoodhart, type GoodhartAssessment } from "./goodhart.js"
import { type TimeSeriesEntry } from "./time-series.js"
import { backpressureConfigOf, type BackpressureConfig, type PulsarVector } from "./vector.js"

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
  readonly readinessScore?: number
  readonly readinessPressure?: number
  readonly hardGateStatus: "pass" | "fail"
}

export const evaluateBackpressure = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: PulsarVector | undefined,
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
  const byCategory = evaluateCategoryBackpressure(latest, windowEntries, config)
  const rationale = buildBackpressureRationale(latest, windowEntries, byCategory, config, goodhart)
  let overall = worstLevel(CATEGORIES.map((category) => byCategory[category].level))

  if (latest.observerOutput.readiness !== undefined) {
    const readinessLevel = backpressureLevelFromReadiness(
      latest.observerOutput.readiness.status,
      latest.observerOutput.readiness.pressure,
    )
    overall = worstLevel([overall, readinessLevel])
  }

  if (latest.observerOutput.hard_gate_status === "fail") {
    overall = "red"
  }

  if (
    latest.observerOutput.minimum !== undefined &&
    latest.observerOutput.minimum.score < config.thresholds.red_min_dimension
  ) {
    overall = "red"
  }

  if (goodhart.suspicion === "high") {
    overall = "red"
  } else if (goodhart.suspicion === "elevated") {
    overall = overall === "green" ? "yellow" : overall
  }

  return {
    overall,
    byCategory,
    rationale,
    trajectoryDays: config.trajectory_days,
    goodhart,
  }
}

const evaluateCategoryBackpressure = (
  latest: TimeSeriesEntry,
  windowEntries: ReadonlyArray<TimeSeriesEntry>,
  config: BackpressureConfig,
): Record<Category, CategoryBackpressure> =>
  Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      evaluateOneCategoryBackpressure(latest, windowEntries, category, config),
    ]),
  ) as Record<Category, CategoryBackpressure>

const evaluateOneCategoryBackpressure = (
  latest: TimeSeriesEntry,
  windowEntries: ReadonlyArray<TimeSeriesEntry>,
  category: Category,
  config: BackpressureConfig,
): CategoryBackpressure => {
  const currentScore = latest.observerOutput.categories[category].score
  const trajectorySlope = computeTrajectorySlope(windowEntries, category)
  const triggers = categoryScoreTriggers(category, currentScore, trajectorySlope, config)
  return {
    level: levelFromTriggers(currentScore, trajectorySlope, config),
    currentScore,
    trajectorySlope,
    triggers,
  }
}

const categoryScoreTriggers = (
  category: Category,
  currentScore: number,
  trajectorySlope: number,
  config: BackpressureConfig,
): ReadonlyArray<string> => {
  const triggers: Array<string> = []
  if (currentScore < config.thresholds.yellow_min_score) {
    triggers.push(
      `${category} score ${currentScore.toFixed(2)} is below ${config.thresholds.yellow_min_score.toFixed(2)}`,
    )
  } else if (currentScore < config.thresholds.green_min_score) {
    triggers.push(
      `${category} score ${currentScore.toFixed(2)} is below the green floor ${config.thresholds.green_min_score.toFixed(2)}`,
    )
  }
  if (trajectorySlope <= slopeThreshold(config)) {
    triggers.push(
      `${category} slope ${trajectorySlope.toFixed(3)} / day is degrading faster than the allowed trend`,
    )
  }
  return triggers
}

const levelFromTriggers = (
  currentScore: number,
  trajectorySlope: number,
  config: BackpressureConfig,
): BackpressureLevel => {
  if (currentScore < config.thresholds.yellow_min_score) return "red"
  if (currentScore < config.thresholds.green_min_score) return "yellow"
  return trajectorySlope <= slopeThreshold(config) ? "yellow" : "green"
}

const slopeThreshold = (config: BackpressureConfig): number =>
  -config.thresholds.degrading_window_drop / config.trajectory_days

const buildBackpressureRationale = (
  latest: TimeSeriesEntry,
  windowEntries: ReadonlyArray<TimeSeriesEntry>,
  byCategory: Record<Category, CategoryBackpressure>,
  config: BackpressureConfig,
  goodhart: GoodhartAssessment,
): ReadonlyArray<string> => [
  ...readinessRationale(latest),
  ...hardGateRationale(latest),
  ...minimumDimensionRationale(latest, config),
  ...trendWindowRationale(windowEntries, config),
  ...CATEGORIES.flatMap((category) => byCategory[category].triggers),
  ...(goodhart.suspicion === "low" ? [] : goodhart.rationale),
]

const readinessRationale = (latest: TimeSeriesEntry): ReadonlyArray<string> => {
  const readiness = latest.observerOutput.readiness
  if (readiness === undefined) return []
  const level = backpressureLevelFromReadiness(readiness.status, readiness.pressure)
  return level === "green"
    ? []
    : [`Readiness pressure is ${readiness.pressure.toFixed(2)} (${readiness.status}).`]
}

const hardGateRationale = (latest: TimeSeriesEntry): ReadonlyArray<string> =>
  latest.observerOutput.hard_gate_status === "fail"
    ? ["Hard-gate violations are present in the latest observation."]
    : []

const minimumDimensionRationale = (
  latest: TimeSeriesEntry,
  config: BackpressureConfig,
): ReadonlyArray<string> => {
  const minimum = latest.observerOutput.minimum
  return minimum !== undefined && minimum.score < config.thresholds.red_min_dimension
    ? [`Minimum dimension ${minimum.signal} fell to ${minimum.score.toFixed(2)}.`]
    : []
}

const trendWindowRationale = (
  windowEntries: ReadonlyArray<TimeSeriesEntry>,
  config: BackpressureConfig,
): ReadonlyArray<string> =>
  windowEntries.length < 2
    ? [
        `Only ${windowEntries.length} observation(s) fall inside the ${config.trajectory_days}-day trend window.`,
      ]
    : []

export const evaluateBackpressureTrend = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: PulsarVector | undefined,
): ReadonlyArray<BackpressureTrendEntry> =>
  entries.map((entry, index) => {
    const prefix = entries.slice(0, index + 1)
    const output = evaluateBackpressure(prefix, vector)
    return {
      sha: entry.sha,
      timestamp: entry.timestamp,
      overall: output.overall,
      weightedMean: entry.observerOutput.weighted_mean,
      ...(entry.observerOutput.readiness !== undefined
        ? {
            readinessScore: entry.observerOutput.readiness.score,
            readinessPressure: entry.observerOutput.readiness.pressure,
          }
        : {}),
      hardGateStatus: entry.observerOutput.hard_gate_status,
    }
  })

const backpressureLevelFromReadiness = (
  readinessStatus: NonNullable<TimeSeriesEntry["observerOutput"]["readiness"]>["status"],
  pressure: number,
): BackpressureLevel => {
  if (readinessStatus === "green") return "green"
  if (readinessStatus === "unknown") return pressure > 0 ? "yellow" : "green"
  if (readinessStatus === "yellow") return "yellow"
  if (readinessStatus === "failed") return "red"
  return "red"
}

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
