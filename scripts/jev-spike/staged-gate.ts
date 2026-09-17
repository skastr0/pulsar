/**
 * Deterministic evidence for the staged-judgment experiment.
 *
 * Every mandatory obligation that a compiler or a runtime probe can decide is decided here,
 * outside the model. Each probe returns its own evidence string, so the staged policy stage
 * receives facts with provenance rather than a model's opinion about them.
 *
 * This module also derives the mechanical variant relationship used only as an independent
 * check on the taxonomy stage. That label is never sent to the provider as a question option.
 */
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { buildShapeCandidates, type ShapeFileMap } from "./shape-candidates.ts"

const RUNNER = "packages/core/src/runner.ts"
const OBSERVER = "packages/core/src/observer-execution.ts"
const CACHE = "packages/core/src/cache.ts"
const SCORE_EXECUTION = "packages/core/src/scoring-engine-score-execution.ts"
const CLOCK = "packages/core/src/observer-time.ts"

export type VariantKey = "a" | "b"

export type GateCheck = {
  readonly obligationId: string
  readonly probe: string
  readonly satisfied: boolean
  readonly detail: string
}

export type MechanicalRelationship = {
  readonly root: string
  readonly child: string | null
  readonly evidence: ReadonlyArray<string>
}

export type GateResult = {
  readonly checks: Readonly<Record<VariantKey, ReadonlyArray<GateCheck>>>
  readonly eligible: Readonly<Record<VariantKey, boolean>>
  readonly violations: Readonly<Record<VariantKey, ReadonlyArray<string>>>
  readonly relationship: MechanicalRelationship
}

export type ObligationSpec = {
  readonly id: string
  readonly kind: "deterministic" | "semantic"
  readonly probe?: string
  readonly text: string
}

export type SubjectProbeKind = "extraction" | "consolidation" | "representation"

const temps: Array<string> = []

/** Remove every temporary variant tree this module created. */
export function cleanupTemps(): void {
  while (temps.length > 0) {
    const root = temps.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}

const materialize = (repoRoot: string, files: ShapeFileMap, extras: ShapeFileMap = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "jev-staged-"))
  temps.push(root)
  cpSync(join(repoRoot, "packages/core/src"), join(root, "packages/core/src"), { recursive: true })
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"))
  for (const [relative, content] of Object.entries({ ...files, ...extras })) {
    writeFileSync(join(root, relative), content)
  }
  return root
}

const load = async (root: string, relative: string): Promise<Record<string, any>> =>
  import(pathToFileURL(join(root, relative)).href)

