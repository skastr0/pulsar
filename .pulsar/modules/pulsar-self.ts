import { Effect } from "effect"
import {
  classifyArchitectureRole,
  defineProcessor,
  defineProjectModule,
  readArchitectureRole,
  tuneFactorPolicy,
  tuneTypeScriptCloneGroup,
  tuneTypeScriptNesting,
  tuneTypeScriptSize,
  tuneTypeScriptUnsafeType,
  type CalibrationSlotInput,
  type ResolvedCalibrationContext,
  type TypeScriptUnsafeTypePolicyValue,
} from "@skastr0/pulsar-project-module-sdk"

type PulsarArchitectureRole = "pure_utility" | "shared_contextual" | "integration"

const ARCHITECTURE_ROLE_RULE_ID = "pulsar.architecture-role.v1"
const DELIBERATE_EXISTENTIAL_RULE_ID = "pulsar.deliberate-existential-boundary.v1"
const INTEGRATION_TYPE_COUPLING_RULE_ID = "pulsar.integration-type-coupling-policy.v1"
const INTEGRATION_SIZE_RULE_ID = "pulsar.integration-size-policy.v1"
const INTEGRATION_NESTING_RULE_ID = "pulsar.integration-nesting-policy.v1"
const INTEGRATION_CLONE_RULE_ID = "pulsar.integration-clone-policy.v1"
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
      id: "pulsar-architecture-role-classifier",
      slot: "taxonomy.file-classifier",
      role: "enricher",
      priority: 20,
      fingerprint: "pulsar-architecture-role-classifier-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          const rule = architectureRoleRule(current.value.path)
          if (rule === undefined) return current

          return classifyArchitectureRole(current, runtime, rule.role, {
            ruleId: ARCHITECTURE_ROLE_RULE_ID,
            reason:
              "Pulsar self-calibration declares repo-local architecture taste once through taxonomy metadata so downstream signals can interpret size, nesting, clones, and coupling by code role.",
            evidence: [
              { kind: "path", value: current.value.path },
              { kind: "architecture-role", value: rule.role },
              { kind: "role-rule", value: rule.id },
            ],
            metadata: {
              repository: "pulsar",
              policy: "repo-local-architecture-role",
              ruleId: rule.id,
              ...(rule.boundary !== undefined ? { boundary: rule.boundary } : {}),
            },
          })
        }),
    }),
    defineProcessor({
      id: "integration-size-policy",
      slot: "typescript.size-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "integration-size-policy-v1",
      process: (current, context, runtime) =>
        Effect.gen(function* () {
          const classification = yield* architectureRoleClassificationForFile(context, current.value.file)
          if (classification.role !== "integration") return current

          return tuneTypeScriptSize(current, runtime, {
            severity: "info",
            penaltyWeight: 0,
            maxLoc: current.value.kind === "file" ? 1_200 : 160,
            ruleId: INTEGRATION_SIZE_RULE_ID,
            reason:
              "Integration code is allowed to stay locally coherent as a larger executable story when splitting would scatter one operational decision across files.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "architecture-role", value: classification.role },
              { kind: "size-kind", value: current.value.kind },
              { kind: "loc", value: String(current.value.loc) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "integration-size",
              architectureRole: classification.role,
            },
          })
        }),
    }),
    defineProcessor({
      id: "integration-nesting-policy",
      slot: "typescript.nesting-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "integration-nesting-policy-v1",
      process: (current, context, runtime) =>
        Effect.gen(function* () {
          const classification = yield* architectureRoleClassificationForFile(context, current.value.file)
          if (classification.role !== "integration") return current

          return tuneTypeScriptNesting(current, runtime, {
            severity: "info",
            penaltyWeight: 0,
            threshold: 8,
            ruleId: INTEGRATION_NESTING_RULE_ID,
            reason:
              "Integration code often has irreducible control-flow from external protocols, orchestration, and error routing; Pulsar tracks it as information instead of forcing helper extraction.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "architecture-role", value: classification.role },
              { kind: "observed-nesting", value: String(current.value.observedNesting) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "integration-nesting",
              architectureRole: classification.role,
            },
          })
        }),
    }),
    defineProcessor({
      id: "integration-clone-policy",
      slot: "typescript.clone-group-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "integration-clone-policy-v1",
      process: (current, context, runtime) =>
        Effect.gen(function* () {
          const memberRoles = new Set<PulsarArchitectureRole>()
          for (const member of current.value.members) {
            const classification = yield* architectureRoleClassificationForFile(context, member.file)
            if (classification.role !== undefined) memberRoles.add(classification.role)
          }
          if (memberRoles.size !== 1 || !memberRoles.has("integration")) return current

          return tuneTypeScriptCloneGroup(current, runtime, {
            cloneAction: "exclude",
            factor: 0,
            severity: "info",
            penaltyWeight: 0,
            ruleId: INTEGRATION_CLONE_RULE_ID,
            reason:
              "Duplicate-looking integration code can preserve local protocol context better than a contextual abstraction; this policy excludes all-integration clone groups from score pressure.",
            evidence: [
              { kind: "clone-group", value: current.value.groupId },
              { kind: "architecture-role", value: "integration" },
              { kind: "member-count", value: String(current.value.members.length) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "integration-clones",
              architectureRole: "integration",
            },
          })
        }),
    }),
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
      id: "integration-type-coupling-policy",
      slot: "typescript.type-coupling-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "integration-type-coupling-policy-v1",
      process: (current, context, runtime) =>
        Effect.gen(function* () {
          const classification = yield* architectureRoleClassificationForFile(context, current.value.file)
          if (classification.role !== "integration") return current
          const boundary = classification.boundary ?? classification.ruleId ?? "classified-integration"

          return tuneFactorPolicy(current, runtime, {
            action: "tune-type-coupling",
            severity: "info",
            penaltyWeight: 0,
            ruleId: INTEGRATION_TYPE_COUPLING_RULE_ID,
            reason:
              "This file is deliberate integration code; type coupling is tracked as orchestration evidence instead of forcing contextual extraction that would scatter one local decision.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "boundary", value: boundary },
              { kind: "outgoing-types", value: String(current.value.externalTypesReferenced) },
              { kind: "outlier-threshold", value: String(current.value.outlierThreshold) },
            ],
            metadata: {
              repository: "pulsar",
              policy: "integration-type-coupling",
              boundary,
              architectureRole: classification.role,
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

type ArchitectureRoleRule = {
  readonly id: string
  readonly role: PulsarArchitectureRole
  readonly boundary?: string
  readonly matches: (path: string) => boolean
}

type ArchitectureRoleClassification = {
  readonly role?: PulsarArchitectureRole
  readonly boundary?: string
  readonly ruleId?: string
}

const architectureRoleClassificationForFile = (
  context: ResolvedCalibrationContext,
  file: string,
) =>
  context.runSlot("taxonomy.file-classifier", {
    path: file,
    categories: [],
  }).pipe(
    Effect.map((result): ArchitectureRoleClassification => {
      const role = readPulsarArchitectureRole(result.value.metadata)
      const boundary = readStringMetadata(result.value.metadata, "boundary")
      const ruleId = readStringMetadata(result.value.metadata, "ruleId")
      return {
        ...(role !== undefined ? { role } : {}),
        ...(boundary !== undefined ? { boundary } : {}),
        ...(ruleId !== undefined ? { ruleId } : {}),
      }
    }),
  )

const readStringMetadata = (
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key]
  return typeof value === "string" ? value : undefined
}

const readPulsarArchitectureRole = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): PulsarArchitectureRole | undefined => {
  const role = readArchitectureRole(metadata)
  return isPulsarArchitectureRole(role) ? role : undefined
}

const isPulsarArchitectureRole = (
  value: string | undefined,
): value is PulsarArchitectureRole =>
  value === "pure_utility" ||
  value === "shared_contextual" ||
  value === "integration"

const architectureRoleRule = (file: string): ArchitectureRoleRule | undefined => {
  const normalized = normalizePath(file)
  return architectureRoleRules.find((rule) => rule.matches(normalized))
}

const architectureRoleRules: ReadonlyArray<ArchitectureRoleRule> = [
  integrationFile(
    "core.signal-contract",
    "packages/core/src/signal.ts",
    "canonical signal contract",
  ),
  integrationFile(
    "core.scoring-observe",
    "packages/core/src/scoring-engine-observe.ts",
    "observer cache and worktree orchestration",
  ),
  integrationFile(
    "core.scoring-execution",
    "packages/core/src/scoring-engine-score-execution.ts",
    "single-signal cache and execution orchestration",
  ),
  integrationFile(
    "core.observer-execution",
    "packages/core/src/observer-execution.ts",
    "observer signal execution orchestration",
  ),
  integrationFile(
    "core.scoring-contract",
    "packages/core/src/scoring-engine-contract.ts",
    "scoring engine public contract",
  ),
  integrationFile(
    "core.runner",
    "packages/core/src/runner.ts",
    "signal runner orchestration",
  ),
  integrationFile(
    "core.calibration-context",
    "packages/core/src/calibration-context.ts",
    "calibration processor orchestration",
  ),
  integrationFile(
    "core.elicitation-passive",
    "packages/core/src/elicitation/proposal-passive.ts",
    "elicitation proposal orchestration",
  ),
  integrationFile(
    "core.routing-matching",
    "packages/core/src/routing-matching.ts",
    "routing pattern matcher",
  ),
  integrationFile(
    "core.routing",
    "packages/core/src/routing.ts",
    "routing detector orchestration",
  ),
  integrationFile(
    "core.vector-resolution",
    "packages/core/src/vector-resolution.ts",
    "vector validation and resolution boundary",
  ),
  integrationFile(
    "core.bus-factor-signal",
    "packages/core/src/shared-02-bus-factor.ts",
    "shared bus-factor signal policy boundary",
  ),
  integrationFile(
    "core.churn-rate-signal",
    "packages/core/src/shared-03-churn-rate.ts",
    "shared churn-rate signal policy boundary",
  ),
  integrationFile(
    "ts.dependency-usage-aggregation",
    "packages/ts-pack/src/signals/ts-de-04-usage.ts",
    "TypeScript dependency usage fact aggregation",
  ),
  integrationFile(
    "ts.unfinished-output",
    "packages/ts-pack/src/signals/ts-sl-04-output.ts",
    "TypeScript unfinished-implementation output assembly",
  ),
  integrationPrefix("ts.unfinished-implementations", "packages/ts-pack/src/signals/ts-sl-04-"),
  integrationPrefix("ts.size-distribution", "packages/ts-pack/src/signals/ts-ld-02-"),
  integrationPrefix("ts.unsafe-type-erosion", "packages/ts-pack/src/signals/ts-ld-07-"),
  integrationPrefix("ts.pr-size", "packages/ts-pack/src/signals/ts-rp-02-"),
  sharedContextualSuffix("signal-models", "-model.ts"),
  sharedContextualSuffix("signal-policies", "-policy.ts"),
  sharedContextualSuffix("signal-configs", "-config.ts"),
  sharedContextualFile("core.calibration-slots", "packages/core/src/calibration-slot-values.ts"),
  sharedContextualFile("self.calibration-module", ".pulsar/modules/pulsar-self.ts"),
  pureUtilityPrefix("ts.shared-compiler", "packages/ts-pack/src/signals/shared-compiler-"),
  pureUtilityFile("core.factor-paths", "packages/core/src/factor-policy-ledger.ts"),
  pureUtilityFile("core.architecture-role-compat", "packages/core/src/architectural-tier.ts"),
]

function integrationFile(
  id: string,
  file: string,
  boundary: string,
): ArchitectureRoleRule {
  return {
    id,
    role: "integration",
    boundary,
    matches: (path) => path.endsWith(file),
  }
}

function integrationPrefix(id: string, prefix: string): ArchitectureRoleRule {
  return {
    id,
    role: "integration",
    matches: (path) => path.includes(prefix),
  }
}

function sharedContextualFile(id: string, file: string): ArchitectureRoleRule {
  return {
    id,
    role: "shared_contextual",
    matches: (path) => path.endsWith(file),
  }
}

function sharedContextualSuffix(id: string, suffix: string): ArchitectureRoleRule {
  return {
    id,
    role: "shared_contextual",
    matches: (path) => path.endsWith(suffix),
  }
}

function pureUtilityFile(id: string, file: string): ArchitectureRoleRule {
  return {
    id,
    role: "pure_utility",
    matches: (path) => path.endsWith(file),
  }
}

function pureUtilityPrefix(id: string, prefix: string): ArchitectureRoleRule {
  return {
    id,
    role: "pure_utility",
    matches: (path) => path.includes(prefix),
  }
}

const normalizePath = (file: string): string => file.replaceAll("\\", "/")

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
