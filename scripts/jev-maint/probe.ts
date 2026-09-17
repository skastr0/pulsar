import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  applyPatch,
  baseFiles,
  ENFORCEMENT,
  OBSERVER,
  OBSERVER_CACHE,
  PATCHES,
  patchById,
  RUNNER,
  TASK_PATCHES,
  type Files,
  type PatchId,
  type TaskId,
  type Variant,
} from "./patches.ts"

const TSC = "node_modules/.bin/tsc"
const PROBE = "packages/core/src/jev-maint-probe.ts"
const TYPECHECK_FILES = [RUNNER, OBSERVER, ENFORCEMENT, OBSERVER_CACHE]

/**
 * Runtime probe written into the disposable copy. It is intentionally loose
 * about static types: its job is to observe behaviour, while the compiler
 * evidence comes from typechecking the patched production files.
 */
const PROBE_SOURCE = `import { Effect, Schema } from "effect"
import { buildRegistry } from "./registry.js"
import { runSignal } from "./runner.js"
import { executeObserverSignals } from "./observer-execution.js"
import { enforceSeverityCeiling } from "./enforcement.js"
import { fromCachedObserverOutput } from "./scoring-engine-observer-cache.js"
import { SignalComputeError } from "./errors.js"

const Config = Schema.Struct({})
const base = {
  tier: 1,
  evidenceClass: "deterministic-ast",
  configSchema: Config,
  defaultConfig: {},
  inputs: [],
}
const make = (id, category, kind, over) => ({
  ...base,
  id,
  category,
  kind,
  compute: () => Effect.succeed({ n: 1 }),
  score: () => 0.9,
  diagnose: () => [],
  ...over,
})

const ok = make("P-OK", "legibility-decay", "legibility", {})
const failing = make("P-FAIL", "legibility-decay", "legibility", {
  compute: () => Effect.fail(new SignalComputeError({ signalId: "P-FAIL", message: "boom" })),
  score: () => 0.5,
})
const slop = make("P-SLOP", "generated-slop", "structural", {
  score: () => 0.3,
  diagnose: () => [{ severity: "block", message: "slop" }],
})
const inactive = make("P-INACTIVE", "legibility-decay", "legibility", { score: () => 0.1 })
const undefinedOut = make("P-UNDEF", "legibility-decay", "legibility", {
  compute: () => Effect.succeed(undefined),
  score: () => 0.4,
})

const vector = (overrides) => ({ id: "v1", domain: "typescript", signal_overrides: overrides })
const inactiveVec = vector({ "P-INACTIVE": { active: false } })

const runOne = (signals, id, vec) =>
  Effect.gen(function* () {
    const reg = yield* buildRegistry(signals)
    return yield* runSignal(reg, id, vec)
  })

const observe = (signals, vec) =>
  Effect.gen(function* () {
    const reg = yield* buildRegistry(signals)
    const executed = yield* executeObserverSignals(reg, vec, false)
    return {
      inactive: executed.inactiveSignals,
      results: Object.fromEntries(executed.signalResults),
      outputs: Object.fromEntries(executed.outputs),
    }
  })

const severityOf = (result) => result.diagnostics[0]?.severity ?? null

export const runProbe = async () => {
  const okRun = await Effect.runPromise(runOne([ok], "P-OK"))
  const okObs = await Effect.runPromise(observe([ok]))
  const missingRun = await Effect.runPromise(runOne([inactive], "P-INACTIVE", inactiveVec))
  const inactiveObs = await Effect.runPromise(observe([ok, inactive], inactiveVec))
  const undefObs = await Effect.runPromise(observe([undefinedOut]))
  const failure = await Effect.runPromise(Effect.result(runOne([failing], "P-FAIL")))
  const failureObs = await Effect.runPromise(observe([ok, failing]))
  const slopRun = await Effect.runPromise(runOne([slop], "P-SLOP"))
  const slopObs = await Effect.runPromise(observe([slop]))
  const engineCapped = enforceSeverityCeiling(
    { category: "generated-slop", enforcement: ["hard-gate"], evidenceClass: "deterministic-ast" },
    [{ severity: "block", message: "engine" }],
  )
  const restored = fromCachedObserverOutput({
    categories: [],
    minimum: 0,
    weighted_mean: 0,
    hard_gate_status: "pass",
    hard_gate_violations: [],
    inactiveSignals: [],
    signalResults: [
      { signalId: "P-OK", score: 0.9, diagnostics: [], applicability: "applicable", output: { n: 1 } },
    ],
  })
  const restoredOk = restored.signalResults.get("P-OK")
  const failureResult = failureObs.results["P-FAIL"]
  return {
    runnerOk: { contractVersion: okRun.contractVersion ?? null, score: okRun.score },
    observerOk: { contractVersion: okObs.results["P-OK"]?.contractVersion ?? null, score: okObs.results["P-OK"]?.score ?? null },
    cacheRestored: { contractVersion: restoredOk?.contractVersion ?? null, score: restoredOk?.score ?? null },
    runnerMissingOutput: {
      contractVersion: missingRun.contractVersion ?? null,
      metadata: missingRun.metadata ?? null,
      severity: severityOf(missingRun),
    },
    observerInactive: { inactive: inactiveObs.inactive, resultIds: Object.keys(inactiveObs.results) },
    observerUndefinedOutput: {
      hasResult: undefObs.results["P-UNDEF"] !== undefined,
      score: undefObs.results["P-UNDEF"]?.score ?? null,
      metadata: undefObs.results["P-UNDEF"]?.metadata ?? null,
    },
    runnerFailure:
      failure._tag === "Failure"
        ? { failed: true, tag: failure.failure?._tag ?? null }
        : { failed: false, tag: null },
    observerFailure: {
      contractVersion: failureResult?.contractVersion ?? null,
      score: failureResult?.score ?? null,
      metadata: failureResult?.metadata ?? null,
      data: failureResult?.diagnostics?.[0]?.data ?? null,
      severity: failureResult ? severityOf(failureResult) : null,
      isolatedOk: failureObs.results["P-OK"] !== undefined,
    },
    engineCeiling: severityOf({ diagnostics: engineCapped }),
    runnerCeiling: severityOf(slopRun),
    observerCeiling: slopObs.results["P-SLOP"] ? severityOf(slopObs.results["P-SLOP"]) : null,
  }
}
`

