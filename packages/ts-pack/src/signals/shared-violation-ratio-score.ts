interface ViolationRatioScoreInput {
  readonly referenceDataStatus: "loaded" | "missing"
  readonly violationCount: number
  readonly totalCount: number
}

export const scoreReferenceBackedViolationRatio = ({
  referenceDataStatus,
  violationCount,
  totalCount,
}: ViolationRatioScoreInput): number => {
  if (referenceDataStatus === "missing" || totalCount === 0) return 1
  return Math.max(0, 1 - violationCount / totalCount)
}
