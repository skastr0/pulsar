import {
  ScoringEngineLayer,
  ScoringEngineTag,
  buildRegistry,
  type Registry,
  type TasteVector,
} from "@taste-codec/core"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@taste-codec/ts-pack"
import { Effect } from "effect"

/**
 * Build a ready-to-use scoring engine for the default TS signal pack.
 * Wires registry, pack layer, and an optional taste vector in one place
 * so callers (`score`, `bisect`) don't reassemble the same stack.
 */
export const makeScoringEngine = (vector?: TasteVector) =>
  Effect.gen(function* () {
    const registry: Registry = yield* buildRegistry(TS_PACK_SIGNALS)
    const EngineLayer = ScoringEngineLayer(registry, TsProjectLayer, vector)
    return yield* Effect.provide(ScoringEngineTag, EngineLayer)
  })
