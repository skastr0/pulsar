import {
  Shared02BusFactor,
  Shared03ChurnRate,
  SharedChurn01,
  type AnySignal,
} from "@skastr0/pulsar-core"
import { Shared05Suppression } from "./shared-05-suppression.js"
import { Shared06PrDepDelta } from "./shared-06-pr-dep-delta.js"

const SHARED_PACK_CACHE_VERSION =
  "shared-pack-2026-05-06-applicability-1"

const withSharedPackCacheVersion = <S extends AnySignal>(signal: S): S => ({
  ...signal,
  cacheVersion:
    signal.cacheVersion === undefined
      ? SHARED_PACK_CACHE_VERSION
      : `${SHARED_PACK_CACHE_VERSION}:${signal.cacheVersion}`,
})

export const SHARED_SIGNALS: ReadonlyArray<AnySignal> = [
  SharedChurn01,
  Shared02BusFactor,
  Shared03ChurnRate,
  Shared05Suppression,
  Shared06PrDepDelta,
].map(withSharedPackCacheVersion)
