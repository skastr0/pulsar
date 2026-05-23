import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import {
  factorPathSegment,
  relativeFactorPath,
} from "@skastr0/pulsar-core/factors"
import {
  CalibrationContextTag,
  type CalibrationDecision,
  type ResolvedCalibrationContext,
  type TypeScriptCloneGroupPolicyValue,
} from "@skastr0/pulsar-core/calibration"
import { Effect, Option } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { computeTsSl01Output } from "./ts-sl-01-compute.js"
import {
  DEFAULT_SCORE_BUDGET_MIN_TOKENS,
  DEFAULT_TS_SL_01_DIAGNOSTIC_LIMIT,
  type CloneGroup,
  TsSl01Config,
  type TsSl01Output,
  normalizeTsSl01DiagnosticLimit,
  normalizeTsSl01MinTokens,
} from "./ts-sl-01-model.js"
import { sortCloneGroups } from "./ts-sl-01-groups.js"
import {
  cloneGroupImpact,
  cloneGroupRepresentative,
  cloneGroupSeverity,
  cloneMemberSummary,
  sortCloneMembers,
} from "./ts-sl-01-policy.js"

export const TsSl01: Signal<TsSl01Config, TsSl01Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-01-duplication",
  title: "Duplication",
  aliases: ["TS-SL-01"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "exact-source-hunks-generic-defaults-v1",
  configSchema: TsSl01Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "sdk-samples/**",
      "**/sdk-samples/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    min_tokens: DEFAULT_SCORE_BUDGET_MIN_TOKENS,
    top_n_diagnostics: DEFAULT_TS_SL_01_DIAGNOSTIC_LIMIT,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const output = yield* Effect.try({
        try: () => computeTsSl01Output(project, context, config),
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-01-duplication", message: String(cause), cause }),
      })
      return yield* calibrateCloneOutput(output, calibration).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-SL-01-duplication",
            message: String(cause),
            cause,
          }),
        ),
      )
    }),
  score: (out) => {
    const minTokens = normalizeTsSl01MinTokens(
      out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
    )
    const impacts = out.groups.map((group) =>
      cloneGroupImpact(group, out.scopeMode, minTokens),
    )
    const penalty = impacts.reduce((sum, impact) => sum + impact, 0)
    if (penalty === 0) return 1
    const zeroImpactDuplicateMembers = out.groups.reduce(
      (sum, group, index) =>
        impacts[index] === 0 ? sum + group.members.length : sum,
      0,
    )
    const scoreBudgetFunctions = Math.max(
      0,
      out.scoreBudgetFunctions - zeroImpactDuplicateMembers,
    )
    const expectedCleanBudget = Math.max(80, scoreBudgetFunctions * 0.12)
    return Math.max(0, 1 - Math.min(1, penalty / expectedCleanBudget))
  },
  outputMetadata: (out) =>
    out.totalFunctionsAnalyzed === 0 ? { applicability: "not_applicable" as const } : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const minTokens = normalizeTsSl01MinTokens(
      out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
    )
    return sortCloneGroups(out.groups, out.scopeMode, minTokens)
      .filter((group) => cloneGroupImpact(
        group,
        out.scopeMode,
        minTokens,
      ) > 0)
      .slice(0, normalizeTsSl01DiagnosticLimit(
        out.diagnosticLimit ?? TsSl01.defaultConfig.top_n_diagnostics,
      ))
      .map((group) => ({
        severity: cloneGroupSeverity(
          group,
          out.scopeMode,
          minTokens,
        ),
        message:
          `${group.kind} clone group with ${group.members.length} members (${group.tokenCount} tokens): ` +
          cloneMemberSummary(group.members),
        location: {
          file: cloneGroupRepresentative(group)?.file ?? "unknown",
          line: cloneGroupRepresentative(group)?.startLine,
        },
        data: {
          groupId: group.groupId,
          kind: group.kind,
          tokenCount: group.tokenCount,
          members: group.members,
          structuralHash: group.structuralHash,
        },
      }))
  },
}

const calibrateCloneOutput = (
  output: TsSl01Output,
  calibration: Option.Option<ResolvedCalibrationContext>,
) =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) return output

    const groups: Array<CloneGroup> = []
    const decisions: Array<CalibrationDecision> = []
    for (const group of output.groups) {
      const result = yield* calibration.value.runSlot(
        "typescript.clone-group-policy",
        defaultCloneGroupPolicy(group, output, calibration.value),
      )
      decisions.push(...result.decisions)
      groups.push(withCloneGroupPolicy(group, result.value))
    }

    return {
      ...output,
      groups,
      calibrationDecisions: decisions,
    }
  })

const defaultCloneGroupPolicy = (
  group: CloneGroup,
  output: TsSl01Output,
  calibration: ResolvedCalibrationContext,
): TypeScriptCloneGroupPolicyValue => ({
  groupId: group.groupId,
  action: "keep",
  factor: 1,
  visible: true,
  severity: cloneGroupSeverity(
    group,
    output.scopeMode,
    normalizeTsSl01MinTokens(output.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens),
  ),
  penaltyWeight: 1,
  factorPathPrefix: `clones.${factorPathSegment(group.kind)}.${factorPathSegment(group.structuralHash)}.${factorPathSegment(
    relativeFactorPath(cloneGroupRepresentative(group)?.file ?? "unknown", calibration.repoFacts.repoRoot),
  )}`,
  members: sortCloneMembers(group.members),
  kind: group.kind,
  tokenCount: group.tokenCount,
})

const withCloneGroupPolicy = (
  group: CloneGroup,
  policy: TypeScriptCloneGroupPolicyValue,
): CloneGroup => ({
  ...group,
  members: sortCloneMembers(group.members),
  policy: {
    action: policy.action,
    factor: policy.factor,
    visible: policy.visible,
    severity: policy.severity,
    penaltyWeight: policy.penaltyWeight,
    ...(policy.metadata !== undefined ? { metadata: policy.metadata } : {}),
  },
})
