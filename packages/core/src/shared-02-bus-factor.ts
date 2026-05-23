import { Effect, Option, Schema } from "effect"
import type {
  CalibrationDecision,
  CalibrationProcessorError,
  ResolvedCalibrationContext,
  SharedBusFactorPolicyValue,
} from "./calibration-model.js"
import { CalibrationContextTag } from "./calibration-model.js"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import {
  commonDirectoryPrefix,
  factorEntryForPolicyDecision,
  factorPathSegment,
  relativeFactorPath,
} from "./factor-policy-ledger.js"
import { makeFactorLedger } from "./factor-ledger.js"
import type { SignalFactorLedger, SignalFactorLedgerEntry } from "./signal-factor-model.js"
import {
  buildBusFactorOutput,
  type Shared02BusFactorOutput as RawShared02BusFactorOutput,
} from "./shared-02-aggregation.js"
import { SignalComputeError } from "./errors.js"
import type { Signal } from "./signal.js"
import { loadTouchedFileHistory } from "./shared-02-history.js"
import { SHARED_PRODUCTION_EXCLUDE_GLOBS } from "./shared-history-defaults.js"
import {
  clamp01,
  listAuthorsByTouchedFileInWindow,
  loadAuthorAliases,
  readHeadDate,
} from "./shared-history.js"

export type {
  BusFactorInfo,
} from "./shared-02-aggregation.js"

interface Shared02EffectiveSilo {
  readonly file: string
  readonly author: string
  readonly loc: number
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly penaltyWeight: number
  readonly factorPathPrefix: string
  readonly policyDecisions: ReadonlyArray<CalibrationDecision>
}

export interface Shared02BusFactorOutput extends RawShared02BusFactorOutput {
  readonly topDiagnostics: number
  readonly effectiveSiloed?: ReadonlyArray<Shared02EffectiveSilo>
  readonly calibrationDecisions?: ReadonlyArray<CalibrationDecision>
  readonly factorLedger?: SignalFactorLedger
}

export const Shared02BusFactorConfig = Schema.Struct({
  window_days: Schema.Number,
  max_commits: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  min_loc: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type Shared02BusFactorConfig = typeof Shared02BusFactorConfig.Type

const DEFAULT_SHARED_02_BUS_FACTOR_CONFIG: Shared02BusFactorConfig = {
  window_days: 180,
  max_commits: 5000,
  include_extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"],
  exclude_globs: [...SHARED_PRODUCTION_EXCLUDE_GLOBS],
  min_loc: 50,
  top_n_diagnostics: 10,
}

/**
 * SHARED-02 — language-agnostic knowledge concentration from git history.
 * This lives in core so both the TS and Rust packs can re-export the same
 * deterministic compute instead of growing near-duplicate wrappers.
 */
export const Shared02BusFactor: Signal<
  Shared02BusFactorConfig,
  Shared02BusFactorOutput,
  SignalContextTag
> = {
  id: "SHARED-02-bus-factor",
  title: "Bus factor",
  aliases: ["SHARED-02"],
  tier: 1.5,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "bounded-history-v5-normalized-config-git-context-factor-policy",
  cacheDependencies: ["git-revision-context"],
  configSchema: Shared02BusFactorConfig,
  defaultConfig: DEFAULT_SHARED_02_BUS_FACTOR_CONFIG,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const normalizedConfig = normalizeShared02BusFactorConfig(config)

      const output = yield* Effect.tryPromise({
        try: () => computeBusFactorOutput(ctx.worktreePath, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-02-bus-factor",
            message: `Failed to compute bus factor: ${String(cause)}`,
            cause,
          }),
      })
      return yield* applyBusFactorPolicy(output, calibration).pipe(
        Effect.mapError(toSignalComputeError),
      )
    }),
  score: (out) => {
    if (out.touchedFileCount === 0) return 1
    if (out.touchedLoc === 0) return 1
    const penalty = effectiveSiloed(out).reduce(
      (sum, entry) =>
        entry.visible ? sum + Math.max(0, entry.penaltyWeight) : sum,
      0,
    )
    return 1 - Math.min(0.35, penalty)
  },
  outputMetadata: (out) => {
    if (out.touchedFileCount === 0 || out.touchedLoc === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    return undefined
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.touchedFileCount === 0) {
      return [
        {
          severity: "info",
          message: `SHARED-02 found no relevant files touched in the last ${out.windowDays} days`,
        },
      ]
    }

    if (out.repoAuthors.length < 2) {
      return [
        {
          severity: "info",
          message:
            `SHARED-02 found a single-author corpus in the last ${out.windowDays} days; ` +
            "treating touched production LOC as concentrated ownership",
          data: { authors: out.repoAuthors, windowDays: out.windowDays },
        },
      ]
    }

    return effectiveSiloed(out)
      .filter((entry) => entry.visible && entry.penaltyWeight > 0)
      .slice(0, out.topDiagnostics)
      .map((entry) => ({
        severity: entry.severity,
        message: `Knowledge silo candidate: ${entry.file} is single-author in the last ${out.windowDays} days (${entry.author}, ${entry.loc} LOC)`,
        location: { file: entry.file },
        data: {
          author: entry.author,
          windowDays: out.windowDays,
          loc: entry.loc,
          penaltyWeight: entry.penaltyWeight,
          policyDecisions: entry.policyDecisions,
        },
      }))
  },
  factorLedger: (out) => out.factorLedger,
}

