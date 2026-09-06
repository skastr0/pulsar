/**
 * @skastr0/pulsar-ts-pack — TypeScript signal pack.
 */

export const TS_PACK_VERSION = "0.1.2" as const

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
  TsAnalysisLayer,
  TsAnalysisTag,
  makeTsAnalysisSession,
} from "./ts-analysis.js"
export type { TsProjectOptions } from "./ts-analysis.js"
export {
  textOf,
  walkDescendants,
} from "./ast.js"
export {
  isAsExpression,
  isCallExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isParameter,
  isSatisfiesExpression,
  isSourceFile,
  isTypeAliasDeclaration,
  isTypeAssertionExpression,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
} from "./tsgo-api.js"
export type {
  Node,
  SourceFile,
  VariableDeclaration,
} from "./tsgo-api.js"

export { discoverPackages } from "./discovery.js"
export type { PackageInfo, PackageManifest } from "./discovery.js"

export { TS_PACK_SIGNALS } from "./pack.js"
export { TsLd01 } from "./signals/ts-ld-01-complexity.js"
export { TsSl04 } from "./signals/ts-sl-04-empty-implementations.js"
export { TsSec01 } from "./signals/ts-sec-01-dangerous-capability-surface.js"
export { TsSec02 } from "./signals/ts-sec-02-untrusted-boundary-sinks.js"
export { TsSec03 } from "./signals/ts-sec-03-secret-material.js"
export { TsCc01 } from "./signals/ts-cc-01-async-failure-control.js"
export { TsCc02 } from "./signals/ts-cc-02-unbounded-concurrency.js"
export { TsBp01 } from "./signals/ts-bp-01-public-api-signature-diff.js"
export { TsSl05 } from "./signals/ts-sl-05-phantom-tests.js"
export { TsSl06 } from "./signals/ts-sl-06-confidence-claim-mismatch.js"
