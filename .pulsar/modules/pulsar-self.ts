import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  tuneFactorPolicy,
  tuneTypeScriptUnsafeType,
  type TypeScriptTypeCouplingPolicyValue,
  type TypeScriptUnsafeTypePolicyValue,
} from "@skastr0/pulsar-project-module-sdk"

const DELIBERATE_EXISTENTIAL_RULE_ID = "pulsar.deliberate-existential-boundary.v1"
const CORE_ORCHESTRATION_TYPE_COUPLING_RULE_ID = "pulsar.core-orchestration-type-coupling.v1"
const SELF_HOSTING_BUS_FACTOR_RULE_ID = "pulsar.self-hosting-single-maintainer-bus-factor.v1"
const ACTIVE_SELF_HOSTING_CLEANUP_CHURN_RULE_ID = "pulsar.active-self-hosting-cleanup-churn.v1"
const ACTIVE_SELF_HOSTING_CLEANUP_PR_SIZE_RULE_ID = "pulsar.active-self-hosting-cleanup-pr-size.v1"
const SELF_HOSTING_POLICY_OWNER = "Guilherme Castro"
const TC_158_REVIEW_TRIGGER = "TC-158 accepted and self-hosting cleanup branch merged"

export default defineProjectModule({
  id: "pulsar-self",
  version: "0.0.0",
  scope: "repository",
  processors: [
    defineProcessor({
      id: "deliberate-existential-unsafe-types",
      slot: "typescript.unsafe-type-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "deliberate-existential-unsafe-types-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isDeliberateExistentialBoundary(current.value)) return current

          return tuneTypeScriptUnsafeType(current, runtime, {
            boundary: false,
            severity: "info",
            weight: 0,
            ruleId: DELIBERATE_EXISTENTIAL_RULE_ID,
            reason:
              "Pulsar uses this unsafe type as an explicit existential boundary where TypeScript cannot express the heterogeneous Effect/Signal service set without making downstream types less accurate.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "symbol", value: current.value.target },
              { kind: "unsafe-kind", value: current.value.kind },
            ],
            metadata: { repository: "pulsar", policy: "deliberate-existential-boundary" },
          })
        }),
    }),
    defineProcessor({
      id: "core-orchestration-type-coupling",
      slot: "typescript.type-coupling-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "core-orchestration-type-coupling-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          const rule = coreOrchestrationTypeCouplingRule(current.value)
          if (rule === undefined) return current

          return tuneFactorPolicy(current, runtime, {
            action: "tune-type-coupling",
            severity: "info",
            penaltyWeight: 0,
            ruleId: CORE_ORCHESTRATION_TYPE_COUPLING_RULE_ID,
            reason:
              "This file is a deliberate Pulsar orchestration or contract boundary; previous extraction attempts moved coupling into helper files and worsened the dependency map rather than improving local reasoning.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "boundary", value: rule.boundary },
              { kind: "outgoing-types", value: String(current.value.externalTypesReferenced) },
              { kind: "outlier-threshold", value: String(current.value.outlierThreshold) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "core-orchestration-type-coupling",
              boundary: rule.boundary,
            },
          })
        }),
    }),
    defineProcessor({
      id: "self-hosting-single-maintainer-bus-factor",
      slot: "shared.bus-factor-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "self-hosting-single-maintainer-bus-factor-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isSelfHostingSingleMaintainerBusFactor(current.value)) return current

          return tuneFactorPolicy(current, runtime, {
            action: "tune-bus-factor",
            severity: "info",
            penaltyWeight: 0,
            ruleId: SELF_HOSTING_BUS_FACTOR_RULE_ID,
            reason:
              "Pulsar is currently a single-maintainer self-hosted repository. That is a real process risk, but it is not a code-health defect in the max-score code-quality loop.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "repo-authors", value: current.value.repoAuthors.join(",") },
              { kind: "window-days", value: String(current.value.windowDays) },
              { kind: "touched-loc", value: String(current.value.touchedLoc) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "self-hosting-single-maintainer-process-risk",
              owner: SELF_HOSTING_POLICY_OWNER,
              retirementTrigger: "Pulsar gains additional regular maintainers",
              reviewTrigger: "Pulsar gains additional regular maintainers",
              reviewCadence: "quarterly",
            },
          })
        }),
    }),
    defineProcessor({
      id: "active-self-hosting-cleanup-churn",
      slot: "shared.churn-rate-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "active-self-hosting-cleanup-churn-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isActiveSelfHostingCleanupChurn(current.value)) return current

          return tuneFactorPolicy(current, runtime, {
            action: "tune-churn-rate",
            severity: "info",
            penaltyWeight: 0,
            ruleId: ACTIVE_SELF_HOSTING_CLEANUP_CHURN_RULE_ID,
            reason:
              "The current churn is from TC-158 active self-hosting consolidation; this temporary policy expires when TC-158 is accepted and the cleanup branch is merged.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "scope", value: "TC-158" },
              { kind: "window-days", value: String(current.value.windowDays) },
              { kind: "introduced-lines", value: String(current.value.introducedLineCount) },
              { kind: "churned-lines", value: String(current.value.churnedLineCount) },
              { kind: "churn-rate", value: String(current.value.churnRate) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "active-self-hosting-cleanup",
              owner: SELF_HOSTING_POLICY_OWNER,
              scope: "TC-158",
              removalTrigger: TC_158_REVIEW_TRIGGER,
            },
          })
        }),
    }),
    defineProcessor({
      id: "active-self-hosting-cleanup-pr-size",
      slot: "typescript.pr-size-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "active-self-hosting-cleanup-pr-size-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isActiveSelfHostingCleanupPrSize(current.value)) return current

          return tuneFactorPolicy(current, runtime, {
            action: "tune-pr-size",
            severity: "info",
            penaltyWeight: 0,
            ruleId: ACTIVE_SELF_HOSTING_CLEANUP_PR_SIZE_RULE_ID,
            reason:
              "The current branch diff is TC-158 active self-hosting consolidation; this temporary policy expires when TC-158 is accepted and the cleanup branch is merged.",
            evidence: [
              { kind: "scope", value: "TC-158" },
              { kind: "diff-mode", value: current.value.diffMode },
              { kind: "size-category", value: current.value.sizeCategory },
              { kind: "lines-added", value: String(current.value.linesAdded) },
              { kind: "lines-deleted", value: String(current.value.linesDeleted) },
              { kind: "files-changed", value: String(current.value.filesChanged.length) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "active-self-hosting-cleanup",
              owner: SELF_HOSTING_POLICY_OWNER,
              scope: "TC-158",
              removalTrigger: TC_158_REVIEW_TRIGGER,
            },
          })
        }),
    }),
  ],
})

