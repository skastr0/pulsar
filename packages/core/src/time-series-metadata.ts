import type { Category } from "./category.js"
import type { ObserverOutput, toObserverJson } from "./observer.js"
import type { WeightedEntry } from "./time-series-compaction-types.js"

export const aggregateCategoryMetadata = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
  category: Category,
  totalWeight: number,
): Partial<ReturnType<typeof toObserverJson>["categories"][Category]> => {
  const snapshots = weightedEntries.map(({ entry }) => entry.observerOutput.categories[category])
  const withSignalCount = snapshots.every((snapshot) => snapshot.signalCount !== undefined)
  const withApplicableSignalCount = snapshots.every((snapshot) => snapshot.applicableSignalCount !== undefined)
  const withActiveSignalIds = snapshots.every((snapshot) => snapshot.activeSignalIds !== undefined)

  return {
    ...(withSignalCount
      ? {
          signalCount:
            weightedEntries.reduce(
              (sum, { entry, weight }) =>
                sum + (entry.observerOutput.categories[category].signalCount ?? 0) * weight,
              0,
            ) / totalWeight,
        }
      : {}),
    ...(withApplicableSignalCount
      ? {
          applicableSignalCount:
            weightedEntries.reduce(
              (sum, { entry, weight }) =>
                sum + (entry.observerOutput.categories[category].applicableSignalCount ?? 0) * weight,
              0,
            ) / totalWeight,
        }
      : {}),
    ...(withActiveSignalIds
      ? {
          activeSignalIds: [...new Set(snapshots.flatMap((snapshot) => snapshot.activeSignalIds ?? []))].sort(),
        }
      : {}),
  }
}

export const aggregateSignalMetadata = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
): ObserverOutput["signal_metadata"] | undefined => {
  if (
    weightedEntries.length === 0 ||
    weightedEntries.some(({ entry }) => entry.observerOutput.signal_metadata === undefined)
  ) {
    return undefined
  }

  const signalIds = [
    ...new Set(
      weightedEntries.flatMap(({ entry }) => Object.keys(entry.observerOutput.signal_metadata ?? {})),
    ),
  ].sort()

  return Object.fromEntries(
    signalIds.map((signalId) => {
      const metadata = weightedEntries.flatMap(({ entry, weight }) => {
        const item = entry.observerOutput.signal_metadata?.[signalId]
        return item === undefined ? [] : [{ item, weight }]
      })
      const hasMetadataForEverySource = metadata.length === weightedEntries.length
      const applicabilityValues = new Set(
        metadata.map(({ item }) => item.applicability).filter((value) => value !== undefined),
      )
      const computedAt = metadata
        .map(({ item }) => item.computedAt)
        .filter((value) => value !== undefined)
        .sort()
        .at(-1)
      const effectiveConfidence = averageOptional(metadata, ({ item }) => item.effectiveConfidence)
      const baseConfidence = averageOptional(metadata, ({ item }) => item.baseConfidence)

      return [
        signalId,
        {
          ...(effectiveConfidence !== undefined ? { effectiveConfidence } : {}),
          ...(baseConfidence !== undefined ? { baseConfidence } : {}),
          ...(computedAt !== undefined ? { computedAt } : {}),
          ...(metadata.some(({ item }) => item.stale === true) ? { stale: true } : {}),
          ...(hasMetadataForEverySource && applicabilityValues.size === 1
            ? { applicability: [...applicabilityValues][0] }
            : {}),
        },
      ]
    }),
  )
}

const averageOptional = <A>(
  entries: ReadonlyArray<{ readonly weight: number } & A>,
  value: (entry: A) => number | undefined,
): number | undefined => {
  let total = 0
  let weight = 0
  for (const entry of entries) {
    const item = value(entry)
    if (item === undefined) continue
    total += item * entry.weight
    weight += entry.weight
  }
  return weight === 0 ? undefined : total / weight
}
