import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@skastr0/pulsar-project-module-sdk"
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
      declarations: [
        {
          declarationKind: "VariableDeclaration",
          exportName: "listProjects",
          localName: "listProjects",
          initializerCall: { calleeText: "query", calleeName: "query" },
        },
      ],
      sourceImports: [
        {
          moduleSpecifier: "./_generated/server",
          importKind: "named",
          importedName: "query",
          localName: "query",
        },
      ],
      isPublicEntrypoint: false,
    })).toBe(true)
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/schema.ts",
      exportName: "default",
      declarationFiles: ["/repo/convex/schema.ts"],
      declarationKinds: ["ExportAssignment"],
      declarations: [
        {
          declarationKind: "ExportAssignment",
          exportName: "default",
          expressionCall: { calleeText: "defineSchema", calleeName: "defineSchema" },
        },
      ],
      sourceImports: [
        {
          moduleSpecifier: "convex/server",
          importKind: "named",
          importedName: "defineSchema",
          localName: "defineSchema",
        },
      ],
      isPublicEntrypoint: false,
    })).toBe(true)
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/domain.ts",
      exportName: "LifecycleRoot",
      declarationFiles: ["/repo/convex/domain.ts"],
      declarationKinds: ["TypeAliasDeclaration"],
      declarations: [
        {
          declarationKind: "TypeAliasDeclaration",
          exportName: "LifecycleRoot",
          localName: "LifecycleRoot",
        },
      ],
      isPublicEntrypoint: false,
    })).toBe(false)
  })

  test("resolves Convex factory aliases and local export specifiers structurally", () => {
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/lifecycle.ts",
      exportName: "visibleList",
      declarationFiles: ["/repo/convex/lifecycle.ts"],
      declarationKinds: [],
      sourceImports: [
        {
          moduleSpecifier: "./_generated/server",
          importKind: "named",
          importedName: "query",
          localName: "convexQuery",
        },
      ],
      sourceLocalBindings: [
        {
          localName: "listProjects",
          initializerCall: { calleeText: "convexQuery", calleeName: "convexQuery" },
        },
      ],
      sourceExportSpecifiers: [
        {
          exportedName: "visibleList",
          localName: "listProjects",
        },
      ],
      isPublicEntrypoint: false,
    })).toBe(true)
  })

  test("does not treat incidental Convex-looking text or local helpers as public", () => {
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/helpers.ts",
      exportName: "looksLikeQuery",
      declarationFiles: ["/repo/convex/helpers.ts"],
      declarationKinds: ["VariableDeclaration"],
      declarations: [
        {
          declarationKind: "VariableDeclaration",
          exportName: "looksLikeQuery",
          localName: "looksLikeQuery",
          initializerCall: { calleeText: "localQuery", calleeName: "localQuery" },
        },
      ],
      sourceImports: [
        {
          moduleSpecifier: "./local",
          importKind: "named",
          importedName: "query",
          localName: "localQuery",
        },
      ],
      isPublicEntrypoint: false,
    })).toBe(false)
    expect(isConvexPublicEntrypointExport({
      exportFile: "/repo/convex/schema.ts",
      exportName: "default",
      declarationFiles: ["/repo/convex/schema.ts"],
      declarationKinds: ["ExportAssignment"],
      declarations: [
        {
          declarationKind: "ExportAssignment",
          exportName: "default",
          expressionIdentifier: "schema",
        },
      ],
      sourceLocalBindings: [
        {
          localName: "schema",
        },
      ],
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
        declarations: [
          {
            declarationKind: "VariableDeclaration",
            exportName: "syncLifecycle",
            localName: "syncLifecycle",
            initializerCall: { calleeText: "internalMutation", calleeName: "internalMutation" },
          },
        ],
        sourceImports: [
          {
            moduleSpecifier: "./_generated/server",
            importKind: "named",
            importedName: "internalMutation",
            localName: "internalMutation",
          },
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
