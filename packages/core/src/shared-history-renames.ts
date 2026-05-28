export const resolveCurrentHistoryPath = (
  file: string,
  renameTargets: ReadonlyMap<string, string>,
): string => {
  let current = file
  const seen = new Set<string>()

  while (!seen.has(current)) {
    seen.add(current)
    const target = renameTargets.get(current)
    if (target === undefined) return current
    current = target
  }

  return current
}
