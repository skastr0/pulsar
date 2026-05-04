import { Effect, Schema } from "effect"
import type { Diagnostic, Signal } from "@taste-codec/core"

export const Shared05SuppressionConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type Shared05SuppressionConfig = typeof Shared05SuppressionConfig.Type

interface TsSuppressionLike {
  readonly suppressions: ReadonlyArray<unknown>
  readonly unjustifiedCount: number
  readonly expiredCount: number
  readonly missingJustificationCount: number
}

interface RsSuppressionLike {
  readonly suppressions: ReadonlyArray<unknown>
  readonly missingJustificationCount: number
  readonly expiredJustificationCount: number
}

export interface Shared05SuppressionOutput {
  readonly totalSuppressions: number
  readonly languageCount: number
  readonly unjustifiedCount: number
  readonly missingJustificationCount: number
  readonly expiredJustificationCount: number
  readonly byLanguage: {
    readonly typescript?: {
      readonly totalSuppressions: number
      readonly unjustifiedCount: number
    }
    readonly rust?: {
      readonly totalSuppressions: number
      readonly unjustifiedCount: number
    }
  }
}

export const Shared05Suppression: Signal<Shared05SuppressionConfig, Shared05SuppressionOutput> = {
  id: "SHARED-05",
  tier: 1.5,
  category: "generated-slop",
  kind: "compound",
  configSchema: Shared05SuppressionConfig,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [{ id: "TS-SL-03", optional: true }, { id: "RS-SL-02", optional: true }],
  compute: (_config, inputs) =>
    Effect.sync(() => {
      const ts = inputs.get("TS-SL-03") as TsSuppressionLike | undefined
      const rs = inputs.get("RS-SL-02") as RsSuppressionLike | undefined
      const rustUnjustified =
        (rs?.missingJustificationCount ?? 0) + (rs?.expiredJustificationCount ?? 0)
      const languageCount = [
        ts !== undefined && ts.suppressions.length > 0,
        rs !== undefined && rs.suppressions.length > 0,
      ].filter(Boolean).length

      return {
        totalSuppressions: (ts?.suppressions.length ?? 0) + (rs?.suppressions.length ?? 0),
        languageCount,
        unjustifiedCount: (ts?.unjustifiedCount ?? 0) + rustUnjustified,
        missingJustificationCount:
          (ts?.missingJustificationCount ?? 0) + (rs?.missingJustificationCount ?? 0),
        expiredJustificationCount:
          (ts?.expiredCount ?? 0) + (rs?.expiredJustificationCount ?? 0),
        byLanguage: {
          ...(ts !== undefined
            ? {
                typescript: {
                  totalSuppressions: ts.suppressions.length,
                  unjustifiedCount: ts.unjustifiedCount,
                },
              }
            : {}),
          ...(rs !== undefined
            ? {
                rust: {
                  totalSuppressions: rs.suppressions.length,
                  unjustifiedCount: rustUnjustified,
                },
              }
            : {}),
        },
      }
    }),
  score: (out) => {
    if (out.languageCount < 2) return 1
    if (out.totalSuppressions === 0) return 1
    const penalty =
      out.expiredJustificationCount * 4 +
      out.missingJustificationCount +
      Math.max(0, out.totalSuppressions - out.unjustifiedCount) * 0.25
    return Math.max(0, 1 - penalty / 100)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = [
      {
        severity: out.languageCount >= 2 && out.unjustifiedCount > 0 ? ("warn" as const) : ("info" as const),
        message: `Suppression governance: ${out.unjustifiedCount} unjustified suppressions across ${out.totalSuppressions} total suppressions`,
        data: {
          totalSuppressions: out.totalSuppressions,
          languageCount: out.languageCount,
          unjustifiedCount: out.unjustifiedCount,
          missingJustificationCount: out.missingJustificationCount,
          expiredJustificationCount: out.expiredJustificationCount,
        },
      },
    ]

    if (out.byLanguage.typescript !== undefined) {
      diagnostics.push({
        severity: out.byLanguage.typescript.unjustifiedCount > 0 ? ("warn" as const) : ("info" as const),
        message: `TypeScript suppressions: ${out.byLanguage.typescript.unjustifiedCount} unjustified / ${out.byLanguage.typescript.totalSuppressions} total`,
      })
    }
    if (out.byLanguage.rust !== undefined) {
      diagnostics.push({
        severity: out.byLanguage.rust.unjustifiedCount > 0 ? ("warn" as const) : ("info" as const),
        message: `Rust suppressions: ${out.byLanguage.rust.unjustifiedCount} unjustified / ${out.byLanguage.rust.totalSuppressions} total`,
      })
    }

    return diagnostics
  },
}
