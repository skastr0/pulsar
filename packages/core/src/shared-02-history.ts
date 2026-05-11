import { join } from "node:path"
import { mapWithConcurrency } from "./concurrency.js"
import { countFileLoc } from "./shared-history.js"

export interface TouchedFileHistory {
  readonly absolutePath: string
  readonly authors: ReadonlyArray<string>
  readonly loc: number
}

export const loadTouchedFileHistory = (
  worktreePath: string,
  authorsByFile: ReadonlyMap<string, ReadonlyArray<string>>,
): Promise<ReadonlyArray<TouchedFileHistory>> =>
  mapWithConcurrency([...authorsByFile.entries()], 16, async ([relativePath, authors]) => {
    const absolutePath = join(worktreePath, relativePath)
    const loc = await countFileLoc(absolutePath).catch(() => 0)
    return { absolutePath, authors, loc }
  })
