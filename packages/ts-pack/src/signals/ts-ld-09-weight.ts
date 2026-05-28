import type { ErrorChannelOpacityKind } from "./ts-ld-09-types.js"

const BASE_WEIGHT_BY_KIND: Record<ErrorChannelOpacityKind, number> = {
  "broad-throw": 2.5,
  "catch-without-narrowing": 3,
  "opaque-promise-api": 4,
  "promise-catch-collapse": 3,
  "effect-unknown-exception": 4,
  "effect-error-collapse": 3.5,
}

const BOUNDARY_MULTIPLIER = 2

export const errorChannelWeight = (
  kind: ErrorChannelOpacityKind,
  boundary: boolean,
): number => {
  const base = BASE_WEIGHT_BY_KIND[kind]
  return boundary ? base * BOUNDARY_MULTIPLIER : base
}
