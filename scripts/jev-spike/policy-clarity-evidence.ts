import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { buildFactorPolicyBoundaryCandidate } from "./policy-clarity-cases.ts"
import { buildShapeCandidates } from "./shape-candidates.ts"

/**
 * Independent evidence for the policy-clarity cases, computed outside provider
 * input and kept separate from the declared obligations.
 *
 * Two distinctions this module exists to preserve:
 *
 * 1. Declared runtime-context obligations are not repository compatibility. A
 *    variant can preserve every obligation the packet declares and still fail
 *    to be an applicable refactor because an existing test or consumer does not
 *    compile against it.
 * 2. A finite runtime probe is not a proof. "Identical over N probed inputs"
 *    never establishes "identical for any signal and vector".
 */

const TSC = "node_modules/.bin/tsc"
const FACTOR_LEDGER = "packages/core/src/factor-ledger.ts"
const FACTOR_LEDGER_TEST = "packages/core/src/__tests__/factor-ledger.test.ts"
const CACHE = "packages/core/src/cache.ts"

export interface CompilerProbe {
  readonly target: string
  readonly variant: "a" | "b"
  readonly exitCode: number
  readonly firstError: string | null
}

export interface HeldOutEvidence {
  readonly compilerProbes: ReadonlyArray<CompilerProbe>
  readonly runtimeContextProbe: {
    readonly probedInputs: number
    readonly identical: boolean
    readonly sample: string
  }
  readonly sourceInspection: {
    readonly productionCallSites: number
    readonly testCallSites: number
    readonly inlinedVariantStillReadsBackFromResolvedConfig: boolean
    readonly inlinedVariantDropsTheDocumentingComment: boolean
  }
}

export interface DevelopmentEvidence {
  readonly representationConsumerCompileExitCodes: { readonly a: number; readonly b: number }
  readonly cacheLookupIdenticalOverProbedCases: boolean
  readonly cacheLookupSample: string
  readonly existingBehavioralSuiteExitCode: number
  readonly existingBehavioralSuiteSummary: string
}

export interface EvidenceReport {
  readonly schema: "pulsar.jev_policy_clarity_evidence.v1"
  readonly repositorySha: string
  readonly heldOut: HeldOutEvidence
  readonly development: DevelopmentEvidence
  readonly limitations: ReadonlyArray<string>
}

const temporaryRoots: string[] = []

export const materializeRepoCopy = (root: string, files: Record<string, string>): string => {
  const target = mkdtempSync(join(tmpdir(), "jev-policy-clarity-evidence-"))
  temporaryRoots.push(target)
  cpSync(resolve(root, "packages/core/src"), join(target, "packages/core/src"), { recursive: true })
  symlinkSync(resolve(root, "node_modules"), join(target, "node_modules"))
  for (const [relative, content] of Object.entries(files)) writeFileSync(join(target, relative), content)
  return target
}

export const cleanupRepoCopies = (): void => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
}

