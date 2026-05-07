import { execFile } from "node:child_process"
import { realpathSync } from "node:fs"
import { appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { promisify } from "node:util"
import { Effect, Option, Schema } from "effect"
import { CATEGORIES, type Category } from "./category.js"
import {
  Diagnostic as DiagnosticSchema,
  type Diagnostic,
} from "./diagnostic.js"
import {
  ObserverOutput as ObserverOutputSchema,
  OBSERVER_OUTPUT_SEMANTICS,
  toObserverJson,
  type ObserverOutput,
  type ReadinessOutput,
  type ReadinessPressure,
} from "./observer.js"

const execFileAsync = promisify(execFile)

export const TIME_SERIES_DIRECTORY = ".pulsar/time-series" as const
export const DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD = 10_000
export const DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS = 90
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_LOCK_RETRY_MS = 25
const DAY_MS = 24 * 60 * 60 * 1000

export class TimeSeriesReadFailed extends Schema.TaggedError<TimeSeriesReadFailed>()(
  "TimeSeriesReadFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TimeSeriesWriteFailed extends Schema.TaggedError<TimeSeriesWriteFailed>()(
  "TimeSeriesWriteFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TimeSeriesLockFailed extends Schema.TaggedError<TimeSeriesLockFailed>()(
  "TimeSeriesLockFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export type TimeSeriesError =
  | TimeSeriesReadFailed
  | TimeSeriesWriteFailed
  | TimeSeriesLockFailed

export const TimeSeriesAggregate = Schema.Struct({
  kind: Schema.Literal("weekly-average"),
  from: Schema.String,
  to: Schema.String,
  sample_count: Schema.Number,
  commit_shas: Schema.Array(Schema.String),
  observer_semantics: Schema.optional(
    Schema.Literal("readiness-aware", "legacy-compatibility"),
  ),
  readiness_sample_count: Schema.optional(Schema.Number),
  compatibility_reason: Schema.optional(Schema.String),
})
export type TimeSeriesAggregate = typeof TimeSeriesAggregate.Type

const SignalDiagnostics = Schema.Record({
  key: Schema.String,
  value: Schema.Array(DiagnosticSchema),
})

export const TimeSeriesEntry = Schema.Struct({
  sha: Schema.String,
  timestamp: Schema.String,
  observerOutput: ObserverOutputSchema,
  signalDiagnostics: Schema.optional(SignalDiagnostics),
  inactiveSignals: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.Literal("raw", "weekly-average"),
  aggregate: Schema.optional(TimeSeriesAggregate),
})
export type TimeSeriesEntry = typeof TimeSeriesEntry.Type

export interface TimeSeriesRange {
  readonly from?: string
  readonly to?: string
}

export interface TimeSeriesReader {
  readonly entries: (
    range?: TimeSeriesRange,
  ) => Effect.Effect<ReadonlyArray<TimeSeriesEntry>, TimeSeriesError>
  readonly latest: Effect.Effect<Option.Option<TimeSeriesEntry>, TimeSeriesError>
  readonly atSha: (sha: string) => Effect.Effect<Option.Option<TimeSeriesEntry>, TimeSeriesError>
}

export interface TimeSeriesAppendResult {
  readonly status: "written" | "duplicate"
  readonly entry: TimeSeriesEntry
}

export type TimeSeriesEntrySubscriber = (
  entry: TimeSeriesEntry,
) => void | Promise<void>

export interface TimeSeriesWriter {
  readonly append: (
    entry: TimeSeriesEntry,
  ) => Effect.Effect<TimeSeriesAppendResult, TimeSeriesError>
  readonly appendObservation: (
    sha: string,
    observerOutput: ObserverOutput,
  ) => Effect.Effect<TimeSeriesAppendResult, TimeSeriesError>
  readonly onEntry: (subscriber: TimeSeriesEntrySubscriber) => void
}

export interface TimeSeriesServices {
  readonly repoId: string
  readonly filePath: string
  readonly reader: TimeSeriesReader
  readonly writer: TimeSeriesWriter
}

export interface TimeSeriesOptions {
  readonly repoId?: string
  readonly compactionThreshold?: number
  readonly rawRetentionDays?: number
  readonly lockTimeoutMs?: number
  readonly lockRetryMs?: number
}

export const defaultTimeSeriesRepoId = (repoPath: string): string =>
  basename(repoPath).replace(/[^A-Za-z0-9._-]+/g, "-") || "repo"

export const resolveTimeSeriesPath = (repoPath: string, repoId: string): string =>
  join(repoPath, TIME_SERIES_DIRECTORY, `${repoId}.jsonl`)

export const createTimeSeriesServices = (
  repoPath: string,
  options?: TimeSeriesOptions,
): TimeSeriesServices => {
  const canonicalRepoPath = normalizeRepoPath(repoPath)
  const repoId = options?.repoId ?? defaultTimeSeriesRepoId(canonicalRepoPath)
  const filePath = resolveTimeSeriesPath(canonicalRepoPath, repoId)
  const subscribers: Array<TimeSeriesEntrySubscriber> = []

  const readEntriesEffect = (range?: TimeSeriesRange) =>
    Effect.tryPromise({
      try: async () => {
        const entries = await readTimeSeriesEntries(canonicalRepoPath, filePath)
        return applyTimeRange(entries, range)
      },
      catch: (cause) =>
        normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "read"),
    })

  const reader: TimeSeriesReader = {
    entries: (range) => readEntriesEffect(range),
    latest: readEntriesEffect().pipe(
      Effect.map((entries) => Option.fromNullable(entries.at(-1))),
    ),
    atSha: (sha) =>
      readEntriesEffect().pipe(
        Effect.map((entries) =>
          Option.fromNullable(
            entries.find(
              (entry) =>
                entry.sha === sha ||
                entry.aggregate?.commit_shas.includes(sha) === true,
            ),
          ),
        ),
      ),
  }

  const writer: TimeSeriesWriter = {
    append: (entry) =>
      Effect.tryPromise({
        try: async () => {
          const normalized = Schema.decodeUnknownSync(TimeSeriesEntry)(entry)
          const result = await appendTimeSeriesEntry({
            repoPath: canonicalRepoPath,
            filePath,
            entry: normalized,
            compactionThreshold:
              options?.compactionThreshold ?? DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD,
            rawRetentionDays:
              options?.rawRetentionDays ?? DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS,
            lockTimeoutMs: options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
            lockRetryMs: options?.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS,
          })
          if (result.status === "written") {
            for (const subscriber of subscribers) {
              await subscriber(result.entry)
            }
          }
          return result
        },
        catch: (cause) =>
          normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "write"),
      }),
    appendObservation: (sha, observerOutput) =>
      Effect.tryPromise({
        try: async () => {
          const timestamp = await readCommitTimestamp(canonicalRepoPath, filePath, sha)
          return await Effect.runPromise(
            writer.append({
              sha,
              timestamp,
              observerOutput: toObserverJson(observerOutput),
              signalDiagnostics: signalDiagnosticsFromObserver(observerOutput),
              inactiveSignals: [...observerOutput.inactiveSignals],
              source: "raw",
            }),
          )
        },
        catch: (cause) =>
          normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "write"),
      }),
    onEntry: (subscriber) => {
      subscribers.push(subscriber)
    },
  }

  return { repoId, filePath, reader, writer }
}

