import { createHash } from "node:crypto"
import { CATEGORIES, type Category } from "./category.js"
import { type TimeSeriesEntry } from "./time-series.js"
import { backpressureConfigOf, type BackpressureConfig, type PulsarVector } from "./vector.js"

type GoodhartSuspicion = "low" | "elevated" | "high"

export interface GoodhartAssessment {
  readonly suspicion: GoodhartSuspicion
  readonly rationale: ReadonlyArray<string>
  readonly visibleSignalIds: ReadonlyArray<string>
  readonly hiddenSignalIds: ReadonlyArray<string>
  readonly visibleScore: number | undefined
  readonly hiddenScore: number | undefined
  readonly holdoutGap: number | undefined
  readonly visibleTrend: number
  readonly hiddenTrend: number
  readonly velocityExcess: number
  readonly rotationWindowDays: number
}

interface AgentFacingCategoryView {
  readonly diagnostics: ReadonlyArray<string>
  readonly hiddenSignalCount: number
}

interface AgentFacingObserverView {
  readonly categories: Record<Category, AgentFacingCategoryView>
  readonly reminders: ReadonlyArray<string>
  readonly visibleSignalIds: ReadonlyArray<string>
  readonly hiddenSignalIds: ReadonlyArray<string>
}

export const evaluateGoodhart = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: PulsarVector | undefined,
): GoodhartAssessment => {
  const backpressureConfig = backpressureConfigOf(vector)
  const config = backpressureConfig.goodhart
  const latest = entries.at(-1)
  if (latest === undefined) {
    return emptyGoodhartAssessment("No score history exists yet.", config.rotation_period_days)
  }

  const signalIds = extractSignalIds(latest)
  if (signalIds.length === 0) {
    return emptyGoodhartAssessment(
      "No active signals were present in the latest observation.",
      config.rotation_period_days,
    )
  }

  return buildGoodhartAssessment(
    scoreGoodhartSlices(
      entries,
      latest,
      signalIds,
      backpressureConfig.trajectory_days,
      config,
    ),
    config,
  )
}

type GoodhartConfig = BackpressureConfig["goodhart"]

interface GoodhartScoreSlices {
  readonly visibleSignalIds: ReadonlyArray<string>
  readonly hiddenSignalIds: ReadonlyArray<string>
  readonly visibleScore: number | undefined
  readonly hiddenScore: number | undefined
  readonly holdoutGap: number | undefined
  readonly visibleTrend: number
  readonly hiddenTrend: number
  readonly velocityExcess: number
  readonly recentHistoryCount: number
}

interface GoodhartSuspicionResult {
  readonly suspicion: GoodhartSuspicion
  readonly rationale: ReadonlyArray<string>
}

const emptyGoodhartAssessment = (
  rationale: string,
  rotationWindowDays: number,
): GoodhartAssessment => ({
  suspicion: "low",
  rationale: [rationale],
  visibleSignalIds: [],
  hiddenSignalIds: [],
  visibleScore: undefined,
  hiddenScore: undefined,
  holdoutGap: undefined,
  visibleTrend: 0,
  hiddenTrend: 0,
  velocityExcess: 0,
  rotationWindowDays,
})

const scoreGoodhartSlices = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  latest: TimeSeriesEntry,
  signalIds: ReadonlyArray<string>,
  trajectoryDays: number,
  config: GoodhartConfig,
): GoodhartScoreSlices => {
  const hiddenSignalIds = pickHiddenSignals(
    signalIds,
    latest.timestamp,
    config.rotation_period_days,
    config.holdout_ratio,
  )
  const visibleSignalIds = signalIds.filter((signalId) => !hiddenSignalIds.includes(signalId))

  const latestVisibleScore = meanSignalScore(latest, visibleSignalIds)
  const latestHiddenScore = meanSignalScore(latest, hiddenSignalIds)
  const relevantEntries = filterRecentEntries(
    entries,
    latest.timestamp,
    trajectoryDays,
  )
  const visibleTrend = trendDelta(relevantEntries, visibleSignalIds)
  const hiddenTrend = trendDelta(relevantEntries, hiddenSignalIds)
  const holdoutGap =
    latestVisibleScore !== undefined && latestHiddenScore !== undefined
      ? latestVisibleScore - latestHiddenScore
      : undefined
  const velocityExcess = visibleTrend - hiddenTrend

  return {
    visibleSignalIds,
    hiddenSignalIds,
    visibleScore: latestVisibleScore,
    hiddenScore: latestHiddenScore,
    holdoutGap,
    visibleTrend,
    hiddenTrend,
    velocityExcess,
    recentHistoryCount: relevantEntries.length,
  }
}

const buildGoodhartAssessment = (
  slices: GoodhartScoreSlices,
  config: GoodhartConfig,
): GoodhartAssessment => {
  const result = classifyGoodhartSuspicion(slices, config)
  return {
    suspicion: result.suspicion,
    rationale: result.rationale,
    visibleSignalIds: slices.visibleSignalIds,
    hiddenSignalIds: slices.hiddenSignalIds,
    visibleScore: slices.visibleScore,
    hiddenScore: slices.hiddenScore,
    holdoutGap: slices.holdoutGap,
    visibleTrend: slices.visibleTrend,
    hiddenTrend: slices.hiddenTrend,
    velocityExcess: slices.velocityExcess,
    rotationWindowDays: config.rotation_period_days,
  }
}

