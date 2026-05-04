import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@taste-codec/project-module-sdk"
import {
  CONVEX_PUBLIC_ENTRYPOINT_RULE_ID,
  CONVEX_GENERATED_TAXONOMY_RULE_ID,
  CONVEX_PROJECT_MODULE_ID,
  convexProjectModule,
  isConvexGeneratedPath,
  isConvexPublicEntrypointExport,
  isConvexRuntimeEntrypointPath,
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
        {
          slot: "typescript.export-reachability",
          processorId: "convex-public-entrypoints",
          role: "resolver",
          priority: 20,
          fingerprint: "convex-public-entrypoints-v1",
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

  test("detects Convex runtime entrypoint paths", () => {
    expect(isConvexRuntimeEntrypointPath("/repo/convex/http.ts")).toBe(true)
    expect(isConvexRuntimeEntrypointPath("/repo/convex/lifecycle.ts")).toBe(true)
    expect(isConvexRuntimeEntrypointPath("/repo/packages/app/convex/users/list.ts")).toBe(true)
    expect(isConvexRuntimeEntrypointPath("/repo/convex/_generated/api.ts")).toBe(false)
    expect(isConvexRuntimeEntrypointPath("/repo/convex/schema.ts")).toBe(false)
    expect(isConvexRuntimeEntrypointPath("/repo/src/convexity.ts")).toBe(false)
  })

  test("detects Convex public entrypoint exports from declaration evidence", () => {
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/lifecycle.ts",
      exportName: "listProjects",
      declarationFiles: ["/repo/convex/lifecycle.ts"],
      declarationKinds: ["VariableDeclaration"],
      declarationTexts: ["export const listProjects = query({ handler: async () => [] })"],
      isPublicEntrypoint: false,
    })).toBe(true)
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/schema.ts",
      exportName: "default",
      declarationFiles: ["/repo/convex/schema.ts"],
      declarationKinds: ["ExportAssignment"],
      declarationTexts: ["export default defineSchema({})"],
      isPublicEntrypoint: false,
    })).toBe(true)
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/domain.ts",
      exportName: "LifecycleRoot",
      declarationFiles: ["/repo/convex/domain.ts"],
      declarationKinds: ["TypeAliasDeclaration"],
      declarationTexts: ["export type LifecycleRoot = 'sdlc'"],
      isPublicEntrypoint: false,
    })).toBe(false)
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

  test("marks Convex runtime exports as public entrypoints with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [convexProjectModule.activeModule],
      processors: convexProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.export-reachability", {
        exportFile: "/repo/convex/lifecycle.ts",
        exportName: "syncLifecycle",
        declarationFiles: ["/repo/convex/lifecycle.ts"],
        declarationKinds: ["VariableDeclaration"],
        declarationTexts: [
          "export const syncLifecycle = internalMutation({ handler: async () => null })",
        ],
        isPublicEntrypoint: false,
      }),
    )

    expect(result.value.isPublicEntrypoint).toBe(true)
    expect(result.value.metadata).toMatchObject({ technology: "convex" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: CONVEX_PROJECT_MODULE_ID,
      processorId: "convex-public-entrypoints",
      slot: "typescript.export-reachability",
      action: "mark-public-entrypoint",
      ruleId: CONVEX_PUBLIC_ENTRYPOINT_RULE_ID,
      confidence: "high",
    })
  })
})
