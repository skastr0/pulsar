/**
 * @skastr0/pulsar-ts-pack — TypeScript signal pack.
 */

export const TS_PACK_VERSION = "0.0.0" as const

export {
  CASING_PATTERNS,
  inferCasingPattern,
  isRecognizedCasingPattern,
  matchesCasingPattern,
  parseCasingPatternAlternatives,
  splitIdentifierTokens,
} from "./casing.js"
export type {
  IdentifierPattern,
  RecognizedCasingPattern,
} from "./casing.js"

export {
  TsPackageInfoLayer,
  TsPackageInfoTag,
  TsProjectLayer,
  TsProjectTag,
  makeTsProject,
  makeTsProjectWithOptions,
} from "./ts-project.js"
export type { TsProjectOptions } from "./ts-project.js"

export { discoverPackages } from "./discovery.js"
export type { PackageInfo, PackageManifest } from "./discovery.js"

export { TS_PACK_SIGNALS } from "./pack.js"
export { TsLd01 } from "./signals/ts-ld-01-complexity.js"
export { TsSl04 } from "./signals/ts-sl-04-empty-implementations.js"