const computeBusFactorOutput = async (
  worktreePath: string,
  config: Shared02BusFactorConfig,
): Promise<Shared02BusFactorOutput> => {
  if (config.include_extensions.length === 0) {
    return emptyOutput(config)
  }

  const headDate = await readHeadDate(worktreePath)
  const sinceDate = new Date(headDate.getTime() - config.window_days * 24 * 3600 * 1000)
  const aliasMap = await loadAuthorAliases(worktreePath)
  const authorsByFile = await listAuthorsByTouchedFileInWindow(
    worktreePath,
    sinceDate.toISOString(),
    headDate.toISOString(),
    {
      includeExtensions: config.include_extensions,
      excludeGlobs: config.exclude_globs,
      maxCommits: config.max_commits,
    },
  )
  const touchedFiles = await loadTouchedFileHistory(worktreePath, authorsByFile)
  return {
    ...buildBusFactorOutput(touchedFiles, aliasMap, config),
    topDiagnostics: config.top_n_diagnostics,
  }
}

const emptyOutput = (config: Shared02BusFactorConfig): Shared02BusFactorOutput => ({
  ...buildBusFactorOutput([], new Map(), config),
  topDiagnostics: config.top_n_diagnostics,
})

const normalizeShared02BusFactorConfig = (
  config: Shared02BusFactorConfig,
): Shared02BusFactorConfig => ({
  window_days: normalizePositiveFiniteNumber(
    config.window_days,
    DEFAULT_SHARED_02_BUS_FACTOR_CONFIG.window_days,
  ),
  max_commits: normalizePositiveInteger(
    config.max_commits,
    DEFAULT_SHARED_02_BUS_FACTOR_CONFIG.max_commits,
  ),
  include_extensions: stringArrayOrDefault(config.include_extensions, []),
  exclude_globs: stringArrayOrDefault(
    config.exclude_globs,
    DEFAULT_SHARED_02_BUS_FACTOR_CONFIG.exclude_globs,
  ),
  min_loc: normalizeNonNegativeInteger(
    config.min_loc,
    DEFAULT_SHARED_02_BUS_FACTOR_CONFIG.min_loc,
  ),
  top_n_diagnostics: normalizeDiagnosticLimit(config.top_n_diagnostics),
})

const normalizePositiveFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalizePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const normalizeNonNegativeInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback

const normalizeDiagnosticLimit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

