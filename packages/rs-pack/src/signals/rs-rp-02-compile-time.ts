import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  access,
  readFile,
} from "node:fs/promises"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Effect, Schema } from "effect"
import { RustProjectTag, type RustManifestInfo } from "../project.js"

const execFileAsync = promisify(execFile)

const RsRp02Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  measure_live_builds: Schema.Boolean,
})
type RsRp02Config = typeof RsRp02Config.Type

interface CargoTimingUnit {
  readonly i: number
  readonly name: string
  readonly version?: string
  readonly target?: string
  readonly duration: number
  readonly rmeta_time?: number
  readonly unblocked_units?: ReadonlyArray<number>
  readonly unblocked_rmeta_units?: ReadonlyArray<number>
}

interface CompileTimingCrate {
  readonly crate: string
  readonly totalDurationMs: number
  readonly unitCount: number
  readonly cascadeImpact: number
  readonly incrementalCacheHitRate: number | undefined
}

interface RsRp02Output {
  readonly crates: ReadonlyArray<CompileTimingCrate>
  readonly totalUnits: number
  readonly buildStatus: "measured" | "unavailable"
  readonly unavailableReason?: "no-cargo-project" | "missing-timing-data" | "invalid-timing-data" | "cargo-build-failed"
  readonly timingSource: "cargo-timings-html"
  readonly cacheProbeMode: "noop-second-build" | "unavailable"
  readonly measurementMode: "existing-cargo-timings" | "live-cargo-build"
  readonly manifestCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "slowest-crate-compile-duration"
  readonly scoreDenominator: "slowest-crate-duration-ms"
}

interface TimingReadFound {
  readonly status: "found"
  readonly units: ReadonlyArray<CargoTimingUnit>
}

interface TimingReadMissing {
  readonly status: "missing"
}

interface TimingReadInvalid {
  readonly status: "invalid"
}

type TimingReadResult = TimingReadFound | TimingReadMissing | TimingReadInvalid

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const DEFAULT_MEASURE_LIVE_BUILDS = false
const RS_RP_02_SCORE_MODE = "slowest-crate-compile-duration" as const
const RS_RP_02_SCORE_DENOMINATOR = "slowest-crate-duration-ms" as const

const RsRp02FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  {
    path: "config.measure_live_builds",
    title: "Config measure live builds",
    valueKind: "boolean",
    scoreRole: "evidence",
    defaultValue: DEFAULT_MEASURE_LIVE_BUILDS,
  },
]

