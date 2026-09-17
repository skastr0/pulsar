import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, Result, Schema } from "effect"
import { buildShapeCandidates } from "../jev-spike/shape-candidates.ts"

const REPO = resolve(import.meta.dir, "../..")
const TSC = resolve(REPO, "node_modules/.bin/tsc")
const RUNNER = "packages/core/src/runner.ts"
const OBSERVER = "packages/core/src/observer-execution.ts"
const CACHE = "packages/core/src/cache.ts"
const SCORE = "packages/core/src/scoring-engine-score-execution.ts"
const CLOCK = "packages/core/src/observer-time.ts"

type Diagnostic = { readonly severity: string; readonly message: string }
type RunResult = {
  readonly signalId: string
  readonly score: number
  readonly output: unknown
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly metadata?: { readonly applicability?: string; readonly effectiveConfidence?: number }
  readonly factorLedger?: {
    readonly entries: ReadonlyArray<{
      readonly path: string
      readonly value: unknown
      readonly source: string
      readonly mutations?: ReadonlyArray<{
        readonly action: string
        readonly before: unknown
        readonly after: unknown
        readonly ruleId: string
      }>
    }>
  }
}
type ExecutionView = {
  readonly outputs: Record<string, unknown>
  readonly results: Record<string, RunResult>
  readonly inactive: ReadonlyArray<string>
  readonly metadata: Record<string, unknown>
  readonly profiles: Record<string, { readonly score: number; readonly diagnostics: number }>
}

const temps: string[] = []

