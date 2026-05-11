export const scoreThresholdViolationShare = (
  totalCount: number,
  violationCount: number,
): number => {
  if (totalCount === 0) return 1
  return Math.max(0, 1 - violationCount / totalCount)
}
