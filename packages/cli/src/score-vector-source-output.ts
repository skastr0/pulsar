import type { DiscoveredPulsarVector } from "./vector-discovery.js"

const UNCALIBRATED_SCORE_CONTEXT =
  "uncalibrated evidence, not a verdict"

export const scoreVectorSourceLines = (
  sourceLabel: string,
  trustBoundary: DiscoveredPulsarVector["trustBoundary"],
): ReadonlyArray<string> => [
  `  Vector Source: ${sourceLabel}`,
  ...(trustBoundary === "built-in-defaults"
    ? [`  Score Context: ${UNCALIBRATED_SCORE_CONTEXT}`]
    : []),
]
