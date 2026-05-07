export const matchesGlob = (path: string, glob: string): boolean =>
  compileGlob(glob).test(path)

export const matchesAnyGlob = (
  path: string,
  globs: ReadonlyArray<string>,
): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

const GLOB_REGEX_CACHE = new Map<string, RegExp>()

const compileGlob = (glob: string): RegExp => {
  const cached = GLOB_REGEX_CACHE.get(glob)
  if (cached !== undefined) return cached

  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  GLOB_REGEX_CACHE.set(glob, regex)
  return regex
}
