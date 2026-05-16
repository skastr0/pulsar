import {
  compositeSignalInputs,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  TS_RP_01_COMPOSITE_INPUTS,
  computeHotspotOutput,
  scoreHotspotOutput,
  type Hotspot,
  type HotspotOutput,
  type Quadrant,
} from "./ts-rp-01-hotspot-model.js"

const TsRp01Config = Schema.Struct({
  top_n: Schema.Number,
  min_churn: Schema.Number,
  min_complexity: Schema.Number,
  threshold_softness: Schema.Number,
  peer_percentile_floor: Schema.Number,
})
type TsRp01Config = typeof TsRp01Config.Type

type TsRp01Output = HotspotOutput

/**
 * TS-RP-01 — churn × complexity hotspots.
 *
 * The best-validated compound metric in the literature. Combines
 * TS-LD-01 (per-file avg complexity) with SHARED-CHURN-01 (per-file
 * commit count). The score now uses soft threshold weighting plus a
 * continuous top-right pressure measure so small repos do not collapse
 * into a single threshold-crossing step function.
 */
export const TsRp01: Signal<TsRp01Config, TsRp01Output, never> = {
  id: "TS-RP-01-hotspots",
  title: "Hotspots",
  aliases: ["TS-RP-01"],
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  cacheVersion: "risk-hotspot-v2-composite-policy-v1",
  configSchema: TsRp01Config,
  defaultConfig: {
    top_n: 10,
    min_churn: 2,
    min_complexity: 5,
    threshold_softness: 0.5,
    peer_percentile_floor: 0.5,
  },
  inputs: compositeSignalInputs(TS_RP_01_COMPOSITE_INPUTS),
  compute: (config, inputs) =>
    Effect.sync(() => computeHotspotOutput(config, inputs)),
  score: scoreHotspotOutput,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const top = out.hotspots
      .slice(0, out.diagnosticLimit ?? 10)
      .sort(compareDiagnosticHotspots)
    return top.map((h, index) => ({
      severity: h.quadrant === "top-right" ? ("warn" as const) : ("info" as const),
      message:
        `Hotspot #${index + 1}: ${formatHotspotPath(h.file)} ` +
        `(churn=${h.churn}, complexity=${h.complexity.toFixed(1)}, ${h.quadrant})`,
      location: { file: h.file },
      data: {
        churn: h.churn,
        complexity: h.complexity,
        ...(h.weightedChurn !== undefined ? { weightedChurn: h.weightedChurn } : {}),
        ...(h.ownershipRisk !== undefined ? { ownershipRisk: h.ownershipRisk } : {}),
        ...(h.coverageGap !== undefined ? { coverageGap: h.coverageGap } : {}),
        ...(h.cochangeRisk !== undefined ? { cochangeRisk: h.cochangeRisk } : {}),
        ...(h.riskFactors !== undefined ? { riskFactors: h.riskFactors } : {}),
        hotspotScore: h.hotspotScore,
        quadrant: h.quadrant,
        rank: h.rank,
        diagnosticRank: index + 1,
        displayFile: formatHotspotPath(h.file),
      },
    }))
  },
}

const HOTSPOT_PATH_MARKERS = [
  "/packages/",
  "/extensions/",
  "/apps/",
  "/src/",
  "/ui/",
  "/server/",
  "/cli/",
] as const

const formatHotspotPath = (file: string): string => {
  for (const marker of HOTSPOT_PATH_MARKERS) {
    const index = file.indexOf(marker)
    if (index !== -1) return file.slice(index + 1)
  }
  return file
}

const compareDiagnosticHotspots = (left: Hotspot, right: Hotspot): number => {
  const severityDelta = hotspotSeverityRank(left) - hotspotSeverityRank(right)
  if (severityDelta !== 0) return severityDelta
  return left.rank - right.rank
}

const hotspotSeverityRank = (hotspot: Hotspot): number =>
  hotspot.quadrant === "top-right" ? 0 : 1