const stringArrayOrDefault = (
  value: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : fallback

const applyBusFactorPolicy = (
  output: Shared02BusFactorOutput,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<Shared02BusFactorOutput, CalibrationProcessorError, never> => {
  if (output.touchedFileCount === 0 || output.touchedLoc === 0 || output.siloed.length === 0) {
    return Effect.succeed({
      ...output,
      effectiveSiloed: [],
      calibrationDecisions: [],
      factorLedger: makeFactorLedger("SHARED-02-bus-factor", []),
    })
  }

  const factorPathRoot = commonDirectoryPrefix(output.siloed.map((entry) => entry.file))
  return Effect.gen(function* () {
    const effectiveSiloedEntries = yield* Effect.forEach(
      output.siloed,
      (entry) =>
        Effect.gen(function* () {
          const input = defaultBusFactorPolicy(entry, output, factorPathRoot)
          if (Option.isNone(calibration)) return toEffectiveSilo(entry, input, [])
          const policy = yield* calibration.value.runSlot("shared.bus-factor-policy", input)
          return toEffectiveSilo(entry, policy.value, policy.decisions)
        }),
      { concurrency: 1 },
    )

    return {
      ...output,
      effectiveSiloed: effectiveSiloedEntries,
      calibrationDecisions: effectiveSiloedEntries.flatMap((entry) => entry.policyDecisions),
      factorLedger: makeShared02FactorLedger(effectiveSiloedEntries),
    }
  })
}

const defaultBusFactorPolicy = (
  entry: RawShared02BusFactorOutput["siloed"][number],
  output: RawShared02BusFactorOutput,
  factorPathRoot: string,
): SharedBusFactorPolicyValue => ({
  signalId: "SHARED-02-bus-factor",
  findingId: entry.file,
  file: entry.file,
  author: entry.author,
  loc: entry.loc,
  windowDays: output.windowDays,
  maxCommits: output.maxCommits,
  touchedFileCount: output.touchedFileCount,
  touchedLoc: output.touchedLoc,
  repoAuthors: output.repoAuthors,
  visible: true,
  severity: entry.loc >= 200 ? "warn" : "info",
  penaltyWeight: defaultBusFactorPenaltyWeight(entry.loc, output.touchedLoc),
  factorPathPrefix: `bus_factor.${factorPathSegment(relativeFactorPath(entry.file, factorPathRoot))}`,
})

const toEffectiveSilo = (
  entry: RawShared02BusFactorOutput["siloed"][number],
  policy: SharedBusFactorPolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): Shared02EffectiveSilo => ({
  ...entry,
  visible: policy.visible,
  severity: policy.severity,
  penaltyWeight: policy.penaltyWeight,
  factorPathPrefix: policy.factorPathPrefix,
  policyDecisions: decisions,
})

const effectiveSiloed = (
  output: Shared02BusFactorOutput,
): ReadonlyArray<Shared02EffectiveSilo> =>
  output.effectiveSiloed ?? output.siloed.map((entry) =>
    toEffectiveSilo(entry, defaultBusFactorPolicy(entry, output, ""), []),
  )

const defaultBusFactorPenaltyWeight = (loc: number, touchedLoc: number): number =>
  touchedLoc === 0 ? 0 : clamp01(loc / touchedLoc) * 0.45

const makeShared02FactorLedger = (
  entries: ReadonlyArray<Shared02EffectiveSilo>,
): SignalFactorLedger =>
  makeFactorLedger(
    "SHARED-02-bus-factor",
    entries.flatMap((entry): ReadonlyArray<SignalFactorLedgerEntry> => [
      factorEntryForPolicyDecision({
        decisions: entry.policyDecisions,
        path: `${entry.factorPathPrefix}.visible`,
        title: "Bus factor visible",
        value: entry.visible,
      }),
      factorEntryForPolicyDecision({
        decisions: entry.policyDecisions,
        path: `${entry.factorPathPrefix}.severity`,
        title: "Bus factor severity",
        value: entry.severity,
      }),
      factorEntryForPolicyDecision({
        decisions: entry.policyDecisions,
        path: `${entry.factorPathPrefix}.penalty_weight`,
        title: "Bus factor penalty_weight",
        value: entry.penaltyWeight,
      }),
    ]),
  )

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "SHARED-02-bus-factor",
        message: String(cause),
        cause,
      })
