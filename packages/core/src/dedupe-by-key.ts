export const dedupeByKey = <Item>(
  items: ReadonlyArray<Item>,
  keyOf: (item: Item) => string,
): ReadonlyArray<Item> => {
  const seen = new Set<string>()
  const deduped: Array<Item> = []

  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  return deduped
}
