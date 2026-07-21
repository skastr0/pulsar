import { CATEGORIES, type Category, categoryRecord } from "./category.js"
import { evaluateGoodhart, type GoodhartAssessment } from "./goodhart.js"
import { categoryOutputOrEmpty } from "./observer-model.js"
import { type TimeSeriesEntry } from "./time-series.js"
import { backpressureConfigOf, type BackpressureConfig, type PulsarVector } from "./vector.js"

export {
  projectObserverForAgent,
  selectGoodhartHoldoutSignalIds,
} from "./goodhart.js"

export const BACKPRESSURE_OUTPUT_SEMANTICS = "evidence-qualified-v1" as const

export type BackpressureLevel = "green" | "yellow" | "red"
export type BackpressureVerdict = BackpressureLevel | "unavailable"
export type BackpressureEvidenceState =
  | "available"
  | "insufficient-evidence"
  | "failed"
export type BackpressureUnavailableReason =
  | "no-history"
  | "first-observation"
  | "latest-readiness-unknown"
  | "latest-readiness-failed"
  | "latest-observation-insufficient"
  | "insufficient-history"
  | "no-category-evidence"
  | "insufficient-category-history"

interface CategoryBackpressureCommon {
  readonly observationCount: number
  readonly triggers: ReadonlyArray<string>
}

export type CategoryBackpressure =
  | (CategoryBackpressureCommon & {
      readonly level: BackpressureLevel
      readonly evidenceState: "available"
      readonly currentScore: number
      readonly trajectorySlope: number
      readonly evidenceReason?: never
    })
  | (CategoryBackpressureCommon & {
      readonly level: "unavailable"
      readonly evidenceState: "insufficient-evidence"
      readonly evidenceReason: BackpressureUnavailableReason
      readonly currentScore?: number
      readonly trajectorySlope?: never
    })
  | (CategoryBackpressureCommon & {
      readonly level: "unavailable"
      readonly evidenceState: "failed"
      readonly evidenceReason: BackpressureUnavailableReason
      readonly currentScore?: never
      readonly trajectorySlope?: never
    })

interface BackpressureOutputCommon {
  readonly backpressureSemantics: typeof BACKPRESSURE_OUTPUT_SEMANTICS
  readonly byCategory: Record<Category, CategoryBackpressure>
  readonly rationale: ReadonlyArray<string>
  readonly trajectoryDays: number
  readonly observationCount: number
  readonly evidenceObservationCount: number
}

export type BackpressureOutput =
  | (BackpressureOutputCommon & {
      readonly overall: BackpressureLevel
      readonly evidenceState: "available"
      readonly evidenceReason?: never
      readonly goodhart: GoodhartAssessment
    })
  | (BackpressureOutputCommon & {
      readonly overall: "unavailable"
      readonly evidenceState: "insufficient-evidence" | "failed"
      readonly evidenceReason: BackpressureUnavailableReason
      readonly goodhart?: never
    })

interface BackpressureTrendEntryCommon {
  readonly sha: string
  readonly timestamp: string
  readonly overall: BackpressureVerdict
  readonly observationCount: number
  readonly evidenceObservationCount: number
  readonly readinessStatus?: NonNullable<TimeSeriesEntry["observerOutput"]["readiness"]>["status"]
  readonly hardGateStatus: "pass" | "fail"
}

export type BackpressureTrendEntry =
  | (BackpressureTrendEntryCommon & {
      readonly overall: BackpressureLevel
      readonly evidenceState: "available"
      readonly evidenceReason?: never
      readonly weightedMean: number
      readonly readinessScore?: number
      readonly readinessPressure?: number
    })
  | (BackpressureTrendEntryCommon & {
      readonly overall: "unavailable"
      readonly evidenceState: "insufficient-evidence" | "failed"
      readonly evidenceReason: BackpressureUnavailableReason
      readonly weightedMean?: never
      readonly readinessScore?: never
      readonly readinessPressure?: never
    })

type ObservationEvidence =
  | { readonly state: "available" }
  | {
      readonly state: "insufficient-evidence"
      readonly reason: "latest-readiness-unknown" | "latest-observation-insufficient"
    }
  | {
      readonly state: "failed"
      readonly reason: "latest-readiness-failed"
    }

