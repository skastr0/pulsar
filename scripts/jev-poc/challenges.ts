import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Executable mutation fixtures for the autonomous Jev POC.
 *
 * Each challenge is a deterministic, fail-closed source transformation over
 * REAL Pulsar code. The transformation is applied to a disposable copy of the
 * workspace; the pipeline then runs its own discovery and scoring and compares
 * the result against the declared directions below.
 *
 * Design rules this file obeys:
 *
 * - Nothing here is discovery or transport. The pipeline finds affected
 *   pointers from signals after the mutation; `affectedRegions` is evaluation
 *   metadata and is never handed to the pipeline as input.
 * - Mutated source carries no case id, no label, no explanation, and no
 *   expected outcome. A hygiene check in the test enforces that.
 * - Directions are declared under two explicitly opposite repository
 *   preferences, because no code style is universally good.
 * - Detector misses are declared, not hidden. `detectorReach.covered` records
 *   whether the candidate signal set used by the pipeline can actually see the
 *   mutation, with the measured evidence for that claim.
 */

const REPO_ROOT = resolve(import.meta.dir, "../..")

// --- preferences -------------------------------------------------------------

export type PocPreferenceId =
  | "extract-shared-rules"
  | "callers-own-their-rules"
  | "direct-code"
  | "neutral-abstraction"

export type PocDirection = "down" | "unchanged"

export type PocPreference = {
  readonly id: PocPreferenceId
  /** The opposite repository preference this direction must be contrasted with. */
  readonly opposite: PocPreferenceId
  /** Repository-owned calibration data. Never a generic Pulsar default. */
  readonly statement: string
}

export const POC_PREFERENCES: Record<PocPreferenceId, PocPreference> = {
  "extract-shared-rules": {
    id: "extract-shared-rules",
    opposite: "callers-own-their-rules",
    statement:
      "When two sites implement the same domain rule, this repository wants one authoritative owner; a second independent copy of the rule is debt.",
  },
  "callers-own-their-rules": {
    id: "callers-own-their-rules",
    opposite: "extract-shared-rules",
    statement:
      "A caller may implement its own rule; duplication is tolerated and no extraction is required.",
  },
  "direct-code": {
    id: "direct-code",
    opposite: "neutral-abstraction",
    statement:
      "Indirection that adds no shared rule is debt: this repository prefers the shortest call path that preserves behaviour.",
  },
  "neutral-abstraction": {
    id: "neutral-abstraction",
    opposite: "direct-code",
    statement:
      "A stable indirection layer is acceptable on its own; this repository does not treat it as debt.",
  },
}

// --- challenge model ---------------------------------------------------------

export type PocChallengeKind =
  | "duplicated-rule"
  | "unnecessary-abstraction"
  | "similar-shape-different-rule"
  | "gaming-padding"
  | "gaming-beyond-top-n"

export type PocSignalMovement =
  | "new-clone-group"
  | "clone-group-count-unchanged"
  | "complexity-finding-count-unchanged"
  | "complexity-pressure-decrease"
  /** Present in the consumed output as a below-threshold candidate, creating no finding. */
  | "candidate-below-threshold"
  /** Reacts only in a signal outside the pipeline's candidate set. */
  | "none-in-candidate-set"

export type PocMutation = {
  readonly path: string
  readonly kind: "edit" | "create"
  /** Evaluation metadata. Never part of the mutated source. */
  readonly description: string
  readonly apply: (source: string) => string
}

export type PocDetectorEvidence = {
  readonly signalId: string
  readonly output: "clone-groups" | "complexity-functions"
  readonly movement: PocSignalMovement
  /** Measured value, so a detector miss is visible rather than assumed. */
  readonly measured: string
}

