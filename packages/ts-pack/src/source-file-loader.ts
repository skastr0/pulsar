import type { Project, SourceFile } from "./tsgo-api.js"

type SourceFileReader = Pick<Project["program"], "getSourceFile">

const pendingByProgram = new WeakMap<SourceFileReader, Map<string, Promise<SourceFile | undefined>>>()

/** Per-mapping-call window; independent mapping calls remain concurrent. */
export const SOURCE_FILE_LOAD_WINDOW_SIZE = 32

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

/**
 * Loads one bounded source-file window at a time, then visits the loaded files
 * in input order. Independent callers remain concurrent while a single caller
 * avoids decoding every project AST at once.
 */
export const mapSourceFilesInWindows = async <File extends { readonly path: string }, A>(
  program: SourceFileReader,
  files: ReadonlyArray<File>,
  visit: (file: File, sourceFile: SourceFile) => Promise<A>,
): Promise<Array<A>> => {
  const results: Array<A> = []
  for (let start = 0; start < files.length; start += SOURCE_FILE_LOAD_WINDOW_SIZE) {
    const window = files.slice(start, start + SOURCE_FILE_LOAD_WINDOW_SIZE)
    const sourceFiles = await Promise.all(
      window.map((file) => loadSourceFile(program, file.path)),
    )
    for (const [index, file] of window.entries()) {
      const sourceFile = sourceFiles[index]
      if (sourceFile === undefined) continue
      results.push(await visit(file, sourceFile))
    }
  }
  return results
}