export const RsRp02: Signal<RsRp02Config, RsRp02Output, RustProjectTag> = {
  id: "RS-RP-02-compile-time",
  title: "Compile time",
  aliases: ["RS-RP-02"],
  tier: 1,
  category: "review-pain",
  kind: "structural",
  cacheVersion: "cargo-timings-config-applicability-diagnostics-v1",
  configSchema: RsRp02Config,
  factorDefinitions: RsRp02FactorDefinitions,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
    measure_live_builds: DEFAULT_MEASURE_LIVE_BUILDS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsRp02Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsRp02Output> => {
          if (project.manifests.length === 0 || !(await exists(join(project.worktreePath, "Cargo.toml")))) {
            return emptyCompileOutput(normalizedConfig, {
              cacheProbeMode: "unavailable",
              manifestCount: project.manifests.length,
              measurementMode: "existing-cargo-timings",
              unavailableReason: "no-cargo-project",
            })
          }

          const existingUnits = await readTimingUnits(project.worktreePath)
          if (!normalizedConfig.measure_live_builds) {
            if (existingUnits.status !== "found") {
              return emptyCompileOutput(normalizedConfig, {
                cacheProbeMode: "unavailable",
                manifestCount: project.manifests.length,
                measurementMode: "existing-cargo-timings",
                unavailableReason: existingUnits.status === "invalid"
                  ? "invalid-timing-data"
                  : "missing-timing-data",
              })
            }
            return measuredCompileOutput(
              existingUnits.units,
              normalizedConfig,
              project.manifests,
              new Set(),
              "unavailable",
              "existing-cargo-timings",
            )
          }

          const firstBuild = await runCargoBuildWithTimings(project.worktreePath)
          const firstUnits = firstBuild ? await readTimingUnits(project.worktreePath) : existingUnits
          if (firstUnits.status !== "found") {
            return emptyCompileOutput(normalizedConfig, {
              cacheProbeMode: "unavailable",
              manifestCount: project.manifests.length,
              measurementMode: "live-cargo-build",
              unavailableReason: firstBuild
                ? firstUnits.status === "invalid"
                  ? "invalid-timing-data"
                  : "missing-timing-data"
                : "cargo-build-failed",
            })
          }

          const secondBuild = await runCargoBuildWithTimings(project.worktreePath)
          const secondUnits = !secondBuild
            ? { status: "missing" as const }
            : await readTimingUnits(project.worktreePath)
          const secondCrates = new Set(secondUnits.status === "found" ? secondUnits.units.map((unit) => unit.name) : [])

          return measuredCompileOutput(
            firstUnits.units,
            normalizedConfig,
            project.manifests,
            secondCrates,
            secondUnits.status === "found" ? "noop-second-build" : "unavailable",
            "live-cargo-build",
          )
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-RP-02-compile-time", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.buildStatus !== "measured" || out.totalUnits === 0 || out.crates.length === 0) return 1
    const longest = out.crates[0]?.totalDurationMs ?? 0
    return Math.max(0, 1 - Math.min(1, longest / 10_000))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.buildStatus !== "measured") {
      return [{
        severity: "warn" as const,
        message: "RS-RP-02 could not collect cargo timing data",
        data: {
          unavailableReason: out.unavailableReason,
          manifestCount: out.manifestCount,
          timingSource: out.timingSource,
          cacheProbeMode: out.cacheProbeMode,
          measurementMode: out.measurementMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.crates.filter((crate) => crate.unitCount > 0)
      .slice(0, out.diagnosticLimit)
      .map((crate) => ({
      severity: crate.totalDurationMs >= 1_000 ? ("warn" as const) : ("info" as const),
      message: `Compile hotspot ${crate.crate}: ${(crate.totalDurationMs / 1000).toFixed(2)}s`,
      data: {
        crate: crate.crate,
        totalDurationMs: crate.totalDurationMs,
        unitCount: crate.unitCount,
        cascadeImpact: crate.cascadeImpact,
        incrementalCacheHitRate: crate.incrementalCacheHitRate,
        cacheProbeMode: out.cacheProbeMode,
        measurementMode: out.measurementMode,
        scoreMode: out.scoreMode,
        scoreDenominator: out.scoreDenominator,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.unavailableReason === "no-cargo-project") {
      return { applicability: "not_applicable" as const }
    }
    if (out.buildStatus !== "measured" || out.totalUnits === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsRp02FactorLedger(),
}

type NormalizedRsRp02Config = RsRp02Config

const normalizeRsRp02Config = (config: RsRp02Config): NormalizedRsRp02Config => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
  measure_live_builds: config.measure_live_builds,
})

const emptyCompileOutput = (
  config: NormalizedRsRp02Config,
  options: {
    readonly cacheProbeMode: RsRp02Output["cacheProbeMode"]
    readonly manifestCount: number
    readonly measurementMode: RsRp02Output["measurementMode"]
    readonly unavailableReason: NonNullable<RsRp02Output["unavailableReason"]>
  },
): RsRp02Output => ({
  crates: [],
  totalUnits: 0,
  buildStatus: "unavailable",
  unavailableReason: options.unavailableReason,
  timingSource: "cargo-timings-html",
  cacheProbeMode: options.cacheProbeMode,
  measurementMode: options.measurementMode,
  manifestCount: options.manifestCount,
  diagnosticLimit: config.top_n_diagnostics,
  scoreMode: RS_RP_02_SCORE_MODE,
  scoreDenominator: RS_RP_02_SCORE_DENOMINATOR,
})

const measuredCompileOutput = (
  units: ReadonlyArray<CargoTimingUnit>,
  config: NormalizedRsRp02Config,
  manifests: ReadonlyArray<RustManifestInfo>,
  secondBuildCrates: ReadonlySet<string>,
  cacheProbeMode: RsRp02Output["cacheProbeMode"],
  measurementMode: RsRp02Output["measurementMode"],
): RsRp02Output => ({
  crates: summarizeCrates(units, workspaceCrateNames(manifests), secondBuildCrates),
  totalUnits: units.length,
  buildStatus: "measured",
  timingSource: "cargo-timings-html",
  cacheProbeMode,
  measurementMode,
  manifestCount: manifests.length,
  diagnosticLimit: config.top_n_diagnostics,
  scoreMode: RS_RP_02_SCORE_MODE,
  scoreDenominator: RS_RP_02_SCORE_DENOMINATOR,
})

const makeRsRp02FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-RP-02-compile-time",
    RsRp02FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const runCargoBuildWithTimings = async (cwd: string): Promise<boolean> => {
  try {
    await execFileAsync("cargo", ["build", "--timings"], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}

const workspaceCrateNames = (
  manifests: ReadonlyArray<RustManifestInfo>,
): ReadonlyArray<string> =>
  manifests
    .map((manifest) => manifest.packageName)
    .filter((name): name is string => name !== undefined)

const readTimingUnits = async (cwd: string): Promise<TimingReadResult> => {
  const reportPath = join(cwd, "target", "cargo-timings", "cargo-timing.html")
  if (!(await exists(reportPath))) return { status: "missing" }
  const html = await readFile(reportPath, "utf8")
  const match = /const UNIT_DATA = (\[[\s\S]*?\]);/.exec(html)
  if (match === null) return { status: "invalid" }
  const units = parseTimingUnits(match[1]!)
  return units === undefined ? { status: "invalid" } : { status: "found", units }
}

const summarizeCrates = (
  units: ReadonlyArray<CargoTimingUnit>,
  workspaceCrates: ReadonlyArray<string>,
  secondBuildCrates: ReadonlySet<string>,
): ReadonlyArray<CompileTimingCrate> => {
  const grouped = new Map<string, { durationMs: number; unitCount: number; cascadeImpact: number }>()
  for (const unit of units) {
    const bucket = grouped.get(unit.name) ?? { durationMs: 0, unitCount: 0, cascadeImpact: 0 }
    bucket.durationMs += unit.duration * 1000
    bucket.unitCount += 1
    bucket.cascadeImpact += (unit.unblocked_units?.length ?? 0) + (unit.unblocked_rmeta_units?.length ?? 0)
    grouped.set(unit.name, bucket)
  }

  const knownCrates = new Set([...grouped.keys(), ...workspaceCrates])
  return [...knownCrates]
    .map((crate) => ({
      crate,
      totalDurationMs: grouped.get(crate)?.durationMs ?? 0,
      unitCount: grouped.get(crate)?.unitCount ?? 0,
      cascadeImpact: grouped.get(crate)?.cascadeImpact ?? 0,
      incrementalCacheHitRate: secondBuildCrates.size === 0 ? undefined : secondBuildCrates.has(crate) ? 0 : 1,
    }))
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs || left.crate.localeCompare(right.crate))
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const parseTimingUnits = (raw: string): ReadonlyArray<CargoTimingUnit> | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const units: Array<CargoTimingUnit> = []
  for (const entry of parsed) {
    if (!isTimingUnit(entry)) return undefined
    units.push(entry)
  }
  return units
}

const isTimingUnit = (value: unknown): value is CargoTimingUnit => {
  if (!isRecord(value)) return false
  return (
    typeof value.i === "number" &&
    typeof value.name === "string" &&
    typeof value.duration === "number" &&
    (value.version === undefined || typeof value.version === "string") &&
    (value.target === undefined || typeof value.target === "string") &&
    (value.rmeta_time === undefined || typeof value.rmeta_time === "number") &&
    isNumberArray(value.unblocked_units) &&
    isNumberArray(value.unblocked_rmeta_units)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNumberArray = (value: unknown): value is ReadonlyArray<number> =>
  value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "number"))