const tsc = (repoRoot: string, cwd: string, files: ReadonlyArray<string>): { code: number; output: string } => {
  const result = Bun.spawnSync({
    cmd: [
      resolve(repoRoot, "node_modules/.bin/tsc"),
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
  return { code: result.exitCode ?? 1, output: `${result.stdout.toString()}${result.stderr.toString()}` }
}

const occurrenceCount = (source: string, needle: string): number => {
  if (needle.length === 0) throw new Error("empty anchor")
  let count = 0
  let from = 0
  while (true) {
    const at = source.indexOf(needle, from)
    if (at < 0) return count
    count += 1
    from = at + needle.length
  }
}

const FactorConfig = {} as never
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
  signalResults: Map<string, any>
  inactiveSignals: Array<string>
  signalMetadata: Record<string, unknown>
  signalProfiles: Record<string, { durationMs?: number; score: number; diagnostics: number }>
}) => ({
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

type ExtractionObservation = {
  readonly capRunnerSeverities: ReadonlyArray<string>
  readonly capObserverSeverities: ReadonlyArray<string>
  readonly runnerFailureTag: string | null
  readonly observerFailureView: { readonly score: number; readonly applicability: unknown; readonly severity: unknown }
  readonly suite: string
}

const runExtraction = async (repoRoot: string, files: ShapeFileMap): Promise<ExtractionObservation> => {
  const root = materialize(repoRoot, files)
  const compiled = tsc(repoRoot, root, [RUNNER, OBSERVER])
  if (compiled.code !== 0) throw new Error(`extraction variant does not compile: ${compiled.output.slice(0, 400)}`)
  const runner = await load(root, RUNNER)
  const observer = await load(root, OBSERVER)
  const registryMod = await load(root, "packages/core/src/registry.ts")
  const factors = await load(root, "packages/core/src/factor-ledger.ts")
  const errors = await load(root, "packages/core/src/errors.ts")

  const absent = {
    id: "TEST-ABSENT", tier: 1, category: "legibility-decay", kind: "legibility",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: () => Effect.succeed({ n: 1 }), score: () => 0.7, diagnose: () => [],
  }
  const present = {
    id: "TEST-PRESENT", tier: 1, category: "generated-slop", kind: "structural",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {},
    factorDefinitions: [scoreCap], inputs: [],
    compute: () =>
      Effect.gen(function* () {
        const factorPolicy = yield* Effect.serviceOption(factors.SignalFactorPolicyTag)
        const overrides =
          factorPolicy._tag === "Some"
            ? (factorPolicy.value as { vectorOverrides: Record<string, unknown> }).vectorOverrides
            : {}
        return { n: 1, visibleVectorOverrideCount: Object.keys(overrides).length }
      }),
    score: () => 0.8, diagnose: () => [],
    outputMetadata: () => ({ applicability: "applicable", effectiveConfidence: 0.42 }),
    factorLedger: () => factors.makeFactorLedger("TEST-PRESENT", [factors.makeFactorEntry(scoreCap, 0.8)]),
  }
  const capped = {
    id: "TEST-LEG", tier: 1, category: "legibility-decay", kind: "legibility",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: () => Effect.succeed({ n: 1 }), score: () => 0.2,
    diagnose: () => [{ severity: "block", message: "shouldn't block" }],
  }
  const failing = {
    id: "TEST-BAD", tier: 1, category: "legibility-decay", kind: "legibility",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: () => Effect.fail(new errors.SignalComputeError({ signalId: "TEST-BAD", message: "boom" })),
    score: () => 0.5, diagnose: () => [],
  }
  const ok = {
    id: "TEST-OK", tier: 1, category: "legibility-decay", kind: "legibility",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: () => Effect.succeed({ n: 1 }), score: () => 0.9, diagnose: () => [],
  }
  const inactive = {
    id: "TEST-INACTIVE", tier: 1, category: "legibility-decay", kind: "legibility",
    evidenceClass: "deterministic-ast", configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: () => Effect.succeed({ n: 1 }), score: () => 0.1, diagnose: () => [],
  }
  const run = (signals: ReadonlyArray<unknown>, id: string, vec?: ReturnType<typeof vector>) =>
    Effect.gen(function* () {
      const registry = yield* registryMod.buildRegistry(signals)
      return (yield* runner.runSignal(registry, id, vec)) as any
    })
  const observe = (signals: ReadonlyArray<unknown>, vec?: ReturnType<typeof vector>) =>
    Effect.gen(function* () {
      const registry = yield* registryMod.buildRegistry(signals)
      return executionView(yield* observer.executeObserverSignals(registry, vec, false))
    })
  const overrideVec = vector({ "TEST-PRESENT": { factors: { "stub_kinds.throw-not-implemented.score_cap": 0.6 } } })
  const inactiveVec = vector({ "TEST-INACTIVE": { active: false } })

  const observed = await Effect.runPromise(
    Effect.gen(function* () {
      return {
        absentRun: yield* run([absent], "TEST-ABSENT"),
        presentRun: yield* run([present], "TEST-PRESENT"),
        presentOverride: yield* run([present], "TEST-PRESENT", overrideVec),
        capRun: yield* run([capped], "TEST-LEG"),
        inactiveRun: yield* run([inactive], "TEST-INACTIVE", inactiveVec),
        runnerFailure: yield* Effect.result(run([failing], "TEST-BAD")),
        absentObs: yield* observe([absent]),
        presentObs: yield* observe([present]),
        presentOverrideObs: yield* observe([present], overrideVec),
        capObs: yield* observe([capped]),
        isolated: yield* observe([ok, failing]),
        inactiveObs: yield* observe([ok, inactive], inactiveVec),
      }
    }) as Effect.Effect<any, never, never>,
  )

  const capRunnerSeverities = (observed.capRun.diagnostics as ReadonlyArray<{ severity: string }>).map((d) => d.severity)
  const capObserverSeverities = (
    (observed.capObs.results["TEST-LEG"]?.diagnostics ?? []) as ReadonlyArray<{ severity: string }>
  ).map((d) => d.severity)
  const failedResult = observed.isolated.results["TEST-BAD"] as {
    score: number
    metadata?: { applicability?: unknown }
    diagnostics?: ReadonlyArray<{ severity: unknown }>
  }
  const runnerFailureTag = observed.runnerFailure._tag === "Failure" ? observed.runnerFailure.failure._tag : null
  return {
    capRunnerSeverities,
    capObserverSeverities,
    runnerFailureTag,
    observerFailureView: {
      score: failedResult.score,
      applicability: failedResult.metadata?.applicability,
      severity: failedResult.diagnostics?.[0]?.severity,
    },
    // Compared across variants; covers every value the two variants must agree on.
    suite: JSON.stringify({
      absentRun: observed.absentRun,
      presentRun: observed.presentRun,
      presentOverride: observed.presentOverride,
      inactiveRun: observed.inactiveRun,
      absentObs: observed.absentObs,
      presentObs: observed.presentObs,
      presentOverrideObs: observed.presentOverrideObs,
      isolated: observed.isolated,
      inactiveObs: observed.inactiveObs,
      runnerFailureTag,
      capRunnerSeverities,
      capObserverSeverities,
    }),
  }
}

type ConsolidationObservation = {
  readonly view: ReturnType<typeof executionView>
  readonly invocations: Record<string, number>
  readonly inputs: Record<string, Record<string, unknown>>
}

const CLOCK_SOURCE = `let t = 0
export const nowMs = (): number => {
  t += 1
  return t
}
export const roundRuntimeMs = (value: number): number => Math.max(0, Number(value.toFixed(2)))
`

const runConsolidation = async (repoRoot: string, files: ShapeFileMap): Promise<ConsolidationObservation> => {
  const root = materialize(repoRoot, files, { [CLOCK]: CLOCK_SOURCE })
  const compiled = tsc(repoRoot, root, [OBSERVER])
  if (compiled.code !== 0) throw new Error(`consolidation variant does not compile: ${compiled.output.slice(0, 400)}`)
  const observer = await load(root, OBSERVER)
  const registryMod = await load(root, "packages/core/src/registry.ts")
  const errors = await load(root, "packages/core/src/errors.ts")
  const invocations = new Map<string, number>()
  const inputs: Record<string, Record<string, unknown>> = {}
  const leaf = (
    id: string,
    opts: { score: number; fail?: boolean; metadata?: { applicability: string }; compute?: () => Effect.Effect<{ n: number }, unknown> },
  ) => ({
    id, tier: 1, category: "legibility-decay", kind: "legibility", evidenceClass: "deterministic-ast",
    configSchema: FactorConfig, defaultConfig: {}, inputs: [],
    compute: (_config: unknown, received: ReadonlyMap<string, unknown>) => {
      invocations.set(id, (invocations.get(id) ?? 0) + 1)
      inputs[id] = Object.fromEntries(received)
      if (opts.fail) return Effect.fail(new errors.SignalComputeError({ signalId: id, message: "boom" }))
      return opts.compute?.() ?? Effect.succeed({ n: 1 })
    },
    score: () => opts.score, diagnose: () => [],
    ...(opts.metadata !== undefined ? { outputMetadata: () => opts.metadata } : {}),
  })
  const l1 = leaf("L1", { score: 0.4, metadata: { applicability: "applicable" } })
  const l2 = leaf("L2", { score: 0.7, compute: () => Effect.sleep("5 millis").pipe(Effect.map(() => ({ n: 2 }))) })
  const failing = leaf("FAIL", { score: 0.5, fail: true })
  const inactive = leaf("INACTIVE", { score: 0.1 })
  const compound = {
    id: "COMPOUND", tier: 1.5, category: "review-pain", kind: "compound", evidenceClass: "deterministic-ast",
    configSchema: FactorConfig, defaultConfig: {}, inputs: [{ id: "L1" }, { id: "L2" }, { id: "INACTIVE" }],
    compute: (_config: unknown, received: ReadonlyMap<string, unknown>) => {
      invocations.set("COMPOUND", (invocations.get("COMPOUND") ?? 0) + 1)
      inputs.COMPOUND = Object.fromEntries(received)
      return Effect.succeed({
        n:
          ((received.get("L1") as { n: number } | undefined)?.n ?? 0) +
          ((received.get("L2") as { n: number } | undefined)?.n ?? 0),
      })
    },
    score: () => 0.9, diagnose: () => [],
  }
  const vec = vector({ INACTIVE: { active: false } })
  const executed = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* registryMod.buildRegistry([l1, l2, failing, inactive, compound])
      return yield* observer.executeObserverSignals(registry, vec, true)
    }) as Effect.Effect<Parameters<typeof executionView>[0], never, never>,
  )
  return { view: executionView(executed), invocations: Object.fromEntries(invocations), inputs }
}

