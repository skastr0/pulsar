import { selectGoodhartHoldoutSignalIds } from "@skastr0/pulsar-core/backpressure"
import {
  collectChangedHunksForRange,
  collectWorktreeChangedHunks,
  type Registry,
} from "@skastr0/pulsar-core/scoring"
import {
  CATEGORIES,
  type Category,
  type ChangedHunk,
  type Diagnostic,
} from "@skastr0/pulsar-core/signal"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { PulsarVector } from "@skastr0/pulsar-core/vector"
import { Effect } from "effect"
import { isAbsolute, relative } from "node:path"
import {
  makePulsarRuntime,
  readHeadSha,
  resolveGitRef,
  resolveRepoRoot,
} from "./runtime.js"
import {
  diagnosticLocation,
  diagnosticMessage,
  severityLabel,
} from "./score-diagnostics.js"
import {
  decideGate,
  type GateDiagnosticRecord,
  type GateStatus,
} from "./score-diff-gate.js"
import { CATEGORY_LABELS } from "./score-format.js"
import { toScoreJson } from "./score-json.js"
import type { DiscoveredPulsarVector } from "./vector-discovery.js"

export interface ScoreDiffOptions {
  readonly repoPath: string
  readonly diffRange: string
  readonly changedOnly?: boolean
  readonly agentView?: boolean
  readonly json?: boolean
  readonly profile?: boolean
}

export interface ScoreDiffVectorContext {
  readonly registry: Registry
  readonly vectorSelection: DiscoveredPulsarVector
  readonly observerVector: PulsarVector
}

interface DiffEndpoint {
  readonly ref: string
  readonly sha: string
  readonly output: ObserverOutput
}

interface DiffRun {
  readonly repoRoot: string
  readonly base: DiffEndpoint
  readonly head: DiffEndpoint
  readonly changedHead?: DiffEndpoint
  readonly changedHunks: ReadonlyArray<ChangedHunk>
}

interface DiagnosticRecord extends GateDiagnosticRecord {
  readonly signal_id: string
  readonly category: Category
  readonly tier: number
  readonly kind: string
  readonly enforcement_ceiling: ReadonlyArray<string>
  readonly confidence: number
  readonly applicability: string
  readonly diagnostic: Diagnostic
  readonly fix_hints: NonNullable<Diagnostic["fixHints"]>
  readonly in_changed_scope: boolean
  readonly changed_scope: "hunk" | "file" | "global" | "outside_changed_scope"
}

interface DiffDiagnosticDeltas {
  readonly allIntroduced: ReadonlyArray<DiagnosticRecord>
  readonly changedOnlyDiagnostics: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
}

interface AgentSignalProjection {
  readonly activeSignalIds: ReadonlyArray<string>
  readonly visibleSignalIds: ReadonlyArray<string>
  readonly hiddenSignalIds: ReadonlyArray<string>
}

export const parseScoreDiffRange = (
  range: string,
): { readonly baseRef: string; readonly headRef: string } => {
  const match = /^([^.]+)\.\.([^.]+)$/.exec(range)
  if (match === null) {
    throw new ScoreDiffRangeParseError()
  }
  return { baseRef: match[1]!, headRef: match[2]! }
}

class ScoreDiffRangeParseError extends Error {
  constructor() {
    super("score --diff must be <base>..<head|WORKTREE> (two dots, no three-dot syntax)")
    this.name = "ScoreDiffRangeParseError"
  }
}

export const runScoreDiffMode = (
  opts: ScoreDiffOptions,
  vectorContext: ScoreDiffVectorContext,
): Effect.Effect<number, unknown, never> =>
  Effect.gen(function* () {
    const parsedRange = parseScoreDiffRange(opts.diffRange)
    const run = yield* observeDiffRun(opts, parsedRange, vectorContext.observerVector)
    if (collectActiveSignalIds(run.head.output).length === 0) {
      return yield* Effect.fail(new Error("Observer mode has no active signals."))
    }
    const report = buildDiffReport(opts, vectorContext, run)

    if (opts.json === true) {
      console.log(JSON.stringify({
        ...toScoreJson(run.head.output, vectorContext.vectorSelection),
        ...report,
      }, null, 2))
    } else if (opts.agentView === true) {
      printAgentDiffReport(run.repoRoot, report)
    } else {
      printHumanDiffReport(run.repoRoot, report)
    }

    return report.gate_decision.status === "block" ? 2 : 0
  })