export type PocChallenge = {
  readonly id: string
  readonly kind: PocChallengeKind
  readonly summary: string
  readonly mutations: ReadonlyArray<PocMutation>
  /** Evaluation metadata: the pipeline must rediscover these from signals. */
  readonly affectedRegions: ReadonlyArray<{ readonly path: string; readonly symbols: ReadonlyArray<string> }>
  /**
   * Whether the pipeline's current candidate signal set can see this mutation.
   * `false` means the fixture is a declared negative control, not a scored case.
   */
  readonly detectorReach: {
    /**
     * Whether the candidate set the pipeline consumes can emit this mutation as
     * a candidate at all. A candidate is not a finding: a below-threshold entry
     * still has to survive the pipeline's own cap and penalty interval.
     */
    readonly covered: boolean
    readonly evidence: ReadonlyArray<PocDetectorEvidence>
    /**
     * Where the mutation's own entry sits in the candidate output, so the
     * ranking and cap risk is explicit rather than inferred from a count.
     */
    readonly candidateRanking: ReadonlyArray<{
      readonly output: "clone-groups" | "complexity-functions"
      readonly entry: string
      readonly index: number
      readonly total: number
      readonly ordering: string
    }>
    readonly note: string
  }
  /**
   * Declared policy expectations, not measurements: what this repository's own
   * calibration should do with the mutation. A detector that cannot see the
   * mutation does not change what the policy wants, so a declared direction is
   * never softened to match a detector miss.
   */
  readonly expectedDirections: ReadonlyArray<{ readonly preference: PocPreferenceId; readonly direction: PocDirection }>
  readonly behavioralPreservation: ReadonlyArray<{ readonly kind: "test" | "typecheck"; readonly target: string }>
  /**
   * Proof that the behavioural checks are sensitive rather than vacuous: a
   * corruption of the mutated behaviour that the declared tests must catch.
   * Applied only inside the test suite, never to a scored copy.
   */
  readonly sensitivity?: {
    readonly path: string
    readonly description: string
    readonly corrupt: (source: string) => string
  }
  /** True when the fixture exists to defeat aggregation or discovery. */
  readonly adversarial: boolean
}

// --- source-edit helpers -----------------------------------------------------

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

export class PocAnchorDriftError extends Error {
  constructor(path: string, label: string) {
    super(`POC fixture anchor drift in ${path}: ${label}`)
    this.name = "PocAnchorDriftError"
  }
}

const replaceOnce = (source: string, anchor: string, replacement: string, path: string, label: string): string => {
  const first = source.indexOf(anchor)
  if (first < 0) throw new PocAnchorDriftError(path, `${label} (anchor absent)`)
  if (source.indexOf(anchor, first + 1) >= 0) throw new PocAnchorDriftError(path, `${label} (anchor not unique)`)
  if (replacement === anchor) throw new PocAnchorDriftError(path, `${label} (no-op)`)
  return source.slice(0, first) + replacement + source.slice(first + anchor.length)
}

const insertBefore = (source: string, anchor: string, insertion: string, path: string, label: string): string => {
  const first = source.indexOf(anchor)
  if (first < 0) throw new PocAnchorDriftError(path, `${label} (anchor absent)`)
  if (source.indexOf(anchor, first + 1) >= 0) throw new PocAnchorDriftError(path, `${label} (anchor not unique)`)
  return source.slice(0, first) + insertion + source.slice(first)
}

const OBSERVER_READINESS = "packages/core/src/observer-readiness.ts"
const ENFORCEMENT = "packages/core/src/enforcement.ts"
const OBSERVER_EXECUTION = "packages/core/src/observer-execution.ts"
const OBSERVER_CATEGORIES = "packages/core/src/observer-categories.ts"
const EVIDENCE = "packages/core/src/evidence.ts"

// --- challenge 1: duplicated domain rule ------------------------------------

/**
 * The poison-authority rule has one owner in `enforcement.ts`. This mutation
 * copies the rule into a second function inside `observer-readiness.ts` and
 * calls the copy. Behaviour is identical because the copied body is
 * token-identical and calls the same `evidenceClassAllowsPoison` helper, which
 * the detector's own exact-clone group confirms.
 */
const DUPLICATED_RULE_HELPER = `const localPoisonAuthority = (signal: {
  readonly tier: Tier
  readonly evidenceClass: SignalEvidenceClass
  readonly enforcement: EnforcementCeiling
}): boolean =>
  (signal.tier === 1 || signal.tier === 1.5) &&
  evidenceClassAllowsPoison(signal.evidenceClass) &&
  signal.enforcement.includes("hard-gate")

`

