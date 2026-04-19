export const matchesGlob = (path: string, glob: string): boolean => {
  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  return regex.test(path)
}

export const matchesAnyGlob = (path: string, globs: ReadonlyArray<string>): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

export const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, globs)
