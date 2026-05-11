import { join } from "node:path"
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

const mapWithConcurrency = async <A, B>(
  items: ReadonlyArray<A>,
  concurrency: number,
  fn: (item: A) => Promise<B>,
): Promise<Array<B>> => {
  const results = new Array<B>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= items.length) return
        results[index] = await fn(items[index]!)
      }
    }),
  )

  return results
}
