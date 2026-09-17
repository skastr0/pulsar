import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Schema } from "effect"
import { sha256 } from "./model.ts"
import { buildShapeCandidates } from "./shape-candidates.ts"

/**
 * Policy-clarity research cases.
 *
 * These are research fixtures. No case here is adopted Pulsar policy, generic
 * signal semantics, or a repository architectural preference. The declared
 * "policies" are explicit, research-scoped experiment criteria supplied to a
 * provider so that the effect of *how precisely* a repository policy is stated
 * can be measured. Every case carries an agent-authored expectation plus the
 * independent evidence that bears on it; that evidence is deliberately kept out
 * of provider input.
 */

export type VariantFiles = Record<string, string>

export interface SourceExcerpt {
  readonly path: string
  readonly start: number
  readonly end: number
  readonly content: string
  readonly sha256: string
  readonly fileSha256: string
}

export interface PolicyText {
  readonly question: string
  readonly focus: string | null
  readonly precedence: string | null
  readonly goal: string | null
  readonly boundaryTest: {
    readonly what: string
    readonly notFor: string | null
    readonly examples: ReadonlyArray<string>
  } | null
  readonly preference: string | null
}

export interface CasePolicies {
  /** The initial, underspecified wording: same direction, undefined boundary. */
  readonly ambiguous: PolicyText
  /** Same direction, operationalized: boundary definition, focus, precedence. */
  readonly precise: PolicyText
  /** Same precision as `precise`, opposite direction. Null when not measured. */
  readonly opposing: PolicyText | null
  /**
   * Same precision, a direction that discriminates against the author
   * expectation. Used where `opposing` happens to select the same variant as
   * `precise` and therefore cannot test whether the rubric is operational.
   */
  readonly opposingSingleCallSite: PolicyText | null
  /** Two operationalized rules with opposite directions and no precedence. */
  readonly conflict: PolicyText
}

export interface AuthorExpectation {
  readonly physical: "a" | "b"
  readonly rationale: string
  /** Independent checks computed outside provider input. */
  readonly independentEvidence: ReadonlyArray<string>
  /**
   * A structural rule that alone decides this case, if one exists. This is
   * about whether *any* rule decides it, not about whether a policy is needed
   * to select which rule applies.
   */
  readonly deterministicRule: string | null
  /** Honest statement of what this expectation is and is not. */
  readonly status: "agent_authored_not_human_ground_truth"
  /**
   * Repository compatibility of each variant, established outside provider
   * input. Kept separate from the declared runtime-context obligations: a
   * variant can satisfy every declared obligation and still fail to be an
   * applicable refactor because an existing test or consumer does not compile.
   */
  readonly compatibility: {
    readonly a: string
    readonly b: string
  }
  /**
   * Falsifiable predictions registered before the corresponding batch was
   * called, so a batch cannot be retro-fitted to its result. A prediction
   * frozen before its own batch is still an exploratory follow-up when the
   * condition itself was chosen after inspecting an earlier batch.
   */
  readonly registeredPredictions: ReadonlyArray<{
    readonly condition: string
    readonly prediction: string
    /** Whether this condition existed before any related result was inspected. */
    readonly exploratoryFollowUp: boolean
  }>
}

export interface PolicyClarityCase {
  readonly id: "observer-batch-protocol" | "cache-lookup-representation" | "factor-policy-boundary"
  /** Shared rubric family; the held-out case reuses the development family. */
  readonly rubricFamily: "helper-boundary" | "producer-guarantee"
  readonly role: "development" | "held_out"
  readonly subject: string
  readonly variants: { readonly a: VariantFiles; readonly b: VariantFiles }
  readonly sources: Record<string, SourceExcerpt>
  readonly obligations: ReadonlyArray<string>
  readonly policies: CasePolicies
  readonly authorExpectation: AuthorExpectation
  /**
   * Whether the two rules in `policies.conflict` require incompatible outcomes
   * for this candidate. False means the cell cannot test contradiction
   * detection: both rules select the same variant, so its result must not be
   * read as a contradiction the model missed.
   */
  readonly conflictForcesIncompatibleOutcomes: boolean
  readonly conflictFixtureNote: string
}

export type PolicyClarityCases = Record<PolicyClarityCase["id"], PolicyClarityCase>