const duplicatedRule: PocChallenge = {
  id: "duplicated-rule",
  kind: "duplicated-rule",
  summary: "A shared domain rule gains a second, independent implementation in a caller.",
  mutations: [
    {
      path: OBSERVER_READINESS,
      kind: "edit",
      description: "Replace the delegated rule call with a local copy of the rule.",
      apply: (source) => {
        const imported = replaceOnce(
          source,
          'import { hasPoisonAuthority } from "./enforcement.js"',
          'import { evidenceClassAllowsPoison } from "./evidence.js"\nimport type { SignalEvidenceClass } from "./evidence.js"\nimport type { EnforcementCeiling } from "./enforcement.js"\nimport type { Tier } from "./tier.js"',
          OBSERVER_READINESS,
          "rule import",
        )
        const called = replaceOnce(
          imported,
          "  const poisonAuthority = hasPoisonAuthority(signal)",
          "  const poisonAuthority = localPoisonAuthority(signal)",
          OBSERVER_READINESS,
          "rule call",
        )
        return insertBefore(called, "const readinessPressureContribution = (", DUPLICATED_RULE_HELPER, OBSERVER_READINESS, "helper insertion")
      },
    },
  ],
  affectedRegions: [
    { path: OBSERVER_READINESS, symbols: ["localPoisonAuthority"] },
    { path: ENFORCEMENT, symbols: ["hasPoisonAuthority"] },
  ],
  detectorReach: {
    covered: true,
    evidence: [
      {
        signalId: "TS-SL-01-duplication",
        output: "clone-groups",
        movement: "new-clone-group",
        measured:
          "new exact group, 29 tokens, members enforcement.ts:hasPoisonAuthority + observer-readiness.ts:localPoisonAuthority; group count 148 -> 149",
      },
      {
        signalId: "TS-LD-01-cyclomatic-complexity",
        output: "complexity-functions",
        movement: "candidate-below-threshold",
        measured:
          "the copied rule appears in output.functions as observer-readiness.ts:localPoisonAuthority, complexity 4, threshold 20; totalFunctions 7137 -> 7138",
      },
    ],
    candidateRanking: [
      {
        output: "clone-groups",
        entry: "exact group pairing hasPoisonAuthority with localPoisonAuthority",
        index: 37,
        total: 149,
        ordering: "descending token count; the signal's own diagnosticLimit is 10",
      },
      {
        output: "complexity-functions",
        entry: "observer-readiness.ts:localPoisonAuthority",
        index: 1162,
        total: 7138,
        ordering: "descending complexity; complexity 4 against a threshold of 20",
      },
    ],
    note:
      "Two candidate pointers exist: the clone group and the complexity function entry. Both are real and both rank beyond a small cap, so the risk here is ranking and cap, not absence. The clone group also carries only about 0.58 impact and severity info.",
  },
  expectedDirections: [
    { preference: "extract-shared-rules", direction: "down" },
    { preference: "callers-own-their-rules", direction: "unchanged" },
  ],
  sensitivity: {
    path: OBSERVER_READINESS,
    description: "Invert the gate in the local copy of the rule.",
    corrupt: (source) =>
      replaceOnce(source, 'signal.enforcement.includes("hard-gate")', '!signal.enforcement.includes("hard-gate")', OBSERVER_READINESS, "sensitivity gate"),
  },
  behavioralPreservation: [
    { kind: "test", target: "packages/core/src/__tests__/enforcement.test.ts" },
    { kind: "test", target: "packages/core/src/__tests__/observer.test.ts" },
    { kind: "typecheck", target: OBSERVER_READINESS },
  ],
  adversarial: false,
}

// --- challenge 2: unnecessary indirection -----------------------------------

/**
 * Two forms of indirection that add no shared rule: a pass-through wrapper
 * around the ceiling function, used by a real caller, and a facade module that
 * re-exports the enforcement rules for one consumer.
 *
 * The full complexity inventory includes the wrapper even though it crosses no
 * diagnostic threshold. The facade itself is not a function. Ranking can hide
 * the wrapper, while the pressure ratios misleadingly improve after adding it.
 */
const PASS_THROUGH_WRAPPER = `/** Convenience wrapper kept for readability. */
export const applySeverityCeiling = (
  signal: Parameters<typeof enforceSeverityCeiling>[0],
  diagnostics: Parameters<typeof enforceSeverityCeiling>[1],
): ReadonlyArray<Diagnostic> => enforceSeverityCeiling(signal, diagnostics)

`

const FACADE_MODULE = `/**
 * Stable facade over the enforcement rules.
 */
export { deriveEnforcement, enforceSeverityCeiling, hasPoisonAuthority } from "./enforcement.js"
export type { EnforcementCeiling } from "./enforcement.js"
`