const normalizeRepoPath = (repoPath: string): string => {
  try {
    return realpathSync.native(repoPath)
  } catch {
    return repoPath
  }
}

const readCommitTimestamp = async (
  repoPath: string,
  filePath: string,
  sha: string,
): Promise<string> => {
  try {
    const result = await execFileAsync("git", ["show", "-s", "--format=%cI", sha], {
      cwd: repoPath,
    })
    return result.stdout.trim()
  } catch (error) {
    throw new TimeSeriesWriteFailed({
      repoPath,
      filePath,
      message: `git show failed for ${sha}: ${String(error)}`,
    })
  }
}

const signalDiagnosticsFromObserver = (
  observerOutput: ObserverOutput,
): Record<string, ReadonlyArray<Diagnostic>> =>
  Object.fromEntries(
    [...observerOutput.signalResults.entries()]
      .filter(([, result]) => result.diagnostics.length > 0)
      .map(([signalId, result]) => [signalId, result.diagnostics]),
  )

const appendTimeSeriesEntry = async (args: {
  readonly repoPath: string
  readonly filePath: string
  readonly entry: TimeSeriesEntry
  readonly compactionThreshold: number
  readonly rawRetentionDays: number
  readonly lockTimeoutMs: number
  readonly lockRetryMs: number
}): Promise<TimeSeriesAppendResult> => {
  await mkdir(join(args.repoPath, TIME_SERIES_DIRECTORY), { recursive: true })
  return withTimeSeriesLock(
    args.repoPath,
    args.filePath,
    args.lockTimeoutMs,
    args.lockRetryMs,
    async () => {
      const existing = await readTimeSeriesEntries(args.repoPath, args.filePath)
      const duplicate = existing.find(
        (entry) =>
          entry.sha === args.entry.sha ||
          entry.aggregate?.commit_shas.includes(args.entry.sha) === true,
      )
      if (duplicate !== undefined) {
        return { status: "duplicate", entry: duplicate }
      }

      const next = [...existing, args.entry].sort(compareTimeSeriesEntries)
      if (next.length > args.compactionThreshold) {
        const compacted = compactTimeSeriesEntries(next, args.rawRetentionDays)
        await writeTimeSeriesEntries(args.filePath, compacted)
      } else {
        await appendFile(args.filePath, `${JSON.stringify(args.entry)}\n`, "utf8")
      }

      return { status: "written", entry: args.entry }
    },
  )
}

