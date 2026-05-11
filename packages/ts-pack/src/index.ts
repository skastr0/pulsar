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

export { TS_PACK_SIGNALS, TsLd01, TsSl04 } from "./pack.js"
