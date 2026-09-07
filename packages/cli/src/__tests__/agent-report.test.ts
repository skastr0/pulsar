import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import { emptyObserverCategoryOutput, type CategoryOutput, type ObserverOutput } from "@skastr0/pulsar-core/observer"
import { CATEGORIES, type Category, type Diagnostic } from "@skastr0/pulsar-core/signal"
import { parseAgentArguments } from "../agent-args.js"
import { AGENT_SCHEMA, type AgentPreparedPolicy, type AgentStaticPolicy } from "../agent-contract.js"
import { buildAgentScoreReport } from "../agent-report.js"
import { buildPulsarRegistry } from "../runtime-registry.js"

const signalId = "TS-LD-02-function-size-distribution"
const registry = await Effect.runPromise(buildPulsarRegistry())
const policy: AgentStaticPolicy = {
  repoRoot: "/repo", registry,
  vector: { id: "repo", domain: "typescript", signal_overrides: { [signalId]: { weight: 1.5 } } },
  vectorSelection: { source: "worktree", trustBoundary: "repo-local", path: "/repo/.pulsar/vector.json", label: "repo", sourceLabel: "repo-local .pulsar/vector.json", vector: undefined },
  manifest: undefined, manifestSource: undefined, moduleDependencyRoot: undefined, explanation: {},
}
const prepared: AgentPreparedPolicy = {
  fingerprint: "policy-unchanged",
  calibrationContext: makeResolvedCalibrationContext({ repoFacts: { repoRoot: "/repo", fingerprint: "facts", detectedTechnologies: [], sourceExtensions: [] } }),
  explanation: {},
}

const makeOutput = (options: {
  readonly applicability?: NonNullable<ObserverOutput["signal_diagnostics"]>[string]["applicability"]
  readonly diagnostics?: ReadonlyArray<Diagnostic>
  readonly blocked?: boolean
} = {}): ObserverOutput => {
  const diagnostics = options.diagnostics ?? [{ severity: "warn", message: "Oversized business function", location: { file: "/repo/src/service.ts", line: 4 } }]
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, emptyObserverCategoryOutput()])) as Record<Category, CategoryOutput>
  categories["legibility-decay"] = { score: 0.6, signals: { [signalId]: 0.6 }, signalCount: 1, applicableSignalCount: 1, activeSignalIds: [signalId] }
  return {
    observer_semantics: "applicability-aware-readiness-v2",
    weighted_mean: 0.6,
    minimum: undefined,
    hard_gate_status: options.blocked ? "fail" : "pass",
    hard_gate_violations: options.blocked ? [{ signalId, category: "legibility-decay", diagnostic: diagnostics[0]! }] : [],
    categories,
    inactiveSignals: [],
    signalResults: new Map([[signalId, {
      signalId, score: 0.6, output: {}, diagnostics,
      metadata: { applicability: options.applicability ?? "applicable" },
      factorLedger: { signalId, entries: [{ path: "size.policy", value: 0.6, source: "module", affectsScore: true, attribution: { ruleId: "repo-size", moduleId: "repo", processorId: "size", sourceRef: ".pulsar/modules/repo.ts" } }] },
    }]]),
  }
}

const report = (output: ObserverOutput, args: ReadonlyArray<string> = []) => buildAgentScoreReport({
  options: parseAgentArguments(["score", ...args]), policy, prepared, output, gitSha: "head", inputFingerprint: "input",
})

describe("agent assessment projection", () => {
  test("preserves policy, weights and actual repository-relative findings", () => {
    const { result, exitCode } = report(makeOutput())
    expect(exitCode).toBe(0)
    expect(result.policy.fingerprint).toBe("policy-unchanged")
    expect(result.findings[0]).toMatchObject({ signal_id: signalId, weight: 1.5, location: { file: "src/service.ts", line: 4 } })
    expect(result.assessment.scope).toBe("whole-repository")
    expect(result.presentation.count_scope).toContain("not a total")
  })

  test("exit codes distinguish block, incomplete, not applicable and no measurement", () => {
    expect(report(makeOutput({ blocked: true, applicability: "failed" })).exitCode).toBe(2)
    expect(report(makeOutput({ applicability: "failed" })).exitCode).toBe(3)
    expect(report(makeOutput({ applicability: "insufficient_evidence" })).exitCode).toBe(3)
    expect(report(makeOutput({ applicability: "not_applicable" })).exitCode).toBe(3)
    const output = makeOutput()
    const signalResults = new Map(output.signalResults)
    signalResults.set("TS-DE-01-type-level-coupling", { signalId: "TS-DE-01-type-level-coupling", score: 1, output: {}, diagnostics: [], metadata: { applicability: "not_applicable" } })
    output.categories["dependency-entropy"].signals["TS-DE-01-type-level-coupling"] = 1
    expect(report({ ...output, signalResults }).exitCode).toBe(0)
  })

  test("filtering detail never filters the verdict or completeness", () => {
    const { result, exitCode } = report(makeOutput({ blocked: true }), ["--signal", "RS-LD-01-unsafe-code"])
    expect(exitCode).toBe(2)
    expect(result.findings).toHaveLength(0)
    expect(result.assessment.hard_gate_violations).toBe(1)
    expect(result.presentation.filtering_changes_assessment).toBe(false)
  })

  test("compact mode omits informational evidence and bounds encoded UTF-8 bytes", () => {
    const diagnostics: Diagnostic[] = Array.from({ length: 30 }, (_, index) => ({
      severity: index === 0 ? "info" : "warn",
      message: `${index} ${"修复".repeat(2_000)}`,
      data: { large: "x".repeat(100_000) },
    }))
    const { result } = report(makeOutput({ diagnostics }), ["--limit", "100"])
    const bytes = Buffer.byteLength(JSON.stringify({ schema: AGENT_SCHEMA, operation: "score", status: "completed", result }, null, 2) + "\n")
    expect(bytes).toBeLessThanOrEqual(16 * 1024)
    expect(result.presentation.available_diagnostics).toBe(30)
    expect(result.presentation.eligible_findings).toBe(29)
    expect(result.presentation.truncated).toBe(true)
    expect(result.findings.every((finding) => finding.severity !== "info")).toBe(true)
  })

  test("full output retrieves existing diagnostics and factor attribution without inventing uncapped totals", () => {
    const { result } = report(makeOutput(), ["--full", "--signal", signalId])
    expect(result.signals?.[signalId]?.factors[0]?.attribution).toMatchObject({ ruleId: "repo-size", moduleId: "repo" })
    expect(result.findings[0]?.diagnostic?.message).toBe("Oversized business function")
    expect(result.presentation.detail_omitted).toBe(false)
    expect(result.presentation.truncated).toBe(false)
  })
})
