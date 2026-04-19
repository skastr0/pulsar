import type { Registry } from "./registry.js"
import type { TasteVector } from "./vector.js"
import {
  aggregateNumeric,
  baselineConfigOf,
  collectSignalIds,
  compareConfigStrictness,
  defaultAggregationMode,
  explicitConfigOf,
  overrideOf,
  weightedVariance,
  type AggregationMode,
} from "./vector-composition.js"

export interface TeamVectorInput {
  readonly teamId?: string
  readonly domain?: string
  readonly description?: string
  readonly members: ReadonlyArray<{
    readonly id: string
    readonly vector: TasteVector
    readonly weight?: number
  }>
  readonly aggregationRules?: Record<string, AggregationMode>
}

export interface TeamSignalVariance {
  readonly mode: AggregationMode
  readonly aggregatedWeight: number
  readonly variance: number
  readonly stddev: number
  readonly memberWeights: Record<string, number>
}

export interface TeamVectorResult {
  readonly vector: TasteVector
  readonly varianceBySignal: Record<string, TeamSignalVariance>
}

export const aggregateTeamVector = (
  input: TeamVectorInput,
  registry?: Registry,
): TeamVectorResult => {
  if (input.members.length === 0) {
    return {
      vector: {
        id: input.teamId ?? "team-vector",
        domain: input.domain ?? "team",
        ...(input.description !== undefined ? { description: input.description } : {}),
        signal_overrides: {},
      },
      varianceBySignal: {},
    }
  }

  const signal_overrides: Record<
    string,
    {
      active?: boolean
      weight?: number
      config?: Record<string, unknown>
    }
  > = {}
  const varianceBySignal: Record<string, TeamSignalVariance> = {}

  for (const signalId of collectSignalIds(...input.members.map((member) => member.vector))) {
    const mode = input.aggregationRules?.[signalId] ?? defaultAggregationMode(signalId, registry)
    const memberSamples = input.members.map((member) => ({
      memberId: member.id,
      memberWeight: member.weight ?? 1,
      signalWeight: overrideOf(signalId, member.vector)?.weight ?? 1,
      active: overrideOf(signalId, member.vector)?.active ?? true,
      config: explicitConfigOf(overrideOf(signalId, member.vector)),
    }))

    const weightSamples = memberSamples.map((sample) => ({
      value: sample.signalWeight,
      weight: sample.memberWeight,
    }))
    const aggregatedWeight = aggregateNumeric(weightSamples, mode)
    const variance = weightedVariance(weightSamples)
    const memberWeights: Record<string, number> = {}
    for (const sample of memberSamples) {
      memberWeights[sample.memberId] = sample.signalWeight
    }

    const aggregatedConfig = baselineConfigOf(signalId, registry)
    let hasExplicitConfig = false
    for (const sample of memberSamples) {
      for (const [configKey, attempted] of Object.entries(sample.config)) {
        const current = aggregatedConfig[configKey]
        const comparison = compareConfigStrictness({
          signalId,
          configKey,
          current,
          attempted,
          ...(registry !== undefined ? { registry } : {}),
        })
        if (comparison.accepted) {
          aggregatedConfig[configKey] = attempted
          hasExplicitConfig = true
        }
      }
    }

    const active = memberSamples.every((sample) => sample.active)
    signal_overrides[signalId] = {
      ...(active ? {} : { active: false }),
      ...(aggregatedWeight === 1 ? {} : { weight: aggregatedWeight }),
      ...(hasExplicitConfig ? { config: aggregatedConfig } : {}),
    }

    varianceBySignal[signalId] = {
      mode,
      aggregatedWeight,
      variance,
      stddev: Math.sqrt(variance),
      memberWeights,
    }
  }

  const firstMember = input.members[0]
  return {
    vector: {
      id: input.teamId ?? "team-vector",
      domain: input.domain ?? firstMember?.vector.domain ?? "team",
      ...(input.description !== undefined
        ? { description: input.description }
        : {
            description: `Aggregated team vector from ${input.members.length} members`,
          }),
      signal_overrides,
    },
    varianceBySignal,
  }
}
