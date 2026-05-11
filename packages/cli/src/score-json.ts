import {
  type ObserverOutput,
  toObserverJson,
} from "@skastr0/pulsar-core/observer"
import type { DiscoveredPulsarVector } from "./vector-discovery.js"

export const toScoreJson = (
  output: ObserverOutput,
  vectorSelection: DiscoveredPulsarVector,
): ReturnType<typeof toObserverJson> & {
  readonly vector: {
    readonly id: string
    readonly source: DiscoveredPulsarVector["source"]
    readonly trust_boundary: DiscoveredPulsarVector["trustBoundary"]
    readonly source_label: string
    readonly path?: string
  }
} => ({
  ...toObserverJson(output),
  vector: {
    id: vectorSelection.label,
    source: vectorSelection.source,
    trust_boundary: vectorSelection.trustBoundary,
    source_label: vectorSelection.sourceLabel,
    ...(vectorSelection.path !== undefined ? { path: vectorSelection.path } : {}),
  },
})