const unnecessaryAbstraction: PocChallenge = {
  id: "unnecessary-abstraction",
  kind: "unnecessary-abstraction",
  summary: "A pass-through wrapper and a re-export facade add indirection without adding a shared rule.",
  mutations: [
    {
      path: ENFORCEMENT,
      kind: "edit",
      description: "Add a pass-through wrapper that forwards to the ceiling function.",
      apply: (source) =>
        insertBefore(source, "export const deriveEnforcement = (", PASS_THROUGH_WRAPPER, ENFORCEMENT, "wrapper insertion"),
    },
    {
      path: OBSERVER_EXECUTION,
      kind: "edit",
      description: "Route the observer's ceiling call through the pass-through wrapper.",
      apply: (source) =>
        replaceOnce(
          replaceOnce(
            source,
            'import { enforceSeverityCeiling } from "./enforcement.js"',
            'import { applySeverityCeiling } from "./enforcement.js"',
            OBSERVER_EXECUTION,
            "wrapper import",
          ),
          "diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),",
          "diagnostics: applySeverityCeiling(signal, signal.diagnose(out)),",
          OBSERVER_EXECUTION,
          "wrapper call",
        ),
    },
    {
      path: "packages/core/src/enforcement-facade.ts",
      kind: "create",
      description: "Add a re-export facade module over the enforcement rules.",
      apply: () => FACADE_MODULE,
    },
    {
      path: OBSERVER_CATEGORIES,
      kind: "edit",
      description: "Route one real consumer through the facade.",
      apply: (source) =>
        replaceOnce(
          source,
          'import { hasPoisonAuthority } from "./enforcement.js"',
          'import { hasPoisonAuthority } from "./enforcement-facade.js"',
          OBSERVER_CATEGORIES,
          "facade import",
        ),
    },
  ],
  affectedRegions: [
    { path: ENFORCEMENT, symbols: ["applySeverityCeiling"] },
    { path: "packages/core/src/enforcement-facade.ts", symbols: ["hasPoisonAuthority", "enforceSeverityCeiling"] },
    { path: OBSERVER_CATEGORIES, symbols: [] },
    { path: OBSERVER_EXECUTION, symbols: [] },
  ],
  detectorReach: {
    covered: true,
    evidence: [
      {
        signalId: "TS-LD-01-cyclomatic-complexity",
        output: "complexity-functions",
        movement: "candidate-below-threshold",
        measured:
          "the wrapper is a candidate in output.functions as enforcement.ts:applySeverityCeiling, complexity 1, threshold 20; totalFunctions 7137 -> 7138; overThresholdCount stays 14",
      },
      {
        signalId: "TS-SL-01-duplication",
        output: "clone-groups",
        movement: "clone-group-count-unchanged",
        measured: "group count 148 -> 148; no group mentions applySeverityCeiling or the facade module",
      },
      {
        signalId: "TS-LD-02-function-size-distribution",
        output: "complexity-functions",
        movement: "complexity-finding-count-unchanged",
        measured: "oversizedFunctionCount 26 -> 26; the wrapper is not an outlier or oversized function",
      },
      {
        signalId: "TS-AB-02-unused-exports",
        output: "clone-groups",
        movement: "none-in-candidate-set",
        measured:
          "unused exports 36 -> 39 because the facade re-exports two names nothing consumes; this signal is outside the pipeline's candidate set",
      },
      {
        signalId: "TS-AB-03-type-indirection-depth",
        output: "clone-groups",
        movement: "none-in-candidate-set",
        measured:
          "a type-alias chain for EnforcementCeiling raises its depth to 5 and adds it to the top of the core list; this signal is outside the pipeline's candidate set",
      },
    ],
    candidateRanking: [
      {
        output: "complexity-functions",
        entry: "enforcement.ts:applySeverityCeiling",
        index: 4377,
        total: 7138,
        ordering: "descending complexity; complexity 1 against a threshold of 20",
      },
    ],
    note:
      "Covered as a candidate, not as a finding. The wrapper is emitted in output.functions, so a pointer exists; it creates no finding in any detector: no clone group, no over-threshold complexity, no size outlier. Both pressure ratios also move very slightly down, because one more low-complexity function lowers the ratio. The risk is therefore ranking and penalty, not absence: at complexity 1 the entry sorts 4377th of 7138 under a complexity-descending cap, and only the pipeline's additive penalty interval decides whether a below-threshold candidate costs anything. This is a scored case: under direct-code the wrapper is debt and the number should fall.",
  },
  expectedDirections: [
    { preference: "direct-code", direction: "down" },
    { preference: "neutral-abstraction", direction: "unchanged" },
  ],
  sensitivity: {
    path: ENFORCEMENT,
    description: "Downgrade the derived enforcement ceiling for structural signals.",
    corrupt: (source) => replaceOnce(source, 'return ["hard-gate"]', 'return ["soft-warning"]', ENFORCEMENT, "sensitivity ceiling"),
  },
  behavioralPreservation: [
    { kind: "test", target: "packages/core/src/__tests__/enforcement.test.ts" },
    { kind: "test", target: "packages/core/src/__tests__/observer.test.ts" },
    { kind: "typecheck", target: ENFORCEMENT },
  ],
  adversarial: false,
}

