import type { PulsarVector } from "./vector-schema.js"

export const aiAssistedModeEnabled = (vector: PulsarVector | undefined): boolean =>
  vector?.modes?.ai_assisted ?? false

export interface AiAssistedModeExplanation {
  readonly active: boolean
  readonly source: "inactive" | "preset" | "proposal" | "manual"
  readonly summary: string
  readonly overrideHint: string
}

export const explainAiAssistedMode = (
  vector: PulsarVector | undefined,
): AiAssistedModeExplanation => {
  if (!aiAssistedModeEnabled(vector)) {
    return {
      active: false,
      source: "inactive",
      summary: "inactive — AI-assisted thresholds are off for this run.",
      overrideHint:
        "The pulsar never hides this switch: enable modes.ai_assisted or accept an AI-mode proposal if you want the tighter thresholds.",
    }
  }

  const latestRelevant = [...(vector?.provenance ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.source === "ai-assisted-detection" ||
        entry.source === "preset" ||
        entry.summary.toLowerCase().includes("ai-assisted"),
    )

  if (latestRelevant?.source === "ai-assisted-detection") {
    return {
      active: true,
      source: "proposal",
      summary: `active via accepted AI-assisted detection proposal — ${latestRelevant.summary}`,
      overrideHint:
        "This remains explicit in vector.modes.ai_assisted; edit the vector or reject future proposals to stay on manual thresholds.",
    }
  }

  if (latestRelevant?.source === "preset") {
    return {
      active: true,
      source: "preset",
      summary:
        latestRelevant.preset_id !== undefined
          ? `active via preset ${latestRelevant.preset_id}`
          : `active via preset provenance — ${latestRelevant.summary}`,
      overrideHint:
        "This remains explicit in vector.modes.ai_assisted; switch presets or set the mode to false to return to manual thresholds.",
    }
  }

  return {
    active: true,
    source: "manual",
    summary: "active because vector.modes.ai_assisted is true.",
    overrideHint:
      "This remains explicit in the vector; set modes.ai_assisted to false to disable the tighter thresholds.",
  }
}
