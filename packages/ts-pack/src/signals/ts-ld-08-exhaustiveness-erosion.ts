import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { SyntaxKind } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"

const TsLd08Config = Schema.Struct({
  min_case_clauses: Schema.Number,
  top_n_diagnostics: Schema.Number,
  exclude_globs: Schema.Array(Schema.String),
})
export type TsLd08Config = typeof TsLd08Config.Type

export interface ExhaustivenessErosionFinding {
  readonly file: string
  readonly line: number
  readonly expression: string
  readonly caseCount: number
  readonly defaultText: string
}

export interface TsLd08Output {
  readonly findings: ReadonlyArray<ExhaustivenessErosionFinding>
  readonly analyzedSwitches: number
  readonly findingCount: number
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsLd08: Signal<TsLd08Config, TsLd08Output, TsProjectTag> = {
  id: "TS-LD-08-exhaustiveness-erosion",
  title: "Exhaustiveness erosion",
  aliases: ["TS-LD-08"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "switch-default-v1",
  configSchema: TsLd08Config,
  defaultConfig: {
    min_case_clauses: 2,
    top_n_diagnostics: 10,
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
    ],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsLd08Output => {
          const findings: Array<ExhaustivenessErosionFinding> = []
          let analyzedSwitches = 0

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue
            for (const statement of sourceFile.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
              analyzedSwitches += 1
              const clauses = statement.getCaseBlock().getClauses()
              const caseCount = clauses.filter(
                (clause) => clause.getKind() === SyntaxKind.CaseClause,
              ).length
              const defaultClause = clauses.find(
                (clause) => clause.getKind() === SyntaxKind.DefaultClause,
              )
              if (defaultClause === undefined || caseCount < config.min_case_clauses) {
                continue
              }
              findings.push({
                file,
                line: statement.getStartLineNumber(),
                expression: statement.getExpression().getText(),
                caseCount,
                defaultText: defaultClause.getText().slice(0, 160),
              })
            }
          }

          return {
            findings: findings.sort(
              (left, right) =>
                right.caseCount - left.caseCount ||
                left.file.localeCompare(right.file) ||
                left.line - right.line,
            ),
            analyzedSwitches,
            findingCount: findings.length,
            topDiagnostics: Math.max(0, Math.floor(config.top_n_diagnostics)),
            compositeConsumers: [
              "contract safety gap",
              "boundary trust breach",
            ],
            cacheContributors: [
              "source tree",
              "config.min_case_clauses",
              "config.exclude_globs",
              "config.top_n_diagnostics",
            ],
            calibrationSurface: "config.min_case_clauses and config.exclude_globs",
            enforcementCeiling: ["soft-warning", "trend"],
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-08-exhaustiveness-erosion",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => out.findingCount === 0 ? 1 : 1 / (1 + out.findingCount / 10),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.topDiagnostics).map((finding) => ({
      severity: "warn",
      message:
        `Switch on \`${finding.expression}\` has a default branch after ` +
        `${finding.caseCount} explicit cases; new variants can be hidden`,
      location: { file: finding.file, line: finding.line },
        data: { ...finding },
      })),
  outputMetadata: (out) =>
    out.analyzedSwitches === 0 ? { applicability: "not_applicable" as const } : undefined,
}