afterEach(() => {
  while (temps.length > 0) {
    const root = temps.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

const materialize = (files: Record<string, string>, extras: Record<string, string> = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "jev-shape-"))
  temps.push(root)
  cpSync(join(REPO, "packages/core/src"), join(root, "packages/core/src"), { recursive: true })
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"))
  for (const [relative, content] of Object.entries({ ...files, ...extras })) {
    writeFileSync(join(root, relative), content)
  }
  return root
}

const load = async (root: string, relative: string): Promise<Record<string, any>> =>
  import(pathToFileURL(join(root, relative)).href)

const tsc = (cwd: string, files: ReadonlyArray<string>): { code: number; output: string } => {
  const result = Bun.spawnSync({
    cmd: [
      TSC,
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
      ...files,
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: result.exitCode ?? 1,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  }
}

const writeProbe = (root: string, name: string, source: string): string => {
  const relative = `packages/core/src/${name}`
  writeFileSync(join(root, relative), source)
  return relative
}

const FactorConfig = Schema.Struct({})
const scoreCap = {
  path: "stub_kinds.throw-not-implemented.score_cap",
  title: "Throw-not-implemented score cap",
  valueKind: "number" as const,
  scoreRole: "score-cap" as const,
  defaultValue: 0.8,
}

const vector = (overrides: Record<string, { active?: boolean; factors?: Record<string, number> }>) => ({
  id: "v1",
  domain: "typescript",
  signal_overrides: overrides,
})

const executionView = (executed: {
  outputs: Map<string, unknown>
  signalResults: Map<string, RunResult>
  inactiveSignals: Array<string>
  signalMetadata: Record<string, unknown>
  signalProfiles: Record<string, { durationMs?: number; score: number; diagnostics: number }>
}): ExecutionView => ({
  outputs: Object.fromEntries(executed.outputs),
  results: Object.fromEntries(executed.signalResults),
  inactive: executed.inactiveSignals,
  metadata: executed.signalMetadata,
  profiles: Object.fromEntries(
    Object.entries(executed.signalProfiles).map(([id, profile]) => [
      id,
      { score: profile.score, diagnostics: profile.diagnostics },
    ]),
  ),
})

describe("buildShapeCandidates", () => {
  test("preserves exact originals for a and fails closed on unique-anchor drift", () => {
    const candidates = buildShapeCandidates(REPO)
    expect(candidates.extraction.a[RUNNER]).toBe(readFileSync(join(REPO, RUNNER), "utf8"))
    expect(candidates.extraction.a[OBSERVER]).toBe(readFileSync(join(REPO, OBSERVER), "utf8"))
    expect(candidates.consolidation.a[OBSERVER]).toBe(readFileSync(join(REPO, OBSERVER), "utf8"))
    expect(candidates.representation.a[CACHE]).toBe(readFileSync(join(REPO, CACHE), "utf8"))
    expect(candidates.representation.a[SCORE]).toBe(readFileSync(join(REPO, SCORE), "utf8"))
    expect(candidates.extraction.b[RUNNER]).toContain("export const finalizeSignalResult")
    expect(candidates.extraction.mutant[RUNNER]).toContain("diagnostics: signal.diagnose(out)")
    expect(candidates.extraction.mutant[RUNNER]).not.toContain(
      "diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out))",
    )

    const drifted = materialize({})
    writeFileSync(
      join(drifted, RUNNER),
      readFileSync(join(REPO, RUNNER), "utf8").replace(
        "target.outputMetadata?.(out)",
        "target.outputMetadata?.(out, vector)",
      ),
    )
    expect(() => buildShapeCandidates(drifted)).toThrow(/Anchor drift/)
  })
})

describe("extraction", () => {
  test("A and B match on metadata/ledger, vector overrides, severity caps, runner failure, observer isolation", async () => {
    const candidates = buildShapeCandidates(REPO)
    const runVariant = async (files: Record<string, string>) => {
      const root = materialize(files)
      expect(tsc(root, [RUNNER, OBSERVER]).code).toBe(0)
      const runner = await load(root, RUNNER)
      const observer = await load(root, OBSERVER)
      const registryMod = await load(root, "packages/core/src/registry.ts")
      const factors = await load(root, "packages/core/src/factor-ledger.ts")
      const errors = await load(root, "packages/core/src/errors.ts")

      const absent = {
        id: "TEST-ABSENT",
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: () => Effect.succeed({ n: 1 }),
        score: () => 0.7,
        diagnose: () => [],
      }
      const present = {
        id: "TEST-PRESENT",
        tier: 1,
        category: "generated-slop",
        kind: "structural",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        factorDefinitions: [scoreCap],
        inputs: [],
        compute: () =>
          Effect.gen(function* () {
            const factorPolicy = yield* Effect.serviceOption(factors.SignalFactorPolicyTag)
            const overrides =
              factorPolicy._tag === "Some"
                ? (factorPolicy.value as { vectorOverrides: Record<string, unknown> }).vectorOverrides
                : {}
            return { n: 1, visibleVectorOverrideCount: Object.keys(overrides).length }
          }),
        score: () => 0.8,
        diagnose: () => [],
        outputMetadata: () => ({ applicability: "applicable", effectiveConfidence: 0.42 }),
        factorLedger: () => factors.makeFactorLedger("TEST-PRESENT", [factors.makeFactorEntry(scoreCap, 0.8)]),
      }
      const capped = {
        id: "TEST-LEG",
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: () => Effect.succeed({ n: 1 }),
        score: () => 0.2,
        diagnose: () => [{ severity: "block", message: "shouldn't block" }],
      }
      const failing = {
        id: "TEST-BAD",
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: () => Effect.fail(new errors.SignalComputeError({ signalId: "TEST-BAD", message: "boom" })),
        score: () => 0.5,
        diagnose: () => [],
      }
      const ok = {
        id: "TEST-OK",
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: () => Effect.succeed({ n: 1 }),
        score: () => 0.9,
        diagnose: () => [],
      }
      const inactive = {
        id: "TEST-INACTIVE",
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: () => Effect.succeed({ n: 1 }),
        score: () => 0.1,
        diagnose: () => [],
      }

      const run = (signals: ReadonlyArray<unknown>, id: string, vec?: ReturnType<typeof vector>) =>
        Effect.gen(function* () {
          const registry = yield* registryMod.buildRegistry(signals)
          return (yield* runner.runSignal(registry, id, vec)) as RunResult
        })

      const observe = (signals: ReadonlyArray<unknown>, vec?: ReturnType<typeof vector>) =>
        Effect.gen(function* () {
          const registry = yield* registryMod.buildRegistry(signals)
          return executionView(yield* observer.executeObserverSignals(registry, vec, false))
        })

      const overrideVec = vector({
        "TEST-PRESENT": { factors: { "stub_kinds.throw-not-implemented.score_cap": 0.6 } },
      })
      const inactiveVec = vector({ "TEST-INACTIVE": { active: false } })

      return {
        absentRun: await Effect.runPromise(run([absent], "TEST-ABSENT") as Effect.Effect<RunResult, never, never>),
        presentRun: await Effect.runPromise(run([present], "TEST-PRESENT") as Effect.Effect<RunResult, never, never>),
        presentOverride: await Effect.runPromise(
          run([present], "TEST-PRESENT", overrideVec) as Effect.Effect<RunResult, never, never>,
        ),
        capRun: await Effect.runPromise(run([capped], "TEST-LEG") as Effect.Effect<RunResult, never, never>),
        inactiveRun: await Effect.runPromise(
          run([inactive], "TEST-INACTIVE", inactiveVec) as Effect.Effect<RunResult, never, never>,
        ),
        runnerFailure: await Effect.runPromise(
          Effect.result(run([failing], "TEST-BAD") as Effect.Effect<RunResult, { _tag: string }, never>),
        ),
        absentObs: await Effect.runPromise(observe([absent]) as Effect.Effect<ExecutionView, never, never>),
        presentObs: await Effect.runPromise(observe([present]) as Effect.Effect<ExecutionView, never, never>),
        presentOverrideObs: await Effect.runPromise(
          observe([present], overrideVec) as Effect.Effect<ExecutionView, never, never>,
        ),
        capObs: await Effect.runPromise(observe([capped]) as Effect.Effect<ExecutionView, never, never>),
        isolated: await Effect.runPromise(observe([ok, failing]) as Effect.Effect<ExecutionView, never, never>),
        inactiveObs: await Effect.runPromise(
          observe([ok, inactive], inactiveVec) as Effect.Effect<ExecutionView, never, never>,
        ),
      }
    }

    const a = await runVariant(candidates.extraction.a)
    const b = await runVariant(candidates.extraction.b)
    expect(b).toEqual(a)

    expect(a.absentRun).toMatchObject({ signalId: "TEST-ABSENT", score: 0.7, output: { n: 1 } })
    expect(a.absentRun).not.toHaveProperty("metadata")
    expect(a.absentRun).not.toHaveProperty("factorLedger")
    expect(a.presentRun).toMatchObject({
      metadata: { applicability: "applicable", effectiveConfidence: 0.42 },
      output: { n: 1, visibleVectorOverrideCount: 0 },
    })
    expect(a.presentRun.factorLedger?.entries[0]).toMatchObject({
      path: scoreCap.path,
      value: 0.8,
      source: "computed",
    })
    expect((a.presentOverride.output as { visibleVectorOverrideCount: number }).visibleVectorOverrideCount).toBe(1)
    expect(a.presentOverride.factorLedger?.entries[0]).toMatchObject({
      path: scoreCap.path,
      value: 0.6,
      source: "vector",
      mutations: [{ action: "override-factor", before: 0.8, after: 0.6, ruleId: "vector.factor-override" }],
    })
    expect(a.capRun.diagnostics[0]).toMatchObject({ severity: "warn" })
    expect(a.capRun.diagnostics[0]?.message).toContain("severity capped to warn")
    expect(a.inactiveRun).toMatchObject({ signalId: "TEST-INACTIVE", score: 0, output: undefined })
    expect(Result.isFailure(a.runnerFailure)).toBe(true)
    if (Result.isFailure(a.runnerFailure)) expect(a.runnerFailure.failure._tag).toBe("SignalComputeError")
    expect(a.isolated.results["TEST-OK"]).toMatchObject({ score: 0.9 })
    expect(a.isolated.results["TEST-BAD"]).toMatchObject({
      score: 0,
      output: undefined,
      metadata: { applicability: "failed" },
    })
    expect(a.isolated.results["TEST-BAD"]?.diagnostics[0]?.severity).toBe("warn")
    expect(a.isolated.results["TEST-BAD"]?.diagnostics[0]?.message).toContain("TEST-BAD")
    expect(a.inactiveObs.inactive).toEqual(["TEST-INACTIVE"])
    expect(a.inactiveObs.results["TEST-INACTIVE"]).toBeUndefined()
    expect(a.presentOverrideObs.results["TEST-PRESENT"]?.factorLedger?.entries[0]?.value).toBe(0.6)
    expect(a.capObs.results["TEST-LEG"]?.diagnostics[0]?.severity).toBe("warn")
  })

  test("mutant helper skips severity ceiling; assert the incorrect uncapped block as expected", async () => {
    const candidates = buildShapeCandidates(REPO)
    const root = materialize(candidates.extraction.mutant)
    const runner = await load(root, RUNNER)
    const observer = await load(root, OBSERVER)
    const registryMod = await load(root, "packages/core/src/registry.ts")
    const capped = {
      id: "TEST-LEG",
      tier: 1,
      category: "legibility-decay",
      kind: "legibility",
      evidenceClass: "deterministic-ast",
      configSchema: FactorConfig,
      defaultConfig: {},
      inputs: [],
      compute: () => Effect.succeed({ n: 1 }),
      score: () => 0.2,
      diagnose: () => [{ severity: "block", message: "shouldn't block" }],
    }
    const { runnerResult, observed } = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* registryMod.buildRegistry([capped])
        const runnerResult = (yield* runner.runSignal(registry, "TEST-LEG")) as RunResult
        const observed = yield* observer.executeObserverSignals(registry, undefined, false)
        return { runnerResult, observed }
      }) as Effect.Effect<{ runnerResult: RunResult; observed: { signalResults: Map<string, RunResult> } }, never, never>,
    )
    expect(runnerResult.diagnostics[0]?.severity).toBe("block")
    expect(runnerResult.diagnostics[0]?.message).toBe("shouldn't block")
    expect(observed.signalResults.get("TEST-LEG")?.diagnostics[0]?.severity).toBe("block")
  })
})