export const evaluateBackpressure = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: PulsarVector | undefined,
): BackpressureOutput => {
  const config = backpressureConfigOf(vector)
  const latest = entries.at(-1)

  if (latest === undefined) {
    return unavailableBackpressureOutput({
      entries,
      latest: undefined,
      qualityEntries: [],
      config,
      evidenceState: "insufficient-evidence",
      evidenceReason: "no-history",
    })
  }

  const windowEntries = selectWindow(entries, latest.timestamp, config.trajectory_days)
  const latestEvidence = observationEvidenceOf(latest)
  const qualityEntries = windowEntries.filter(
    (entry) => observationEvidenceOf(entry).state === "available",
  )

  if (latestEvidence.state !== "available") {
    return unavailableBackpressureOutput({
      entries: windowEntries,
      latest,
      qualityEntries,
      config,
      evidenceState: latestEvidence.state,
      evidenceReason: latestEvidence.reason,
    })
  }

  if (qualityEntries.length < 2) {
    return unavailableBackpressureOutput({
      entries: windowEntries,
      latest,
      qualityEntries,
      config,
      evidenceState: "insufficient-evidence",
      evidenceReason:
        windowEntries.length === 1 ? "first-observation" : "insufficient-history",
    })
  }

  const byCategory = evaluateCategoryBackpressure(latest, qualityEntries, config)
  const categoryLevels = CATEGORIES.flatMap((category) => {
    const entry = byCategory[category]
    return entry.evidenceState === "available" ? [entry.level] : []
  })
  if (categoryLevels.length === 0) {
    const hasCategoryEvidence = CATEGORIES.some(
      (category) => byCategory[category].observationCount > 0,
    )
    return unavailableBackpressureOutput({
      entries: windowEntries,
      latest,
      qualityEntries,
      config,
      evidenceState: "insufficient-evidence",
      evidenceReason: hasCategoryEvidence
        ? "insufficient-category-history"
        : "no-category-evidence",
    })
  }

  const goodhart = evaluateGoodhart(qualityEntries, vector)
  const rationale = buildBackpressureRationale(
    latest,
    qualityEntries,
    byCategory,
    config,
    goodhart,
  )
  let overall = worstLevel(categoryLevels)

  const readinessLevel = qualityLevelFromReadiness(latest)
  if (readinessLevel !== undefined) {
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
    backpressureSemantics: BACKPRESSURE_OUTPUT_SEMANTICS,
    overall,
    evidenceState: "available",
    byCategory,
    rationale,
    trajectoryDays: config.trajectory_days,
    observationCount: windowEntries.length,
    evidenceObservationCount: qualityEntries.length,
    goodhart,
  }
}

const unavailableBackpressureOutput = (args: {
  readonly entries: ReadonlyArray<TimeSeriesEntry>
  readonly latest: TimeSeriesEntry | undefined
  readonly qualityEntries: ReadonlyArray<TimeSeriesEntry>
  readonly config: BackpressureConfig
  readonly evidenceState: "insufficient-evidence" | "failed"
  readonly evidenceReason: BackpressureUnavailableReason
}): BackpressureOutput => ({
  backpressureSemantics: BACKPRESSURE_OUTPUT_SEMANTICS,
  overall: "unavailable",
  evidenceState: args.evidenceState,
  evidenceReason: args.evidenceReason,
  byCategory: unavailableCategoryOutput(args),
  rationale: unavailableRationale(
    args.evidenceReason,
    args.entries.length,
    args.qualityEntries.length,
    args.config,
  ),
  trajectoryDays: args.config.trajectory_days,
  observationCount: args.entries.length,
  evidenceObservationCount: args.qualityEntries.length,
})

const unavailableCategoryOutput = (args: {
  readonly entries: ReadonlyArray<TimeSeriesEntry>
  readonly latest: TimeSeriesEntry | undefined
  readonly qualityEntries: ReadonlyArray<TimeSeriesEntry>
  readonly evidenceState: "insufficient-evidence" | "failed"
  readonly evidenceReason: BackpressureUnavailableReason
}): Record<Category, CategoryBackpressure> =>
  categoryRecord((category): CategoryBackpressure => {
    const categoryEntries = args.qualityEntries.filter((entry) =>
      hasCategoryQualityEvidence(entry, category),
    )
    if (args.evidenceState === "failed") {
      return {
        level: "unavailable",
        evidenceState: "failed",
        evidenceReason: args.evidenceReason,
        observationCount: categoryEntries.length,
        triggers: [unavailableReasonMessage(args.evidenceReason)],
      }
    }

    const hasCurrentScore =
      args.latest !== undefined &&
      observationEvidenceOf(args.latest).state === "available" &&
      hasCategoryQualityEvidence(args.latest, category)
    const evidenceReason =
      args.latest === undefined || args.evidenceReason === "no-history"
        ? "no-history"
        : hasCurrentScore
          ? "insufficient-category-history"
          : "no-category-evidence"

    return {
      level: "unavailable",
      evidenceState: "insufficient-evidence",
      evidenceReason,
      ...(hasCurrentScore
        ? {
            currentScore: categoryOutputOrEmpty(
              args.latest!.observerOutput.categories,
              category,
            ).score,
          }
        : {}),
      observationCount: categoryEntries.length,
      triggers: [unavailableReasonMessage(evidenceReason)],
    }
  })

