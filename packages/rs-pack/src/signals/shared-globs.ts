const toGlobRegex = (glob: string): RegExp =>
  new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )

export const normalizePath = (path: string): string => path.replaceAll("\\", "/")

const matchesGlob = (path: string, glob: string): boolean =>
  toGlobRegex(glob).test(normalizePath(path))

export const matchesAnyGlob = (
  path: string,
  globs: ReadonlyArray<string>,
): boolean => globs.some((glob) => matchesGlob(path, glob))

export const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, globs)
