export const mapWithConcurrency = async <A, B>(
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