const excerpt = (root: string, path: string, start: number, end: number): SourceExcerpt => {
  const full = readFileSync(resolve(root, path), "utf8")
  const lines = full.split("\n")
  if (start < 1 || end < start || end > lines.length) throw new Error(`Excerpt drift: ${path}`)
  const content = lines.slice(start - 1, end).join("\n")
  return { path, start, end, content, sha256: sha256(content), fileSha256: sha256(full) }
}

// ---------------------------------------------------------------------------
// Frozen rubric text.
//
// The helper-boundary test is authored once and reused verbatim for the
// development boundary case and for the held-out case, so the held-out run
// measures rubric transfer rather than freshly tuned wording.
// ---------------------------------------------------------------------------

export const HELPER_BOUNDARY_TEST = {
  what:
    "A helper boundary is independently useful when at least one of these holds: (a) more than one production call site uses it; (b) a separate requirement, test, or calibration rule can target its contract without also targeting its single caller; (c) it enforces a documented invariant that a caller would otherwise have to restate.",
  notFor:
    "A private helper called exactly once from one owner that only forwards arguments or threads the same mutable state object to the next step.",
  examples: [
    "Independently useful: a normalization predicate with two production callers and its own unit test.",
    "Not independently useful: a private step function whose only caller passes the same accumulator object through unchanged.",
  ],
}

export const HELPER_BOUNDARY_TEST_OPPOSING = {
  what:
    "A named phase boundary is independently useful when it gives a reviewer a named unit to inspect, test, or attribute, even when it has exactly one production call site.",
  notFor:
    "Inlining a phase into a larger sequence when that phase enforces a documented invariant or a distinguishable step of the protocol.",
  examples: [
    "Independently useful: a named step function a reviewer can evaluate without reading its caller.",
    "Not independently useful: a two-line inline step with no name and no separate contract.",
  ],
}

export const BOUNDARY_PRECEDENCE =
  "The declared behavior obligations are minimums, not compensating benefits. When both variants meet every minimum, apply the boundary test before stating a preference."

export const PRODUCER_GUARANTEE_TEST = {
  what:
    "A producer guarantee is established when the supplied producer implementation sets the payload fields on every non-miss outcome, so a consumer that narrows to hit or stale can rely on those fields without a runtime check.",
  notFor:
    "A guarantee asserted only by a comment, a cast, or the absence of a counterexample; and any claim about the contents of a payload read from external storage.",
  examples: [
    "Established: the supplied producer always assigns the payload before returning a non-miss status.",
    "Not established: the type declares the fields but the code that writes them is not supplied.",
  ],
}