type RepresentationObservation = {
  readonly lookups: Record<string, unknown>
  readonly consumerCode: number
  readonly hitCode: number
  readonly missCode: number
  readonly narrowCode: number
}

const runRepresentation = async (repoRoot: string, files: ShapeFileMap): Promise<RepresentationObservation> => {
  const root = materialize(repoRoot, files)
  const cache = await load(root, CACHE)
  const now = new Date("2026-09-17T00:00:00.000Z")
  const staleAt = new Date("2026-06-19T00:00:00.000Z").toISOString()
  const lookups: Record<string, unknown> = {
    absent: cache.evaluateTieredCacheEntry(undefined, { now }),
    mismatchedTier: cache.evaluateTieredCacheEntry(cache.buildTieredCacheEntry(1, { tier: 1, computedAt: now.toISOString() }), { now, tier: 2 }),
    mismatchedRef: cache.evaluateTieredCacheEntry(
      cache.buildTieredCacheEntry(1, { tier: 2, refVersionHash: "ref-v1", computedAt: now.toISOString() }),
      { now, tier: 2, refVersionHash: "ref-v2" },
    ),
    mismatchedModel: cache.evaluateTieredCacheEntry(
      cache.buildTieredCacheEntry(1, { tier: 3, modelId: "m1", computedAt: now.toISOString() }),
      { now, tier: 3, modelId: "m2" },
    ),
    fresh: cache.evaluateTieredCacheEntry(cache.buildTieredCacheEntry(7, { tier: 1, computedAt: now.toISOString() }), { now, tier: 1 }),
    staleHit: cache.evaluateTieredCacheEntry(
      cache.buildTieredCacheEntry(3, { tier: 3, modelId: "m1", baseConfidence: 0.9, halfLifeDays: 30, computedAt: staleAt }),
      { now, tier: 3, modelId: "m1", confidenceThreshold: 0.5, staleMode: "mark-stale" },
    ),
    staleMiss: cache.evaluateTieredCacheEntry(
      cache.buildTieredCacheEntry(3, { tier: 3, modelId: "m1", baseConfidence: 0.9, halfLifeDays: 30, computedAt: staleAt }),
      { now, tier: 3, modelId: "m1", confidenceThreshold: 0.5 },
    ),
  }
  const writeProbe = (name: string, source: string): string => {
    const relative = `packages/core/src/${name}`
    writeFileSync(join(root, relative), source)
    return relative
  }
  const hitProbe = writeProbe(
    "jev-staged-hit-assignability.ts",
    `import { evaluateTieredCacheEntry } from "./cache.js"
declare function accept(result: ReturnType<typeof evaluateTieredCacheEntry<number>>): void
accept({ status: "hit" })
`,
  )
  const missProbe = writeProbe(
    "jev-staged-miss-confidence.ts",
    `import { evaluateTieredCacheEntry } from "./cache.js"
declare function accept(result: ReturnType<typeof evaluateTieredCacheEntry<number>>): void
accept({ status: "miss", effectiveConfidence: 0.12 })
`,
  )
  const narrowProbe = writeProbe(
    "jev-staged-narrow.ts",
    `import { buildTieredCacheEntry, evaluateTieredCacheEntry } from "./cache.js"
const result = evaluateTieredCacheEntry(buildTieredCacheEntry(7), { now: new Date("2026-09-17T00:00:00.000Z") })
if (result.status === "hit" || result.status === "stale") {
  const value: number = result.value
  void value
}
`,
  )
  return {
    lookups,
    consumerCode: tsc(repoRoot, root, [SCORE_EXECUTION]).code,
    hitCode: tsc(repoRoot, root, [hitProbe]).code,
    missCode: tsc(repoRoot, root, [missProbe]).code,
    narrowCode: tsc(repoRoot, root, [narrowProbe]).code,
  }
}

