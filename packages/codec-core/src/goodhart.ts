import { createHash } from "node:crypto"
import { CATEGORIES, type Category } from "./category.js"
import { type TimeSeriesEntry } from "./time-series.js"
import { backpressureConfigOf, type TasteVector } from "./vector.js"

export type GoodhartSuspicion = "low" | "elevated" | "high"

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

export interface AgentFacingCategoryView {
  readonly diagnostics: ReadonlyArray<string>
  readonly hiddenSignalCount: number
}

export interface AgentFacingObserverView {
  readonly categories: Record<Category, AgentFacingCategoryView>
  readonly reminders: ReadonlyArray<string>
  readonly visibleSignalIds: ReadonlyArray<string>
  readonly hiddenSignalIds: ReadonlyArray<string>
}

export const evaluateGoodhart = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  vector: TasteVector | undefined,
): GoodhartAssessment => {
  const latest = entries.at(-1)
  if (latest === undefined) {
    return {
      suspicion: "low",
      rationale: ["No score history exists yet."],
      visibleSignalIds: [],
      hiddenSignalIds: [],
      visibleScore: undefined,
      hiddenScore: undefined,
      holdoutGap: undefined,
      visibleTrend: 0,
      hiddenTrend: 0,
      velocityExcess: 0,
      rotationWindowDays: backpressureConfigOf(vector).goodhart.rotation_period_days,
    }
  }

  const config = backpressureConfigOf(vector).goodhart
  const signalIds = extractSignalIds(latest)
  if (signalIds.length === 0) {
    return {
      suspicion: "low",
      rationale: ["No active signals were present in the latest observation."],
      visibleSignalIds: [],
      hiddenSignalIds: [],
      visibleScore: undefined,
      hiddenScore: undefined,
      holdoutGap: undefined,
      visibleTrend: 0,
      hiddenTrend: 0,
      velocityExcess: 0,
      rotationWindowDays: config.rotation_period_days,
    }
  }

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
    backpressureConfigOf(vector).trajectory_days,
  )
  const visibleTrend = trendDelta(relevantEntries, visibleSignalIds)
  const hiddenTrend = trendDelta(relevantEntries, hiddenSignalIds)
  const holdoutGap =
    latestVisibleScore !== undefined && latestHiddenScore !== undefined
      ? latestVisibleScore - latestHiddenScore
      : undefined
  const velocityExcess = visibleTrend - hiddenTrend

  const rationale: Array<string> = [
    "Numeric score surfaces stay hidden from the agent; only concrete diagnostics are exposed.",
  ]
  if (hiddenSignalIds.length > 0) {
    rationale.push(
      `${hiddenSignalIds.length} holdout signal(s) are rotated every ${config.rotation_period_days} day(s).`,
    )
  }

  let suspicion: GoodhartSuspicion = "low"
  if (holdoutGap !== undefined && holdoutGap > config.max_visible_holdout_gap) {
    suspicion = "elevated"
    rationale.push(
      `Visible signals are improving ${holdoutGap.toFixed(2)} faster than the holdout slice.`,
    )
  }
  if (
    relevantEntries.length >= config.min_history_points &&
    velocityExcess > config.max_velocity_excess
  ) {
    suspicion = suspicion === "elevated" ? "high" : "elevated"
    rationale.push(
      `Visible-score velocity exceeds holdout velocity by ${velocityExcess.toFixed(2)} across the recent window.`,
    )
  }

  return {
    suspicion,
    rationale,
    visibleSignalIds,
    hiddenSignalIds,
    visibleScore: latestVisibleScore,
    hiddenScore: latestHiddenScore,
    holdoutGap,
    visibleTrend,
    hiddenTrend,
    velocityExcess,
    rotationWindowDays: config.rotation_period_days,
  }
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
    "Optimize for the concrete diagnostics below, not for any hidden codec number.",
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
