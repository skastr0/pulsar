import type { Category } from "@skastr0/pulsar-core/signal"

export const CATEGORY_LABELS: Record<Category, string> = {
  "architectural-drift": "Architectural Drift",
  "dependency-entropy": "Dependency Entropy",
  "abstraction-bloat": "Abstraction Bloat",
  "legibility-decay": "Legibility Decay",
  "generated-slop": "Generated Slop",
  "review-pain": "Review Pain",
  "security-risk": "Security Risk",
  "concurrency-safety": "Concurrency Safety",
  "behavior-preservation": "Behavior Preservation",
}

export const fixedWidthLabel = (value: string, width: number): string =>
  value.length > width ? value : value.padEnd(width, " ")

export const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export const formatLocation = (location: { readonly file: string; readonly line?: number }): string =>
  `${location.file}${location.line !== undefined ? `:${location.line}` : ""}`