const evaluateCategoryBackpressure = (
  latest: TimeSeriesEntry,
  qualityEntries: ReadonlyArray<TimeSeriesEntry>,
  config: BackpressureConfig,
): Record<Category, CategoryBackpressure> =>
  categoryRecord((category): CategoryBackpressure =>
    evaluateOneCategoryBackpressure(latest, qualityEntries, category, config),
  )

const evaluateOneCategoryBackpressure = (
  latest: TimeSeriesEntry,
  qualityEntries: ReadonlyArray<TimeSeriesEntry>,
  category: Category,
  config: BackpressureConfig,
): CategoryBackpressure => {
  const categoryEntries = qualityEntries.filter((entry) =>
    hasCategoryQualityEvidence(entry, category),
  )
  const hasCurrentScore = hasCategoryQualityEvidence(latest, category)
  if (!hasCurrentScore) {
    return unavailableCategory("no-category-evidence", categoryEntries.length)
  }

  const currentScore = categoryOutputOrEmpty(latest.observerOutput.categories, category).score
  const trajectorySlope = computeTrajectorySlope(categoryEntries, category)
  if (trajectorySlope === undefined) {
    return unavailableCategory(
      "insufficient-category-history",
      categoryEntries.length,
      currentScore,
    )
  }

  const triggers = categoryScoreTriggers(category, currentScore, trajectorySlope, config)
  return {
    level: levelFromTriggers(currentScore, trajectorySlope, config),
    evidenceState: "available",
    currentScore,
    trajectorySlope,
    observationCount: categoryEntries.length,
    triggers,
  }
}

const unavailableCategory = (
  evidenceReason: BackpressureUnavailableReason,
  observationCount: number,
  currentScore?: number,
): CategoryBackpressure => ({
  level: "unavailable",
  evidenceState: "insufficient-evidence",
  evidenceReason,
  ...(currentScore !== undefined ? { currentScore } : {}),
  observationCount,
  triggers: [unavailableReasonMessage(evidenceReason)],
})

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
  qualityEntries: ReadonlyArray<TimeSeriesEntry>,
  byCategory: Record<Category, CategoryBackpressure>,
  config: BackpressureConfig,
  goodhart: GoodhartAssessment,
): ReadonlyArray<string> => {
  const unavailableCategoryCount = CATEGORIES.filter(
    (category) => byCategory[category].evidenceState !== "available",
  ).length
  return [
    ...readinessRationale(latest),
    ...hardGateRationale(latest),
    ...minimumDimensionRationale(latest, config),
    ...CATEGORIES.flatMap((category) => {
      const entry = byCategory[category]
      return entry.evidenceState === "available" ? entry.triggers : []
    }),
    ...(unavailableCategoryCount === 0
      ? []
      : [
          `${unavailableCategoryCount} categor${unavailableCategoryCount === 1 ? "y lacks" : "ies lack"} two evidence-bearing observations in the ${config.trajectory_days}-day window.`,
        ]),
    ...(qualityEntries.length >= 2 ? [] : trendWindowRationale(qualityEntries, config)),
    ...(goodhart.suspicion === "low" ? [] : goodhart.rationale),
  ]
}

const readinessRationale = (latest: TimeSeriesEntry): ReadonlyArray<string> => {
  const readiness = latest.observerOutput.readiness
  if (readiness === undefined) return []
  const level = qualityLevelFromReadiness(latest)
  return level === undefined || level === "green"
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
  qualityEntries: ReadonlyArray<TimeSeriesEntry>,
  config: BackpressureConfig,
): ReadonlyArray<string> => [
  `Only ${qualityEntries.length} evidence-bearing observation(s) fall inside the ${config.trajectory_days}-day trend window.`,
]