const describe = (value: unknown): string => JSON.stringify(value)

const extractionOwnershipEvidence = (files: ShapeFileMap): ReadonlyArray<string> => {
  const construction =
    occurrenceCount(files[RUNNER] ?? "", "score: target.score(out)") +
    occurrenceCount(files[RUNNER] ?? "", "score: signal.score(out)") +
    occurrenceCount(files[OBSERVER] ?? "", "score: signal.score(out)")
  const calls =
    occurrenceCount(files[RUNNER] ?? "", "finalizeSignalResult(") +
    occurrenceCount(files[OBSERVER] ?? "", "finalizeSignalResult(")
  const definitions = occurrenceCount(files[RUNNER] ?? "", "export const finalizeSignalResult")
  return [
    `successful-result construction sites (score:<signal>.score(out) occurrences): ${construction}`,
    `shared-constructor call sites: ${calls}`,
    `shared-constructor definitions: ${definitions}`,
  ]
}

const consolidationDecompositionEvidence = (files: ShapeFileMap): ReadonlyArray<string> => {
  const source = files[OBSERVER] ?? ""
  const helpers = ["createObserverSignalExecution", "takeNextObserverBatch", "runObserverSignalBatch", "recordObserverBatchResults"]
  const declared = helpers.filter((name) => source.includes(`const ${name} = (`))
  const exported = helpers.filter((name) => source.includes(`export const ${name} = (`))
  return [
    `phase helpers declared as module-private const: ${declared.length} (${declared.join(", ") || "none"})`,
    `phase helpers exported: ${exported.length} (${exported.join(", ") || "none"})`,
    `batch loop inlined in the exported entry point: ${source.includes("while (execution.pendingSignals.length > 0)")}`,
  ]
}

