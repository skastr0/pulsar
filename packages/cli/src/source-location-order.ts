interface SourceLocationLike {
  readonly file: string
  readonly line?: number | undefined
}

export const sourceLineNumber = (location: SourceLocationLike): number => location.line ?? -1

export const compareSourceLocations = (
  a: SourceLocationLike,
  b: SourceLocationLike,
): number => {
  if (a.file !== b.file) return a.file.localeCompare(b.file)
  return sourceLineNumber(a) - sourceLineNumber(b)
}
