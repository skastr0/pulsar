import type { Project } from "ts-morph"
import { collectCloneCandidates } from "./ts-sl-01-collect.js"
import { buildCloneGroups, sortCloneGroups } from "./ts-sl-01-groups.js"
import type { TsSl01Config, TsSl01Context, TsSl01Output } from "./ts-sl-01-model.js"

export const computeTsSl01Output = (
  project: Project,
  context: TsSl01Context,
  config: TsSl01Config,
): TsSl01Output => {
  const collection = collectCloneCandidates(project.getSourceFiles(), context, config)
  const groups = buildCloneGroups(collection.functions, config, collection.scopeMode)
  return {
    groups: sortCloneGroups(groups, collection.scopeMode, config.min_tokens),
    totalFunctionsAnalyzed: collection.totalFunctionsAnalyzed,
    scoreBudgetFunctions: collection.scoreBudgetFunctions,
    scopeMode: collection.scopeMode,
    detectionMinTokens: config.min_tokens,
    diagnosticLimit: config.top_n_diagnostics,
  }
}
