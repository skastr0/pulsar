import { tokenizeIdentifier } from "./rust-analysis-syntax.js"
import type { RustIdentifierFact } from "./rust-analysis-types.js"

export const addRustIdentifierFact = (
  identifiers: Array<RustIdentifierFact>,
  fact: Omit<RustIdentifierFact, "tokens">,
): void => {
  identifiers.push({ ...fact, tokens: tokenizeIdentifier(fact.name) })
}
