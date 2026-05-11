export {
  computeDiagnosticHash,
  type Diagnostic,
} from "./diagnostic.js"
export {
  decodeGlossaryDraftSync,
  decodeGlossarySync,
  type CanonicalGlossaryTerm,
  type Glossary,
  type GlossaryDraft,
  type GlossaryIdentifierKind,
  type GlossaryProvenance,
} from "./glossary.js"
export {
  decodeSchemaConventionsSync,
  type BoundaryConvention,
  type NamingConventions,
  type SchemaConventions,
} from "./conventions.js"
export {
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  CANONICAL_GLOSSARY_RELATIVE_PATH,
  loadCanonicalReferenceDataEntries,
} from "./reference-data-loader.js"
export {
  ReferenceDataTag,
  makeReferenceData,
  type ReferenceData,
} from "./context.js"