export type Observations = {
  readonly runnerOk: { readonly contractVersion: number | null; readonly score: number | null }
  readonly observerOk: { readonly contractVersion: number | null; readonly score: number | null }
  readonly cacheRestored: { readonly contractVersion: number | null; readonly score: number | null }
  readonly runnerMissingOutput: {
    readonly contractVersion: number | null
    readonly metadata: unknown
    readonly severity: string | null
  }
  readonly observerInactive: { readonly inactive: ReadonlyArray<string>; readonly resultIds: ReadonlyArray<string> }
  readonly observerUndefinedOutput: {
    readonly hasResult: boolean
    readonly score: number | null
    readonly metadata: unknown
  }
  readonly runnerFailure: { readonly failed: boolean; readonly tag: string | null }
  readonly observerFailure: {
    readonly contractVersion: number | null
    readonly score: number | null
    readonly metadata: unknown
    readonly data: unknown
    readonly severity: string | null
    readonly isolatedOk: boolean
  }
  readonly engineCeiling: string | null
  readonly runnerCeiling: string | null
  readonly observerCeiling: string | null
}

export type PatchOutcome = {
  readonly patch: PatchId
  readonly task: TaskId
  readonly variant: Variant
  readonly declaredEditedOwners: ReadonlyArray<string>
  readonly declaredEditedFiles: ReadonlyArray<string>
  readonly actualEditedFiles: ReadonlyArray<string>
  readonly compiles: boolean
  readonly tscOutput: string
  readonly requirementSatisfied: boolean
  readonly obligationsViolated: ReadonlyArray<string>
  readonly unmetRequirement: string | null
  readonly observations: Observations | null
}

const temps: Array<string> = []

export const cleanupTemps = (): void => {
  while (temps.length > 0) {
    const root = temps.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}

const materialize = (root: string, files: Files): string => {
  const copy = mkdtempSync(join(tmpdir(), "jev-maint-"))
  temps.push(copy)
  cpSync(join(root, "packages/core/src"), join(copy, "packages/core/src"), { recursive: true })
  symlinkSync(join(root, "node_modules"), join(copy, "node_modules"))
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(copy, relative)), { recursive: true })
    writeFileSync(join(copy, relative), content)
  }
  writeFileSync(join(copy, PROBE), PROBE_SOURCE)
  return copy
}