// --- challenge 3: similar shape, different rule (control) --------------------

/**
 * Two functions become token-identical while keeping their own policy tables,
 * so similarity rises and no rule is duplicated. The two rules stay distinct
 * because each reads its own module-local allow-list.
 *
 * The control's purpose is to catch a pipeline that treats similarity as debt.
 * The measured detector output is decisive in a second way: the new exact group
 * is 17 tokens, below the whole-tree impact floor of 20, so the detector itself
 * assigns it zero penalty.
 */
const evidenceHardGateBody = `const EVIDENCE_CLASSES: ReadonlySet<SignalEvidenceClass> = new Set([
  "deterministic-ast",
  "manifest-fact",
  "reference-backed",
])

export const evidenceClassAllowsHardGate = (
  evidenceClass: SignalEvidenceClass,
): boolean => {
  if (EVIDENCE_CLASSES.has(evidenceClass)) {
    return true
  }
  return false
}

export { evidenceClassAllowsPoison } from "./evidence-poison.js"`

const evidencePoisonModule = `import type { SignalEvidenceClass } from "./evidence.js"

const EVIDENCE_CLASSES: ReadonlySet<SignalEvidenceClass> = new Set([
  "deterministic-ast",
  "manifest-fact",
])

export const evidenceClassAllowsPoison = (
  evidenceClass: SignalEvidenceClass,
): boolean => {
  if (EVIDENCE_CLASSES.has(evidenceClass)) {
    return true
  }
  return false
}
`

