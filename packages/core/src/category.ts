import { Schema } from "effect"

export const CATEGORIES = [
  "architectural-drift",
  "dependency-entropy",
  "abstraction-bloat",
  "legibility-decay",
  "generated-slop",
  "review-pain",
  "security-risk",
  "concurrency-safety",
  "behavior-preservation",
] as const

export const Category = Schema.Literal(...CATEGORIES)
export type Category = typeof Category.Type

export const categoryRecord = <Value>(
  valueOf: (category: Category) => Value,
): Record<Category, Value> =>
  Object.fromEntries(
    CATEGORIES.map((category) => [category, valueOf(category)]),
  ) as Record<Category, Value>