const withTimeSeriesLock = async <A>(
  repoPath: string,
  filePath: string,
  timeoutMs: number,
  retryMs: number,
  run: () => Promise<A>,
): Promise<A> => {
  const lockPath = `${filePath}.lock`
  const start = Date.now()

  while (true) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(lockPath, "wx")
      await handle.close()
      break
    } catch (error) {
      const code = errorCodeOf(error)
      if (code !== "EEXIST") {
        throw new TimeSeriesLockFailed({
          repoPath,
          filePath,
          message: String(error),
        })
      }
      if (Date.now() - start >= timeoutMs) {
        throw new TimeSeriesLockFailed({
          repoPath,
          filePath,
          message: `Timed out waiting for ${lockPath}`,
        })
      }
      await sleep(retryMs)
      continue
    }
  }

  try {
    return await run()
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined)
  }
}

const readTimeSeriesEntries = async (
  repoPath: string,
  filePath: string,
): Promise<ReadonlyArray<TimeSeriesEntry>> => {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return []
    throw new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(error),
    })
  }

  const entries: Array<TimeSeriesEntry> = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      entries.push(Schema.decodeUnknownSync(TimeSeriesEntry)(JSON.parse(trimmed)))
    } catch (error) {
      throw new TimeSeriesReadFailed({
        repoPath,
        filePath,
        message: `Invalid JSONL entry: ${String(error)}`,
      })
    }
  }
  return entries.sort(compareTimeSeriesEntries)
}

const writeTimeSeriesEntries = async (
  filePath: string,
  entries: ReadonlyArray<TimeSeriesEntry>,
): Promise<void> => {
  await writeFile(
    filePath,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )
}

const compactTimeSeriesEntries = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  rawRetentionDays: number,
): ReadonlyArray<TimeSeriesEntry> => {
  if (entries.length === 0) return entries
  const latestTimestamp = Date.parse(entries.at(-1)?.timestamp ?? new Date(0).toISOString())
  const retentionCutoff = latestTimestamp - rawRetentionDays * DAY_MS

  const recent = entries.filter((entry) => Date.parse(entry.timestamp) >= retentionCutoff)
  const older = entries.filter((entry) => Date.parse(entry.timestamp) < retentionCutoff)
  if (older.length === 0) return entries

  const byWeek = new Map<string, Array<TimeSeriesEntry>>()
  for (const entry of older) {
    const key = isoWeekKey(new Date(entry.timestamp))
    const bucket = byWeek.get(key) ?? []
    bucket.push(entry)
    byWeek.set(key, bucket)
  }

  const compacted = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, bucket]) => aggregateWeek(bucket))

  return [...compacted, ...recent].sort(compareTimeSeriesEntries)
}