const similarShapeDifferentRule: PocChallenge = {
  id: "similar-shape-different-rule",
  kind: "similar-shape-different-rule",
  summary: "Two distinct rules adopt the same shape and table-backed idiom; similarity rises, no rule is duplicated.",
  mutations: [
    {
      path: EVIDENCE,
      kind: "edit",
      description: "Move the poison allow-list into its own module and give both predicates the same shape.",
      apply: (source) => {
        const anchor = `export const evidenceClassAllowsHardGate = (
  evidenceClass: SignalEvidenceClass,
): boolean =>
  evidenceClass === "deterministic-ast" ||
  evidenceClass === "manifest-fact" ||
  evidenceClass === "reference-backed"

export const evidenceClassAllowsPoison = (
  evidenceClass: SignalEvidenceClass,
): boolean =>
  evidenceClass === "deterministic-ast" || evidenceClass === "manifest-fact"`
        return replaceOnce(source, anchor, evidenceHardGateBody, EVIDENCE, "evidence predicates")
      },
    },
    {
      path: "packages/core/src/evidence-poison.ts",
      kind: "create",
      description: "Add the module that owns the poison allow-list under the shared idiom.",
      apply: () => evidencePoisonModule,
    },
  ],
  affectedRegions: [
    { path: EVIDENCE, symbols: ["evidenceClassAllowsHardGate"] },
    { path: "packages/core/src/evidence-poison.ts", symbols: ["evidenceClassAllowsPoison"] },
  ],
  detectorReach: {
    covered: true,
    evidence: [
      {
        signalId: "TS-SL-01-duplication",
        output: "clone-groups",
        movement: "new-clone-group",
        measured:
          "new exact group, 17 tokens, members evidence.ts:evidenceClassAllowsHardGate + evidence-poison.ts:evidenceClassAllowsPoison; group count 148 -> 149",
      },
      {
        signalId: "TS-LD-01-cyclomatic-complexity",
        output: "complexity-functions",
        movement: "candidate-below-threshold",
        measured:
          "the relocated predicate appears in output.functions as evidence-poison.ts:evidenceClassAllowsPoison, complexity 2; totalFunctions stays 7137 because one function moved between files",
      },
    ],
    candidateRanking: [
      {
        output: "clone-groups",
        entry: "exact group pairing evidenceClassAllowsHardGate with evidenceClassAllowsPoison",
        index: 124,
        total: 149,
        ordering: "descending token count; the signal's own diagnosticLimit is 10",
      },
      {
        output: "complexity-functions",
        entry: "evidence-poison.ts:evidenceClassAllowsPoison",
        index: 2494,
        total: 7137,
        ordering: "descending complexity; complexity 2 against a threshold of 20",
      },
    ],
    note:
      "Two candidate pointers exist. The clone group is below the whole-tree impact floor, where cloneGroupImpact returns 0 for an exact group under 20 tokens and severity is info, so a pipeline that reuses the signal's own impact scores this at zero while a pipeline that counts clone groups would wrongly charge it as duplication debt. The risk is again ranking and penalty: the clone group ranks 124th of 149 and the function entry 2494th of 7137 under a complexity-descending cap.",
  },
  expectedDirections: [
    { preference: "extract-shared-rules", direction: "unchanged" },
    { preference: "callers-own-their-rules", direction: "unchanged" },
  ],
  sensitivity: {
    path: "packages/core/src/evidence-poison.ts",
    description: "Widen the poison allow-list, which must change the rule the tests cover.",
    corrupt: (source) =>
      replaceOnce(source, '"manifest-fact",\n])', '"manifest-fact",\n  "heuristic-pattern",\n])', "packages/core/src/evidence-poison.ts", "sensitivity allow-list"),
  },
  behavioralPreservation: [
    { kind: "test", target: "packages/core/src/__tests__/enforcement.test.ts" },
    { kind: "test", target: "packages/core/src/__tests__/observer.test.ts" },
    { kind: "typecheck", target: EVIDENCE },
  ],
  adversarial: false,
}

// --- challenge 4: healthy padding -------------------------------------------

const paddingModule = (index: number): string => {
  const suffix = String(index).padStart(2, "0")
  return `/** Walkthrough section ${suffix}. Self-contained copy used by the onboarding walkthrough. */
const sectionLabel${suffix} = "walkthrough-${suffix}"

const normalizeSection${suffix} = (value: string): string => value.trim().toLowerCase()

const describeSection${suffix} = (value: string): string => {
  const normalized = normalizeSection${suffix}(value)
  return normalized.length === 0 ? sectionLabel${suffix} : sectionLabel${suffix} + ":" + normalized
}
`
}

const PADDING_COUNT = 24

const healthyPadding: PocChallenge = {
  id: "healthy-padding",
  kind: "gaming-padding",
  summary: `${PADDING_COUNT} unrelated, healthy, self-contained modules are added with no exports and no consumers.`,
  mutations: Array.from({ length: PADDING_COUNT }, (_unused, index) => ({
    path: `packages/onboard/src/walkthrough/section-${String(index).padStart(2, "0")}.ts`,
    kind: "create" as const,
    description: "Add an unrelated healthy module.",
    apply: () => paddingModule(index),
  })),
  affectedRegions: [],
  detectorReach: {
    covered: true,
    evidence: [
      {
        signalId: "TS-SL-01-duplication",
        output: "clone-groups",
        movement: "clone-group-count-unchanged",
        measured: "group count 148 -> 148",
      },
      {
        signalId: "TS-LD-01-cyclomatic-complexity",
        output: "complexity-functions",
        movement: "candidate-below-threshold",
        measured:
          "48 new entries appear in output.functions (24 at complexity 1 and 24 at complexity 2, all below the threshold of 20); totalFunctions 7137 -> 7185; overThresholdCount stays 14",
      },
      {
        signalId: "TS-LD-02-function-size-distribution",
        output: "complexity-functions",
        movement: "complexity-pressure-decrease",
        measured:
          "ratioPressure 0.0018387182 -> 0.0018214936 and mean function size 7.1583 -> 7.1271 while oversizedFunctionCount stays 26: the added code reads as a marginal improvement",
      },
      {
        signalId: "TS-AB-02-unused-exports",
        output: "clone-groups",
        movement: "none-in-candidate-set",
        measured: "unused exports 36 -> 36 because the added modules export nothing",
      },
    ],
    candidateRanking: [
      {
        output: "complexity-functions",
        entry: "packages/onboard/src/walkthrough/section-00.ts:describeSection00",
        index: 2653,
        total: 7185,
        ordering: "descending complexity; every added entry has complexity 1 or 2 against a threshold of 20",
      },
    ],
    note:
      "The aggregation challenge, stated precisely: no new finding appears, 48 new low-complexity candidate entries do appear, and the size pressure ratio improves slightly. So padding both dilutes the candidate population with 48 irrelevant pointers and moves the aggregate reading in the favourable direction. A score that rewards pressure-ratio movement, or that counts candidates rather than findings, would report a better repository for pure padding.",
  },
  expectedDirections: [
    { preference: "extract-shared-rules", direction: "unchanged" },
    { preference: "callers-own-their-rules", direction: "unchanged" },
    { preference: "direct-code", direction: "unchanged" },
    { preference: "neutral-abstraction", direction: "unchanged" },
  ],
  behavioralPreservation: [{ kind: "typecheck", target: "packages/onboard/src/walkthrough/section-00.ts" }],
  adversarial: true,
}

