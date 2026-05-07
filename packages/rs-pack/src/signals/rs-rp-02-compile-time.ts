import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { RustProjectTag, type RustManifestInfo } from "../project.js"

const execFileAsync = promisify(execFile)

export const RsRp02Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  measure_live_builds: Schema.Boolean,
})
export type RsRp02Config = typeof RsRp02Config.Type

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

export interface CompileTimingCrate {
  readonly crate: string
  readonly totalDurationMs: number
  readonly unitCount: number
  readonly cascadeImpact: number
  readonly incrementalCacheHitRate: number | undefined
}

export interface RsRp02Output {
  readonly crates: ReadonlyArray<CompileTimingCrate>
  readonly totalUnits: number
  readonly buildStatus: "measured" | "unavailable"
  readonly timingSource: "cargo-timings-html"
  readonly cacheProbeMode: "noop-second-build" | "unavailable"
}

export const RsRp02: Signal<RsRp02Config, RsRp02Output, RustProjectTag> = {
  id: "RS-RP-02",
  tier: 1,
  category: "review-pain",
  kind: "structural",
  configSchema: RsRp02Config,
  defaultConfig: {
    top_n_diagnostics: 10,
    measure_live_builds: false,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsRp02Output> => {
          if (project.manifests.length === 0 || !(await exists(join(project.worktreePath, "Cargo.toml")))) {
            return emptyCompileOutput("unavailable")
          }

          const existingUnits = await readTimingUnits(project.worktreePath)
          if (!config.measure_live_builds) {
            if (existingUnits === undefined) return emptyCompileOutput("unavailable")
            return {
              crates: summarizeCrates(existingUnits, workspaceCrateNames(project.manifests), new Set()),
              totalUnits: existingUnits.length,
              buildStatus: "measured",
              timingSource: "cargo-timings-html",
              cacheProbeMode: "unavailable",
            }
          }

          const firstBuild = await runCargoBuildWithTimings(project.worktreePath)
          const firstUnits = firstBuild ? await readTimingUnits(project.worktreePath) : existingUnits
          if (firstUnits === undefined) {
            return emptyCompileOutput("unavailable")
          }

          const secondBuild = await runCargoBuildWithTimings(project.worktreePath)
          const secondUnits = !secondBuild ? undefined : await readTimingUnits(project.worktreePath)
          const workspaceCrates = workspaceCrateNames(project.manifests)
          const secondCrates = new Set((secondUnits ?? []).map((unit) => unit.name))

          const crates = summarizeCrates(firstUnits, workspaceCrates, secondCrates)
          return {
            crates,
            totalUnits: firstUnits.length,
            buildStatus: "measured",
            timingSource: "cargo-timings-html",
            cacheProbeMode: secondUnits === undefined ? "unavailable" : "noop-second-build",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-RP-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.buildStatus !== "measured" || out.crates.length === 0) return 1
    const longest = out.crates[0]?.totalDurationMs ?? 0
    return Math.max(0, 1 - Math.min(1, longest / 10_000))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.buildStatus !== "measured") {
      return [{ severity: "warn", message: "RS-RP-02 could not collect cargo timing data" }]
    }
    return out.crates.slice(0, 10).map((crate) => ({
      severity: crate.totalDurationMs >= 1_000 ? ("warn" as const) : ("info" as const),
      message: `Compile hotspot ${crate.crate}: ${(crate.totalDurationMs / 1000).toFixed(2)}s`,
      data: {
        crate: crate.crate,
        totalDurationMs: crate.totalDurationMs,
        unitCount: crate.unitCount,
        cascadeImpact: crate.cascadeImpact,
        incrementalCacheHitRate: crate.incrementalCacheHitRate,
        cacheProbeMode: out.cacheProbeMode,
      },
    }))
  },
}

const emptyCompileOutput = (
  cacheProbeMode: RsRp02Output["cacheProbeMode"],
): RsRp02Output => ({
  crates: [],
  totalUnits: 0,
  buildStatus: "unavailable",
  timingSource: "cargo-timings-html",
  cacheProbeMode,
})

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

const readTimingUnits = async (cwd: string): Promise<ReadonlyArray<CargoTimingUnit> | undefined> => {
  const reportPath = join(cwd, "target", "cargo-timings", "cargo-timing.html")
  if (!(await exists(reportPath))) return undefined
  const html = await readFile(reportPath, "utf8")
  const match = /const UNIT_DATA = (\[[\s\S]*?\]);/.exec(html)
  if (match === null) return undefined
  return parseTimingUnits(match[1]!)
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
  const parsed = JSON.parse(raw)
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