export const PRODUCER_GUARANTEE_TEST_OPPOSING = {
  what:
    "A result shape is adequate when every status remains representable without a discriminated union, and the producer's runtime behavior is the only place the payload guarantee needs to hold.",
  notFor:
    "Adding a discriminated union whose narrowing benefit no supplied consumer requirement asks for.",
  examples: [
    "Adequate: one flat shape with optional payload fields and a producer that always sets them.",
    "Not adequate: a flat shape whose optional fields are read as if the producer never omitted them.",
  ],
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const CONSOLIDATION_AMBIGUOUS: PolicyText = {
  question: "Which presentation better satisfies the repository's declared policy for this observer scheduler?",
  focus: null,
  precedence: null,
  goal:
    "For this integration scheduler, prefer the presentation that makes the existing output-visibility protocol easier to inspect as one operational sequence. Retain a helper boundary when it hides an independently useful contract. File length and number of functions are not benefits by themselves.",
  boundaryTest: null,
  preference: null,
}

const CONSOLIDATION_PRECISE: PolicyText = {
  question: "Which presentation better satisfies this repository's declared integration-code policy for the observer batch scheduler?",
  focus:
    "Judge only the organization of the batch output-visibility protocol: readiness selection, pending removal, the batch output snapshot, concurrent execution, and publication of the batch's results after it returns. Ignore file length, function count, naming, and general style.",
  precedence: BOUNDARY_PRECEDENCE,
  goal:
    "This repository's declared goal for integration code is that one operational decision stays inspectable as a single local sequence. A named boundary earns its place only when it carries a contract of its own; splitting a single decision across private boundaries that add no contract scatters the decision without buying an independently reviewable unit.",
  boundaryTest: HELPER_BOUNDARY_TEST,
  preference:
    "Prefer the presentation that avoids private single-call-site phase helpers, unless a helper satisfies the boundary test above.",
}

const CONSOLIDATION_OPPOSING: PolicyText = {
  question: "Which presentation better satisfies this repository's declared integration-code policy for the observer batch scheduler?",
  focus:
    "Judge only the organization of the batch output-visibility protocol: readiness selection, pending removal, the batch output snapshot, concurrent execution, and publication of the batch's results after it returns. Ignore file length, function count, naming, and general style.",
  precedence: BOUNDARY_PRECEDENCE,
  goal:
    "This repository's declared goal for integration code is that every distinguishable step of an external protocol has a name, so a reviewer can inspect, test, or attribute that step without reading the whole sequence. One long local sequence hides which step failed or changed.",
  boundaryTest: HELPER_BOUNDARY_TEST_OPPOSING,
  preference:
    "Prefer the presentation that gives each distinguishable protocol step its own named boundary, unless a boundary would leave a declared obligation unenforced.",
}

const CONSOLIDATION_CONFLICT: PolicyText = {
  question: "Which presentation better satisfies the repository's declared integration-code policy for the observer batch scheduler?",
  focus:
    "Judge only the organization of the batch output-visibility protocol: readiness selection, pending removal, the batch output snapshot, concurrent execution, and publication of the batch's results after it returns.",
  precedence: null,
  goal:
    "Two repository rules apply to this file and both are declared binding. Rule one requires that one operational decision stay inspectable as a single local sequence and that a named boundary exist only when it carries a contract of its own. Rule two requires that every distinguishable step of an external protocol has its own named boundary so it can be inspected, tested, or attributed on its own.",
  boundaryTest: null,
  preference: null,
}

const CACHE_AMBIGUOUS: PolicyText = {
  question: "Which result-type presentation better satisfies the repository's declared policy for this cache lookup?",
  focus: null,
  precedence: null,
  goal:
    "Prefer representing already-established producer guarantees in the result type when doing so preserves runtime and serialized behavior. Do not treat static narrowing as runtime validation of external data.",
  boundaryTest: null,
  preference: null,
}

const CACHE_PRECISE: PolicyText = {
  question: "Which result-type presentation better satisfies this repository's declared policy on expressing producer guarantees?",
  focus:
    "Judge only how the declared result type relates to the supplied producer implementation and to consumers that narrow on `status`. Do not judge runtime validation of persisted external data, serialized payload shape, or code style.",
  precedence:
    "Preserving runtime behavior and serialized payload shape is a minimum, not a compensating benefit. Apply the producer-guarantee test before stating a preference.",
  goal:
    "This repository's declared goal is that a declared type should not be weaker than a guarantee its own producer already establishes: when the producer always supplies the payload for a non-miss status, consumers should not have to restate that guarantee with an assertion or a runtime check.",
  boundaryTest: PRODUCER_GUARANTEE_TEST,
  preference:
    "Prefer the presentation whose declared type requires the payload fields for every non-miss outcome, when the supplied producer establishes that guarantee and runtime behavior is unchanged.",
}

const CACHE_OPPOSING: PolicyText = {
  question: "Which result-type presentation better satisfies this repository's declared policy on expressing producer guarantees?",
  focus:
    "Judge only how the declared result type relates to the supplied producer implementation and to consumers that narrow on `status`. Do not judge runtime validation of persisted external data, serialized payload shape, or code style.",
  precedence:
    "Preserving runtime behavior and serialized payload shape is a minimum, not a compensating benefit. Apply the result-shape test before stating a preference.",
  goal:
    "This repository's declared goal is that a lookup result stays one flat, easily serialized shape: the producer's runtime behavior is the only place the payload guarantee needs to hold, and no supplied consumer requirement asks for narrowing.",
  boundaryTest: PRODUCER_GUARANTEE_TEST_OPPOSING,
  preference:
    "Prefer the presentation that keeps one flat result shape with optional payload fields, unless a supplied consumer requirement cannot be met without narrowing.",
}

const CACHE_CONFLICT: PolicyText = {
  question: "Which result-type presentation better satisfies the repository's declared policy for this cache lookup?",
  focus:
    "Judge only how the declared result type relates to the supplied producer implementation and to consumers that narrow on `status`.",
  precedence: null,
  goal:
    "Two repository rules apply to this type and both are declared binding. Rule one requires that a declared type be no weaker than a guarantee its own producer establishes. Rule two requires that a lookup result stay one flat, easily serialized shape with the producer's runtime behavior as the only place the payload guarantee holds.",
  boundaryTest: null,
  preference: null,
}

const BOUNDARY_FRESH_AMBIGUOUS: PolicyText = {
  question: "Which presentation better satisfies the repository's declared policy for this factor-policy module?",
  focus: null,
  precedence: null,
  goal:
    "Prefer the presentation that makes the factor-policy construction easier to inspect as one operation. Retain a helper boundary when it hides an independently useful contract. File length and number of functions are not benefits by themselves.",
  boundaryTest: null,
  preference: null,
}

const BOUNDARY_FRESH_PRECISE: PolicyText = {
  question: "Which presentation better satisfies this repository's declared policy on named boundaries in the factor-policy module?",
  focus:
    "Judge only whether the named boundary around the config-derived factor overrides is independently useful. Ignore runtime behavior, performance, naming, and general style.",
  precedence: BOUNDARY_PRECEDENCE,
  goal:
    "This repository's declared goal for this module is that a named boundary earns its place only when it carries a contract of its own. A derivation that no other caller and no separate requirement can target on its own does not earn a name merely by being extracted.",
  boundaryTest: HELPER_BOUNDARY_TEST,
  preference:
    "Prefer the presentation that keeps a named boundary only when it satisfies the boundary test above.",
}

const BOUNDARY_FRESH_OPPOSING: PolicyText = {
  question: "Which presentation better satisfies this repository's declared policy on named boundaries in the factor-policy module?",
  focus:
    "Judge only whether the named boundary around the config-derived factor overrides is independently useful. Ignore runtime behavior, performance, naming, and general style.",
  precedence: BOUNDARY_PRECEDENCE,
  goal:
    "This repository's declared goal for this module is that every rule with a non-obvious invariant has a name, so a reviewer can inspect, test, or attribute that rule without reading its caller.",
  boundaryTest: HELPER_BOUNDARY_TEST_OPPOSING,
  preference:
    "Prefer the presentation that gives a rule with a documented invariant its own named boundary, unless inlining would leave the invariant unenforced.",
}

const BOUNDARY_FRESH_OPPOSING_SINGLE_CALLSITE: PolicyText = {
  question: "Which presentation better satisfies this repository's declared policy on named boundaries in the factor-policy module?",
  focus:
    "Judge only whether the named boundary around the config-derived factor overrides is independently useful. Ignore runtime behavior, performance, naming, and general style.",
  precedence: BOUNDARY_PRECEDENCE,
  goal:
    "This repository's declared goal for this module is that a name is reserved for code more than one production caller needs. A boundary used once is a private implementation detail of its caller, whatever it documents.",
  boundaryTest: {
    what:
      "A named boundary is independently useful only when more than one production call site uses it.",
    notFor:
      "A boundary whose extra consumers are tests, whose contract is documented, or whose invariant a reviewer would otherwise have to restate; none of those justify a name on their own.",
    examples: [
      "Independently useful: a derivation two production callers share.",
      "Not independently useful: a derivation with a single production caller and a dedicated test.",
    ],
  },
  preference:
    "Prefer the presentation that keeps a named boundary only when more than one production call site uses it.",
}

const BOUNDARY_FRESH_CONFLICT: PolicyText = {
  question: "Which presentation better satisfies the repository's declared policy on named boundaries in the factor-policy module?",
  focus:
    "Judge only whether the named boundary around the config-derived factor overrides is independently useful.",
  precedence: null,
  goal:
    "Two repository rules apply to this module and both are declared binding. Rule one requires that a named boundary exist only when it carries a contract of its own, with no separate consumer or separately targetable requirement. Rule two requires that every rule with a documented invariant have its own named boundary so a reviewer can inspect and test it on its own.",
  boundaryTest: null,
  preference: null,
}

// ---------------------------------------------------------------------------
// Fresh held-out candidate: inline the config-override derivation into its only
// production caller and drop the named export.
// ---------------------------------------------------------------------------

const FACTOR_LEDGER = "packages/core/src/factor-ledger.ts"

const FACTOR_LEDGER_CONTEXT_ANCHOR = `export const makeSignalFactorPolicyContext = (
  signal: AnySignal,
  vector?: PulsarVector,
  options?: { readonly vectorSourceRef?: string },
): SignalFactorPolicyContext => ({
  signalId: signal.id,
  precedence: SIGNAL_FACTOR_POLICY_PRECEDENCE,
  vectorOverrides: factorOverridesOf(signal, vector),
  vectorConfigOverrides: configFactorOverridesOf(signal, vector),
  ...(options?.vectorSourceRef !== undefined
    ? { vectorSourceRef: options.vectorSourceRef }
    : {}),
})`

const FACTOR_LEDGER_INLINED_CONTEXT = `export const makeSignalFactorPolicyContext = (
  signal: AnySignal,
  vector?: PulsarVector,
  options?: { readonly vectorSourceRef?: string },
): SignalFactorPolicyContext => {
  const vectorOverrides = factorOverridesOf(signal, vector)
  const overrideConfig = signalOverrideOf(signal, vector)?.config
  let vectorConfigOverrides: SignalFactorOverrideMap = {}
  if (overrideConfig !== undefined) {
    const effectiveConfig = resolvedConfig(
      signal,
      asConfigRecord(signal.defaultConfig),
      vector,
    )
    const overrides: Record<string, SignalFactorValue> = {}
    for (const key of Object.keys(overrideConfig)) {
      const path = \`config.\${normalizeFactorPathSegment(key)}\`
      if (Object.hasOwn(vectorOverrides, path)) continue
      const factorValue = toSignalFactorValue(effectiveConfig[key])
      if (factorValue === undefined) continue
      overrides[path] = factorValue
    }
    vectorConfigOverrides = overrides
  }
  return {
    signalId: signal.id,
    precedence: SIGNAL_FACTOR_POLICY_PRECEDENCE,
    vectorOverrides,
    vectorConfigOverrides,
    ...(options?.vectorSourceRef !== undefined
      ? { vectorSourceRef: options.vectorSourceRef }
      : {}),
  }
}`

const FACTOR_LEDGER_NAMED_BOUNDARY = `/**
 * Project vector \`override.config\` entries onto \`config.*\` factor paths so
 * the factor ledger reports the same effective values scoring enforces.
 *
 * Values are not read from the raw override — they are read back from
 * \`resolvedConfig\`, the single resolution function the scoring path uses,
 * so the audit trail and the enforced config cannot drift apart. Keys that
 * are also overridden through the explicit \`factors\` form are skipped here;
 * the factor-form pass owns their attribution (matching \`resolvedConfig\`,
 * where factor overrides layer after config overrides).
 */
export const configFactorOverridesOf = (
  signal: AnySignal,
  vector: PulsarVector | undefined,
): SignalFactorOverrideMap => {
  const overrideConfig = signalOverrideOf(signal, vector)?.config
  if (overrideConfig === undefined) return {}
  const factorOverrides = factorOverridesOf(signal, vector)
  const effectiveConfig = resolvedConfig(
    signal,
    asConfigRecord(signal.defaultConfig),
    vector,
  )
  const overrides: Record<string, SignalFactorValue> = {}
  for (const key of Object.keys(overrideConfig)) {
    const path = \`config.\${normalizeFactorPathSegment(key)}\`
    if (Object.hasOwn(factorOverrides, path)) continue
    const factorValue = toSignalFactorValue(effectiveConfig[key])
    if (factorValue === undefined) continue
    overrides[path] = factorValue
  }
  return overrides
}

`

const occurrences = (haystack: string, needle: string): number => {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return count
    count += 1
    from = at + needle.length
  }
}

