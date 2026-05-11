import { summarize } from "@skastr0/pulsar-core/signal"
import type { DistributionalSummary } from "@skastr0/pulsar-core/signal"
import { compareDescendingMetricByFile } from "./shared-rank-order.js"

export interface CouplingCounterpart {
  readonly module: string
  readonly outgoingTypes: number
  readonly incomingTypes: number
  readonly totalTypes: number
}

export interface ModuleTypeCoupling {
  readonly file: string
  readonly externalTypesReferenced: number
  readonly typesReferencedExternally: number
  readonly totalCoupling: number
  readonly counterparts: ReadonlyArray<CouplingCounterpart>
}

export interface TsDe01Output {
  readonly modules: ReadonlyArray<ModuleTypeCoupling>
  readonly byModule: ReadonlyMap<string, DistributionalSummary>
  readonly repoDistribution: DistributionalSummary
  readonly outlierThreshold: number
  readonly totalModules: number
  readonly diagnosticLimit: number
}

export type CouplingTable = Map<string, Map<string, Set<string>>>

export const ensureNestedSet = (
  table: CouplingTable,
  outer: string,
  inner: string,
): Set<string> => {
  const row = table.get(outer) ?? new Map<string, Set<string>>()
  table.set(outer, row)
  const set = row.get(inner) ?? new Set<string>()
  row.set(inner, set)
  return set
}

export const createCouplingTables = (
  fileSet: ReadonlySet<string>,
): {
  readonly outgoing: CouplingTable
  readonly incoming: CouplingTable
} => {
  const outgoing = new Map<string, Map<string, Set<string>>>()
  const incoming = new Map<string, Map<string, Set<string>>>()

  for (const file of fileSet) {
    outgoing.set(file, new Map())
    incoming.set(file, new Map())
  }

  return { outgoing, incoming }
}

export const buildOutputFromTables = (
  fileSet: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, ReadonlyMap<string, Set<string>>>,
  incoming: ReadonlyMap<string, ReadonlyMap<string, Set<string>>>,
  diagnosticLimit: number,
): TsDe01Output => {
  const byModule = new Map<string, DistributionalSummary>()
  const modules: Array<ModuleTypeCoupling> = []

  for (const file of fileSet) {
    const outgoingByCounterpart = outgoing.get(file) ?? new Map()
    const incomingByCounterpart = incoming.get(file) ?? new Map()
    const counterpartPaths = new Set<string>([
      ...outgoingByCounterpart.keys(),
      ...incomingByCounterpart.keys(),
    ])

    const counterparts = [...counterpartPaths]
      .map((counterpart): CouplingCounterpart => ({
        module: counterpart,
        outgoingTypes: outgoingByCounterpart.get(counterpart)?.size ?? 0,
        incomingTypes: incomingByCounterpart.get(counterpart)?.size ?? 0,
        totalTypes:
          (outgoingByCounterpart.get(counterpart)?.size ?? 0) +
          (incomingByCounterpart.get(counterpart)?.size ?? 0),
      }))
      .filter((counterpart) => counterpart.totalTypes > 0)
      .sort(compareCounterparts)

    const summary = summarize(counterparts.map((counterpart) => counterpart.totalTypes))
    const externalTypesReferenced = uniqueSetSize(outgoingByCounterpart.values())
    const typesReferencedExternally = uniqueSetSize(incomingByCounterpart.values())

    modules.push({
      file,
      externalTypesReferenced,
      typesReferencedExternally,
      totalCoupling: externalTypesReferenced + typesReferencedExternally,
      counterparts,
    })
    byModule.set(file, summary)
  }

  modules.sort(compareModules)

  const repoDistribution = summarize(modules.map((module) => module.externalTypesReferenced))

  return {
    modules,
    byModule,
    repoDistribution,
    outlierThreshold: Math.max(repoDistribution.avg, repoDistribution.p95),
    totalModules: modules.length,
    diagnosticLimit,
  }
}

const uniqueSetSize = (sets: Iterable<Set<string>>): number => {
  const merged = new Set<string>()
  for (const set of sets) {
    for (const value of set) {
      merged.add(value)
    }
  }
  return merged.size
}

const compareCounterparts = (left: CouplingCounterpart, right: CouplingCounterpart): number => {
  if (right.totalTypes !== left.totalTypes) {
    return right.totalTypes - left.totalTypes
  }
  return left.module.localeCompare(right.module)
}

const compareModules = (left: ModuleTypeCoupling, right: ModuleTypeCoupling): number => {
  return compareDescendingMetricByFile(left.totalCoupling, right.totalCoupling, left.file, right.file)
}