const observeDiffRun = (
  opts: ScoreDiffOptions,
  range: { readonly baseRef: string; readonly headRef: string },
  observerVector: PulsarVector,
): Effect.Effect<DiffRun, unknown, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const currentHeadSha = yield* readHeadSha(repoRoot)
    const runtime = yield* makePulsarRuntime(repoRoot, observerVector, {
      ...(opts.profile === true ? { observer: { profile: true } } : {}),
      tsProject: { productionOnly: true },
    })
    const baseSha = yield* resolveGitRef(repoRoot, range.baseRef)
    const headIsWorktree = range.headRef === "WORKTREE"
    const headSha = headIsWorktree
      ? currentHeadSha
      : yield* resolveGitRef(repoRoot, range.headRef)
    const changedHunks = headIsWorktree
      ? yield* collectWorktreeChangedHunks(repoRoot)
      : yield* collectChangedHunksForRange(repoRoot, baseSha, headSha)

    const baseOutput = yield* runtime.engine.observeCommit(repoRoot, baseSha)
    const headOutput = headIsWorktree
      ? yield* runtime.engine.observeWorktree(repoRoot, currentHeadSha, { changedHunks: [] })
      : yield* runtime.engine.observeCommit(repoRoot, headSha)
    const changedHeadOutput = headIsWorktree && changedHunks.length > 0
      ? yield* runtime.engine.observeWorktree(repoRoot, currentHeadSha, { changedHunks })
      : undefined

    return {
      repoRoot,
      base: { ref: range.baseRef, sha: baseSha, output: baseOutput },
      head: { ref: range.headRef, sha: headSha, output: headOutput },
      ...(changedHeadOutput !== undefined
        ? { changedHead: { ref: range.headRef, sha: headSha, output: changedHeadOutput } }
        : {}),
      changedHunks,
    }
  })

const buildDiffReport = (
  opts: ScoreDiffOptions,
  vectorContext: ScoreDiffVectorContext,
  run: DiffRun,
) => {
  const diagnostics = diffDiagnosticDeltas(vectorContext.registry, run)
  const projection = agentSignalProjection(opts, vectorContext, run.head.output)
  const gateDecision = decideGate(
    diagnostics.allIntroduced,
    opts.changedOnly === true ? diagnostics.changedOnlyDiagnostics : diagnostics.allIntroduced,
  )

  return {
    diff: diffSummary(opts, run),
    ...(opts.agentView === true
      ? {
          agent_view: {
            enabled: true,
            score_output_suppressed: opts.json !== true,
            visible_signal_ids: projection.visibleSignalIds,
            hidden_signal_ids: projection.hiddenSignalIds,
          },
        }
      : {}),
    introduced_diagnostics: diagnostics.allIntroduced,
    changed_only_diagnostics: diagnostics.changedOnlyDiagnostics,
    resolved_diagnostics: diagnostics.resolved,
    signal_changes: signalChanges(vectorContext.registry, run.base.output, run.head.output),
    category_changes: categoryChanges(run.base.output, run.head.output),
    gate_decision: gateDecision,
    ...(opts.agentView === true
      ? { trust: trustReadout(run.head.output, projection.activeSignalIds, projection.hiddenSignalIds, gateDecision) }
      : {}),
  }
}

const diffDiagnosticDeltas = (
  registry: Registry,
  run: DiffRun,
): DiffDiagnosticDeltas => {
  const diagnosticDelta = compareDiagnostics(
    run.repoRoot,
    registry,
    run.base.output,
    run.head.output,
    run.changedHunks,
  )
  const changedDiagnosticDelta = run.changedHead === undefined
    ? diagnosticDelta
    : compareDiagnostics(
        run.repoRoot,
        registry,
        run.base.output,
        run.changedHead.output,
        run.changedHunks,
      )

  return {
    allIntroduced: diagnosticDelta.introduced,
    changedOnlyDiagnostics: changedDiagnosticDelta.introduced.filter((diagnostic) => diagnostic.in_changed_scope),
    resolved: diagnosticDelta.resolved,
  }
}

