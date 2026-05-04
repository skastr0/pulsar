import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@taste-codec/project-module-sdk"
import {
  CONVEX_GENERATED_TAXONOMY_RULE_ID,
  CONVEX_PROJECT_MODULE_ID,
  convexProjectModule,
  isConvexGeneratedPath,
} from "../index.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["convex", "typescript"],
  sourceExtensions: [".ts"],
}

describe("convex project module", () => {
  test("exports a technology-scoped taxonomy contribution", () => {
    expect(convexProjectModule.descriptor).toMatchObject({
      id: CONVEX_PROJECT_MODULE_ID,
      scope: "technology",
      source: "package",
      contributions: [
        {
          slot: "taxonomy.file-classifier",
          processorId: "convex-generated-taxonomy",
          role: "filter",
          priority: 20,
          fingerprint: "convex-generated-taxonomy-v1",
        },
      ],
    })
  })

  test("detects Convex generated paths", () => {
    expect(isConvexGeneratedPath("/repo/convex/_generated/api.ts")).toBe(true)
    expect(isConvexGeneratedPath("convex/_generated/server.ts")).toBe(true)
    expect(isConvexGeneratedPath("/repo/src/_generated/api.ts")).toBe(false)
    expect(isConvexGeneratedPath("/repo/convex/schema.ts")).toBe(false)
  })

  test("classifies Convex generated files as generated with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [convexProjectModule.activeModule],
      processors: convexProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("taxonomy.file-classifier", {
        path: "/repo/convex/_generated/api.ts",
        categories: ["production_source"],
      }),
    )

    expect(result.value.categories).toEqual(["generated", "production_source"])
    expect(result.value.metadata).toMatchObject({ generator: "convex" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: CONVEX_PROJECT_MODULE_ID,
      processorId: "convex-generated-taxonomy",
      slot: "taxonomy.file-classifier",
      action: "classify-generated",
      ruleId: CONVEX_GENERATED_TAXONOMY_RULE_ID,
      confidence: "high",
    })
  })
})
