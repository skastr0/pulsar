import type { PulsarVector, PulsarVectorProvenanceEntry } from "./vector-schema.js"

export const appendVectorProvenance = (
  vector: PulsarVector,
  entry: PulsarVectorProvenanceEntry,
): PulsarVector => ({
  ...vector,
  provenance: [...(vector.provenance ?? []), entry],
})
