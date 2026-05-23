import type { Project } from "ts-morph"
import { collectCloneCandidates } from "./ts-sl-01-collect.js"
import { buildCloneGroups, sortCloneGroups } from "./ts-sl-01-groups.js"
import {
  normalizeTsSl01Config,
  type TsSl01Config,
  type TsSl01Context,
  type TsSl01Output,
} from "./ts-sl-01-model.js"

export const computeTsSl01Output = (
  project: Project,
  context: TsSl01Context,
  config: TsSl01Config,
): TsSl01Output => {
  const normalizedConfig = normalizeTsSl01Config(config)
  const collection = collectCloneCandidates(project.getSourceFiles(), context, normalizedConfig)
  const groups = buildCloneGroups(collection.functions, normalizedConfig, collection.scopeMode)
  return {
    groups: sortCloneGroups(groups, collection.scopeMode, normalizedConfig.min_tokens),
    totalFunctionsAnalyzed: collection.totalFunctionsAnalyzed,
    scoreBudgetFunctions: collection.scoreBudgetFunctions,
    scopeMode: collection.scopeMode,
    detectionMinTokens: normalizedConfig.min_tokens,
    diagnosticLimit: normalizedConfig.top_n_diagnostics,
  }
}