// --- challenge 5: real duplication beyond the old top-N ----------------------

const lateDuplicateModule = `import type { SourceCategory } from "./calibration.js"

const hasMixedProductionCategory = (categories: ReadonlySet<SourceCategory>): boolean =>
  [...categories].some((category) => category !== "unknown" && category !== "production_source")
`

const beyondTopN: PocChallenge = {
  id: "beyond-top-n",
  kind: "gaming-beyond-top-n",
  summary: "A real rule is duplicated into a late-ranking module, so the finding exists but falls outside a top-N pointer budget.",
  mutations: [
    {
      path: "packages/core/src/file-category-support.ts",
      kind: "create",
      description: "Add a module that re-implements a real file-taxonomy rule.",
      apply: () => lateDuplicateModule,
    },
  ],
  affectedRegions: [
    { path: "packages/core/src/file-category-support.ts", symbols: ["hasMixedProductionCategory"] },
    { path: "packages/core/src/file-taxonomy.ts", symbols: ["hasNonProductionCategory"] },
  ],
  detectorReach: {
    covered: true,
    evidence: [
      {
        signalId: "TS-SL-01-duplication",
        output: "clone-groups",
        movement: "new-clone-group",
        measured:
          "new exact group, 19 tokens, members file-taxonomy.ts:hasNonProductionCategory + file-category-support.ts:hasMixedProductionCategory; group count 148 -> 149, 0-based rank 115",
      },
      {
        signalId: "TS-LD-01-cyclomatic-complexity",
        output: "complexity-functions",
        movement: "candidate-below-threshold",
        measured:
          "two entries appear in output.functions: file-category-support.ts:hasMixedProductionCategory (complexity 1) and its inner callback (complexity 2); totalFunctions 7137 -> 7139",
      },
    ],
    candidateRanking: [
      {
        output: "clone-groups",
        entry: "exact group pairing hasNonProductionCategory with hasMixedProductionCategory",
        index: 115,
        total: 149,
        ordering: "descending token count; the signal's own diagnosticLimit is 10",
      },
      {
        output: "complexity-functions",
        entry: "file-category-support.ts:hasMixedProductionCategory",
        index: 2501,
        total: 7139,
        ordering: "descending complexity; complexity 1 against a threshold of 20",
      },
    ],
    note:
      "Discovery challenge: the candidate exists but ranks 115 of 149, so reading only the signal's diagnosticLimit of 10 misses it. A larger budget can reach it. It is also 19 tokens, one below the whole-tree impact floor of 20, so the detector assigns it zero penalty. Low diagnostic weight does not decide whether this is duplicated domain policy.",
  },
  expectedDirections: [
    { preference: "extract-shared-rules", direction: "down" },
    { preference: "callers-own-their-rules", direction: "unchanged" },
  ],
  behavioralPreservation: [{ kind: "typecheck", target: "packages/core/src/file-category-support.ts" }],
  adversarial: true,
}

export const POC_CHALLENGES: ReadonlyArray<PocChallenge> = [
  duplicatedRule,
  unnecessaryAbstraction,
  similarShapeDifferentRule,
  healthyPadding,
  beyondTopN,
]

