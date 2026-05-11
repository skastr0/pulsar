export const scoreDoubleWeightedThresholdRatio = (
  overThresholdCount: number,
  totalCount: number,
): number => {
  if (totalCount === 0) return 1
  return Math.max(0, 1 - (overThresholdCount / totalCount) * 2)
}
