import { isAbsolute, relative } from "node:path"

export const normalizeWorktreeRelativePath = (
  worktree: string,
  value: string,
): string => {
  const normalized = value.replace(/\\/g, "/")
  if (!isAbsolute(normalized)) return trimDotSlash(normalized)
  return trimDotSlash(relative(worktree, normalized).replace(/\\/g, "/"))
}

const trimDotSlash = (value: string): string => value.replace(/^\.\//, "")