const aggregateWeek = (entries: ReadonlyArray<TimeSeriesEntry>): TimeSeriesEntry => {
  const weightedEntries = entries.map((entry) => ({
    entry,
    weight: entry.aggregate?.sample_count ?? 1,
  }))
  const totalWeight = weightedEntries.reduce((sum, item) => sum + item.weight, 0)
  const earliest = entries[0]?.timestamp ?? new Date(0).toISOString()
  const latest = entries.at(-1)?.timestamp ?? earliest
  const signalAverages = new Map<string, { category: Category; total: number }>()
  const readiness = aggregateReadiness(weightedEntries, totalWeight)
  const signalMetadata = aggregateSignalMetadata(weightedEntries)
  const readinessSampleCount = weightedEntries
    .filter(({ entry }) => entry.observerOutput.readiness !== undefined)
    .reduce((sum, item) => sum + item.weight, 0)

  const categories = Object.fromEntries(
    CATEGORIES.map((category) => {
      let categorySum = 0
      const signals: Record<string, number> = {}

      for (const { entry, weight } of weightedEntries) {
        const snapshot = entry.observerOutput.categories[category]
        categorySum += snapshot.score * weight
        for (const [signalId, score] of Object.entries(snapshot.signals)) {
          const existing = signalAverages.get(signalId) ?? { category, total: 0 }
          existing.total += score * weight
          signalAverages.set(signalId, existing)
        }
      }

      for (const [signalId, average] of signalAverages.entries()) {
        if (average.category === category) {
          signals[signalId] = average.total / totalWeight
        }
      }

      return [
        category,
        {
          score: categorySum / totalWeight,
          signals,
          ...aggregateCategoryMetadata(weightedEntries, category, totalWeight),
        },
      ]
    }),
  ) as ReturnType<typeof toObserverJson>["categories"]

  const minimum = computeAggregateMinimum(signalAverages, totalWeight)
  const weightedMean =
    weightedEntries.reduce(
      (sum, { entry, weight }) => sum + entry.observerOutput.weighted_mean * weight,
      0,
    ) / totalWeight
  const hardGateStatus = weightedEntries.some(
    ({ entry }) => entry.observerOutput.hard_gate_status === "fail",
  )
    ? "fail"
    : "pass"
  const commitShas = weightedEntries.flatMap(({ entry }) =>
    entry.aggregate?.commit_shas ?? [entry.sha],
  )
  const weekStart = startOfIsoWeek(new Date(earliest))
  const weekEnd = endOfIsoWeek(new Date(latest))

  return {
    sha: `aggregate:${isoWeekKey(weekStart)}`,
    timestamp: weekEnd.toISOString(),
    source: "weekly-average",
    aggregate: {
      kind: "weekly-average",
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      sample_count: commitShas.length,
      commit_shas: commitShas,
      observer_semantics:
        readiness === undefined ? "legacy-compatibility" : "readiness-aware",
      readiness_sample_count: readinessSampleCount,
      ...(readiness === undefined
        ? {
            compatibility_reason:
              readinessSampleCount === 0
                ? "source rows predate readiness/applicability metadata"
                : "source rows mix readiness-aware and legacy observer semantics",
          }
        : {}),
    },
    observerOutput: {
      observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
      categories,
      minimum,
      weighted_mean: weightedMean,
      ...(readiness !== undefined ? { readiness } : {}),
      hard_gate_status: hardGateStatus,
      hard_gate_violations: [],
      ...(signalMetadata !== undefined ? { signal_metadata: signalMetadata } : {}),
    },
    inactiveSignals: [],
  }
}

type WeightedEntry = {
  readonly entry: TimeSeriesEntry
  readonly weight: number
}

const aggregateCategoryMetadata = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
  category: Category,
  totalWeight: number,
): Partial<ReturnType<typeof toObserverJson>["categories"][Category]> => {
  const snapshots = weightedEntries.map(({ entry }) => entry.observerOutput.categories[category])
  const withSignalCount = snapshots.every((snapshot) => snapshot.signalCount !== undefined)
  const withApplicableSignalCount = snapshots.every(
    (snapshot) => snapshot.applicableSignalCount !== undefined,
  )
  const withActiveSignalIds = snapshots.every(
    (snapshot) => snapshot.activeSignalIds !== undefined,
  )

  return {
    ...(withSignalCount
      ? {
          signalCount:
            weightedEntries.reduce(
              (sum, { entry, weight }) =>
                sum + (entry.observerOutput.categories[category].signalCount ?? 0) * weight,
              0,
            ) / totalWeight,
        }
      : {}),
    ...(withApplicableSignalCount
      ? {
          applicableSignalCount:
            weightedEntries.reduce(
              (sum, { entry, weight }) =>
                sum +
                (entry.observerOutput.categories[category].applicableSignalCount ?? 0) *
                  weight,
              0,
            ) / totalWeight,
        }
      : {}),
    ...(withActiveSignalIds
      ? {
          activeSignalIds: [
            ...new Set(snapshots.flatMap((snapshot) => snapshot.activeSignalIds ?? [])),
          ].sort(),
        }
      : {}),
  }
}

