import type { ChangedFileStat } from "./ts-rp-02-pr-size.js"

export const formatLargestFiles = (
  fileStats: ReadonlyArray<ChangedFileStat>,
  maxExamples = 3,
): string => {
  const examples = fileStats.slice(0, maxExamples)
  if (examples.length === 0) return ""
  const remaining = Math.max(0, fileStats.length - examples.length)
  const suffix = remaining > 0 ? ` (+${remaining} more)` : ""
  return `; largest files: ${examples.map(formatFileStat).join(", ")}${suffix}`
}

const formatFileStat = (stat: ChangedFileStat): string =>
  `${stat.file} (+${stat.linesAdded}/-${stat.linesDeleted})`
