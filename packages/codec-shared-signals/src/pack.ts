import {
  Shared02BusFactor,
  Shared03ChurnRate,
  SharedChurn01,
  type AnySignal,
} from "@taste-codec/core"
import { Shared05Suppression } from "./shared-05-suppression.js"
import { Shared06PrDepDelta } from "./shared-06-pr-dep-delta.js"

const SHARED_PACK_CACHE_VERSION =
  "shared-pack-2026-05-04-bus-factor-score-calibration-1"

const withSharedPackCacheVersion = <S extends AnySignal>(signal: S): S => ({
  ...signal,
  cacheVersion: SHARED_PACK_CACHE_VERSION,
})

export const SHARED_SIGNALS: ReadonlyArray<AnySignal> = [
  SharedChurn01,
  Shared02BusFactor,
  Shared03ChurnRate,
  Shared05Suppression,
  Shared06PrDepDelta,
].map(withSharedPackCacheVersion)
