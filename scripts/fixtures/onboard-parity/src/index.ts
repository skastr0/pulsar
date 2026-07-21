export const classifyRelease = (
  changedFiles: number,
  failingChecks: number,
  hasRollback: boolean,
): string => {
  let pressure = 0
  if (changedFiles > 1) pressure += 1
  if (changedFiles > 3) pressure += 1
  if (changedFiles > 5) pressure += 1
  if (changedFiles > 8) pressure += 1
  if (changedFiles > 13) pressure += 1
  if (failingChecks > 0) pressure += 2
  if (failingChecks > 1) pressure += 2
  if (failingChecks > 2) pressure += 2
  if (!hasRollback) pressure += 3

  if (pressure >= 10) return "hold"
  if (pressure >= 6) return "review"
  return "ship"
}
