export const stripKnownExtension = (path: string): string =>
  path.replace(/\.(?:[cm]?tsx?|[cm]?jsx?)$/u, "")

export const stripRuntimeExtension = (path: string): string =>
  path.replace(/\.(?:[cm]?jsx?)$/u, "")