const tsc = (cwd: string): { code: number; output: string } => {
  const result = Bun.spawnSync({
    cmd: [
      resolve(cwd, TSC),
      "--noEmit",
      "--ignoreConfig",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--skipLibCheck",
      "--types",
      "bun",
      ...TYPECHECK_FILES,
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`.trim().slice(0, 4000),
  }
}

const changedFiles = (root: string, variant: Variant, files: Files): ReadonlyArray<string> => {
  const base = baseFiles(root, variant)
  return Object.keys(files).filter((path) => files[path] !== base[path]).sort()
}

type Verdict = {
  readonly satisfied: boolean
  readonly unmet: string | null
  readonly violations: ReadonlyArray<string>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

export function judge(task: TaskId, observations: Observations): Verdict {
  const violations: string[] = []
  const unmet: string[] = []
  const cacheVersion = observations.cacheRestored.contractVersion
  const runnerVersion = observations.runnerOk.contractVersion
  const observerVersion = observations.observerOk.contractVersion
  if (task === "shared-contract") {
    if (runnerVersion !== 1) unmet.push("runSignal successful result lacks contractVersion")
    if (observerVersion !== 1) unmet.push("observer successful result lacks contractVersion")
    if (observations.runnerMissingOutput.contractVersion !== 1) {
      unmet.push("runSignal missing-output result lacks contractVersion")
    }
    if (observations.observerFailure.contractVersion !== 1) {
      unmet.push("observer failure result lacks contractVersion")
    }
    if (cacheVersion !== 1) unmet.push("cache-restored result lacks contractVersion")
  }
  if (task === "caller-failure") {
    if (asRecord(observations.observerFailure.data).failureKind !== "compute_error") {
      unmet.push("observer failure diagnostic lacks data.failureKind")
    }
    if (observations.observerFailure.score !== 0) unmet.push("observer failure result is not score 0")
    if (asRecord(observations.observerFailure.metadata).applicability !== "failed") {
      unmet.push("observer failure result lost applicability failed")
    }
    if (!observations.observerFailure.isolatedOk) unmet.push("observer lost failure isolation")
    if (!observations.runnerFailure.failed) {
      violations.push("runSignal no longer propagates the typed compute failure")
    }
  }
  if (task === "delegated-rule") {
    if (observations.engineCeiling !== "warn") unmet.push("engine-level severity rule did not downgrade the block")
    if (observations.runnerCeiling !== "warn") unmet.push("runSignal did not downgrade the block")
    if (observations.observerCeiling !== "warn") unmet.push("observer did not downgrade the block")
  }
  if (task === "missing-output") {
    if (asRecord(observations.runnerMissingOutput.metadata).applicability !== "not_applicable") {
      unmet.push("runSignal missing-output result lacks applicability not_applicable")
    }
    if (observations.runnerMissingOutput.severity !== "warn") unmet.push("runSignal missing-output diagnostic is not warn")
    // The requirement names the missing-output path only. Changing how the
    // observer reports inactive signals, or how it treats an active signal
    // whose compute returns undefined, is outside it.
    if (!observations.observerInactive.inactive.includes("P-INACTIVE")) {
      violations.push("observer no longer reports the inactive signal in inactiveSignals")
    }
    if (observations.observerInactive.resultIds.includes("P-INACTIVE")) {
      violations.push("observer now materialises a result for the inactive signal")
    }
    if (observations.observerUndefinedOutput.score !== 0.4 || observations.observerUndefinedOutput.metadata !== null) {
      violations.push("observer behaviour changed for an active signal whose compute returns undefined")
    }
  }
  return { satisfied: unmet.length === 0, unmet: unmet.length > 0 ? unmet.join("; ") : null, violations }
}

export async function runPatchOutcome(root: string, variant: Variant, id: PatchId): Promise<PatchOutcome> {
  const definition = patchById(id)
  const files = applyPatch(root, variant, id)
  const copy = materialize(root, files)
  const compiled = tsc(copy)
  const actualEditedFiles = changedFiles(root, variant, files)
  const declaredEditedFiles = [...definition.editedFiles(variant)].sort()
  const base = {
    patch: id,
    task: definition.task,
    variant,
    declaredEditedOwners: definition.editedOwners(variant),
    declaredEditedFiles,
    actualEditedFiles,
  }
  if (JSON.stringify(actualEditedFiles) !== JSON.stringify(declaredEditedFiles)) {
    return {
      ...base,
      compiles: compiled.code === 0,
      tscOutput: compiled.output,
      requirementSatisfied: false,
      obligationsViolated: ["declared edited files differ from the applied patch"],
      unmetRequirement: "patch declaration drift",
      observations: null,
    }
  }
  if (compiled.code !== 0) {
    return {
      ...base,
      compiles: false,
      tscOutput: compiled.output,
      requirementSatisfied: false,
      obligationsViolated: [],
      unmetRequirement: "does not typecheck",
      observations: null,
    }
  }
  const probeModule = (await import(pathToFileURL(join(copy, PROBE)).href)) as {
    runProbe: () => Promise<Observations>
  }
  const observations = await probeModule.runProbe()
  const verdict = judge(definition.task, observations)
  return {
    ...base,
    compiles: true,
    tscOutput: "",
    requirementSatisfied: verdict.satisfied,
    obligationsViolated: verdict.violations,
    unmetRequirement: verdict.unmet,
    observations,
  }
}

export function patchInventory(): ReadonlyArray<{ patch: PatchId; task: TaskId }> {
  return PATCHES.map((patch) => ({ patch: patch.id, task: patch.task }))
}

export function taskPatches(task: TaskId): ReadonlyArray<PatchId> {
  return TASK_PATCHES[task]
}
