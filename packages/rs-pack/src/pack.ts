import { withConfigFactorLedger, type AnySignal } from "@skastr0/pulsar-core"
import { RsAd01 } from "./signals/rs-ad-01-visibility-surface.js"
import { RsAd02 } from "./signals/rs-ad-02-crate-boundaries.js"
import { RsAd03 } from "./signals/rs-ad-03-circular-crate-deps.js"
import { RsAb01 } from "./signals/rs-ab-01-unused-pub.js"
import { RsAb02 } from "./signals/rs-ab-02-trait-object-depth.js"
import { RsAb03 } from "./signals/rs-ab-03-generic-proliferation.js"
import { RsAb04 } from "./signals/rs-ab-04-derive-density.js"
import { RsDe01 } from "./signals/rs-de-01-trait-coupling.js"
import { RsDe02 } from "./signals/rs-de-02-dep-tree.js"
import { RsDe03 } from "./signals/rs-de-03-feature-flags.js"
import { RsDe04 } from "./signals/rs-de-04-fan-in-fan-out.js"
import { RsLd01 } from "./signals/rs-ld-01-unsafe.js"
import { RsLd02 } from "./signals/rs-ld-02-lifetimes.js"
import { RsLd03 } from "./signals/rs-ld-03-match-catch-all.js"
import { RsLd04 } from "./signals/rs-ld-04-error-granularity.js"
import { RsLd05 } from "./signals/rs-ld-05-complexity.js"
import { RsLd06 } from "./signals/rs-ld-06-domain-terms.js"
import { RsRp01 } from "./signals/rs-rp-01-hotspots.js"
import { RsRp02 } from "./signals/rs-rp-02-compile-time.js"
import { RsRp03 } from "./signals/rs-rp-03-pr-size.js"
import { RsSl01 } from "./signals/rs-sl-01-duplication.js"
import { RsSl02 } from "./signals/rs-sl-02-suppressions.js"
import { RsSl03 } from "./signals/rs-sl-03-unwrap-expect.js"
import { RsSl04 } from "./signals/rs-sl-04-clone-abuse.js"

/**
 * Rust signal implementations land in TC-053..TC-058.
 */
export const RS_PACK_SIGNALS: ReadonlyArray<AnySignal> = [
  RsAd01,
  RsAd02,
  RsAd03,
  RsDe01,
  RsDe02,
  RsDe03,
  RsDe04,
  RsAb01,
  RsAb02,
  RsAb03,
  RsAb04,
  RsLd01,
  RsLd02,
  RsLd03,
  RsLd04,
  RsLd05,
  RsLd06,
  RsSl01,
  RsSl02,
  RsSl03,
  RsSl04,
  RsRp01,
  RsRp02,
  RsRp03,
].map(withConfigFactorLedger)