const replaceUnique = (source: string, path: string, anchor: string, replacement: string): string => {
  const count = occurrences(source, anchor)
  if (count !== 1) throw new Error(`Anchor drift in ${path}: expected 1 occurrence, found ${count}`)
  return source.replace(anchor, replacement)
}

export function buildFactorPolicyBoundaryCandidate(root: string): {
  a: VariantFiles
  b: VariantFiles
  evidence: {
    readonly productionCallSites: ReadonlyArray<string>
    readonly testCallSites: ReadonlyArray<string>
    readonly exportedSymbol: string
    readonly documentedInvariant: string
  }
} {
  const source = readFileSync(resolve(root, FACTOR_LEDGER), "utf8")
  const inlined = replaceUnique(
    replaceUnique(source, FACTOR_LEDGER, FACTOR_LEDGER_CONTEXT_ANCHOR, FACTOR_LEDGER_INLINED_CONTEXT),
    FACTOR_LEDGER,
    FACTOR_LEDGER_NAMED_BOUNDARY,
    "",
  )
  if (inlined.includes("configFactorOverridesOf")) {
    throw new Error("Inlined candidate still references configFactorOverridesOf")
  }
  return {
    a: { [FACTOR_LEDGER]: source },
    b: { [FACTOR_LEDGER]: inlined },
    evidence: {
      productionCallSites: [`${FACTOR_LEDGER}: makeSignalFactorPolicyContext`],
      testCallSites: ["packages/core/src/__tests__/factor-ledger.test.ts:442"],
      exportedSymbol: "configFactorOverridesOf",
      documentedInvariant:
        "Values are read back from `resolvedConfig` so the audit trail and the enforced config cannot drift apart.",
    },
  }
}

