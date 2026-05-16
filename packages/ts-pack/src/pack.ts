import type { AnySignal } from "@skastr0/pulsar-core/signal"
import { withConfigFactorLedger } from "@skastr0/pulsar-core/factors"
import { TsAb01 } from "./signals/ts-ab-01-public-export-surface.js"
import { TsAb02 } from "./signals/ts-ab-02-unused-exports-reachability.js"
import { TsAb03 } from "./signals/ts-ab-03-type-indirection-depth.js"
import { TsAb04 } from "./signals/ts-ab-04-interface-impl-ratio.js"
import { TsAb05 } from "./signals/ts-ab-05-generic-proliferation.js"
import { TsAd01 } from "./signals/ts-ad-01-boundary-violations.js"
import { TsAd02 } from "./signals/ts-ad-02-circular-deps.js"
import { TsAd03 } from "./signals/ts-ad-03-reexport-depth.js"
import { TsAd04 } from "./signals/ts-ad-04-boundary-parser-coverage.js"
import { TsAd05 } from "./signals/ts-ad-05-boundary-trust-breach.js"
import { TsDe01 } from "./signals/ts-de-01-type-level-coupling.js"
import { TsDe02 } from "./signals/ts-de-02-fan-in-out.js"
import { TsDe03 } from "./signals/ts-de-03-propagation-cost.js"
import { TsDe04 } from "./signals/ts-de-04-package-dependency-health.js"
import { TsDe05 } from "./signals/ts-de-05-duplicate-versions.js"
import { TsLd01 } from "./signals/ts-ld-01-complexity.js"
import { TsLd02 } from "./signals/ts-ld-02-size-distribution.js"
import { TsLd03 } from "./signals/ts-ld-03-nesting-depth.js"
import { TsLd04 } from "./signals/ts-ld-04-naming-conventions.js"
import { TsLd05 } from "./signals/ts-ld-05-domain-term-consistency.js"
import { TsLd06 } from "./signals/ts-ld-06-annotation-coverage.js"
import { TsLd07 } from "./signals/ts-ld-07-unsafe-type-erosion.js"
import { TsLd08 } from "./signals/ts-ld-08-exhaustiveness-erosion.js"
import { TsRp01 } from "./signals/ts-rp-01-hotspots.js"
import { TsSl01 } from "./signals/ts-sl-01-duplication.js"
import { TsSl02 } from "./signals/ts-sl-02-inconsistent-clones.js"
import { TsSl03 } from "./signals/ts-sl-03-suppressions.js"
import { TsSl04 } from "./signals/ts-sl-04-empty-implementations.js"
import { TsRp02 } from "./signals/ts-rp-02-pr-size.js"

const TS_PACK_CACHE_VERSION =
  "ts-pack-2026-05-06-local-pressure-1"

const withTsPackCacheVersion = <S extends AnySignal>(signal: S): S => ({
  ...signal,
  cacheVersion:
    signal.cacheVersion === undefined
      ? TS_PACK_CACHE_VERSION
      : `${TS_PACK_CACHE_VERSION}:${signal.cacheVersion}`,
})

/**
 * The TypeScript-only signal pack. Compose this with `SHARED_SIGNALS`
 * from @skastr0/pulsar-shared-signals so compound/shared ids are registered
 * exactly once across polyglot workspaces.
 */
export const TS_PACK_SIGNALS: ReadonlyArray<AnySignal> = [
  TsLd01,
  TsLd02,
  TsLd03,
  TsLd04,
  TsLd05,
  TsAd01,
  TsAd02,
  TsAd03,
  TsAd04,
  TsAd05,
  TsDe01,
  TsDe02,
  TsDe03,
  TsDe04,
  TsDe05,
  TsAb01,
  TsAb02,
  TsAb03,
  TsAb04,
  TsAb05,
  TsLd06,
  TsLd07,
  TsLd08,
  TsRp01,
  TsSl01,
  TsSl03,
  TsSl04,
  TsRp02,
  TsSl02,
].map(withTsPackCacheVersion)
  .map(withConfigFactorLedger)
