import { SignalContextTag, computeDiagnosticHash } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import { SignalFactorPolicyTag } from "@skastr0/pulsar-core/factors"
import { Effect } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { defaultTsSl04Config, TsSl04Config as TsSl04ConfigSchema } from "./ts-sl-04-config.js"
import type { TsSl04Config as TsSl04ConfigShape } from "./ts-sl-04-config.js"
import {
  TsSl04FactorDefinitions,
  stubKindFactorPath,
} from "./ts-sl-04-factors.js"
import type { TsSl04Output } from "./ts-sl-04-model.js"
import { computeTsSl04Output } from "./ts-sl-04-output.js"

const TsSl04Config = TsSl04ConfigSchema
type TsSl04Config = TsSl04ConfigShape

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04-unfinished-implementations",
  title: "Unfinished implementations",
  aliases: ["TS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "factor-policy-v1",
  configSchema: TsSl04Config,
  defaultConfig: defaultTsSl04Config,
  factorDefinitions: TsSl04FactorDefinitions,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const factorPolicy = yield* Effect.serviceOption(SignalFactorPolicyTag)
      return yield* computeTsSl04Output(config, {
        project,
        context,
        calibration,
        factorPolicy,
      })
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    if (out.productionStubs.length === 0) return 1
    const weightedProductionStubs = out.productionStubs.reduce(
      (sum, stub) => sum + stub.penaltyWeight,
      0,
    )
    const baseScore = Math.max(0, 1 - Math.min(1, weightedProductionStubs / out.expectedCleanBudget))
    const scoreCaps = out.productionStubs.flatMap((stub) =>
      stub.scoreCapParticipation && stub.scoreCap !== undefined ? [stub.scoreCap] : [],
    )
    return scoreCaps.length > 0 ? Math.min(baseScore, ...scoreCaps) : baseScore
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    const topN = out.stubs.filter((stub) => stub.visible).slice(0, out.diagnosticLimit)

    for (const stub of topN) {
      diagnostics.push({
        severity: stub.severity,
        message: `${stub.name}: ${stub.kind} (${stub.confidence} confidence)${stub.message ? ` — "${stub.message}"` : ""}`,
        location: { file: stub.file, line: stub.line },
        data: {
          hash: computeDiagnosticHash(`${stub.file}:${stub.line}:${stub.kind}`),
          kind: stub.kind,
          confidence: stub.confidence,
          penaltyWeight: stub.penaltyWeight,
          scoreCapParticipation: stub.scoreCapParticipation,
          scoreCap: stub.scoreCap,
          factorPaths: [
            stubKindFactorPath(stub.kind, "confidence"),
            stubKindFactorPath(stub.kind, "penalty_weight"),
            stubKindFactorPath(stub.kind, "score_cap_participation"),
            stubKindFactorPath(stub.kind, "score_cap"),
          ],
          inTestPath: stub.inTestPath,
          message: stub.message,
        },
      })
    }

    return diagnostics
  },
  factorLedger: (out) => out.factorLedger,
}
