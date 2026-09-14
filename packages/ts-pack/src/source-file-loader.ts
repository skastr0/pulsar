import type { Project, SourceFile } from "./tsgo-api.js"

type SourceFileReader = Pick<Project["program"], "getSourceFile">

const pendingByProgram = new WeakMap<SourceFileReader, Map<string, Promise<SourceFile | undefined>>>()

/**
 * tsgo caches completed source files, but simultaneous cold requests each fetch
 * and decode the same binary AST. Share only the pending request; the Program
 * owns the completed cache and its snapshot invalidation.
 */
export const loadSourceFile = (
  program: SourceFileReader,
  path: string,
): Promise<SourceFile | undefined> => {
  const pending = pendingByProgram.get(program) ?? new Map<string, Promise<SourceFile | undefined>>()
  const existing = pending.get(path)
  if (existing !== undefined) return existing

  const request = program.getSourceFile(path)
  pendingByProgram.set(program, pending)
  pending.set(path, request)
  const release = (): void => {
    pending.delete(path)
    if (pending.size === 0) pendingByProgram.delete(program)
  }
  // Handle both outcomes without retaining a rejected cleanup promise.
  void request.then(release, release)
  return request
}