export const runTsc = (
  root: string,
  cwd: string,
  files: ReadonlyArray<string>,
): { readonly exitCode: number; readonly output: string } => {
  const result = Bun.spawnSync({
    cmd: [
      resolve(root, TSC),
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
  return { exitCode: result.exitCode ?? 1, output: `${result.stdout.toString()}${result.stderr.toString()}` }
}

const firstError = (output: string): string | null =>
  output.split("\n").find((line) => line.includes("error TS")) ?? null

const load = async (root: string, relative: string): Promise<Record<string, any>> =>
  import(pathToFileURL(join(root, relative)).href)

const HELD_OUT_PROBE_VECTORS = [
  undefined,
  { id: "v1", domain: "typescript", signal_overrides: {} },
  { id: "v1", domain: "typescript", signal_overrides: { "TEST-CONFIG-MATRIX": { config: { max_complexity: 15 } } } },
  {
    id: "v1",
    domain: "typescript",
    signal_overrides: {
      "TEST-CONFIG-MATRIX": { config: { max_complexity: 15, unknown_knob: 4 }, factors: { "config.max_complexity": 11 } },
    },
  },
  { id: "v1", domain: "typescript", signal_overrides: { "TEST-CONFIG-MATRIX": { factors: { "config.allow_recursion": false } } } },
]

export async function collectHeldOutEvidence(root: string): Promise<HeldOutEvidence> {
  const candidate = buildFactorPolicyBoundaryCandidate(root)
  const compilerProbes: CompilerProbe[] = []
  const contexts: Record<"a" | "b", ReadonlyArray<unknown>> = { a: [], b: [] }
  for (const variant of ["a", "b"] as const) {
    const copy = materializeRepoCopy(root, candidate[variant])
    for (const [target, file] of [
      ["module", FACTOR_LEDGER],
      ["existing_test_module", FACTOR_LEDGER_TEST],
    ] as const) {
      const result = runTsc(root, copy, [file])
      compilerProbes.push({ target, variant, exitCode: result.exitCode, firstError: firstError(result.output) })
    }
    const ledger = await load(copy, FACTOR_LEDGER)
    const signal = { id: "TEST-CONFIG-MATRIX", defaultConfig: { max_complexity: 20, allow_recursion: true } }
    contexts[variant] = HELD_OUT_PROBE_VECTORS.map((vector) => ledger.makeSignalFactorPolicyContext(signal, vector))
  }
  const inlined = candidate.b[FACTOR_LEDGER]!
  return {
    compilerProbes,
    runtimeContextProbe: {
      probedInputs: HELD_OUT_PROBE_VECTORS.length,
      identical: JSON.stringify(contexts.a) === JSON.stringify(contexts.b),
      sample: JSON.stringify(contexts.a[2]),
    },
    sourceInspection: {
      productionCallSites: candidate.evidence.productionCallSites.length,
      testCallSites: candidate.evidence.testCallSites.length,
      inlinedVariantStillReadsBackFromResolvedConfig: inlined.includes("resolvedConfig("),
      inlinedVariantDropsTheDocumentingComment: !inlined.includes("cannot drift apart"),
    },
  }
}

export async function collectDevelopmentEvidence(root: string): Promise<DevelopmentEvidence> {
  const shapes = buildShapeCandidates(root)
  const compileExitCodes: Record<"a" | "b", number> = { a: 1, b: 1 }
  const lookups: Record<"a" | "b", unknown> = { a: null, b: null }
  const scoreExecution = "packages/core/src/scoring-engine-score-execution.ts"
  for (const variant of ["a", "b"] as const) {
    const copy = materializeRepoCopy(root, shapes.representation[variant])
    compileExitCodes[variant] = runTsc(root, copy, [scoreExecution]).exitCode
    const cache = await load(copy, CACHE)
    const now = new Date("2026-09-17T00:00:00.000Z")
    const staleAt = new Date("2026-06-19T00:00:00.000Z").toISOString()
    lookups[variant] = {
      absent: cache.evaluateTieredCacheEntry(undefined, { now }),
      fresh: cache.evaluateTieredCacheEntry(cache.buildTieredCacheEntry(7, { tier: 1, computedAt: now.toISOString() }), {
        now,
        tier: 1,
      }),
      staleMiss: cache.evaluateTieredCacheEntry(
        cache.buildTieredCacheEntry(3, { tier: 3, modelId: "m1", baseConfidence: 0.9, halfLifeDays: 30, computedAt: staleAt }),
        { now, tier: 3, modelId: "m1", confidenceThreshold: 0.5 },
      ),
    }
  }
  const suite = Bun.spawnSync({
    cmd: ["bun", "test", "scripts/__tests__/jev-shape-candidates.test.ts"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const suiteOutput = `${suite.stdout.toString()}${suite.stderr.toString()}`
  return {
    representationConsumerCompileExitCodes: compileExitCodes,
    cacheLookupIdenticalOverProbedCases: JSON.stringify(lookups.a) === JSON.stringify(lookups.b),
    cacheLookupSample: JSON.stringify(lookups.a),
    existingBehavioralSuiteExitCode: suite.exitCode ?? 1,
    existingBehavioralSuiteSummary:
      suiteOutput
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(-3)
        .join(" ") || "no output",
  }
}

export async function collectEvidence(root: string): Promise<EvidenceReport> {
  const heldOut = await collectHeldOutEvidence(root)
  const development = await collectDevelopmentEvidence(root)
  return {
    schema: "pulsar.jev_policy_clarity_evidence.v1",
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim(),
    heldOut,
    development,
    limitations: [
      "Declared obligations are runtime-context obligations stated in the packet. They are not repository compatibility: variant b of the held-out case preserves them over the probed inputs and still fails the existing test module compilation.",
      `Runtime equality for the held-out case is a finite probe over ${HELD_OUT_PROBE_VECTORS.length} signal/vector inputs, not a proof for any signal and vector.`,
      "The development behavioral evidence is the pre-existing suite's own assertions about equal outputs, results, metadata, inactive ids, profiles, invocation counts and batch inputs; it is not a new proof of behavioral equivalence.",
      "No human labels were used. All expectations are agent-authored.",
    ],
  }
}