const agentSignalProjection = (
  opts: ScoreDiffOptions,
  vectorContext: ScoreDiffVectorContext,
  head: ObserverOutput,
): AgentSignalProjection => {
  const activeSignalIds = collectActiveSignalIds(head)
  const hiddenSignalIds = opts.agentView === true
    ? selectGoodhartHoldoutSignalIds(
        activeSignalIds,
        new Date().toISOString(),
        vectorContext.observerVector,
      )
    : []
  return {
    activeSignalIds,
    hiddenSignalIds,
    visibleSignalIds: activeSignalIds.filter((id) => !hiddenSignalIds.includes(id)),
  }
}

const diffSummary = (opts: ScoreDiffOptions, run: DiffRun) => ({
  range: opts.diffRange,
  base_ref: run.base.ref,
  base_sha: run.base.sha,
  head_ref: run.head.ref,
  head_sha: run.head.sha,
  changed_only: opts.changedOnly === true,
  changed_files: changedFiles(run.changedHunks),
  changed_hunks: run.changedHunks,
})

const compareDiagnostics = (
  repoRoot: string,
  registry: Registry,
  base: ObserverOutput,
  head: ObserverOutput,
  changedHunks: ReadonlyArray<ChangedHunk>,
): {
  readonly introduced: ReadonlyArray<DiagnosticRecord>
  readonly resolved: ReadonlyArray<DiagnosticRecord>
} => {
  const baseRecords = diagnosticRecords(repoRoot, registry, base, changedHunks)
  const headRecords = diagnosticRecords(repoRoot, registry, head, changedHunks)
  const baseKeys = new Set(baseRecords.map((record) => diagnosticRecordKey(record)))
  const headKeys = new Set(headRecords.map((record) => diagnosticRecordKey(record)))
  return {
    introduced: headRecords.filter((record) => !baseKeys.has(diagnosticRecordKey(record))),
    resolved: baseRecords.filter((record) => !headKeys.has(diagnosticRecordKey(record))),
  }
}

const diagnosticRecords = (
  repoRoot: string,
  registry: Registry,
  output: ObserverOutput,
  changedHunks: ReadonlyArray<ChangedHunk>,
): ReadonlyArray<DiagnosticRecord> =>
  [...output.signalResults.entries()]
    .flatMap(([signalId, result]) => {
      const signal = registry.byId.get(signalId)
      if (signal === undefined) return []
      const metadata = output.signalMetadata?.[signalId]
      return result.diagnostics.map((diagnostic) => {
        const changedScope = changedScopeOf(repoRoot, diagnostic, changedHunks)
        return {
          signal_id: signalId,
          category: signal.category,
          tier: signal.tier,
          kind: signal.kind,
          enforcement_ceiling: signal.enforcement,
          confidence:
            metadata?.effectiveConfidence ?? metadata?.baseConfidence ?? confidenceForTier(signal.tier),
          applicability: metadata?.applicability ?? "applicable",
          diagnostic,
          fix_hints: diagnostic.fixHints ?? [],
          in_changed_scope: changedScope === "hunk" || changedScope === "file",
          changed_scope: changedScope,
        }
      })
    })
    .sort(compareDiagnosticRecords)

const changedScopeOf = (
  repoRoot: string,
  diagnostic: Diagnostic,
  changedHunks: ReadonlyArray<ChangedHunk>,
): DiagnosticRecord["changed_scope"] => {
  const file = normalizeDiagnosticPath(repoRoot, diagnostic.location?.file)
  if (file === undefined) return changedScopeFromMembers(repoRoot, diagnostic, changedHunks) ?? "global"
  const matchingHunks = changedHunks.filter((hunk) => hunk.file === file)
  if (matchingHunks.length === 0) {
    return changedScopeFromMembers(repoRoot, diagnostic, changedHunks) ?? "outside_changed_scope"
  }
  const line = diagnostic.location?.line
  if (line === undefined) return "file"
  return matchingHunks.some((hunk) => lineInHunk(line, hunk)) ? "hunk" : "file"
}