const representationContractEvidence = (observation: RepresentationObservation): ReadonlyArray<string> => [
  `a bare {status:"hit"} object literal is assignable to the lookup result type: ${observation.hitCode === 0}`,
  `narrowing on hit/stale yields a non-optional payload without an assertion: ${observation.narrowCode === 0}`,
  `miss carrying effectiveConfidence without entry/value is assignable: ${observation.missCode === 0}`,
  `scoring-engine-score-execution.ts type-checks against this cache module: ${observation.consumerCode === 0}`,
]

const flagOf = (line: string | undefined): boolean => (line ?? "").endsWith("true")
const numberAfter = (line: string | undefined): number => Number(/:\s*(\d+)/.exec(line ?? "")?.[1] ?? "-1")

const relationshipFromOwnership = (
  evidenceA: ReadonlyArray<string>,
  evidenceB: ReadonlyArray<string>,
  behaviorEqual: boolean,
): MechanicalRelationship => {
  if (!behaviorEqual) {
    return {
      root: "contract_or_behavior_differs",
      child: "runtime_behavior_differs",
      evidence: ["variant observation suites differ"],
    }
  }
  const sitesA = numberAfter(evidenceA[0])
  const sitesB = numberAfter(evidenceB[0])
  if (sitesA === sitesB) {
    return { root: "equivalent_organization", child: null, evidence: [...evidenceA, ...evidenceB] }
  }
  // The taxonomy question is directed: it asks how `variants.b` differs from `variants.a`.
  // A direction-blind child label would credit the answer to the wrong variant.
  if (sitesB > sitesA) {
    return {
      root: "ownership_boundary_differs",
      child: "implementation_sites_remain",
      evidence: [...evidenceA, ...evidenceB],
    }
  }
  const calls = numberAfter(evidenceB[1])
  const definitions = numberAfter(evidenceB[2])
  return {
    root: "ownership_boundary_differs",
    child: definitions === 1 && calls >= 2 ? "shared_owner_single_contract" : "shared_owner_caller_specific_mode",
    evidence: [...evidenceA, ...evidenceB],
  }
}

