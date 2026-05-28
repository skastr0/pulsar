import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { errorChannelKindLabel } from "./ts-ld-09-finding.js"
import { computeErrorChannelOpacityOutput } from "./ts-ld-09-output.js"
import {
  TsLd09Config,
  type TsLd09Output,
} from "./ts-ld-09-types.js"

export const TsLd09: Signal<TsLd09Config, TsLd09Output, TsProjectTag> = {
  id: "TS-LD-09-error-channel-opacity",
  title: "Error channel opacity",
  aliases: ["TS-LD-09"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "ts-error-channel-opacity-v8-guarded-fallback-mapping-v1",
  configSchema: TsLd09Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.pi/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-utils/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/*test-utils.ts",
      "**/*test-utils.tsx",
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
      "**/fixtures/**",
    ],
    top_n_diagnostics: 10,
    max_weighted_opacity_per_kloc: 18,
    max_boundary_weighted_opacity: 36,
    expected_failure_name_patterns: [
      "parse",
      "decode",
      "load",
      "fetch",
      "read",
      "write",
      "request",
      "validate",
      "resolve",
    ],
  },
  configDirections: {
    max_weighted_opacity_per_kloc: "higher-is-looser",
    max_boundary_weighted_opacity: "higher-is-looser",
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsLd09Output =>
          computeErrorChannelOpacityOutput(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-09-error-channel-opacity",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.totalFindings === 0) return 1
    const pressure = Math.max(out.densityPressure, out.boundaryPressure)
    return 1 / (1 + pressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.topFindings.map((finding) => ({
      severity: finding.severity,
      message:
        `${errorChannelKindLabel(finding.kind)} in ` +
        `${finding.boundary ? "boundary " : ""}\`${finding.symbol}\``,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        ...finding,
        densityPerKloc: out.densityPerKloc,
        densityThreshold: out.densityThreshold,
        boundaryThreshold: out.boundaryThreshold,
      },
      fixHints: [{
        kind: "make-error-channel-explicit",
        title: "Expose the failure contract",
        summary:
          "Map unknown throws/rejections into a domain error, return a typed Result/Either/Effect error channel, or preserve the rejection instead of collapsing it.",
        confidence: "medium",
        autoApplicable: false,
        data: {
          kind: finding.kind,
          symbol: finding.symbol,
          boundary: finding.boundary,
        },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}