const changedScopeFromMembers = (
  repoRoot: string,
  diagnostic: Diagnostic,
  changedHunks: ReadonlyArray<ChangedHunk>,
): DiagnosticRecord["changed_scope"] | undefined => {
  const members = diagnostic.data?.members
  if (!isDiagnosticMemberArray(members)) return undefined
  let matchedFile = false
  for (const member of members) {
    const file = normalizeDiagnosticPath(repoRoot, member.file)
    if (file === undefined) continue
    const matchingHunks = changedHunks.filter((hunk) => hunk.file === file)
    if (matchingHunks.length === 0) continue
    matchedFile = true
    const startLine = member.startLine
    if (startLine !== undefined && matchingHunks.some((hunk) => lineInHunk(startLine, hunk))) {
      return "hunk"
    }
  }
  return matchedFile ? "file" : undefined
}

const normalizeDiagnosticPath = (
  repoRoot: string,
  file: string | undefined,
): string | undefined => {
  if (file === undefined) return undefined
  const normalized = file.replace(/\\/g, "/")
  const repoRelative = isAbsolute(normalized)
    ? relative(repoRoot, normalized).replace(/\\/g, "/")
    : normalized
  return repoRelative.replace(/^\.\//, "")
}

const isDiagnosticMemberArray = (
  value: unknown,
): value is ReadonlyArray<{ readonly file: string; readonly startLine?: number }> => {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((member) => {
    if (typeof member !== "object" || member === null) return false
    const record = member as Record<string, unknown>
    return (
      typeof record.file === "string" &&
      (record.startLine === undefined || typeof record.startLine === "number")
    )
  })
}

const lineInHunk = (line: number, hunk: ChangedHunk): boolean => {
  if (hunk.newLines === 0) return line === hunk.newStart
  return line >= hunk.newStart && line < hunk.newStart + hunk.newLines
}

const diagnosticRecordKey = (record: DiagnosticRecord): string => {
  const location = record.diagnostic.location
  const stableHash = record.diagnostic.data?.hash
  return [
    record.signal_id,
    typeof stableHash === "string" ? stableHash : record.diagnostic.message,
    record.diagnostic.severity,
    location?.file ?? "",
    location?.line ?? "",
    location?.column ?? "",
  ].join("\0")
}

const compareDiagnosticRecords = (left: DiagnosticRecord, right: DiagnosticRecord): number =>
  left.signal_id.localeCompare(right.signal_id) ||
  left.diagnostic.message.localeCompare(right.diagnostic.message)

const confidenceForTier = (tier: number): number => tier === 3 ? 0.5 : 1

const changedFiles = (hunks: ReadonlyArray<ChangedHunk>): ReadonlyArray<string> =>
  [...new Set(hunks.map((hunk) => hunk.file))].sort((left, right) => left.localeCompare(right))

const collectActiveSignalIds = (output: ObserverOutput): ReadonlyArray<string> =>
  [...output.signalResults.keys()].sort((left, right) => left.localeCompare(right))

const signalChanges = (
  registry: Registry,
  base: ObserverOutput,
  head: ObserverOutput,
) =>
  [...new Set([...base.signalResults.keys(), ...head.signalResults.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((signalId) => {
      const signal = registry.byId.get(signalId)
      const baseScore = base.signalResults.get(signalId)?.score
      const headScore = head.signalResults.get(signalId)?.score
      return {
        signal_id: signalId,
        ...(signal !== undefined
          ? { category: signal.category, tier: signal.tier, kind: signal.kind }
          : {}),
        base_score: baseScore,
        head_score: headScore,
        delta:
          baseScore !== undefined && headScore !== undefined
            ? roundDelta(headScore - baseScore)
            : undefined,
      }
    })

const categoryChanges = (base: ObserverOutput, head: ObserverOutput) =>
  Object.fromEntries(
    CATEGORIES.map((category) => {
      const baseScore = base.categories[category]?.score ?? 1
      const headScore = head.categories[category]?.score ?? 1
      return [
        category,
        {
          base_score: baseScore,
          head_score: headScore,
          delta: roundDelta(headScore - baseScore),
        },
      ]
    }),
  ) as Record<Category, { readonly base_score: number; readonly head_score: number; readonly delta: number }>

const roundDelta = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

const trustReadout = (
  output: ObserverOutput,
  activeSignalIds: ReadonlyArray<string>,
  hiddenSignalIds: ReadonlyArray<string>,
  gateDecision: { readonly status: GateStatus },
) => ({
  active_signals: activeSignalIds.length,
  hidden_holdouts: hiddenSignalIds,
  missing_evidence: Object.entries(output.signalMetadata ?? {})
    .filter(([, metadata]) =>
      metadata.applicability === "insufficient_evidence" || metadata.applicability === "failed",
    )
    .map(([signal_id, metadata]) => ({
      signal_id,
      applicability: metadata.applicability,
    })),
  volatile_or_low_confidence_signals: Object.entries(output.signalMetadata ?? {})
    .filter(([, metadata]) =>
      metadata.stale === true ||
      (metadata.effectiveConfidence !== undefined && metadata.effectiveConfidence < 0.75),
    )
    .map(([signal_id, metadata]) => ({
      signal_id,
      effective_confidence: metadata.effectiveConfidence,
      stale: metadata.stale === true,
    })),
  calibration_fingerprint: output.calibration?.fingerprint,
  coverage_state: coverageState(output),
  final_status: gateDecision.status,
})

const coverageState = (output: ObserverOutput): string => {
  const coverage = output.signalResults.get("SHARED-COV-01-coverage-facts")?.output
  if (typeof coverage === "object" && coverage !== null) {
    const state = (coverage as { readonly state?: unknown }).state
    if (typeof state === "string") return state
  }
  return "not_configured"
}

const printAgentDiffReport = (repoRoot: string, report: ReturnType<typeof buildDiffReport>): void => {
  console.log(`Pulsar Agent View: ${report.gate_decision.status.toUpperCase()}`)
  console.log(`Range: ${report.diff.base_ref}..${report.diff.head_ref}`)
  console.log(`Changed files: ${report.diff.changed_files.length}`)
  console.log(`Introduced diagnostics: ${report.introduced_diagnostics.length}`)
  console.log(`Changed-scope diagnostics: ${report.changed_only_diagnostics.length}`)
  if ("agent_view" in report) {
    console.log(`Holdout signals: ${report.agent_view.hidden_signal_ids.length}`)
  }
  for (const reason of report.gate_decision.reasons) {
    console.log(`- ${reason}`)
  }
  const findings = report.diff.changed_only
    ? report.changed_only_diagnostics
    : report.introduced_diagnostics
  for (const record of findings.slice(0, 10)) {
    console.log(
      `${record.signal_id} ${severityLabel(record.diagnostic)} ${diagnosticMessage(repoRoot, record.diagnostic)}`,
    )
    const loc = diagnosticLocation(repoRoot, record.diagnostic)
    if (loc !== undefined) console.log(`  at ${loc}`)
    for (const hint of record.fix_hints) {
      console.log(`  fix: ${hint.title} (${hint.confidence})`)
    }
  }
}

const printHumanDiffReport = (repoRoot: string, report: ReturnType<typeof buildDiffReport>): void => {
  console.log(`Pulsar Diff: ${report.diff.base_ref}..${report.diff.head_ref}`)
  console.log(`Gate: ${report.gate_decision.status}`)
  for (const category of CATEGORIES) {
    const change = report.category_changes[category]
    if (change.delta === 0) continue
    console.log(
      `${CATEGORY_LABELS[category]} ${change.base_score.toFixed(3)} -> ${change.head_score.toFixed(3)} (${change.delta >= 0 ? "+" : ""}${change.delta.toFixed(3)})`,
    )
  }
  const findings = report.introduced_diagnostics.slice(0, 10)
  if (findings.length === 0) return
  console.log("")
  console.log(`Introduced Findings (${findings.length} shown):`)
  for (const record of findings) {
    console.log(
      `  ${record.signal_id} ${severityLabel(record.diagnostic)} ${diagnosticMessage(repoRoot, record.diagnostic)}`,
    )
    const loc = diagnosticLocation(repoRoot, record.diagnostic)
    if (loc !== undefined) console.log(`    at ${loc}`)
  }
}