// ---------------------------------------------------------------------------

export function buildPolicyClarityCases(root: string): PolicyClarityCases {
  const candidates = buildShapeCandidates(root)
  const fresh = buildFactorPolicyBoundaryCandidate(root)

  const observerBatchProtocol: PolicyClarityCase = {
    id: "observer-batch-protocol",
    rubricFamily: "helper-boundary",
    role: "development",
    subject: "Observer batch output-visibility protocol in packages/core/src/observer-execution.ts",
    variants: {
      a: candidates.consolidation.a,
      b: candidates.consolidation.b,
    },
    sources: {
      signal_result: excerpt(root, "packages/core/src/runner.ts", 24, 31),
      clock: excerpt(root, "packages/core/src/observer-time.ts", 1, 6),
    },
    obligations: [
      "Preserve readiness selection, pending removal, the batch's output snapshot, concurrent execution, publication of the batch's results after it returns, inactive handling, and failure isolation.",
      "The comparison covers only the scheduler sequence in the supplied file. `summarizeCalibration` and per-signal computation are not part of it.",
      "No execution result is supplied in this packet; the declared obligations are minimums.",
    ],
    policies: {
      ambiguous: CONSOLIDATION_AMBIGUOUS,
      precise: CONSOLIDATION_PRECISE,
      opposing: CONSOLIDATION_OPPOSING,
      opposingSingleCallSite: null,
      conflict: CONSOLIDATION_CONFLICT,
    },
    authorExpectation: {
      physical: "b",
      rationale:
        "Under the precise policy the four private helpers each have exactly one call site, are owned by one scheduler, and only forward arguments or thread the same mutable execution object to the next step, so none of them satisfies (a), (b), or (c) of the boundary test. The precise policy therefore selects the single local sequence. The ambiguous wording defines neither 'independently useful contract' nor precedence, so the same facts do not determine an answer.",
      independentEvidence: [
        "The existing behavioral check executes both variants and asserts equal outputs, signal results, inactive ids, metadata, profiles, invocation counts, and batch inputs, so no behavioral difference distinguishes them.",
        "Source inspection of the supplied variants shows every private helper in variant a has exactly one call site inside the same file and no other module imports it.",
      ],
      deterministicRule:
        "Call-site and ownership counting alone decides the boundary-test question here: four private helpers, one call site each, one owner. The policy's contribution is selecting that rule over the alternative, not discovering a fact. If a provider answer agrees with the expectation, that agreement is not evidence of architectural insight; it is evidence that the stated rule was applied.",
      status: "agent_authored_not_human_ground_truth",
      compatibility: {
        a: "Compiles, and the existing behavioral suite passes for it.",
        b: "Compiles, and the existing behavioral suite passes for it. Independently verified applicable refactor for the declared obligations.",
      },
      registeredPredictions: [
        {
          condition: "opposing",
          prediction:
            "Registered before the frozen batch was called, and the condition was chosen before any result on this case was inspected. Flipping the policy direction at constant operational precision is expected to flip the physical answer from b to a. If it does not flip, the rubric is not operational and the precise answers cannot be attributed to the stated policy.",
          exploratoryFollowUp: false,
        },
      ],
    },
    conflictForcesIncompatibleOutcomes: true,
    conflictFixtureNote:
      "Rule one requires that one operational decision stay a single local sequence with a named boundary only when it carries a contract of its own; rule two requires a named boundary for every distinguishable protocol step. On this candidate rule one selects b and rule two selects a, so the fixture does require incompatible outcomes.",
  }

  const cacheLookupRepresentation: PolicyClarityCase = {
    id: "cache-lookup-representation",
    rubricFamily: "producer-guarantee",
    role: "development",
    subject: "CacheLookupResult status and payload representation in packages/core/src/cache.ts",
    variants: {
      a: candidates.representation.a,
      b: candidates.representation.b,
    },
    sources: {
      signal_result: excerpt(root, "packages/core/src/runner.ts", 24, 31),
    },
    obligations: [
      "The supplied `evaluateTieredCacheEntry` producer returns payload fields on hit and stale, and can return a miss carrying `effectiveConfidence` without an entry or value.",
      "Assess payload presence for `CacheLookupResult<SignalRunResult>`; do not infer that an arbitrary generic `T` excludes `undefined`.",
      "Preserve runtime behavior and serialized payload shape; static typing is distinct from external-data validation.",
      "No execution result is supplied in this packet; the declared obligations are minimums.",
    ],
    policies: {
      ambiguous: CACHE_AMBIGUOUS,
      precise: CACHE_PRECISE,
      opposing: CACHE_OPPOSING,
      opposingSingleCallSite: null,
      conflict: CACHE_CONFLICT,
    },
    authorExpectation: {
      physical: "b",
      rationale:
        "The supplied producer always sets the payload for hit and stale, which satisfies the producer-guarantee test, so the precise policy selects the presentation whose declared type requires those fields for every non-miss outcome. The ambiguous wording leaves 'already-established producer guarantee' undefined and names no test for establishing one.",
      independentEvidence: [
        "Independent `tsc` probes: variant a accepts `{ status: 'hit' }` with no payload; variant b rejects it and instead accepts narrowing to hit/stale with the payload present.",
        "Independent runtime comparison at a fixed clock: both variants return identical lookup results, including a miss that carries effectiveConfidence without a value.",
      ],
      deterministicRule:
        "A compiler plus the policy's own sentence decide this case: the producer's assignment of the payload for non-miss statuses is a readable fact, and the policy says to express an established producer guarantee. The policy's contribution is selecting that rule, not discovering a fact. A provider agreement here is not evidence of architectural judgment.",
      status: "agent_authored_not_human_ground_truth",
      compatibility: {
        a: "Compiles; the existing consumer module compiles against it.",
        b: "Compiles; the existing consumer module compiles against it. Independently verified applicable refactor for the declared obligations.",
      },
      registeredPredictions: [],
    },
    conflictForcesIncompatibleOutcomes: true,
    conflictFixtureNote:
      "Rule one requires the declared type to be no weaker than the guarantee the producer establishes; rule two requires one flat serialized shape with the payload guarantee holding only at runtime. On this candidate rule one selects b and rule two selects a, so the fixture does require incompatible outcomes.",
  }

  const factorPolicyBoundary: PolicyClarityCase = {
    id: "factor-policy-boundary",
    rubricFamily: "helper-boundary",
    role: "held_out",
    subject: "Named boundary for config-derived factor overrides in packages/core/src/factor-ledger.ts",
    variants: {
      a: fresh.a,
      b: fresh.b,
    },
    sources: {
      factor_value_model: excerpt(root, "packages/core/src/signal-factor-model.ts", 1, 12),
      vector_resolution: excerpt(root, "packages/core/src/vector-resolution.ts", 80, 98),
    },
    obligations: [
      "Preserve the resolved factor-policy context produced for any signal and vector: `signalId`, `precedence`, `vectorOverrides`, `vectorConfigOverrides`, and the optional `vectorSourceRef`.",
      "Preserve the documented invariant that `config.*` values are read back from `resolvedConfig` so the ledger cannot drift from the enforced config.",
      "No execution result is supplied in this packet; the declared obligations are minimums.",
    ],
    policies: {
      ambiguous: BOUNDARY_FRESH_AMBIGUOUS,
      precise: BOUNDARY_FRESH_PRECISE,
      opposing: BOUNDARY_FRESH_OPPOSING,
      opposingSingleCallSite: BOUNDARY_FRESH_OPPOSING_SINGLE_CALLSITE,
      conflict: BOUNDARY_FRESH_CONFLICT,
    },
    authorExpectation: {
      physical: "a",
      rationale:
        "The named boundary has exactly one production call site, which a 'more than one production call site' rule reads as favouring inlining. But a separate test targets its contract directly (`factor-ledger.test.ts:442` asserts the empty-result contract for a signal whose key is also overridden through the factor form), and the function documents an invariant that its caller would otherwise have to restate. Clause (b) and clause (c) of the frozen boundary test are therefore satisfied, so the precise policy selects the named boundary. This expectation is deliberately the one that a naive single-call-site rule would get wrong.",
      independentEvidence: [
        "Call-site inventory over the repository: one production call site (`factor-ledger.ts`), one direct test call site (`packages/core/src/__tests__/factor-ledger.test.ts:442`).",
        "Independent `tsc` probe on the test file: variant b removes the exported symbol the test imports, so the test module no longer typechecks without also rewriting the test.",
        "Independent runtime comparison over five probed signal/vector inputs: both variants produce an identical resolved factor-policy context. Five inputs are a finite probe, not a proof for any signal and vector.",
        "Source inspection: variant b keeps the `resolvedConfig` read-back in the inlined body, so the invariant's behavior survives while the comment that documents it does not.",
      ],
      deterministicRule:
        "Two candidate rules are available and they select different variants: production call-site counting selects the inlined variant, while the directly targeted test contract and the documented invariant select the named boundary. No rule decides the case until a policy selects which rule applies; once selected, the supplied facts determine the answer. The held-out case therefore tests policy-sensitive rule application, not architectural insight.",
      status: "agent_authored_not_human_ground_truth",
      compatibility: {
        a: "Compiles, and the existing test module compiles against it. Independently verified applicable refactor for the declared obligations.",
        b: "Compiles as a module, but the existing test module imports the removed export, so `tsc` on `packages/core/src/__tests__/factor-ledger.test.ts` fails with TS2305. Without adapting that test, variant b is not a verified applicable refactor, even though it preserves the declared runtime-context obligations over the probed inputs.",
      },
      registeredPredictions: [
        {
          condition: "opposing_single_callsite",
          prediction:
            "Exploratory follow-up. This condition was chosen after the first `opposing` condition turned out to be degenerate on this case (both its stance and the declared stance select physical a). The prediction was written into the case definition and hashed into plan 71df96c4 before these eight calls, but the condition itself is not an untouched preregistered test: under the single-production-call-site rule the expected physical answer is b, because that rule is the one reading that selects inlining and the policy text explicitly refuses to count a test consumer or a documented invariant. If the answer does not move from a to b, the rubric is not tracking policy content on this case.",
          exploratoryFollowUp: true,
        },
      ],
    },
    conflictForcesIncompatibleOutcomes: false,
    conflictFixtureNote:
      "Fixture-design failure. Rule one requires a named boundary only when it carries a contract of its own, and rule two requires a named boundary for a documented invariant. On this candidate the author reading is that the named boundary does carry a contract of its own (a separate test targets it), so rule one also selects a. Both rules can select a, so this cell does not require incompatible outcomes and its result must not be counted as a contradiction the model missed.",
  }

  return {
    "observer-batch-protocol": observerBatchProtocol,
    "cache-lookup-representation": cacheLookupRepresentation,
    "factor-policy-boundary": factorPolicyBoundary,
  }
}

export const CASE_ORDER: ReadonlyArray<PolicyClarityCase["id"]> = [
  "observer-batch-protocol",
  "cache-lookup-representation",
  "factor-policy-boundary",
]
