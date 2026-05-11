import type { ExportConsumer } from "./shared-export-analysis.js"

export interface ConsumerLookup {
  readonly named: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>
  readonly star: ReadonlyArray<ExportConsumer>
}

export const buildConsumerLookupByFile = (
  consumerIndex: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>,
): ReadonlyMap<string, ConsumerLookup> => {
  const lookupByFile = new Map<string, ConsumerLookup>()

  for (const [file, consumers] of consumerIndex) {
    const named = new Map<string, Array<ExportConsumer>>()
    const star: Array<ExportConsumer> = []

    for (const consumer of consumers) {
      if (consumer.exportName === "*") {
        star.push(consumer)
        continue
      }

      const bucket = named.get(consumer.exportName) ?? []
      bucket.push(consumer)
      named.set(consumer.exportName, bucket)
    }

    lookupByFile.set(file, { named, star })
  }

  return lookupByFile
}

export const isReExportedByPublicEntrypoint = (
  consumers: ReadonlyArray<ExportConsumer>,
  publicEntryFiles: ReadonlySet<string>,
): boolean =>
  consumers.some(
    (consumer) =>
      consumer.kind === "re-export" && publicEntryFiles.has(consumer.consumerFile),
  )

export const matchingConsumers = (
  lookup: ConsumerLookup | undefined,
  exportName: string,
): ReadonlyArray<ExportConsumer> => {
  if (lookup === undefined) return []
  const named = lookup.named.get(exportName) ?? []
  if (exportName === "default") return named
  if (named.length === 0) return lookup.star
  if (lookup.star.length === 0) return named
  return [...named, ...lookup.star]
}
