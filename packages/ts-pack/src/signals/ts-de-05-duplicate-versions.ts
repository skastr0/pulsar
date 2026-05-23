import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalFactorLedger, SignalFactorLedgerEntry } from "@skastr0/pulsar-core/signal"
import type { CalibrationDecision, CalibrationProcessorError, ResolvedCalibrationContext, TypeScriptDependencyVersionPolicyValue } from "@skastr0/pulsar-core/calibration"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import {
  factorEntryForPolicyDecision,
  factorPathSegment,
  makeFactorLedger,
} from "@skastr0/pulsar-core/factors"
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
  cacheVersion: "factor-policy-v1-diagnostic-limit-v1-pnpm-chain-v1",
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
          diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
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
        diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
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
      }].slice(0, out.diagnosticLimit)
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

const normalizeDiagnosticLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
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
        factorEntryForPolicyDecision({
          decisions: group.policyDecisions,
          path: `${prefix}.visible`,
          title: "Dependency version visible",
          value: group.visible,
        }),
        factorEntryForPolicyDecision({
          decisions: group.policyDecisions,
          path: `${prefix}.severity`,
          title: "Dependency version severity",
          value: group.severity,
        }),
        factorEntryForPolicyDecision({
          decisions: group.policyDecisions,
          path: `${prefix}.penalty_weight`,
          title: "Dependency version penalty_weight",
          value: group.penaltyWeight,
        }),
      ]
    }),
  )

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "TS-DE-05-duplicate-dependency-versions",
        message: String(cause),
        cause,
      })
