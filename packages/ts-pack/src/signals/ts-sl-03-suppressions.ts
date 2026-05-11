import { SignalContextTag, computeDiagnosticHash, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { computeSuppressions } from "./ts-sl-03-analysis.js"
import { suppressionMessage } from "./ts-sl-03-justifications.js"

export const TsSl03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSl03Config = typeof TsSl03Config.Type

export interface Suppression {
  readonly file: string
  readonly line: number
  readonly kind: "ts-ignore" | "ts-expect-error" | "eslint-disable"
  readonly rule: string | undefined
  readonly justification: "active" | "expired" | "missing"
  readonly justificationSource: "bypass" | "inline" | "contextual" | undefined
  readonly bypassTicket: string | undefined
}

export interface TsSl03Output {
  readonly suppressions: ReadonlyArray<Suppression>
  readonly unjustifiedCount: number
  readonly expiredCount: number
  readonly missingJustificationCount: number
  readonly diagnosticLimit: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analyzedFileCount: number
}

export const TsSl03: Signal<TsSl03Config, TsSl03Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-03-suppressions",
  title: "Suppressions",
  aliases: ["TS-SL-03"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "generated-root-exclusions-v1",
  configSchema: TsSl03Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/_generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/Generated.ts",
      "**/Generated.tsx",
      "**/generated/**",
      "**/*.d.ts",
      "**/sst-env.d.ts",
      "docs/**",
      "**/docs/**",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "demo/**",
      "**/demo/**",
      "demos/**",
      "**/demos/**",
      "private-demos/**",
      "**/private-demos/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "sdk-samples/**",
      "**/sdk-samples/**",
      "google_samples/**",
      "**/google_samples/**",
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
      "**/*.tst.ts",
      "**/*.tst.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/dtslint/**",
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
      "**/*test_helpers.ts",
      "**/*test_helpers.tsx",
      "**/*.test_helpers.ts",
      "**/*.test_helpers.tsx",
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
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: () => Promise.resolve(computeSuppressions(project, context, config)),
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-03-suppressions", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.suppressions.length === 0) return 1
    const penalty =
      out.expiredCount * 4 +
      out.missingJustificationCount +
      (out.suppressions.length - out.unjustifiedCount) * 0.25
    const denominator =
      out.scopeMode === "changed-hunks"
        ? 25
        : Math.max(100, (out.analyzedFileCount ?? out.suppressions.length) * 0.25)
    const maxPenalty = out.scopeMode === "changed-hunks" ? 1 : 0.65
    return Math.max(0, 1 - Math.min(maxPenalty, penalty / denominator))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.suppressions.slice(0, out.diagnosticLimit).map((suppression) => {
      const isUnjustified = suppression.justification === "missing" || suppression.justification === "expired"
      return {
        severity: suppression.justification === "expired"
          ? ("block" as const)
          : isUnjustified
            ? ("warn" as const)
            : ("info" as const),
        message: suppressionMessage(suppression),
        location: { file: suppression.file, line: suppression.line },
        data: {
          hash: computeDiagnosticHash(`${suppression.file}:${suppression.line}:${suppression.kind}`),
          kind: suppression.kind,
          rule: suppression.rule,
          justification: suppression.justification,
          justificationSource: suppression.justificationSource,
          bypassTicket: suppression.bypassTicket,
        },
      }
    }),
}