const aggregateReadiness = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
  totalWeight: number,
): ReadinessOutput | undefined => {
  if (
    weightedEntries.length === 0 ||
    weightedEntries.some(({ entry }) => entry.observerOutput.readiness === undefined)
  ) {
    return undefined
  }

  const readinessEntries = weightedEntries.map(({ entry, weight }) => ({
    readiness: entry.observerOutput.readiness as ReadinessOutput,
    weight,
  }))
  const maxPressureCount = Math.max(
    ...readinessEntries.map(({ readiness }) => readiness.top_pressures.length),
    0,
  )

  return {
    score: weightedAverage(readinessEntries, ({ readiness }) => readiness.score, totalWeight),
    pressure: weightedAverage(
      readinessEntries,
      ({ readiness }) => readiness.pressure,
      totalWeight,
    ),
    status: worstReadinessStatus(readinessEntries.map(({ readiness }) => readiness.status)),
    aggregation: {
      strategy: "pressure-pnorm-local-max",
      p: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.p, totalWeight),
      mean_pressure: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.mean_pressure,
        totalWeight,
      ),
      pnorm_pressure: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.pnorm_pressure,
        totalWeight,
      ),
      max_local_pressure: Math.max(
        ...readinessEntries.map(({ readiness }) => readiness.aggregation.max_local_pressure),
      ),
      failed_signal_pressure: Math.max(
        ...readinessEntries.map(
          ({ readiness }) => readiness.aggregation.failed_signal_pressure ?? 0,
        ),
      ),
      hard_gate_pressure: Math.max(
        ...readinessEntries.map(({ readiness }) => readiness.aggregation.hard_gate_pressure),
      ),
      hard_gate_score_cap: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.hard_gate_score_cap,
        totalWeight,
      ),
      local_warning_threshold: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.local_warning_threshold,
        totalWeight,
      ),
      local_poison_threshold: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.local_poison_threshold,
        totalWeight,
      ),
      local_warning_gain: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.local_warning_gain,
        totalWeight,
      ),
      applicable_signal_count: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.applicable_signal_count,
        totalWeight,
      ),
      ignored_signal_count: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.ignored_signal_count,
        totalWeight,
      ),
      failed_signal_count: weightedAverage(
        readinessEntries,
        ({ readiness }) => readiness.aggregation.failed_signal_count ?? 0,
        totalWeight,
      ),
    },
    top_pressures: aggregateTopPressures(readinessEntries, maxPressureCount),
  }
}

const aggregateTopPressures = (
  readinessEntries: ReadonlyArray<{
    readonly readiness: ReadinessOutput
    readonly weight: number
  }>,
  limit: number,
): ReadonlyArray<ReadinessPressure> => {
  const grouped = new Map<
    string,
    {
      pressure: ReadinessPressure
      totalWeight: number
      score: number
      rawPressure: number
      effectivePressure: number
      weight: number
      confidence: number
    }
  >()

  for (const { readiness, weight } of readinessEntries) {
    for (const pressure of readiness.top_pressures) {
      const key = [
        pressure.signal_id,
        pressure.category,
        pressure.applicability,
      ].join("\u0000")
      const existing = grouped.get(key) ?? {
        pressure,
        totalWeight: 0,
        score: 0,
        rawPressure: 0,
        effectivePressure: 0,
        weight: 0,
        confidence: 0,
      }
      existing.totalWeight += weight
      existing.score += pressure.score * weight
      existing.rawPressure += pressure.raw_pressure * weight
      existing.effectivePressure += pressure.effective_pressure * weight
      existing.weight += pressure.weight * weight
      existing.confidence += pressure.confidence * weight
      grouped.set(key, existing)
    }
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item.pressure,
      score: item.score / item.totalWeight,
      raw_pressure: item.rawPressure / item.totalWeight,
      effective_pressure: item.effectivePressure / item.totalWeight,
      weight: item.weight / item.totalWeight,
      confidence: item.confidence / item.totalWeight,
    }))
    .sort(
      (left, right) =>
        right.effective_pressure - left.effective_pressure ||
        left.signal_id.localeCompare(right.signal_id),
    )
    .slice(0, limit)
}

