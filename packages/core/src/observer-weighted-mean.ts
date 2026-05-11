import { CATEGORIES, type Category } from "./category.js"
import type { CategoryOutput } from "./observer-model.js"

export const computeWeightedMean = (
  categories: Record<Category, CategoryOutput>,
): number => {
  let weightedSum = 0
  let totalCount = 0
  for (const category of CATEGORIES) {
    const entry = categories[category]
    const count = entry.applicableSignalCount ?? entry.signalCount
    if (count === 0) continue
    weightedSum += entry.score * count
    totalCount += count
  }
  if (totalCount === 0) return 1
  return weightedSum / totalCount
}