const unavailableRationale = (
  reason: BackpressureUnavailableReason,
  observationCount: number,
  evidenceObservationCount: number,
  config: BackpressureConfig,
): ReadonlyArray<string> => [
  unavailableReasonMessage(reason),
  `${evidenceObservationCount} of ${observationCount} observation(s) carry usable quality evidence in the ${config.trajectory_days}-day window.`,
]

const unavailableReasonMessage = (reason: BackpressureUnavailableReason): string => {
  switch (reason) {
    case "no-history":
      return "No score time series exists yet."
    case "first-observation":
      return "The first observation cannot establish a backpressure trajectory."
    case "latest-readiness-unknown":
      return "The latest observation has no applicable readiness evidence."
    case "latest-readiness-failed":
      return "The latest observation contains operational signal failures; no quality verdict is available."
    case "latest-observation-insufficient":
      return "The latest observation contains no concrete category quality evidence."
    case "insufficient-history":
      return "Fewer than two evidence-bearing observations remain after excluding unavailable or failed eras."
    case "no-category-evidence":
      return "No concrete quality evidence exists for this category."
    case "insufficient-category-history":
      return "Fewer than two evidence-bearing observations exist for this category."
  }
}

export const evaluateBackpressureTrend = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: PulsarVector | undefined,
): ReadonlyArray<BackpressureTrendEntry> =>
  entries.map((entry, index): BackpressureTrendEntry => {
    const prefix = entries.slice(0, index + 1)
    const output = evaluateBackpressure(prefix, vector)
    const readiness = entry.observerOutput.readiness
    const common: BackpressureTrendEntryCommon = {
      sha: entry.sha,
      timestamp: entry.timestamp,
      overall: output.overall,
      observationCount: output.observationCount,
      evidenceObservationCount: output.evidenceObservationCount,
      ...(readiness !== undefined ? { readinessStatus: readiness.status } : {}),
      hardGateStatus: entry.observerOutput.hard_gate_status,
    }

    if (output.evidenceState !== "available") {
      return {
        ...common,
        overall: "unavailable",
        evidenceState: output.evidenceState,
        evidenceReason: output.evidenceReason,
      }
    }

    return {
      ...common,
      overall: output.overall,
      evidenceState: "available",
      weightedMean: entry.observerOutput.weighted_mean,
      ...(readiness !== undefined
        ? {
            readinessScore: readiness.score,
            readinessPressure: readiness.pressure,
          }
        : {}),
    }
  })

const observationEvidenceOf = (entry: TimeSeriesEntry): ObservationEvidence => {
  const readiness = entry.observerOutput.readiness
  if (readiness?.status === "failed") {
    return { state: "failed", reason: "latest-readiness-failed" }
  }
  if (readiness?.status === "unknown") {
    return { state: "insufficient-evidence", reason: "latest-readiness-unknown" }
  }
  if (!CATEGORIES.some((category) => hasCategoryQualityEvidence(entry, category))) {
    return {
      state: "insufficient-evidence",
      reason: "latest-observation-insufficient",
    }
  }
  return { state: "available" }
}

const hasCategoryQualityEvidence = (
  entry: TimeSeriesEntry,
  category: Category,
): boolean => {
  const snapshot = categoryOutputOrEmpty(entry.observerOutput.categories, category)
  if (!Number.isFinite(snapshot.score)) return false
  if (entry.observerOutput.readiness !== undefined) {
    return (snapshot.applicableSignalCount ?? 0) > 0
  }
  return Object.keys(snapshot.signals).length > 0
}

const qualityLevelFromReadiness = (
  entry: TimeSeriesEntry,
): BackpressureLevel | undefined => {
  const readiness = entry.observerOutput.readiness
  if (readiness === undefined) return undefined
  if (readiness.status === "green") return "green"
  if (readiness.status === "yellow") return "yellow"
  if (readiness.status === "red") return "red"
  if (readiness.status === "blocked") return "red"
  return undefined
}

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
): number | undefined => {
  if (entries.length < 2) return undefined

  const firstTime = Date.parse(entries[0]!.timestamp)
  const points = entries.map((entry) => ({
    x: (Date.parse(entry.timestamp) - firstTime) / (24 * 60 * 60 * 1000),
    y: categoryOutputOrEmpty(entry.observerOutput.categories, category).score,
  }))
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return undefined
  }
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
  return denominator === 0 ? undefined : numerator / denominator
}

const worstLevel = (levels: ReadonlyArray<BackpressureLevel>): BackpressureLevel => {
  if (levels.includes("red")) return "red"
  if (levels.includes("yellow")) return "yellow"
  return "green"
}
