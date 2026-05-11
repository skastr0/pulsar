import { compareSourceLocations } from "./source-location-order.js"

interface SourceLocationLike {
  readonly file: string
  readonly line?: number | undefined
}

type SortFieldValue = string | number
type SortFieldSelector<T> = (value: T) => SortFieldValue

const compareSortFieldValues = (a: SortFieldValue, b: SortFieldValue): number => {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

export const compareSourceLocationThenFields = <T extends SourceLocationLike>(
  a: T,
  b: T,
  fields: ReadonlyArray<SortFieldSelector<T>>,
): number => {
  const locationOrder = compareSourceLocations(a, b)
  if (locationOrder !== 0) return locationOrder

  for (const field of fields) {
    const fieldOrder = compareSortFieldValues(field(a), field(b))
    if (fieldOrder !== 0) return fieldOrder
  }

  return 0
}
