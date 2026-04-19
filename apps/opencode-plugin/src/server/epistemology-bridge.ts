import { createTimeSeriesServices, evaluateBackpressure, listEpistemologyRuleIds, projectObserverForAgent, type TasteVector } from "@taste-codec/core"
import { Effect } from "effect"

export interface EpistemologyBridgeState {
  readonly cachedRuleIdsByWorktree: Map<string, ReadonlyArray<string>>
}

export const createEpistemologyBridgeState = (): EpistemologyBridgeState => ({
  cachedRuleIdsByWorktree: new Map(),
})

export const observeEpistemologyBusEvent = async (input: {
  readonly event: { readonly type?: string }
  readonly worktree: string
  readonly state: EpistemologyBridgeState
}): Promise<void> => {
  const type = input.event.type
  if (
    type !== "tool.execute.before" &&
    type !== "tool.execute.after" &&
    type !== "session.created" &&
    type !== "session.deleted"
  ) {
    return
  }

  if (type === "session.deleted") {
    input.state.cachedRuleIdsByWorktree.delete(input.worktree)
    return
  }

  input.state.cachedRuleIdsByWorktree.set(
    input.worktree,
    await listEpistemologyRuleIds(input.worktree),
  )
}

export const renderEpistemologyObserverContext = async (input: {
  readonly worktree: string
  readonly vector: TasteVector | undefined
  readonly state: EpistemologyBridgeState
}): Promise<string | undefined> => {
  const ruleIds =
    input.state.cachedRuleIdsByWorktree.get(input.worktree) ??
    (await listEpistemologyRuleIds(input.worktree))
  const entries = await Effect.runPromise(
    createTimeSeriesServices(input.worktree).reader.entries(),
  )
  const latest = entries.at(-1)

  if (ruleIds.length === 0 && latest === undefined) {
    return undefined
  }

  const backpressure = evaluateBackpressure(entries, input.vector)
  const agentView = projectObserverForAgent(latest, backpressure.goodhart)
  const payload = {
    schema_id: "taste-codec/epistemology-bridge/v1",
    backpressure: backpressure.overall,
    observed_epistemology_rules: ruleIds,
    agent_diagnostics: Object.fromEntries(
      Object.entries(agentView.categories)
        .filter(([, value]) => value.diagnostics.length > 0)
        .map(([category, value]) => [category, value.diagnostics.slice(0, 3)]),
    ),
    notes: agentView.reminders,
  }

  return [
    '<taste-codec-epistemology-context schema="taste-codec/epistemology-bridge/v1">',
    JSON.stringify(payload, null, 2),
    "</taste-codec-epistemology-context>",
  ].join("\n")
}