const relationshipFromDecomposition = (
  evidenceA: ReadonlyArray<string>,
  evidenceB: ReadonlyArray<string>,
): MechanicalRelationship => {
  const exportedA = numberAfter(evidenceA[1])
  const exportedB = numberAfter(evidenceB[1])
  if (exportedB > 0 || exportedA > 0) {
    return { root: "internal_decomposition_differs", child: "helpers_shared_or_reused", evidence: [...evidenceA, ...evidenceB] }
  }
  const privateA = numberAfter(evidenceA[0])
  const privateB = numberAfter(evidenceB[0])
  if (privateA === privateB) {
    return { root: "equivalent_organization", child: null, evidence: [...evidenceA, ...evidenceB] }
  }
  return {
    root: "internal_decomposition_differs",
    // Directed: private helpers in b means b keeps them; private helpers only in a means b
    // dropped the helper boundary.
    child: privateB > privateA ? "helpers_private_single_use" : "decomposition_not_via_helpers",
    evidence: [...evidenceA, ...evidenceB],
  }
}

const relationshipFromContract = (
  evidenceA: ReadonlyArray<string>,
  evidenceB: ReadonlyArray<string>,
): MechanicalRelationship => {
  const runtimeEqual = flagOf(evidenceA[3]) && flagOf(evidenceB[3])
  const guaranteeDiffers = flagOf(evidenceA[0]) !== flagOf(evidenceB[0]) || flagOf(evidenceA[1]) !== flagOf(evidenceB[1])
  if (runtimeEqual && guaranteeDiffers) {
    return { root: "contract_or_behavior_differs", child: "static_guarantee_differs", evidence: [...evidenceA, ...evidenceB] }
  }
  return { root: "insufficient_evidence", child: null, evidence: [...evidenceA, ...evidenceB] }
}

/**
 * Decide every mechanically decidable obligation for one variant pair, and derive the
 * mechanical relationship. Probe failures throw rather than degrade to a satisfied check.
 */
