import { type AnySignal } from "@skastr0/pulsar-core/signal"
import {
  Shared02BusFactor,
  Shared03ChurnRate,
  SharedChurn01,
  SharedChurn02,
  SharedCochange01,
} from "@skastr0/pulsar-core/shared-signals"
import { withConfigFactorLedger } from "@skastr0/pulsar-core/factors"
import { Shared05Suppression } from "./shared-05-suppression.js"
import { Shared06PrDepDelta } from "./shared-06-pr-dep-delta.js"
import { Shared07MachineFeedbackCoverage } from "./shared-07-machine-feedback-coverage.js"
import { Shared09ContractFreshness } from "./shared-09-contract-freshness.js"
import { Shared10DomainConstructionControl } from "./shared-10-domain-construction-control.js"
import { SharedCov01CoverageFacts } from "./shared-cov-01-coverage-facts.js"

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
  SharedChurn02,
  SharedCochange01,
  Shared02BusFactor,
  Shared03ChurnRate,
  Shared05Suppression,
  Shared06PrDepDelta,
  Shared07MachineFeedbackCoverage,
  Shared09ContractFreshness,
  Shared10DomainConstructionControl,
  SharedCov01CoverageFacts,
].map(withSharedPackCacheVersion)
  .map(withConfigFactorLedger)
