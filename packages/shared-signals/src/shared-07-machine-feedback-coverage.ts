import {
  SignalContextTag,
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  collectMachineFeedbackFacts,
  MACHINE_FEEDBACK_CLASSES,
  type MachineFeedbackClass,
  type MachineFeedbackFacts,
} from "./machine-feedback-facts.js"

const MachineFeedbackClassSchema = Schema.Literal(
  "build",
  "typecheck",
  "test",
  "static_analysis",
  "coverage",
)

export const Shared07MachineFeedbackCoverageConfig = Schema.Struct({
  required_classes: Schema.Array(MachineFeedbackClassSchema),
  top_n_diagnostics: Schema.Number,
})
export type Shared07MachineFeedbackCoverageConfig =
  typeof Shared07MachineFeedbackCoverageConfig.Type

export interface Shared07MachineFeedbackCoverageOutput extends MachineFeedbackFacts {
  readonly requiredClasses: ReadonlyArray<MachineFeedbackClass>
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const Shared07MachineFeedbackCoverage: Signal<
  Shared07MachineFeedbackCoverageConfig,
  Shared07MachineFeedbackCoverageOutput,
  SignalContextTag
> = {
  id: "SHARED-07-machine-feedback-coverage",
  title: "Machine feedback coverage",
  aliases: ["SHARED-07"],
  tier: 1,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "scripts-and-github-workflows-v2-yaml-parser-stable-fingerprint",
  configSchema: Shared07MachineFeedbackCoverageConfig,
  defaultConfig: {
    required_classes: ["build", "typecheck", "test", "static_analysis"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const normalizedConfig = normalizeShared07MachineFeedbackCoverageConfig(config)
      const facts = yield* Effect.tryPromise({
        try: () => collectMachineFeedbackFacts(ctx.worktreePath, normalizedConfig.required_classes),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-07-machine-feedback-coverage",
            message: `Failed to compute machine feedback coverage: ${String(cause)}`,
            cause,
          }),
      })
      return {
        ...facts,
        requiredClasses: normalizedConfig.required_classes,
        topDiagnostics: normalizedConfig.top_n_diagnostics,
        compositeConsumers: [
          "AI quicksand risk",
          "contract safety gap",
          "review shock",
        ],
        cacheContributors: [
          "package.json",
          ".github/workflows/*.yml",
          ".github/workflows/*.yaml",
          "config.required_classes",
          "config.top_n_diagnostics",
        ],
        calibrationSurface: "config.required_classes; project-module policy slot not required for this fact provider",
        enforcementCeiling: ["soft-warning", "trend"],
      }
    }),
  score: () => 1,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const required = new Set(out.requiredClasses)
    return out.classes
      .filter((entry) =>
        required.has(entry.class) || entry.state === "present" || entry.state === "unknown"
      )
      .sort((left, right) =>
        diagnosticRank(left, required) - diagnosticRank(right, required) ||
        classRank(left.class) - classRank(right.class)
      )
      .slice(0, out.topDiagnostics)
      .map((entry) => ({
        severity: machineFeedbackSeverity(entry, required),
        message:
          `Machine feedback ${entry.class}: ${entry.state}` +
          (entry.ciReachable ? " (CI reachable)" : ""),
        data: {
          class: entry.class,
          state: entry.state,
          localCommands: entry.localCommands,
          ciReachable: entry.ciReachable,
          evidence: entry.evidence,
        },
      }))
  },
  outputMetadata: () => ({ applicability: "not_applicable" as const }),
}

const normalizeShared07MachineFeedbackCoverageConfig = (
  config: Shared07MachineFeedbackCoverageConfig,
): Shared07MachineFeedbackCoverageConfig => ({
  required_classes: MACHINE_FEEDBACK_CLASSES.filter((feedbackClass) =>
    config.required_classes.includes(feedbackClass),
  ),
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const machineFeedbackSeverity = (
  entry: MachineFeedbackFacts["classes"][number],
  required: ReadonlySet<MachineFeedbackClass>,
): Diagnostic["severity"] =>
  entry.state === "unknown" || (required.has(entry.class) && entry.state === "absent")
    ? "warn"
    : "info"

const diagnosticRank = (
  entry: MachineFeedbackFacts["classes"][number],
  required: ReadonlySet<MachineFeedbackClass>,
): number => machineFeedbackSeverity(entry, required) === "warn" ? 0 : 1

const classRank = (feedbackClass: MachineFeedbackClass): number =>
  MACHINE_FEEDBACK_CLASSES.indexOf(feedbackClass)
