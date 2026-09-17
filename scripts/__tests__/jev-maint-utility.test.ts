import { afterEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { PATCHES, TASK_PATCHES, type PatchId, type TaskId, type Variant } from "../jev-maint/patches.ts"
import { cleanupTemps, judge, runPatchOutcome, type Observations, type PatchOutcome } from "../jev-maint/probe.ts"
import { assertNoVerdictMarkers, buildEntry, TASKS } from "../jev-maint/tasks.ts"
import { compareToExpected, MAX_REQUEST_BYTES, prepare, SCHEDULE, validatePlan } from "../jev-maint.ts"
import { ledgerEntries } from "../jev-maint/receipt.ts"
import type { Response } from "../jev-spike/model.ts"

const ROOT = resolve(import.meta.dir, "../..")
const CORRECT: Record<TaskId, PatchId> = {
  "shared-contract": "r1_contract_and_all_sites",
  "caller-failure": "r2_observer_failure_branch_only",
  "delegated-rule": "r3_enforcement_rule_only",
  "missing-output": "r4_runner_missing_output_branch_only",
}

afterEach(() => {
  cleanupTemps()
})

describe("maintenance-utility packets", () => {
  test("every task and variant builds a packet with no verdict markers and inside the byte cap", () => {
    for (const task of TASKS) {
      const variants: ReadonlyArray<Variant> = task.id === "insufficient-context" ? ["b"] : ["a", "b"]
      for (const variant of variants) {
        const entry = buildEntry(ROOT, "jev-latest", task, { variant })
        expect(() => assertNoVerdictMarkers(entry)).not.toThrow()
        const bytes = Buffer.byteLength(JSON.stringify(entry.request))
        expect(bytes).toBeLessThan(MAX_REQUEST_BYTES)
        // Every expected owner must be a supplied symbol, and every supplied
        // symbol must be judged by exactly one ownership question.
        const symbols = Object.keys(entry.request.state.symbols as object)
        const ownership = Object.keys(entry.request.questions).filter((id) => id.startsWith("owns_"))
        expect(ownership.map((id) => id.slice("owns_".length)).sort()).toEqual([...symbols].sort())
        for (const owner of entry.expected.owners) expect(symbols).toContain(owner)
      }
    }
  })

  test("the rubric text of each packet is disjoint from its own requirement terms", () => {
    // The guard is exercised through assertNoVerdictMarkers, which throws when a
    // requirement term reaches a rubric. This test asserts the guard is live by
    // confirming each leak term really is distinctive to its task.
    for (const task of TASKS) {
      expect(task.leakTerms.length).toBeGreaterThan(0)
      for (const term of task.leakTerms) {
        const others = TASKS.filter((other) => other.id !== task.id)
        for (const other of others) {
          expect(other.requirement.text.includes(term)).toBe(false)
        }
      }
    }
  })

  test("the evaluation schedule holds delegated-rule and missing-output out of development", () => {
    const developmentTasks = new Set(SCHEDULE.development.map((entry) => entry.task))
    expect(developmentTasks.has("delegated-rule")).toBe(false)
    expect(developmentTasks.has("missing-output")).toBe(false)
    expect(SCHEDULE.evaluation.length).toBe(11)
    const repeat = SCHEDULE.evaluation.find((entry) => entry.repeatOf !== undefined)
    expect(repeat?.id).toBe("shared-contract-b-repeat")
  })

  test("prepare produces a plan whose repeat request is byte-identical to its source", () => {
    const plan = prepare("evaluation")
    expect(() => validatePlan(plan)).not.toThrow()
    const byId = new Map(plan.requests.map((entry) => [entry.id, entry]))
    const repeat = byId.get("shared-contract-b-repeat")!
    const source = byId.get("shared-contract-b")!
    expect(repeat.requestHash).toBe(source.requestHash)
    expect(JSON.stringify(repeat.request)).toBe(JSON.stringify(source.request))
    const reversed = byId.get("shared-contract-b-options-reversed")!
    expect(reversed.requestHash).not.toBe(source.requestHash)
    expect(Object.keys(reversed.request.questions)).toEqual(Object.keys(source.request.questions))
  })

  test("an altered policy, order, or request body is rejected", () => {
    const plan = prepare("development")
    const alteredPolicy = { ...plan, policy: { ...plan.policy, retries: 1 } }
    expect(() => validatePlan(alteredPolicy)).toThrow()
    const swapped = { ...plan, requests: [...plan.requests].reverse() }
    expect(() => validatePlan(swapped)).toThrow()
    const tampered = {
      ...plan,
      requests: plan.requests.map((entry, index) =>
        index === 0 ? { ...entry, request: { ...entry.request, model: "other-model" } } : entry,
      ),
    }
    expect(() => validatePlan(tampered)).toThrow(/Request hash mismatch/)
    const budget = { ...plan, requests: [...plan.requests, plan.requests[0]!] }
    expect(() => validatePlan(budget)).toThrow()
  })
})

describe("candidate patch ground truth", () => {
  test(
    "every candidate patch's declared outcome holds under tsc and the runtime probe",
    async () => {
      const outcomes = new Map<string, PatchOutcome>()
      for (const variant of ["a", "b"] as const) {
        for (const patch of PATCHES) {
          const outcome = await runPatchOutcome(ROOT, variant, patch.id)
          outcomes.set(`${variant}:${patch.id}`, outcome)
          expect(outcome.declaredEditedFiles).toEqual(outcome.actualEditedFiles)
        }
      }
      const at = (variant: Variant, id: PatchId): PatchOutcome => {
        const outcome = outcomes.get(`${variant}:${id}`)
        if (outcome === undefined) throw new Error(`missing outcome ${variant}:${id}`)
        return outcome
      }

      for (const variant of ["a", "b"] as const) {
        for (const [task, patchIds] of Object.entries(TASK_PATCHES) as Array<[TaskId, ReadonlyArray<PatchId>]>) {
          const correct = at(variant, CORRECT[task])
          expect(correct.compiles).toBe(true)
          expect(correct.requirementSatisfied).toBe(true)
          expect(correct.obligationsViolated).toEqual([])
          for (const other of patchIds.filter((id) => id !== CORRECT[task])) {
            const outcome = at(variant, other)
            const behaviourallyCorrect = outcome.requirementSatisfied && outcome.obligationsViolated.length === 0
            if (behaviourallyCorrect) {
              // Behaviourally correct but strictly less minimal than the expected
              // candidate, or the expected candidate itself.
              expect(outcome.declaredEditedOwners.length).toBeGreaterThanOrEqual(
                correct.declaredEditedOwners.length,
              )
            } else {
              expect(!outcome.requirementSatisfied || outcome.obligationsViolated.length > 0).toBe(true)
            }
          }
        }
      }

      // A required field on the shared contract reaches more owners than the
      // two entry-point exits: the extracted constructor is not the whole
      // contract surface.
      expect(at("a", "r1_contract_and_all_sites").declaredEditedOwners.length).toBe(6)
      expect(at("b", "r1_contract_and_all_sites").declaredEditedOwners.length).toBe(5)
      expect(at("a", "r1_contract_and_all_sites").declaredEditedOwners).toContain("from_cached_observer_output")
      expect(at("a", "r1_contract_interface_only").compiles).toBe(false)
      expect(at("b", "r1_contract_interface_only").compiles).toBe(false)
      expect(at("a", "r1_optional_field_one_entry_point").requirementSatisfied).toBe(false)

      // Sharing the observer's failure policy with the runner breaks the
      // runner's typed error channel.
      expect(at("a", "r2_share_failure_policy_both_entry_points").obligationsViolated).toEqual([
        "runSignal no longer propagates the typed compute failure",
      ])
      expect(at("b", "r2_share_failure_policy_both_entry_points").obligationsViolated).toEqual([
        "runSignal no longer propagates the typed compute failure",
      ])

      // Applying the delegated rule only where the ceiling is currently called
      // leaves the engine-level rule unowned.
      expect(at("a", "r3_call_sites_only").requirementSatisfied).toBe(false)
      expect(at("b", "r3_call_sites_only").requirementSatisfied).toBe(false)
      expect(at("a", "r3_enforcement_plus_call_site_rechecks").declaredEditedOwners.length).toBe(3)
      expect(at("b", "r3_enforcement_plus_call_site_rechecks").declaredEditedOwners.length).toBe(2)

      // The observer already reports an inactive signal through inactiveSignals,
      // so adding a missing-output branch there is unreachable for this
      // requirement's trigger and changes unrelated behaviour.
      expect(at("a", "r4_both_entry_points_report_missing_output").obligationsViolated).toEqual([
        "observer behaviour changed for an active signal whose compute returns undefined",
      ])
      expect(at("b", "r4_both_entry_points_report_missing_output").obligationsViolated).toEqual([
        "observer behaviour changed for an active signal whose compute returns undefined",
      ])
      expect(at("a", "r4_no_source_change").requirementSatisfied).toBe(false)
    },
    600_000,
  )

  test("the judge separates a met requirement from a violated obligation", () => {
    const observations: Observations = {
      runnerOk: { contractVersion: null, score: 0.9 },
      observerOk: { contractVersion: null, score: 0.9 },
      cacheRestored: { contractVersion: null, score: 0.9 },
      runnerMissingOutput: { contractVersion: null, metadata: null, severity: "warn" },
      observerInactive: { inactive: ["P-INACTIVE"], resultIds: ["P-OK"] },
      observerUndefinedOutput: { hasResult: true, score: 0.4, metadata: null },
      runnerFailure: { failed: false, tag: null },
      observerFailure: {
        contractVersion: null,
        score: 0,
        metadata: { applicability: "failed" },
        data: { failureKind: "compute_error" },
        severity: "warn",
        isolatedOk: true,
      },
      engineCeiling: "warn",
      runnerCeiling: "warn",
      observerCeiling: "warn",
    }
    // The observer observable is met, but the runner's typed failure channel is
    // gone: a met requirement with a broken obligation must not read as success.
    const shared = judge("caller-failure", observations)
    expect(shared.satisfied).toBe(true)
    expect(shared.violations).toEqual(["runSignal no longer propagates the typed compute failure"])
    expect(shared.unmet).toBeNull()

    const restored = judge("caller-failure", { ...observations, runnerFailure: { failed: true, tag: "SignalComputeError" } })
    expect(restored.satisfied).toBe(true)
    expect(restored.violations).toEqual([])

    const unmet = judge("caller-failure", {
      ...observations,
      runnerFailure: { failed: true, tag: "SignalComputeError" },
      observerFailure: { ...observations.observerFailure, data: null },
    })
    expect(unmet.satisfied).toBe(false)
    expect(unmet.unmet).toContain("data.failureKind")

    // The engine-level rule is what the delegated-rule requirement changes; a
    // call-site-only patch leaves it undowngraded.
    const callSitesOnly = judge("delegated-rule", { ...observations, engineCeiling: "block" })
    expect(callSitesOnly.satisfied).toBe(false)
    expect(callSitesOnly.unmet).toContain("engine-level severity rule")

    // A missing-output patch that changes how the observer treats an active
    // signal returning undefined is not free.
    const overShared = judge("missing-output", {
      ...observations,
      runnerMissingOutput: { contractVersion: null, metadata: { applicability: "not_applicable" }, severity: "warn" },
      observerUndefinedOutput: { hasResult: true, score: 0, metadata: { applicability: "not_applicable" } },
    })
    expect(overShared.satisfied).toBe(true)
    expect(overShared.violations).toEqual([
      "observer behaviour changed for an active signal whose compute returns undefined",
    ])
  })
})

describe("decoder and packet honesty", () => {
  const responseWith = (answers: Record<string, unknown>): Response =>
    ({ model: "jev-test", answers, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Response

  test("each answer field lands in its own comparison slot", () => {
    // Guards the field mix-up that put a Score mean where a Noul probability
    // belonged. The Noul value and the Score value are deliberately different.
    const response = responseWith({
      change_kind: { type: "choice", choice: "caller_specific_change", probabilities: { caller_specific_change: 0.8, shared_contract_change: 0.2 }, confidence: 0.8 },
      shared_obligation: { type: "noul", noul: 0.17 },
      success_producer_count: { type: "score", score: 0.66, probabilities: { "0": 0.44, "1": 0.51, "2": 0, "3": 0.05 }, legend: [], confidence: 0.5 },
      evidence_readiness: { type: "choice", choice: "sufficient", probabilities: { sufficient: 0.9, missing_evidence: 0.1, conflicting_evidence: 0 }, confidence: 0.9 },
      policy_readiness: { type: "choice", choice: "defined", probabilities: { defined: 0.9, missing: 0.1, ambiguous: 0, conflicting: 0 }, confidence: 0.9 },
      owns_x: { type: "noul", noul: 0.9 },
    })
    const comparison = compareToExpected(response, {
      changeKind: "caller_specific_change",
      owners: ["x"],
      sharedObligation: false,
      successProducerCount: 0,
      patch: null,
      evidenceReadiness: "sufficient",
    })
    expect(comparison.sharedObligation?.probability).toBe(0.17)
    expect(comparison.successProducerCount?.mean).toBe(0.66)
    expect(comparison.sharedObligation?.agrees).toBe(true)
    expect(comparison.owners.probabilities).toEqual({ x: 0.9 })
  })

  test("a Score answer reports its distribution and modal level, not the rounded mean", () => {
    // The three recorded shared-contract-b answers, verbatim.
    const recorded = [
      { score: 1.63, probabilities: { "0": 0, "1": 0.66, "2": 0.06, "3": 0.28 } },
      { score: 1.66, probabilities: { "0": 0, "1": 0.63, "2": 0.08, "3": 0.29 } },
      { score: 1.78, probabilities: { "0": 0, "1": 0.57, "2": 0.08, "3": 0.35 } },
    ]
    for (const answer of recorded) {
      const comparison = compareToExpected(
        responseWith({
          success_producer_count: { type: "score", ...answer, legend: [], confidence: 0.5 },
        }),
        {
          changeKind: "shared_contract_change",
          owners: [],
          sharedObligation: false,
          successProducerCount: 1,
          patch: null,
          evidenceReadiness: "sufficient",
        },
      )
      const count = comparison.successProducerCount!
      expect(count.modeLevel).toBe(1)
      expect(count.meanRounded).toBe(2)
      expect(count.distribution).toEqual(answer.probabilities)
      // Mode-based agreement is the reported judgment; the rounded mean is
      // visible beside it but is not the answer.
      expect(count.agrees).toBe(true)
      expect(count.meanRoundedAgrees).toBe(false)
    }
  })

  test("a patch candidate carries a plan description and no implementation", () => {
    const entry = buildEntry(ROOT, "jev-latest", TASKS.find((task) => task.id === "shared-contract")!, { variant: "a" })
    const candidates = entry.request.state.patch_candidates as Record<string, Record<string, unknown>>
    expect(Object.keys(candidates).length).toBe(3)
    for (const candidate of Object.values(candidates)) {
      expect(Object.keys(candidate)).toEqual(["what"])
      const what = candidate["what"] as string
      expect(typeof what).toBe("string")
      // No unified-diff markers, no code fences, no hunk headers: the packet
      // carries prose plan descriptions, never candidate source.
      expect(what).not.toContain("```")
      expect(what).not.toContain("@@")
      expect(what).not.toMatch(/^[-+]{3} /m)
    }
  })

  test("no question references another question, so the packet is not a cascade", () => {
    const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const token = (value: string): RegExp => new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}($|[^A-Za-z0-9_])`)
    for (const task of TASKS) {
      for (const variant of ["a", "b"] as const) {
        if (task.id === "insufficient-context" && variant === "a") continue
        const entry = buildEntry(ROOT, "jev-latest", task, { variant })
        const ids = Object.keys(entry.request.questions)
        for (const id of ids) {
          const instructions = JSON.stringify(entry.request.questions[id]!.instructions)
          for (const other of ids.filter((candidate) => candidate !== id)) {
            expect(token(other).test(instructions)).toBe(false)
          }
        }
      }
    }
  })

  test("the ledger inventory includes intents as well as receipts", () => {
    const names = ["0.intent.json", "0.receipt.json", "run.json", "summary.json", "manifest.json", "notes.txt"]
    expect(ledgerEntries(names)).toEqual([
      "0.intent.json",
      "0.receipt.json",
      "manifest.json",
      "run.json",
      "summary.json",
    ])
  })
})