const classifyGoodhartSuspicion = (
  slices: GoodhartScoreSlices,
  config: GoodhartConfig,
): GoodhartSuspicionResult => {
  const rationale: Array<string> = [
    "Numeric score surfaces stay hidden from the agent; only concrete diagnostics are exposed.",
  ]
  if (slices.hiddenSignalIds.length > 0) {
    rationale.push(
      `${slices.hiddenSignalIds.length} holdout signal(s) are rotated every ${config.rotation_period_days} day(s).`,
    )
  }

  let suspicion: GoodhartSuspicion = "low"
  if (
    slices.holdoutGap !== undefined &&
    slices.holdoutGap > config.max_visible_holdout_gap
  ) {
    suspicion = "elevated"
    rationale.push(
      `Visible signals are improving ${slices.holdoutGap.toFixed(2)} faster than the holdout slice.`,
    )
  }
  if (
    slices.recentHistoryCount >= config.min_history_points &&
    slices.velocityExcess > config.max_velocity_excess
  ) {
    suspicion = suspicion === "elevated" ? "high" : "elevated"
    rationale.push(
      `Visible-score velocity exceeds holdout velocity by ${slices.velocityExcess.toFixed(2)} across the recent window.`,
    )
  }

  return { suspicion, rationale }
}

export const projectObserverForAgent = (
  entry: TimeSeriesEntry | undefined,
  assessment: GoodhartAssessment,
): AgentFacingObserverView => {
  const categories = Object.fromEntries(
    CATEGORIES.map((category) => {
      const diagnostics = collectCategoryDiagnostics(entry, category, assessment.visibleSignalIds)
      const hiddenSignalCount = collectSignalsForCategory(
        entry,
        category,
      ).filter((signalId) => assessment.hiddenSignalIds.includes(signalId)).length
      return [category, { diagnostics, hiddenSignalCount }]
    }),
  ) as Record<Category, AgentFacingCategoryView>

  const reminders = [
    "Optimize for the concrete diagnostics below, not for any hidden pulsar number.",
    assessment.hiddenSignalIds.length > 0
      ? `${assessment.hiddenSignalIds.length} holdout signal(s) stay hidden to detect gaming pressure.`
      : "No holdout signals were selected for this snapshot.",
  ]

  return {
    categories,
    reminders,
    visibleSignalIds: assessment.visibleSignalIds,
    hiddenSignalIds: assessment.hiddenSignalIds,
  }
}

const collectCategoryDiagnostics = (
  entry: TimeSeriesEntry | undefined,
  category: Category,
  visibleSignalIds: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  if (entry?.signalDiagnostics === undefined) return []
  const messages: Array<string> = []
  for (const signalId of visibleSignalIds) {
    if (!(signalId in entry.observerOutput.categories[category].signals)) continue
    const diagnostics = entry.signalDiagnostics[signalId] ?? []
    for (const diagnostic of diagnostics) {
      const location = diagnostic.location?.file
        ? ` (${diagnostic.location.file}${diagnostic.location.line !== undefined ? `:${diagnostic.location.line}` : ""})`
        : ""
      messages.push(`${diagnostic.message}${location}`)
    }
  }
  return messages
}

const collectSignalsForCategory = (
  entry: TimeSeriesEntry | undefined,
  category: Category,
): ReadonlyArray<string> =>
  entry === undefined ? [] : Object.keys(entry.observerOutput.categories[category].signals)

const extractSignalIds = (entry: TimeSeriesEntry): ReadonlyArray<string> =>
  CATEGORIES.flatMap((category) => Object.keys(entry.observerOutput.categories[category].signals))
    .filter((signalId, index, all) => all.indexOf(signalId) === index)
    .sort((a, b) => a.localeCompare(b))

const pickHiddenSignals = (
  signalIds: ReadonlyArray<string>,
  timestamp: string,
  rotationWindowDays: number,
  holdoutRatio: number,
): ReadonlyArray<string> => {
  if (signalIds.length <= 2) return []
  const slot = Math.floor(Date.parse(timestamp) / (rotationWindowDays * 24 * 60 * 60 * 1000))
  const holdoutCount = Math.max(1, Math.floor(signalIds.length * holdoutRatio))
  return [...signalIds]
    .sort((left, right) => hashSignal(left, slot).localeCompare(hashSignal(right, slot)))
    .slice(0, holdoutCount)
    .sort((a, b) => a.localeCompare(b))
}

const hashSignal = (signalId: string, slot: number): string => {
  const hash = createHash("sha1")
  hash.update(`${slot}:${signalId}`)
  return hash.digest("hex")
}

const filterRecentEntries = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  latestTimestamp: string,
  trajectoryDays: number,
): ReadonlyArray<TimeSeriesEntry> => {
  const cutoff = Date.parse(latestTimestamp) - trajectoryDays * 24 * 60 * 60 * 1000
  return entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff)
}

const meanSignalScore = (
  entry: TimeSeriesEntry,
  signalIds: ReadonlyArray<string>,
): number | undefined => {
  if (signalIds.length === 0) return undefined
  const values = signalIds
    .map((signalId) => findSignalScore(entry, signalId))
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const trendDelta = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  signalIds: ReadonlyArray<string>,
): number => {
  if (entries.length < 2 || signalIds.length === 0) return 0
  const first = meanSignalScore(entries[0]!, signalIds)
  const last = meanSignalScore(entries.at(-1)!, signalIds)
  if (first === undefined || last === undefined) return 0
  return last - first
}

const findSignalScore = (
  entry: TimeSeriesEntry,
  signalId: string,
): number | undefined => {
  for (const category of CATEGORIES) {
    const value = entry.observerOutput.categories[category].signals[signalId]
    if (value !== undefined) return value
  }
  return undefined
}
