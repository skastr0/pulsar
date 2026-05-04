import type { AnySignal } from "@taste-codec/core"
import { TsAb01 } from "./signals/ts-ab-01-public-export-surface.js"
import { TsAb02 } from "./signals/ts-ab-02-unused-exports-reachability.js"
import { TsAb03 } from "./signals/ts-ab-03-type-indirection-depth.js"
import { TsAb04 } from "./signals/ts-ab-04-interface-impl-ratio.js"
import { TsAb05 } from "./signals/ts-ab-05-generic-proliferation.js"
import { TsAd01 } from "./signals/ts-ad-01-boundary-violations.js"
import { TsAd02 } from "./signals/ts-ad-02-circular-deps.js"
import { TsAd03 } from "./signals/ts-ad-03-reexport-depth.js"
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
import { TsRp01 } from "./signals/ts-rp-01-hotspots.js"
import { TsSl01 } from "./signals/ts-sl-01-duplication.js"
import { TsSl02 } from "./signals/ts-sl-02-inconsistent-clones.js"
import { TsSl03 } from "./signals/ts-sl-03-suppressions.js"
import { TsSl04 } from "./signals/ts-sl-04-empty-implementations.js"
import { TsRp02 } from "./signals/ts-rp-02-pr-size.js"

const TS_PACK_CACHE_VERSION =
  "ts-pack-2026-05-03-ld06-de04-ad02-severity-calibration-3"

const withTsPackCacheVersion = <S extends AnySignal>(signal: S): S => ({
  ...signal,
  cacheVersion: TS_PACK_CACHE_VERSION,
})

/**
 * The TypeScript-only signal pack. Compose this with `SHARED_SIGNALS`
 * from @taste-codec/shared-signals so compound/shared ids are registered
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
  TsRp01,
  TsSl01,
  TsSl03,
  TsSl04,
  TsRp02,
  TsSl02,
].map(withTsPackCacheVersion)

export { TsLd01 } from "./signals/ts-ld-01-complexity.js"
export { TsLd02 } from "./signals/ts-ld-02-size-distribution.js"
export { TsLd03 } from "./signals/ts-ld-03-nesting-depth.js"
export { TsLd04 } from "./signals/ts-ld-04-naming-conventions.js"
export { TsLd05 } from "./signals/ts-ld-05-domain-term-consistency.js"
export { TsAd01 } from "./signals/ts-ad-01-boundary-violations.js"
export { TsAd02 } from "./signals/ts-ad-02-circular-deps.js"
export { TsAd03 } from "./signals/ts-ad-03-reexport-depth.js"
export { TsDe01 } from "./signals/ts-de-01-type-level-coupling.js"
export { TsDe02 } from "./signals/ts-de-02-fan-in-out.js"
export { TsDe03 } from "./signals/ts-de-03-propagation-cost.js"
export { TsDe04 } from "./signals/ts-de-04-package-dependency-health.js"
export { TsDe05 } from "./signals/ts-de-05-duplicate-versions.js"
export { TsAb01 } from "./signals/ts-ab-01-public-export-surface.js"
export { TsAb02 } from "./signals/ts-ab-02-unused-exports-reachability.js"
export { TsAb03 } from "./signals/ts-ab-03-type-indirection-depth.js"
export { TsAb04 } from "./signals/ts-ab-04-interface-impl-ratio.js"
export { TsAb05 } from "./signals/ts-ab-05-generic-proliferation.js"
export { TsLd06 } from "./signals/ts-ld-06-annotation-coverage.js"
export { SharedChurn01 } from "./signals/shared-churn-01.js"
export { Shared02BusFactor } from "./signals/shared-02-bus-factor.js"
export { Shared03ChurnRate } from "./signals/shared-03-churn-rate.js"
export { TsRp01 } from "./signals/ts-rp-01-hotspots.js"
export { TsSl01 } from "./signals/ts-sl-01-duplication.js"
export { TsSl02 } from "./signals/ts-sl-02-inconsistent-clones.js"
export { TsSl03 } from "./signals/ts-sl-03-suppressions.js"
export { TsSl04 } from "./signals/ts-sl-04-empty-implementations.js"
export { TsRp02 } from "./signals/ts-rp-02-pr-size.js"
