import type { Registry } from "./registry.js"
import type { TasteVector } from "./vector.js"
import {
  baselineConfigOf,
  collectSignalIds,
  compareConfigStrictness,
  explicitConfigOf,
  overrideOf,
} from "./vector-composition.js"

export interface RejectedVectorOverride {
  readonly level: "team" | "project" | "task"
  readonly signalId: string
  readonly attempted: unknown
  readonly reason: string
}

export interface ResolvedVector {
  readonly effective: TasteVector
  readonly rejectedOverrides: ReadonlyArray<RejectedVectorOverride>
  readonly provenance: Record<string, string>
}

export const resolveVectorHierarchy = (
  personal?: TasteVector,
  team?: TasteVector,
  project?: TasteVector,
  task?: TasteVector,
  options?: { readonly registry?: Registry },
): ResolvedVector => {
  const registry = options?.registry
  const rejectedOverrides: Array<RejectedVectorOverride> = []
  const provenance: Record<string, string> = {}
  const signal_overrides: Record<
    string,
    {
      active?: boolean
      weight?: number
      config?: Record<string, unknown>
    }
  > = {}

  for (const signalId of collectSignalIds(personal, team, project, task)) {
    const baselineConfig = baselineConfigOf(signalId, registry)
    const personalOverride = overrideOf(signalId, personal)
    let effectiveActive = personalOverride?.active ?? true
    let effectiveWeight = personalOverride?.weight ?? 1
    const effectiveConfig = {
      ...baselineConfig,
      ...explicitConfigOf(personalOverride),
    }

    provenance[signalId] = personalOverride === undefined ? "default" : "personal"

    for (const [level, vector] of [
      ["team", team],
      ["project", project],
      ["task", task],
    ] as const) {
      const override = overrideOf(signalId, vector)
      if (override === undefined) continue

      if (override.active !== undefined) {
        if (effectiveActive === false && override.active === true) {
          rejectedOverrides.push({
            level,
            signalId,
            attempted: { active: true },
            reason: "cannot re-enable a signal disabled by an ancestor",
          })
        } else if (effectiveActive !== override.active) {
          effectiveActive = override.active
          provenance[signalId] = level
        }
      }

      if (override.weight !== undefined) {
        if (override.weight < effectiveWeight) {
          rejectedOverrides.push({
            level,
            signalId,
            attempted: { weight: override.weight },
            reason: `weight ${override.weight} would loosen ancestor weight ${effectiveWeight}`,
          })
        } else if (override.weight > effectiveWeight) {
          effectiveWeight = override.weight
          provenance[signalId] = level
        }
      }

      for (const [configKey, attempted] of Object.entries(explicitConfigOf(override))) {
        const current = effectiveConfig[configKey]
        const comparison = compareConfigStrictness({
          signalId,
          configKey,
          current,
          attempted,
          ...(registry !== undefined ? { registry } : {}),
        })

        if (!comparison.accepted) {
          rejectedOverrides.push({
            level,
            signalId,
            attempted: { config: { [configKey]: attempted } },
            reason: comparison.reason ?? `config.${configKey} would loosen ancestor settings`,
          })
          continue
        }

        if (comparison.tightened) {
          effectiveConfig[configKey] = attempted
          provenance[signalId] = level
        }
      }
    }

    const explicitConfig = Object.fromEntries(
      Object.entries(effectiveConfig).filter(([configKey, value]) => baselineConfig[configKey] !== value),
    )

    signal_overrides[signalId] = {
      ...(effectiveActive ? {} : { active: false }),
      ...(effectiveWeight === 1 ? {} : { weight: effectiveWeight }),
      ...(Object.keys(explicitConfig).length > 0 ? { config: explicitConfig } : {}),
    }
  }

  return {
    effective: {
      id: task?.id ?? project?.id ?? team?.id ?? personal?.id ?? "resolved-vector",
      domain:
        task?.domain ?? project?.domain ?? team?.domain ?? personal?.domain ?? "resolved",
      description:
        task?.description ??
        project?.description ??
        team?.description ??
        personal?.description ??
        "Resolved vector hierarchy",
      signal_overrides,
    },
    rejectedOverrides,
    provenance,
  }
}
