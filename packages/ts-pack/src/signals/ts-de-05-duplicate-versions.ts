import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalFactorLedger, SignalFactorLedgerEntry } from "@skastr0/pulsar-core/signal"
import type { CalibrationDecision, CalibrationProcessorError, ResolvedCalibrationContext, TypeScriptDependencyVersionPolicyValue } from "@skastr0/pulsar-core/calibration"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import { makeFactorEntry, makeFactorLedger } from "@skastr0/pulsar-core/factors"
import { Effect, Option, Schema } from "effect"
import { findDuplicateGroups, type DuplicateGroup } from "./ts-de-05-groups.js"
import { readTsDe05Lockfile } from "./ts-de-05-lockfile.js"

const TsDe05Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type TsDe05Config = typeof TsDe05Config.Type

interface EffectiveDuplicateGroup extends DuplicateGroup {
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly penaltyWeight: number
  readonly policyDecisions: ReadonlyArray<CalibrationDecision>
}

type TsDe05Output = {
  readonly duplicates: ReadonlyArray<EffectiveDuplicateGroup>
  readonly totalPackages: number
  readonly totalDuplicateInstances: number
  readonly diagnosticLimit: number
  readonly lockfileStatus: "bun" | "npm" | "pnpm" | "unsupported" | "missing"
  readonly lockfileFiles: ReadonlyArray<string>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly factorLedger: SignalFactorLedger
}

const UNSUPPORTED_LOCKFILES = ["yarn.lock"] as const

export const TsDe05: Signal<TsDe05Config, TsDe05Output, SignalContextTag> = {
  id: "TS-DE-05-duplicate-dependency-versions",
  title: "Duplicate dependency versions",
  aliases: ["TS-DE-05"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: TsDe05Config,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const lockfile = yield* Effect.tryPromise({
        try: () => readTsDe05Lockfile(context.worktreePath),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-05-duplicate-dependency-versions",
            message: String(cause),
            cause,
          }),
      })
      if (lockfile.kind === "missing" || lockfile.kind === "unsupported") {
        return {
          duplicates: [],
          totalPackages: 0,
          totalDuplicateInstances: 0,
          diagnosticLimit: config.top_n_diagnostics,
          lockfileStatus: lockfile.kind,
          lockfileFiles: lockfile.files,
          calibrationDecisions: [],
          factorLedger: makeFactorLedger("TS-DE-05-duplicate-dependency-versions", []),
        }
      }

      const resolvedPackages = lockfile.packages.filter(
        (pkg) => !pkg.version.startsWith("workspace:"),
      )
      const duplicates = yield* applyDependencyVersionPolicy(
        findDuplicateGroups(resolvedPackages, lockfile.workspaces),
        calibration,
      ).pipe(Effect.mapError(toSignalComputeError))

      return {
        duplicates,
        totalPackages: resolvedPackages.length,
        totalDuplicateInstances: duplicates.reduce((sum, group) => sum + group.instanceCount, 0),
        diagnosticLimit: config.top_n_diagnostics,
        lockfileStatus: lockfile.kind,
        lockfileFiles: [lockfile.path],
        calibrationDecisions: duplicates.flatMap((group) => group.policyDecisions),
        factorLedger: makeTsDe05FactorLedger(duplicates),
      }
    }),
  score: (out) => {
    if (out.totalPackages === 0) return 1
    const directGroups = out.duplicates.filter(
      (group) => group.visible && group.evidenceKind === "direct-workspace-duplicate",
    )
    const transitiveGroups = out.duplicates.filter(
      (group) => group.visible && group.evidenceKind === "transitive-lockfile-duplicate",
    )
    const penalty = [...directGroups, ...transitiveGroups]
      .reduce((sum, group) => sum + group.penaltyWeight, 0) / out.totalPackages
    return Math.max(0, 1 - Math.min(1, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.lockfileStatus === "missing" || out.lockfileStatus === "unsupported") {
      return [{
        severity: "info" as const,
        message:
          out.lockfileStatus === "missing"
            ? "No supported lockfile found; duplicate-version analysis skipped"
            : `Lockfile format not yet supported: ${out.lockfileFiles.join(", ")}`,
        data: {
          lockfileStatus: out.lockfileStatus,
          files: out.lockfileFiles.slice(),
        },
      }]
    }

    return out.duplicates.filter((group) => group.visible).slice(0, out.diagnosticLimit).map((group) => ({
      severity: group.severity,
      message:
        group.evidenceKind === "direct-workspace-duplicate"
          ? `Duplicate direct dependency versions for ${group.name}: ` +
            `${group.directVersions.join(", ")} (${group.directInstanceCount} direct instances; ` +
            `${group.instanceCount} total instances)`
          : `Duplicate transitive dependency versions for ${group.name}: ` +
            `${group.versions.join(", ")} (${group.instanceCount} lockfile instances)`,
      data: {
        name: group.name,
        versions: group.versions.slice(),
        directVersions: group.directVersions.slice(),
        instanceCount: group.instanceCount,
        directInstanceCount: group.directInstanceCount,
        evidenceKind: group.evidenceKind,
        pullInChains: group.pullInChains.map((chain) => ({
          version: chain.version,
          chain: chain.chain.slice(),
        })),
        policyDecisions: group.policyDecisions,
      },
    }))
  },
  factorLedger: (out) => out.factorLedger,
}