describe("consolidation", () => {
  test("inlined executeObserverSignals matches helper form on inputs, results, metadata, inactive ids, counts, batches", async () => {
    const candidates = buildShapeCandidates(REPO)
    const clock = `let t = 0
export const nowMs = (): number => {
  t += 1
  return t
}
export const roundRuntimeMs = (value: number): number => Math.max(0, Number(value.toFixed(2)))
`
    const runVariant = async (files: Record<string, string>) => {
      const root = materialize(files, { [CLOCK]: clock })
      expect(tsc(root, [OBSERVER]).code).toBe(0)
      const observer = await load(root, OBSERVER)
      const registryMod = await load(root, "packages/core/src/registry.ts")
      const errors = await load(root, "packages/core/src/errors.ts")
      const invocations = new Map<string, number>()
      const inputs: Record<string, Record<string, unknown>> = {}

      const leaf = (
        id: string,
        opts: {
          score: number
          fail?: boolean
          metadata?: { applicability: string }
          compute?: () => Effect.Effect<{ n: number }, unknown>
        },
      ) => ({
        id,
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [],
        compute: (_config: unknown, received: ReadonlyMap<string, unknown>) => {
          invocations.set(id, (invocations.get(id) ?? 0) + 1)
          inputs[id] = Object.fromEntries(received)
          if (opts.fail) {
            return Effect.fail(new errors.SignalComputeError({ signalId: id, message: "boom" }))
          }
          return opts.compute?.() ?? Effect.succeed({ n: 1 })
        },
        score: () => opts.score,
        diagnose: () => [],
        ...(opts.metadata !== undefined ? { outputMetadata: () => opts.metadata } : {}),
      })
      const l1 = leaf("L1", { score: 0.4, metadata: { applicability: "applicable" } })
      const l2 = leaf("L2", {
        score: 0.7,
        compute: () => Effect.sleep("5 millis").pipe(Effect.map(() => ({ n: 2 }))),
      })
      const failing = leaf("FAIL", { score: 0.5, fail: true })
      const inactive = leaf("INACTIVE", { score: 0.1 })
      const compound = {
        id: "COMPOUND",
        tier: 1.5,
        category: "review-pain",
        kind: "compound",
        evidenceClass: "deterministic-ast",
        configSchema: FactorConfig,
        defaultConfig: {},
        inputs: [{ id: "L1" }, { id: "L2" }, { id: "INACTIVE" }],
        compute: (_config: unknown, received: ReadonlyMap<string, unknown>) => {
          invocations.set("COMPOUND", (invocations.get("COMPOUND") ?? 0) + 1)
          inputs.COMPOUND = Object.fromEntries(received)
          return Effect.succeed({
            n:
              ((received.get("L1") as { n: number } | undefined)?.n ?? 0) +
              ((received.get("L2") as { n: number } | undefined)?.n ?? 0),
          })
        },
        score: () => 0.9,
        diagnose: () => [],
      }
      const vec = vector({ INACTIVE: { active: false } })
      const executed = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* registryMod.buildRegistry([l1, l2, failing, inactive, compound])
          return yield* observer.executeObserverSignals(registry, vec, true)
        }) as Effect.Effect<Parameters<typeof executionView>[0], never, never>,
      )
      return {
        view: executionView(executed),
        invocations: Object.fromEntries(invocations),
        inputs,
      }
    }

    const a = await runVariant(candidates.consolidation.a)
    const b = await runVariant(candidates.consolidation.b)
    expect(b.view.results).toEqual(a.view.results)
    expect(b.view.outputs).toEqual(a.view.outputs)
    expect(b.view.inactive).toEqual(a.view.inactive)
    expect(b.view.metadata).toEqual(a.view.metadata)
    expect(b.view.profiles).toEqual(a.view.profiles)
    expect(b.invocations).toEqual(a.invocations)
    expect(b.inputs).toEqual(a.inputs)
    expect(a.view.inactive).toEqual(["INACTIVE"])
    expect(a.invocations).toEqual({ L1: 1, L2: 1, FAIL: 1, COMPOUND: 1 })
    expect(a.inputs.L1).toEqual({})
    expect(a.inputs.L2).toEqual({})
    expect(a.inputs.FAIL).toEqual({})
    expect(a.inputs.INACTIVE).toBeUndefined()
    expect(Object.keys(a.inputs.COMPOUND ?? {}).sort()).toEqual(["L1", "L2"])
    expect(a.inputs.COMPOUND).toEqual({ L1: { n: 1 }, L2: { n: 2 } })
    expect(a.view.results.FAIL).toMatchObject({ score: 0, metadata: { applicability: "failed" } })
    expect(a.view.results.COMPOUND).toMatchObject({ output: { n: 3 }, score: 0.9 })
    expect(a.view.metadata.L1).toEqual({ applicability: "applicable" })
    expect(candidates.consolidation.b[OBSERVER]).not.toContain("createObserverSignalExecution")
    expect(candidates.consolidation.b[OBSERVER]).toContain("const runOneSignal = (")
    expect(candidates.consolidation.b[OBSERVER]).toContain("export const summarizeCalibration")
    expect(candidates.consolidation.b[OBSERVER]).toContain("interface ObserverSignalExecution")
  })
})

