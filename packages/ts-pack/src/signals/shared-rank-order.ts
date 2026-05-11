export const compareDescendingMetricByFile = (
  leftMetric: number,
  rightMetric: number,
  leftFile: string,
  rightFile: string,
): number => {
  if (rightMetric !== leftMetric) return rightMetric - leftMetric
  return leftFile.localeCompare(rightFile)
}