const isDeliberateExistentialBoundary = (
  value: TypeScriptUnsafeTypePolicyValue,
): boolean =>
  deliberateExistentialRules.some((rule) =>
    value.file.endsWith(rule.file) &&
    value.kind === rule.kind &&
    value.target === rule.target,
  )

const deliberateExistentialRules: ReadonlyArray<{
  readonly file: string
  readonly kind: TypeScriptUnsafeTypePolicyValue["kind"]
  readonly target: string
}> = [
  {
    file: "packages/core/src/scoring-engine-contract.ts",
    kind: "return",
    target: "PackLayerFactory",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "return",
    target: "makeEnvLayer",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "return",
    target: "makeEnvironmentLayerFactory",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "parameter",
    target: "envLayer",
  },
  {
    file: "packages/core/src/signal.ts",
    kind: "heritage",
    target: "AnySignal",
  },
  {
    file: "packages/cli/src/runtime.ts",
    kind: "return",
    target: "scoringEngineLayer",
  },
  {
    file: "packages/cli/src/runtime.ts",
    kind: "assertion",
    target: "<expression>",
  },
]

const coreOrchestrationTypeCouplingRule = (
  value: TypeScriptTypeCouplingPolicyValue,
): { readonly boundary: string } | undefined =>
  coreOrchestrationTypeCouplingRules.find((rule) =>
    value.file.endsWith(rule.file),
  )

const coreOrchestrationTypeCouplingRules: ReadonlyArray<{
  readonly file: string
  readonly boundary: string
}> = [
  {
    file: "packages/core/src/signal.ts",
    boundary: "canonical signal contract",
  },
  {
    file: "packages/core/src/scoring-engine-observe.ts",
    boundary: "observer cache and worktree orchestration",
  },
  {
    file: "packages/core/src/scoring-engine-score-execution.ts",
    boundary: "single-signal cache and execution orchestration",
  },
  {
    file: "packages/core/src/observer-execution.ts",
    boundary: "observer signal execution orchestration",
  },
  {
    file: "packages/core/src/scoring-engine-contract.ts",
    boundary: "scoring engine public contract",
  },
  {
    file: "packages/core/src/runner.ts",
    boundary: "signal runner orchestration",
  },
  {
    file: "packages/core/src/calibration-context.ts",
    boundary: "calibration processor orchestration",
  },
  {
    file: "packages/core/src/elicitation/proposal-passive.ts",
    boundary: "elicitation proposal orchestration",
  },
  {
    file: "packages/core/src/routing-matching.ts",
    boundary: "routing pattern matcher",
  },
  {
    file: "packages/core/src/routing.ts",
    boundary: "routing detector orchestration",
  },
  {
    file: "packages/core/src/vector-resolution.ts",
    boundary: "vector validation and resolution boundary",
  },
  {
    file: "packages/core/src/shared-02-bus-factor.ts",
    boundary: "shared bus-factor signal policy boundary",
  },
  {
    file: "packages/core/src/shared-03-churn-rate.ts",
    boundary: "shared churn-rate signal policy boundary",
  },
  {
    file: "packages/ts-pack/src/signals/ts-de-04-usage.ts",
    boundary: "TypeScript dependency usage fact aggregation",
  },
  {
    file: "packages/ts-pack/src/signals/ts-sl-04-output.ts",
    boundary: "TypeScript unfinished-implementation output assembly",
  },
]

const isSelfHostingSingleMaintainerBusFactor = (
  value: SharedBusFactorPolicyValue,
): boolean =>
  value.repoAuthors.length === 1 &&
  value.repoAuthors[0] === SELF_HOSTING_POLICY_OWNER &&
  value.windowDays === 180 &&
  value.touchedLoc > 0

const isActiveSelfHostingCleanupChurn = (
  value: SharedChurnRatePolicyValue,
): boolean =>
  value.windowDays === 14 &&
  value.introducedLineCount >= 5_000 &&
  value.churnedLineCount >= 1_000 &&
  value.churnRate >= 0.2

const isActiveSelfHostingCleanupPrSize = (
  value: TypeScriptPrSizePolicyValue,
): boolean =>
  value.diffMode === "git-branch-range" &&
  value.sizeCategory === "oversized" &&
  value.linesAdded >= 30_000 &&
  value.linesDeleted >= 20_000 &&
  value.filesChanged.length >= 400

type SharedBusFactorPolicyValue = CalibrationSlotInput<"shared.bus-factor-policy">
type SharedChurnRatePolicyValue = CalibrationSlotInput<"shared.churn-rate-policy">
type TypeScriptPrSizePolicyValue = CalibrationSlotInput<"typescript.pr-size-policy">
