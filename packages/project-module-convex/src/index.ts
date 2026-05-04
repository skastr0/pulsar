import { Effect } from "effect"
import {
  addSourceCategory,
  defineProcessor,
  defineProjectModule,
} from "@taste-codec/project-module-sdk"

export const CONVEX_PROJECT_MODULE_ID = "@taste-codec/project-module-convex" as const
export const CONVEX_GENERATED_TAXONOMY_RULE_ID = "convex.generated-artifact.v1" as const

export const convexProjectModule = defineProjectModule({
  id: CONVEX_PROJECT_MODULE_ID,
  version: "0.0.0",
  scope: "technology",
  source: "package",
  processors: [
    defineProcessor({
      id: "convex-generated-taxonomy",
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 20,
      fingerprint: "convex-generated-taxonomy-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isConvexGeneratedPath(current.value.path)) return current
          return addSourceCategory(current, runtime, "generated", {
            ruleId: CONVEX_GENERATED_TAXONOMY_RULE_ID,
            reason: "Convex generated API output",
            evidence: [{ kind: "path", value: current.value.path }],
            metadata: { generator: "convex" },
          })
        }),
    }),
  ],
})

export const isConvexGeneratedPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll("\\", "/")
  return normalized === "convex/_generated" ||
    normalized.includes("/convex/_generated/") ||
    normalized.startsWith("convex/_generated/")
}

export default convexProjectModule