// --- workspace copy and application -----------------------------------------

/** Path segments never copied into a disposable workspace. */
export const POC_COPY_EXCLUSIONS: ReadonlyArray<string> = ["node_modules", ".git", ".turbo", ".pulsar"]

export const pocChallengeById = (id: string): PocChallenge => {
  const challenge = POC_CHALLENGES.find((candidate) => candidate.id === id)
  if (challenge === undefined) throw new Error(`Unknown POC challenge ${id}`)
  return challenge
}

/**
 * Copy the workspace for one challenge. Package-local `node_modules` symlinks
 * are recreated so the copy can run the repository's own tests and compiler
 * without installing dependencies again.
 */
export function copyPocWorkspace(sourceRoot: string, destination: string): void {
  const excluded = new RegExp(`[/\\\\](${POC_COPY_EXCLUSIONS.join("|")})([/\\\\]|$)`)
  mkdirSync(destination, { recursive: true })
  cpSync(sourceRoot, destination, { recursive: true, filter: (source) => !excluded.test(source) })
  if (existsSync(join(sourceRoot, "node_modules"))) {
    symlinkSync(join(sourceRoot, "node_modules"), join(destination, "node_modules"))
  }
  const packagesRoot = join(sourceRoot, "packages")
  if (!existsSync(packagesRoot)) return
  for (const name of readdirSync(packagesRoot)) {
    const modules = join(packagesRoot, name, "node_modules")
    if (existsSync(modules)) symlinkSync(modules, join(destination, "packages", name, "node_modules"))
  }
}

export type PocApplication = {
  readonly challengeId: string
  readonly createdPaths: ReadonlyArray<string>
  readonly editedPaths: ReadonlyArray<string>
  /** SHA256 of each mutated file after application, for receipt purposes. */
  readonly digests: Readonly<Record<string, string>>
}

/**
 * Apply one challenge in place to a disposable workspace. Refuses to run
 * against the Pulsar checkout itself so an accidental call cannot mutate the
 * research workspace.
 */
export function applyPocChallenge(root: string, id: string): PocApplication {
  const resolvedRoot = resolve(root)
  if (resolvedRoot === REPO_ROOT) {
    throw new Error("applyPocChallenge refuses to mutate the Pulsar checkout; pass a disposable copy")
  }
  const challenge = pocChallengeById(id)
  const created: string[] = []
  const edited: string[] = []
  for (const mutation of challenge.mutations) {
    const full = join(resolvedRoot, mutation.path)
    if (mutation.kind === "create") {
      if (existsSync(full)) throw new Error(`POC fixture expects ${mutation.path} to be absent`)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, mutation.apply(""))
      created.push(mutation.path)
      continue
    }
    if (!existsSync(full)) throw new PocAnchorDriftError(mutation.path, "target file absent")
    writeFileSync(full, mutation.apply(readFileSync(full, "utf8")))
    edited.push(mutation.path)
  }
  const digests: Record<string, string> = {}
  for (const path of [...created, ...edited]) digests[path] = sha256(readFileSync(join(resolvedRoot, path), "utf8"))
  return {
    challengeId: challenge.id,
    createdPaths: created.sort(),
    editedPaths: edited.sort(),
    digests,
  }
}

/** Metadata-only view for wiring the automatic run; carries no mutation code. */
export function listPocChallenges(): ReadonlyArray<{
  readonly id: string
  readonly kind: PocChallengeKind
  readonly summary: string
  readonly adversarial: boolean
  readonly covered: boolean
  /**
   * Declared policy expectations, not measurements: what this repository's own
   * calibration should do with the mutation. A detector that cannot see the
   * mutation does not change what the policy wants, so a declared direction is
   * never softened to match a detector miss.
   */
  readonly expectedDirections: ReadonlyArray<{ readonly preference: PocPreferenceId; readonly direction: PocDirection }>
  readonly affectedPaths: ReadonlyArray<string>
}> {
  return POC_CHALLENGES.map((challenge) => ({
    id: challenge.id,
    kind: challenge.kind,
    summary: challenge.summary,
    adversarial: challenge.adversarial,
    covered: challenge.detectorReach.covered,
    expectedDirections: challenge.expectedDirections,
    affectedPaths: challenge.affectedRegions.map((region) => region.path),
  }))
}