describe("representation", () => {
  test("runtime lookup equality at fixed now, and tsc — not Bun — accepts/rejects the union", async () => {
    const candidates = buildShapeCandidates(REPO)
    const now = new Date("2026-09-17T00:00:00.000Z")
    const staleAt = new Date("2026-06-19T00:00:00.000Z").toISOString()
    const runVariant = async (files: Record<string, string>) => {
      const root = materialize(files)
      const cache = await load(root, CACHE)
      const cases = {
        absent: cache.evaluateTieredCacheEntry(undefined, { now }),
        mismatchedTier: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(1, { tier: 1, computedAt: now.toISOString() }),
          { now, tier: 2 },
        ),
        mismatchedRef: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(1, { tier: 2, refVersionHash: "ref-v1", computedAt: now.toISOString() }),
          { now, tier: 2, refVersionHash: "ref-v2" },
        ),
        mismatchedModel: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(1, { tier: 3, modelId: "m1", computedAt: now.toISOString() }),
          { now, tier: 3, modelId: "m2" },
        ),
        fresh: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(7, { tier: 1, computedAt: now.toISOString() }),
          { now, tier: 1 },
        ),
        staleHit: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(3, {
            tier: 3,
            modelId: "m1",
            baseConfidence: 0.9,
            halfLifeDays: 30,
            computedAt: staleAt,
          }),
          { now, tier: 3, modelId: "m1", confidenceThreshold: 0.5, staleMode: "mark-stale" },
        ),
        staleMiss: cache.evaluateTieredCacheEntry(
          cache.buildTieredCacheEntry(3, {
            tier: 3,
            modelId: "m1",
            baseConfidence: 0.9,
            halfLifeDays: 30,
            computedAt: staleAt,
          }),
          { now, tier: 3, modelId: "m1", confidenceThreshold: 0.5 },
        ),
      }
      const consumer = tsc(root, [SCORE])
      const hitProbe = writeProbe(
        root,
        "jev-shape-hit-assignability.ts",
        `import { evaluateTieredCacheEntry } from "./cache.js"
declare function accept(result: ReturnType<typeof evaluateTieredCacheEntry<number>>): void
accept({ status: "hit" })
`,
      )
      const missProbe = writeProbe(
        root,
        "jev-shape-miss-confidence.ts",
        `import { evaluateTieredCacheEntry } from "./cache.js"
declare function accept(result: ReturnType<typeof evaluateTieredCacheEntry<number>>): void
accept({ status: "miss", effectiveConfidence: 0.12 })
`,
      )
      const narrowProbe = writeProbe(
        root,
        "jev-shape-narrow.ts",
        `import { buildTieredCacheEntry, evaluateTieredCacheEntry } from "./cache.js"
const result = evaluateTieredCacheEntry(buildTieredCacheEntry(7), { now: new Date("2026-09-17T00:00:00.000Z") })
if (result.status === "hit" || result.status === "stale") {
  const value: number = result.value
  void value
}
`,
      )
      return {
        cases,
        consumer,
        hit: tsc(root, [hitProbe]),
        miss: tsc(root, [missProbe]),
        narrow: tsc(root, [narrowProbe]),
      }
    }

    const a = await runVariant(candidates.representation.a)
    const b = await runVariant(candidates.representation.b)
    expect(b.cases).toEqual(a.cases)
    expect(a.cases.absent).toEqual({ status: "miss" })
    expect(a.cases.mismatchedTier.status).toBe("miss")
    expect(a.cases.mismatchedRef.status).toBe("miss")
    expect(a.cases.mismatchedModel.status).toBe("miss")
    expect(a.cases.fresh).toMatchObject({ status: "hit", value: 7 })
    expect(a.cases.staleHit.status).toBe("stale")
    expect(a.cases.staleHit.value).toBe(3)
    expect(a.cases.staleHit.effectiveConfidence).toBeLessThan(0.5)
    expect(a.cases.staleMiss).toMatchObject({ status: "miss" })
    expect(a.cases.staleMiss.effectiveConfidence).toBe(a.cases.staleHit.effectiveConfidence)
    expect(a.cases.staleMiss).not.toHaveProperty("value")
    expect(a.consumer.code).toBe(0)
    expect(b.consumer.code).toBe(0)
    expect(a.hit.code).toBe(0)
    expect(b.hit.code).not.toBe(0)
    expect(a.miss.code).toBe(0)
    expect(b.miss.code).toBe(0)
    expect(a.narrow.code).not.toBe(0)
    expect(b.narrow.code).toBe(0)
    expect(a.hit.output).not.toContain("error TS")
    expect(b.hit.output).toContain("error TS")
    expect(b.narrow.output).not.toContain("error TS")
    const version = Bun.spawnSync({ cmd: [TSC, "--version"], cwd: REPO })
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString()).toMatch(/Version 7\./)
  })
})
