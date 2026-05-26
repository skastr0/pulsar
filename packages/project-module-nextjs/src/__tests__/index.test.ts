import { describe, expect, test } from "bun:test"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@skastr0/pulsar-project-module-sdk"
import { Effect } from "effect"
import {
  NEXTJS_APP_ROUTER_EXPORT_RULE_ID,
  NEXTJS_APP_ROUTER_FRAMEWORK_ID,
  nextAppRouterExportContract,
  nextjsProjectModule,
} from "../index.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["next", "typescript"],
  sourceExtensions: [".ts", ".tsx"],
}

describe("Next.js project module", () => {
  test("declares framework identity and export-reachability contribution", () => {
    expect(nextjsProjectModule.descriptor).toMatchObject({
      id: "@skastr0/pulsar-project-module-nextjs",
      version: "0.1.1",
      scope: "framework",
      sourceFingerprint: expect.any(String),
      contributions: [
        {
          slot: "typescript.export-reachability",
          processorId: "nextjs-app-router-export-contracts",
          role: "resolver",
        },
      ],
    })
  })

  test("marks exact App Router exports as framework-consumed", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [nextjsProjectModule.activeModule],
      processors: nextjsProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.export-reachability", {
        exportFile: "/repo/src/app/blog/[slug]/page.tsx",
        exportName: "generateMetadata",
        declarationFiles: ["/repo/src/app/blog/[slug]/page.tsx"],
        declarationKinds: ["FunctionDeclaration"],
        isPublicEntrypoint: false,
      }),
    )

    expect(result.value.frameworkConsumer).toEqual({
      frameworkId: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
      frameworkName: "Next App Router",
      contractId: "nextjs-app-router.page.generateMetadata",
    })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "@skastr0/pulsar-project-module-nextjs",
      processorId: "nextjs-app-router-export-contracts",
      action: "mark-framework-consumed",
      ruleId: NEXTJS_APP_ROUTER_EXPORT_RULE_ID,
      reason: "Consumed by Next App Router page export contract",
    })
  })

  test("leaves unexpected exports in App Router files untouched", () => {
    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/products/page.tsx",
        exportName: "unusedHelper",
        declarationFiles: ["/repo/app/products/page.tsx"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      }),
    ).toBeUndefined()
  })

  test("covers route handlers and metadata image conventions", () => {
    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/api/search/route.ts",
        exportName: "GET",
        declarationFiles: ["/repo/app/api/search/route.ts"],
        declarationKinds: ["FunctionDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.route.GET")

    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/blog/opengraph-image.tsx",
        exportName: "contentType",
        declarationFiles: ["/repo/app/blog/opengraph-image.tsx"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.opengraph-image.contentType")
  })

  test("uses file-specific contract ids for special conventions", () => {
    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/loading.tsx",
        exportName: "default",
        declarationFiles: ["/repo/app/loading.tsx"],
        declarationKinds: ["FunctionDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.loading.default")

    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/not-found.tsx",
        exportName: "default",
        declarationFiles: ["/repo/app/not-found.tsx"],
        declarationKinds: ["FunctionDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.not-found.default")
  })

  test("covers metadata route config contracts and rejects unsupported variants", () => {
    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/robots.ts",
        exportName: "revalidate",
        declarationFiles: ["/repo/app/robots.ts"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.robots.revalidate")

    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/manifest.tsx",
        exportName: "dynamic",
        declarationFiles: ["/repo/app/manifest.tsx"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      }),
    ).toBeUndefined()

    expect(
      nextAppRouterExportContract({
        exportFile: "/repo/app/sitemap.ts",
        exportName: "generateSitemaps",
        declarationFiles: ["/repo/app/sitemap.ts"],
        declarationKinds: ["FunctionDeclaration"],
        isPublicEntrypoint: false,
      })?.id,
    ).toBe("nextjs-app-router.sitemap.generateSitemaps")
  })
})