const applyDependencyVersionPolicy = (
  duplicates: ReadonlyArray<DuplicateGroup>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<ReadonlyArray<EffectiveDuplicateGroup>, CalibrationProcessorError, never> =>
  Effect.forEach(
    duplicates,
    (group) =>
      Effect.gen(function* () {
        const input = defaultDependencyVersionPolicy(group)
        if (Option.isNone(calibration)) return toEffectiveDuplicateGroup(group, input, [])
        const policy = yield* calibration.value.runSlot("typescript.dependency-version-policy", input)
        return toEffectiveDuplicateGroup(group, policy.value, policy.decisions)
      }),
    { concurrency: 1 },
  )

const defaultDependencyVersionPolicy = (
  group: DuplicateGroup,
): TypeScriptDependencyVersionPolicyValue => ({
  signalId: "TS-DE-05-duplicate-dependency-versions",
  findingId: group.name,
  packageName: group.name,
  versions: group.versions,
  evidenceKind: group.evidenceKind,
  pullInChains: group.pullInChains,
  visible: true,
  severity: group.evidenceKind === "direct-workspace-duplicate" ? "warn" : "info",
  penaltyWeight: defaultPenaltyWeight(group),
  factorPathPrefix: `duplicate_versions.${factorPathSegment(group.name)}`,
})

const toEffectiveDuplicateGroup = (
  group: DuplicateGroup,
  policy: TypeScriptDependencyVersionPolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): EffectiveDuplicateGroup => ({
  ...group,
  visible: policy.visible,
  severity: policy.severity,
  penaltyWeight: policy.penaltyWeight,
  policyDecisions: decisions,
})

const defaultPenaltyWeight = (group: DuplicateGroup): number =>
  group.evidenceKind === "direct-workspace-duplicate"
    ? 2 + group.directInstanceCount * 0.15
    : 0.35 + group.instanceCount * 0.03

const makeTsDe05FactorLedger = (
  duplicates: ReadonlyArray<EffectiveDuplicateGroup>,
): SignalFactorLedger =>
  makeFactorLedger(
    "TS-DE-05-duplicate-dependency-versions",
    duplicates.flatMap((group): ReadonlyArray<SignalFactorLedgerEntry> => {
      const prefix = `duplicate_versions.${factorPathSegment(group.name)}`
      return [
        factorEntryForGroupValue(group, `${prefix}.visible`, group.visible),
        factorEntryForGroupValue(group, `${prefix}.severity`, group.severity),
        factorEntryForGroupValue(group, `${prefix}.penalty_weight`, group.penaltyWeight),
      ]
    }),
  )

const factorEntryForGroupValue = (
  group: EffectiveDuplicateGroup,
  path: string,
  value: string | number | boolean,
): SignalFactorLedgerEntry => {
  const decision = [...group.policyDecisions]
    .reverse()
    .find((item) => item.factorPaths?.includes(path))
  return makeFactorEntry({
    path,
    title: `Dependency version ${path.split(".").at(-1) ?? "factor"}`,
    valueKind: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
    scoreRole: path.endsWith(".penalty_weight") ? "penalty" : "metadata",
  }, value, {
    source: decision === undefined ? "computed" : "module",
    ...(decision !== undefined
      ? {
          attribution: {
            moduleId: decision.moduleId,
            processorId: decision.processorId,
            ...(decision.ruleId !== undefined ? { ruleId: decision.ruleId } : {}),
            evidence: decision.evidence,
          },
        }
      : {}),
  })
}

const factorPathSegment = (value: string): string =>
  value.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "_")

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "TS-DE-05-duplicate-dependency-versions",
        message: String(cause),
        cause,
      })
