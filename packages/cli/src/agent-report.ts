import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import { weightOf } from "@skastr0/pulsar-core/vector"
import type { AgentArguments } from "./agent-args.js"
import { agentDetailArgv } from "./agent-args.js"
import { AGENT_SCHEMA, type AgentPreparedPolicy, type AgentStaticPolicy } from "./agent-contract.js"
import { CLI_BUILD_INFO } from "./index.js"
import { toScoreJson } from "./score-json.js"

const COMPACT_BYTES = 16 * 1024
const severityOrder = { block: 0, warn: 1, info: 2 } as const
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const clip = (text: string, limit: number): string => text.length > limit ? `${text.slice(0, limit)}…` : text

interface AgentFinding {
  readonly signal_id: string
  readonly score: number
  readonly weight: number
  readonly severity: Diagnostic["severity"]
  readonly evidence_class: string
  readonly applicability: string
  readonly message: string
  readonly location?: Diagnostic["location"]
  readonly fix_hints: ReadonlyArray<{
    readonly kind: string
    readonly title: string
    readonly summary: string
    readonly confidence: string
    readonly autoApplicable: boolean
  }>
  readonly detail_argv: ReadonlyArray<string>
  readonly diagnostic?: Diagnostic
}

export const agentPolicySummary = (policy: AgentStaticPolicy, prepared: AgentPreparedPolicy) => ({
  fingerprint: prepared.fingerprint,
  vector: {
    id: policy.vectorSelection.label,
    source: policy.vectorSelection.source,
    trust_boundary: policy.vectorSelection.trustBoundary,
    source_label: policy.vectorSelection.sourceLabel,
    ...(policy.vectorSelection.path === undefined ? {} : { path: policy.vectorSelection.path }),
  },
  ...(policy.manifestSource === undefined ? {} : { manifest_source: policy.manifestSource }),
  ...(policy.moduleDependencyRoot === undefined ? {} : { module_dependency_root: policy.moduleDependencyRoot }),
})

export const buildAgentScoreReport = (input: {
  readonly options: AgentArguments
  readonly policy: AgentStaticPolicy
  readonly prepared: AgentPreparedPolicy
  readonly output: ObserverOutput
  readonly gitSha: string
  readonly inputFingerprint: string
}) => {
  const { options, policy, prepared, output } = input
  const json = toScoreJson(output, policy.vectorSelection, policy.repoRoot)
  const snapshots = Object.entries(json.signal_diagnostics ?? {})
  const counts = {
    applicable: 0,
    not_applicable: 0,
    insufficient_evidence: 0,
    failed: 0,
    inactive: output.inactiveSignals.length,
  }
  for (const [, snapshot] of snapshots) counts[snapshot.applicability]++
  const incomplete = counts.failed > 0 || counts.insufficient_evidence > 0 || counts.applicable === 0
  const exitCode = output.hard_gate_status === "fail" ? 2 : incomplete ? 3 : 0
  const selected = snapshots.filter(([id]) => options.signalId === undefined || id === options.signalId)
  const allFindings: AgentFinding[] = selected.flatMap(([id, snapshot]) => {
    const signal = policy.registry.byId.get(id)
    return snapshot.diagnostics.map((diagnostic): AgentFinding => ({
      signal_id: id,
      score: snapshot.score,
      weight: weightOf(signal ?? id, policy.vector),
      severity: diagnostic.severity,
      evidence_class: diagnostic.evidenceClass ?? signal?.evidenceClass ?? "mixed",
      applicability: snapshot.applicability,
      message: options.full ? diagnostic.message : clip(diagnostic.message, 800),
      ...(diagnostic.location === undefined ? {} : { location: diagnostic.location }),
      fix_hints: (options.full ? diagnostic.fixHints ?? [] : (diagnostic.fixHints ?? []).slice(0, 2)).map((hint) => ({
        kind: hint.kind,
        title: options.full ? hint.title : clip(hint.title, 120),
        summary: options.full ? hint.summary : clip(hint.summary, 300),
        confidence: hint.confidence,
        autoApplicable: hint.autoApplicable,
      })),
      detail_argv: agentDetailArgv(options, id),
      ...(options.full ? { diagnostic } : {}),
    }))
  }).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    || a.score - b.score
    || compareText(a.signal_id, b.signal_id)
    || compareText(a.location?.file ?? "", b.location?.file ?? "")
    || (a.location?.line ?? 0) - (b.location?.line ?? 0)
    || compareText(a.message, b.message))
  const candidates = options.full ? allFindings : allFindings.filter((finding) => finding.severity !== "info")
  const base = {
    tool: CLI_BUILD_INFO,
    repository: { root: policy.repoRoot, head: input.gitSha, input_fingerprint: input.inputFingerprint },
    policy: agentPolicySummary(policy, prepared),
    assessment: {
      scope: "whole-repository" as const,
      observer_semantics: json.observer_semantics,
      hard_gate_status: output.hard_gate_status,
      hard_gate_violations: output.hard_gate_violations.length,
      evidence_complete: !incomplete,
      weighted_mean: output.weighted_mean,
      ...(output.readiness === undefined ? {} : {
        readiness: {
          score: output.readiness.score,
          status: output.readiness.status,
          ...(output.readiness.band === undefined ? {} : { band: output.readiness.band }),
        },
      }),
      counts,
      incomplete_signals: snapshots.filter(([, value]) => value.applicability === "failed" || value.applicability === "insufficient_evidence")
        .map(([signal_id, value]) => ({ signal_id, applicability: value.applicability })),
      categories: Object.fromEntries(Object.entries(output.categories).map(([id, category]) => [id, {
        score: category.score,
        applicable_signals: category.applicableSignalCount ?? category.signalCount,
      }])),
    },
    calibration: output.calibration === undefined ? null : options.full ? output.calibration : {
      fingerprint: output.calibration.fingerprint,
      active_modules: output.calibration.active_modules.map((module) => ({
        id: module.id, source: module.source, fingerprint: module.fingerprint,
      })),
      detail_argv: agentDetailArgv(options),
    },
  }
  const makeResult = (findings: ReadonlyArray<AgentFinding>) => ({
    ...base,
    findings,
    presentation: {
      mode: options.full ? "full" as const : "compact" as const,
      ...(options.signalId === undefined ? {} : { signal_filter: options.signalId }),
      filtering_changes_assessment: false,
      available_diagnostics: allFindings.length,
      eligible_findings: candidates.length,
      returned_findings: findings.length,
      truncated: findings.length < candidates.length,
      detail_omitted: !options.full,
      count_scope: "available emitted diagnostics, not a total of underlying defects",
      detail_argv: agentDetailArgv(options, options.signalId),
    },
    ...(options.full ? {
      signals: Object.fromEntries(selected.map(([id, snapshot]) => [id, {
        ...snapshot,
        weight: weightOf(policy.registry.byId.get(id) ?? id, policy.vector),
        factors: json.signal_factors?.[id] ?? [],
      }])),
    } : {}),
  })
  let findings = options.full ? candidates : candidates.slice(0, options.limit)
  let result = makeResult(findings)
  // Bound ordinary compact receipts by bytes as well as count. Full retrieval
  // is explicit and preserves detector-owned diagnostic limits.
  const encodedBytes = (value: typeof result): number => Buffer.byteLength(JSON.stringify({
    schema: AGENT_SCHEMA, operation: "score", status: "completed", result: value,
  }, null, 2) + "\n")
  while (!options.full && findings.length > 0 && encodedBytes(result) > COMPACT_BYTES) {
    findings = findings.slice(0, -1)
    result = makeResult(findings)
  }
  return { result, exitCode }
}