const aggregateSignalMetadata = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
): ObserverOutput["signal_metadata"] | undefined => {
  if (
    weightedEntries.length === 0 ||
    weightedEntries.some(({ entry }) => entry.observerOutput.signal_metadata === undefined)
  ) {
    return undefined
  }

  const signalIds = [
    ...new Set(
      weightedEntries.flatMap(({ entry }) =>
        Object.keys(entry.observerOutput.signal_metadata ?? {}),
      ),
    ),
  ].sort()

  return Object.fromEntries(
    signalIds.map((signalId) => {
      const metadata = weightedEntries.flatMap(({ entry, weight }) => {
        const item = entry.observerOutput.signal_metadata?.[signalId]
        return item === undefined ? [] : [{ item, weight }]
      })
      const hasMetadataForEverySource = metadata.length === weightedEntries.length
      const applicabilityValues = new Set(
        metadata.map(({ item }) => item.applicability).filter((value) => value !== undefined),
      )
      const computedAt = metadata
        .map(({ item }) => item.computedAt)
        .filter((value) => value !== undefined)
        .sort()
        .at(-1)
      const effectiveConfidence = averageOptional(
        metadata,
        ({ item }) => item.effectiveConfidence,
      )
      const baseConfidence = averageOptional(metadata, ({ item }) => item.baseConfidence)

      return [
        signalId,
        {
          ...(effectiveConfidence !== undefined ? { effectiveConfidence } : {}),
          ...(baseConfidence !== undefined ? { baseConfidence } : {}),
          ...(computedAt !== undefined ? { computedAt } : {}),
          ...(metadata.some(({ item }) => item.stale === true) ? { stale: true } : {}),
          ...(hasMetadataForEverySource && applicabilityValues.size === 1
            ? { applicability: [...applicabilityValues][0] }
            : {}),
        },
      ]
    }),
  )
}

const weightedAverage = <A>(
  entries: ReadonlyArray<{ readonly weight: number } & A>,
  value: (entry: A) => number,
  totalWeight: number,
): number =>
  entries.reduce((sum, entry) => sum + value(entry) * entry.weight, 0) / totalWeight

const averageOptional = <A>(
  entries: ReadonlyArray<{ readonly weight: number } & A>,
  value: (entry: A) => number | undefined,
): number | undefined => {
  let total = 0
  let weight = 0
  for (const entry of entries) {
    const item = value(entry)
    if (item === undefined) continue
    total += item * entry.weight
    weight += entry.weight
  }
  return weight === 0 ? undefined : total / weight
}

const worstReadinessStatus = (
  statuses: ReadonlyArray<ReadinessOutput["status"]>,
): ReadinessOutput["status"] => {
  const rank: Record<ReadinessOutput["status"], number> = {
    green: 0,
    unknown: 1,
    yellow: 2,
    red: 3,
    blocked: 4,
    failed: 5,
  }
  return statuses.reduce<ReadinessOutput["status"]>(
    (worst, status) => (rank[status] > rank[worst] ? status : worst),
    "green",
  )
}

const computeAggregateMinimum = (
  signals: ReadonlyMap<string, { category: Category; total: number }>,
  totalWeight: number,
): ReturnType<typeof toObserverJson>["minimum"] => {
  let best:
    | {
        signal: string
        category: Category
        score: number
      }
    | undefined

  for (const [signalId, aggregate] of signals.entries()) {
    const score = aggregate.total / totalWeight
    if (
      best === undefined ||
      score < best.score ||
      (score === best.score && signalId.localeCompare(best.signal) < 0)
    ) {
      best = { signal: signalId, category: aggregate.category, score }
    }
  }

  if (best === undefined) return undefined
  return {
    signal: best.signal,
    category: best.category,
    score: best.score,
    detail: `Compacted weekly average across ${totalWeight} entries`,
  }
}

const applyTimeRange = (
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

const normalizeTimeSeriesError = (
  repoPath: string,
  filePath: string,
  cause: unknown,
  phase: "read" | "write",
): TimeSeriesError => {
  if (
    cause instanceof TimeSeriesReadFailed ||
    cause instanceof TimeSeriesWriteFailed ||
    cause instanceof TimeSeriesLockFailed
  ) {
    return cause
  }
  if (phase === "read") {
    return new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(cause),
    })
  }
  return new TimeSeriesWriteFailed({
    repoPath,
    filePath,
    message: String(cause),
  })
}

const compareTimeSeriesEntries = (left: TimeSeriesEntry, right: TimeSeriesEntry): number => {
  const delta = Date.parse(left.timestamp) - Date.parse(right.timestamp)
  if (delta !== 0) return delta
  return left.sha.localeCompare(right.sha)
}

const isoWeekKey = (date: Date): string => {
  const start = startOfIsoWeek(date)
  return `${start.getUTCFullYear()}-W${String(isoWeekNumber(start)).padStart(2, "0")}`
}

const startOfIsoWeek = (date: Date): Date => {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = copy.getUTCDay() || 7
  copy.setUTCDate(copy.getUTCDate() - day + 1)
  copy.setUTCHours(0, 0, 0, 0)
  return copy
}

const endOfIsoWeek = (date: Date): Date => {
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
