import { Effect, Schema } from "effect"
import type { Diagnostic, Signal } from "@taste-codec/core"

export const Shared06PrDepDeltaConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type Shared06PrDepDeltaConfig = typeof Shared06PrDepDeltaConfig.Type

interface TsPrDeltaLike {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly newCrossPackageEdges: ReadonlyArray<unknown>
  readonly newCrossBoundaryEdges: ReadonlyArray<unknown>
}

interface RsPrDeltaLike {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly newCrossCrateEdges: ReadonlyArray<unknown>
}

export interface Shared06PrDepDeltaOutput {
  readonly totalNewDependencyEdges: number
  readonly crossBoundaryEdges: number
  readonly crossPackageEdges: number
  readonly crossCrateEdges: number
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly byLanguage: {
    readonly typescript?: {
      readonly newDependencyEdges: number
      readonly linesAdded: number
      readonly linesDeleted: number
    }
    readonly rust?: {
      readonly newDependencyEdges: number
      readonly linesAdded: number
      readonly linesDeleted: number
    }
  }
}

export const Shared06PrDepDelta: Signal<Shared06PrDepDeltaConfig, Shared06PrDepDeltaOutput> = {
  id: "SHARED-06",
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  configSchema: Shared06PrDepDeltaConfig,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [{ id: "TS-RP-02", optional: true }, { id: "RS-RP-03", optional: true }],
  compute: (_config, inputs) =>
    Effect.sync(() => {
      const ts = inputs.get("TS-RP-02") as TsPrDeltaLike | undefined
      const rs = inputs.get("RS-RP-03") as RsPrDeltaLike | undefined
      const tsDependencyEdges =
        (ts?.newCrossPackageEdges.length ?? 0) + (ts?.newCrossBoundaryEdges.length ?? 0)
      const rsDependencyEdges = rs?.newCrossCrateEdges.length ?? 0

      return {
        totalNewDependencyEdges: tsDependencyEdges + rsDependencyEdges,
        crossBoundaryEdges: ts?.newCrossBoundaryEdges.length ?? 0,
        crossPackageEdges: ts?.newCrossPackageEdges.length ?? 0,
        crossCrateEdges: rs?.newCrossCrateEdges.length ?? 0,
        linesAdded: (ts?.linesAdded ?? 0) + (rs?.linesAdded ?? 0),
        linesDeleted: (ts?.linesDeleted ?? 0) + (rs?.linesDeleted ?? 0),
        byLanguage: {
          ...(ts !== undefined
            ? {
                typescript: {
                  newDependencyEdges: tsDependencyEdges,
                  linesAdded: ts.linesAdded,
                  linesDeleted: ts.linesDeleted,
                },
              }
            : {}),
          ...(rs !== undefined
            ? {
                rust: {
                  newDependencyEdges: rsDependencyEdges,
                  linesAdded: rs.linesAdded,
                  linesDeleted: rs.linesDeleted,
                },
              }
            : {}),
        },
      }
    }),
  score: (out) => {
    if (out.totalNewDependencyEdges === 0) return 1
    const edgePenalty =
      out.crossBoundaryEdges * 0.2 + out.crossPackageEdges * 0.1 + out.crossCrateEdges * 0.15
    return Math.max(0, 1 - edgePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => [
    {
      severity: out.totalNewDependencyEdges > 0 ? ("warn" as const) : ("info" as const),
      message: `Cross-language PR dependency delta: ${out.totalNewDependencyEdges} new dependency edges (+${out.linesAdded} / -${out.linesDeleted})`,
      data: {
        totalNewDependencyEdges: out.totalNewDependencyEdges,
        crossBoundaryEdges: out.crossBoundaryEdges,
        crossPackageEdges: out.crossPackageEdges,
        crossCrateEdges: out.crossCrateEdges,
      },
    },
  ],
}
