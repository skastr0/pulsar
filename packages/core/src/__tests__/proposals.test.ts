import { describe, expect, test } from "bun:test"
import {
  applyPulsarVectorProposal,
  deriveAiAssistedModeProposal,
  derivePassiveVectorProposal,
  deriveRevealedPreferenceProposal,
  resolvePulsarVectorProposal,
} from "../vector.js"
import {
  type ObserverOutput,
} from "../observer.js"
import {
  type SignalRunResult,
} from "../scoring.js"

const emptyCategories = () => ({
  "architectural-drift": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
  "dependency-entropy": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
  "abstraction-bloat": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
  "legibility-decay": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
  "generated-slop": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
  "review-pain": { score: 1, signals: {}, signalCount: 0, activeSignalIds: [] },
})

const signalResult = (signalId: string, score: number): SignalRunResult => ({
  signalId,
  score,
  output: undefined,
  diagnostics: [],
})

const observerOutput = (entries: ReadonlyArray<[string, number]>): ObserverOutput => ({
  categories: emptyCategories(),
  minimum: undefined,
  weighted_mean: 1,
  hard_gate_status: "pass",
  hard_gate_violations: [],
  inactiveSignals: [],
  signalResults: new Map(entries.map(([signalId, score]) => [signalId, signalResult(signalId, score)])),
})

describe("pulsar vector proposals", () => {
  test("turns score improvements into pending passive proposals", () => {
    const proposal = derivePassiveVectorProposal({
      fingerprint: "abc123def456",
      changedFiles: ["src/payments.ts"],
      vector: {
        id: "current",
        domain: "typescript",
        signal_overrides: { "TS-SL-03": { weight: 1 } },
      },
      previous: observerOutput([
        ["TS-SL-03", 0.4],
        ["TS-LD-01", 0.55],
      ]),
      current: observerOutput([
        ["TS-SL-03", 0.9],
        ["TS-LD-01", 0.8],
      ]),
      now: "2026-04-19T00:00:00.000Z",
    })

    expect(proposal).toBeDefined()
    expect(proposal?.domain).toBe("typescript")
    expect(proposal?.status).toBe("pending-confirmation")
    expect(proposal?.confidence).toBe(1)
    expect(proposal?.deltas[0]?.signal_id).toBe("TS-SL-03")
    expect(proposal?.deltas[0]?.proposed_weight).toBeGreaterThan(1)
  })

  test("derives an AI-assisted mode proposal without silently mutating the vector", () => {
    const proposal = deriveAiAssistedModeProposal({
      changedFiles: ["src/feature.ts"],
      toolName: "morph-mcp_edit_file",
      vector: {
        id: "manual",
        domain: "typescript",
        signal_overrides: {},
      },
      now: "2026-04-19T00:00:00.000Z",
    })

    expect(proposal).toBeDefined()
    expect(proposal?.source).toBe("ai-assisted-detection")
    expect(proposal?.mode_deltas).toHaveLength(1)
    expect(proposal?.mode_deltas[0]?.mode).toBe("ai_assisted")
    expect(proposal?.mode_deltas[0]?.proposed).toBe(true)
    expect(proposal?.summary).toContain("explicit")
  })

  test("derives a revealed-preference proposal with support scores", () => {
    const proposal = deriveRevealedPreferenceProposal({
      proposalId: "proposal-revealed-head12345678",
      createdAt: "2026-04-19T00:00:00.000Z",
      vector: {
        id: "current",
        domain: "typescript",
        signal_overrides: {
          "TS-LD-01": { weight: 1 },
          "TS-RP-02": { weight: 1 },
        },
      },
      algorithm: "pairwise",
      sampleCount: 12,
      minimumSampleCount: 24,
      comparedPairs: 20,
      outcomeCounts: { accepted: 6, revised: 4, reverted: 2 },
      weights: { "TS-LD-01": 1.4, "TS-RP-02": 0.7 },
      support: { "TS-LD-01": 0.82, "TS-RP-02": -0.64 },
      changedFiles: ["src/a.ts", "src/b.ts"],
      reportPath: ".pulsar/elicitation/revealed-preference/proposal.json",
    })

    expect(proposal).toBeDefined()
    expect(proposal?.source).toBe("revealed-preference")
    expect(proposal?.confidence).toBeGreaterThan(0.35)
    expect(proposal?.deltas[0]?.support).toBeDefined()
    expect(proposal?.evidence[0]?.artifact_path).toContain("revealed-preference")
  })

  test("accepted proposals update weights, modes, and provenance deterministically", () => {
    const resolved = resolvePulsarVectorProposal({
      proposal: {
        schema_version: 1,
        id: "proposal-ai-assisted-mode",
        source: "ai-assisted-detection",
        domain: "typescript",
        created_at: "2026-04-19T00:00:00.000Z",
        status: "pending-confirmation",
        confidence: 0.95,
        summary: "Detected agent-mediated editing; keep AI-assisted thresholds explicit instead of hidden.",
        changed_files: ["src/feature.ts"],
        evidence: [{ kind: "observation", summary: "Observed edit tool activity." }],
        deltas: [
          {
            signal_id: "TS-SL-03",
            previous_weight: 1,
            proposed_weight: 1.25,
            rationale: "Recent edits favored cleanup.",
          },
        ],
        mode_deltas: [
          {
            mode: "ai_assisted",
            previous: false,
            proposed: true,
            rationale: "Agent edit tools were active.",
          },
        ],
      },
      status: "accepted",
      now: "2026-04-19T01:00:00.000Z",
    })

    const next = applyPulsarVectorProposal(
      {
        id: "current",
        domain: "typescript",
        signal_overrides: { "TS-SL-03": { weight: 1 } },
      },
      resolved,
      { artifactPath: ".pulsar/proposals/accepted/proposal-ai-assisted-mode.json" },
    )

    expect(next.signal_overrides["TS-SL-03"]?.weight).toBe(1.25)
    expect(next.modes?.ai_assisted).toBe(true)
    expect(next.provenance?.at(-1)?.source).toBe("ai-assisted-detection")
    expect(next.provenance?.at(-1)?.artifact_path).toContain("accepted/proposal-ai-assisted-mode")
  })
})
