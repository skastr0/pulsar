interface RustAnalysisOutputMetadataInput {
  readonly sourceFileCount: number
  readonly analyzedItemCount: number
  readonly evidenceItemCount: number
  readonly evidenceReady?: boolean
}

export const rustAnalysisOutputMetadata = (
  input: RustAnalysisOutputMetadataInput,
): { readonly applicability: "insufficient_evidence" | "not_applicable" } | undefined => {
  if (input.sourceFileCount === 0 || input.evidenceReady === false) {
    return { applicability: "insufficient_evidence" }
  }
  if (input.analyzedItemCount === 0 || input.evidenceItemCount === 0) {
    return { applicability: "not_applicable" }
  }
  return undefined
}

interface RustAnalyzedFunctionOutputMetadataInput {
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly analyzedFunctionCount: number
}

export const rustAnalyzedFunctionOutputMetadata = (
  input: RustAnalyzedFunctionOutputMetadataInput,
): { readonly applicability: "insufficient_evidence" | "not_applicable" } | undefined =>
  rustAnalysisOutputMetadata({
    sourceFileCount: input.sourceFileCount,
    analyzedItemCount: input.analyzedSourceFileCount,
    evidenceItemCount: input.analyzedFunctionCount,
  })
