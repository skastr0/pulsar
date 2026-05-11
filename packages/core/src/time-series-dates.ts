import type { TimeSeriesEntry, TimeSeriesRange } from "./time-series.js"

export const DAY_MS = 24 * 60 * 60 * 1000

export const applyTimeRange = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  range?: TimeSeriesRange,
): ReadonlyArray<TimeSeriesEntry> => {
  if (range === undefined) return entries
  const from = range.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(range.from)
  const to = range.to === undefined ? Number.POSITIVE_INFINITY : Date.parse(range.to)
  return entries.filter((entry) => {
    const value = Date.parse(entry.timestamp)
    return value >= from && value <= to
  })
}

export const compareTimeSeriesEntries = (left: TimeSeriesEntry, right: TimeSeriesEntry): number => {
  const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp)
  if (delta !== 0) return delta
  return left.sha.localeCompare(right.sha)
}

export const isoWeekKey = (date: Date): string => {
  const start = startOfIsoWeek(date)
  return `${start.getUTCFullYear()}-W${String(isoWeekNumber(start)).padStart(2, "0")}`
}

export const startOfIsoWeek = (date: Date): Date => {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = copy.getUTCDay() || 7
  copy.setUTCDate(copy.getUTCDate() - day + 1)
  copy.setUTCHours(0, 0, 0, 0)
  return copy
}

export const endOfIsoWeek = (date: Date): Date => {
  const start = startOfIsoWeek(date)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  end.setUTCHours(23, 59, 59, 999)
  return end
}

const isoWeekNumber = (date: Date): number => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
}
