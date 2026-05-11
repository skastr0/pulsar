export const buildHunkMap = (
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): Map<string, ReadonlyArray<{ start: number; end: number }>> | undefined => {
  if (hunks.length === 0) return undefined

  const map = new Map<string, Array<{ start: number; end: number }>>()
  for (const hunk of hunks) {
    const file = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    const ranges = map.get(file) ?? []
    ranges.push({
      start: hunk.newStart,
      end: hunk.newStart + hunk.newLines,
    })
    map.set(file, ranges)
  }
  return map
}

export const lineRangeOverlapsHunkRanges = (
  startLine: number,
  endLine: number,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): boolean => {
  if (ranges.length === 0) return false

  for (const range of ranges) {
    if (startLine < range.end && endLine >= range.start) {
      return true
    }
  }

  return false
}