export async function evaluateGate(
  repoRoot: string,
  subject: SubjectProbeKind,
  obligations: ReadonlyArray<ObligationSpec>,
  variants: Readonly<Record<VariantKey, ShapeFileMap>>,
): Promise<GateResult> {
  const deterministic = obligations.filter((obligation) => obligation.kind === "deterministic")
  const requireProbe = (obligation: ObligationSpec): string => {
    if (obligation.probe === undefined) throw new Error(`Deterministic obligation without probe: ${obligation.id}`)
    return obligation.probe
  }
  const checks: Record<VariantKey, Array<GateCheck>> = { a: [], b: [] }
  let relationship: MechanicalRelationship

  if (subject === "extraction") {
    const a = await runExtraction(repoRoot, variants.a)
    const b = await runExtraction(repoRoot, variants.b)
    // "Preserve current behavior" is measured against the unmodified repository, not against
    // the other variant, so a candidate is never disqualified by the baseline it must match.
    const reference = await runExtraction(repoRoot, {})
    for (const key of ["a", "b"] as const) {
      const observation = key === "a" ? a : b
      const behaviorEqual = observation.suite === reference.suite
      for (const obligation of deterministic) {
        const probe = requireProbe(obligation)
        if (probe === "extraction.no_uncapped_block") {
          const satisfied = observation.capRunnerSeverities.every((severity) => severity !== "block") &&
            observation.capObserverSeverities.every((severity) => severity !== "block")
          checks[key].push({
            obligationId: obligation.id, probe, satisfied,
            detail: `runner severities ${describe(observation.capRunnerSeverities)}, observer severities ${describe(observation.capObserverSeverities)}`,
          })
        } else if (probe === "extraction.failure_handling") {
          const satisfied = observation.runnerFailureTag === "SignalComputeError" &&
            observation.observerFailureView.score === 0 &&
            observation.observerFailureView.applicability === "failed" &&
            observation.observerFailureView.severity === "warn"
          checks[key].push({
            obligationId: obligation.id, probe, satisfied,
            detail: `runner failure tag ${describe(observation.runnerFailureTag)}, observer failed result ${describe(observation.observerFailureView)}`,
          })
        } else if (probe === "extraction.behavior_equivalence") {
          checks[key].push({
            obligationId: obligation.id, probe, satisfied: behaviorEqual,
            detail: behaviorEqual
              ? "observation suite identical to the unmodified repository"
              : "observation suite differs from the unmodified repository",
          })
        } else {
          throw new Error(`Unknown extraction probe ${probe}`)
        }
      }
    }
    relationship = relationshipFromOwnership(
      extractionOwnershipEvidence(variants.a),
      extractionOwnershipEvidence(variants.b),
      a.suite === b.suite,
    )
  } else if (subject === "consolidation") {
    const a = await runConsolidation(repoRoot, variants.a)
    const b = await runConsolidation(repoRoot, variants.b)
    const suite = (observation: ConsolidationObservation) =>
      describe({ view: observation.view, invocations: observation.invocations, inputs: observation.inputs })
    const reference = suite(await runConsolidation(repoRoot, {}))
    for (const key of ["a", "b"] as const) {
      const observation = key === "a" ? a : b
      const behaviorEqual = suite(observation) === reference
      for (const obligation of deterministic) {
        const probe = requireProbe(obligation)
        if (probe === "consolidation.behavior_equivalence") {
          checks[key].push({
            obligationId: obligation.id, probe, satisfied: behaviorEqual,
            detail: behaviorEqual
              ? `identical outputs/results/metadata/inactive/profiles/invocations (${describe(observation.invocations)})`
              : "outputs, results, metadata, inactive ids, profiles or invocation counts differ",
          })
        } else if (probe === "consolidation.publication_after_batch") {
          const satisfied = describe(observation.inputs.L1) === "{}" && describe(observation.inputs.L2) === "{}" &&
            Object.keys(observation.inputs.COMPOUND ?? {}).sort().join(",") === "L1,L2"
          checks[key].push({
            obligationId: obligation.id, probe, satisfied,
            detail: `batch members received outputs ${describe(observation.inputs.L1)} and ${describe(observation.inputs.L2)}; compound received ${describe(Object.keys(observation.inputs.COMPOUND ?? {}))}`,
          })
        } else {
          throw new Error(`Unknown consolidation probe ${probe}`)
        }
      }
    }
    relationship = relationshipFromDecomposition(
      consolidationDecompositionEvidence(variants.a),
      consolidationDecompositionEvidence(variants.b),
    )
  } else {
    const a = await runRepresentation(repoRoot, variants.a)
    const b = await runRepresentation(repoRoot, variants.b)
    const reference = describe((await runRepresentation(repoRoot, {})).lookups)
    for (const key of ["a", "b"] as const) {
      const observation = key === "a" ? a : b
      for (const obligation of deterministic) {
        const probe = requireProbe(obligation)
        if (probe === "representation.runtime_equivalence") {
          const satisfied = describe(observation.lookups) === reference && observation.consumerCode === 0
          checks[key].push({
            obligationId: obligation.id, probe, satisfied,
            detail: satisfied
              ? "identical lookup results to the unmodified repository; consumer compiles"
              : `lookup results differ from the unmodified repository or the consumer does not compile (exit ${observation.consumerCode})`,
          })
        } else if (probe === "representation.producer_guarantee") {
          const fresh = observation.lookups.fresh as { status?: string; value?: unknown; entry?: unknown }
          const staleHit = observation.lookups.staleHit as { status?: string; value?: unknown; entry?: unknown }
          const staleMiss = observation.lookups.staleMiss as { status?: string; effectiveConfidence?: unknown; value?: unknown; entry?: unknown }
          const satisfied = fresh.status === "hit" && fresh.value !== undefined && fresh.entry !== undefined &&
            staleHit.status === "stale" && staleHit.value !== undefined && staleHit.entry !== undefined &&
            staleMiss.status === "miss" && staleMiss.effectiveConfidence !== undefined &&
            staleMiss.value === undefined && staleMiss.entry === undefined
          checks[key].push({
            obligationId: obligation.id, probe, satisfied,
            detail: `hit ${describe(observation.lookups.fresh)}, stale ${describe(observation.lookups.staleHit)}, miss-with-confidence ${describe(observation.lookups.staleMiss)}`,
          })
        } else {
          throw new Error(`Unknown representation probe ${probe}`)
        }
      }
    }
    relationship = relationshipFromContract(
      representationContractEvidence(a),
      representationContractEvidence(b),
    )
  }

  return {
    checks,
    eligible: {
      a: checks.a.every((check) => check.satisfied),
      b: checks.b.every((check) => check.satisfied),
    },
    violations: {
      a: checks.a.filter((check) => !check.satisfied).map((check) => `${check.obligationId}: ${check.detail}`),
      b: checks.b.filter((check) => !check.satisfied).map((check) => `${check.obligationId}: ${check.detail}`),
    },
    relationship,
  }
}

export { buildShapeCandidates, type ShapeFileMap }
