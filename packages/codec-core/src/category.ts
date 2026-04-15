import { Schema } from "effect"

export const CATEGORIES = [
  "architectural-drift",
  "dependency-entropy",
  "abstraction-bloat",
  "legibility-decay",
  "generated-slop",
  "review-pain",
] as const

export const Category = Schema.Literal(...CATEGORIES)
export type Category = typeof Category.Type
