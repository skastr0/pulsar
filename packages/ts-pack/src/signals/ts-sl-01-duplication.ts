import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { computeTsSl01Output } from "./ts-sl-01-compute.js"
import {
  TsSl01Config,
  type TsSl01Output,
} from "./ts-sl-01-model.js"
import {
  cloneGroupImpact,
  cloneGroupSeverity,
  cloneMemberSummary,
} from "./ts-sl-01-policy.js"

export { TsSl01Config } from "./ts-sl-01-model.js"
export type {
  CloneGroup,
  CloneGroupMember,
  TsSl01Output,
} from "./ts-sl-01-model.js"

export const TsSl01: Signal<TsSl01Config, TsSl01Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-01-duplication",
  title: "Duplication",
  aliases: ["TS-SL-01"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "historical-migration-impact-v1",
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
    min_tokens: 12,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.try({
        try: () => computeTsSl01Output(project, context, config),
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-01-duplication", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const minTokens = out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens
    const penalty = out.groups.reduce(
      (sum, group) => sum + cloneGroupImpact(group, out.scopeMode, minTokens),
      0,
    )
    if (penalty === 0) return 1
    const expectedCleanBudget = Math.max(80, out.scoreBudgetFunctions * 0.12)
    return Math.max(0, 1 - Math.min(1, penalty / expectedCleanBudget))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.groups
      .filter((group) => cloneGroupImpact(
        group,
        out.scopeMode,
        out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
      ) > 0)
      .slice(0, out.diagnosticLimit ?? 10)
      .map((group) => ({
      severity: cloneGroupSeverity(
        group,
        out.scopeMode,
        out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
      ),
      message:
        `${group.kind} clone group with ${group.members.length} members (${group.tokenCount} tokens): ` +
        cloneMemberSummary(group.members),
      location: {
        file: group.members[0]?.file ?? "unknown",
        line: group.members[0]?.startLine,
      },
      data: {
        groupId: group.groupId,
        kind: group.kind,
        tokenCount: group.tokenCount,
        members: group.members,
        structuralHash: group.structuralHash,
      },
    })),
}
