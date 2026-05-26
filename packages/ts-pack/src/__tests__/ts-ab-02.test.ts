import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CalibrationContextTag, appendCalibrationDecision, defineCalibrationProcessor, makeResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import type { RepoFacts } from "@skastr0/pulsar-core/calibration"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { nextjsProjectModule } from "@skastr0/pulsar-project-module-nextjs"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb02 } from "../signals/ts-ab-02-unused-exports-reachability.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: TempRepo
type TsAb02Result = Parameters<typeof TsAb02.score>[0]

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ab-02-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-02 (unused exports reachability)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AB-02"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsAb02]))
    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsAb02).toMatchObject({
      id: "TS-AB-02-unused-exports",
      title: "Unused exports",
      aliases: ["TS-AB-02"],
      tier: 1,
      category: "abstraction-bloat",
      kind: "structural",
      cacheVersion: "calibrated-export-reachability-v4-framework-consumed-diagnostic-limit-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsAb02.id)
    expect(registered?.title).toBe(TsAb02.title)
    expect(registered?.cacheVersion).toContain(TsAb02.cacheVersion)
    expect(registry.byId.get("TS-AB-02")?.id).toBe(TsAb02.id)
    expect(factorLedger?.signalId).toBe(TsAb02.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.public_entry_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.boundary_rules",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 20,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("no exports: zero counts, score 1, and no diagnostics", async () => {
    await repo.write("src/helper.ts", "const local = 1\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)

    expect(out.exports).toEqual([])
    expect(out.counts).toEqual({
      unused: 0,
      "internal-only": 0,
      "cross-module": 0,
      "cross-package": 0,
      "framework-consumed": 0,
    })
    expect(out.boundaryConfined).toEqual([])
    expect(out.diagnosticLimit).toBe(20)
    expect(TsAb02.inputs).toEqual([])
    expect(TsAb02.score(out)).toBe(1)
    expect(TsAb02.diagnose(out)).toEqual([])
  })

  test("classifies unused, internal-only, cross-module, and cross-package exports", async () => {
    await repo.writeJson("packages/a/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/a/package.json", { name: "@repo/a", version: "0.0.0" })
    await repo.writeJson("packages/b/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/b/package.json", { name: "@repo/b", version: "0.0.0" })
    await repo.write(
      "packages/a/src/api.ts",
      [
        "export const unused = 1",
        "export const internalOnly = 2",
        "export const crossModule = 3",
        "export const crossPackage = 4",
        "const local = internalOnly + 1",
        "export const localUse = local",
      ].join("\n"),
    )
    await repo.write(
      "packages/a/src/consumer.ts",
      "import { crossModule } from './api'\nexport const value = crossModule\n",
    )
    await repo.write(
      "packages/b/src/consumer.ts",
      "import { crossPackage } from '../../a/src/api'\nexport const value = crossPackage\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("unused")?.classification).toBe("unused")
    expect(byName.get("internalOnly")?.classification).toBe("internal-only")
    expect(byName.get("crossModule")?.classification).toBe("cross-module")
    expect(byName.get("crossPackage")?.classification).toBe("cross-package")
  })

  test("boundary rules escalate same-boundary exports to a blocking diagnostic", async () => {
    await repo.write(
      "src/domain/api.ts",
      "export const domainOnly = 1\n",
    )
    await repo.write(
      "src/domain/use.ts",
      "import { domainOnly } from './api'\nexport const value = domainOnly\n",
    )
    await repo.write(
      "src/app/main.ts",
      "export const app = 1\n",
    )

    const out = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      boundary_rules: [
        { name: "domain", globs: ["**/src/domain/**"] },
        { name: "app", globs: ["**/src/app/**"] },
      ],
    })

    expect(out.boundaryConfined.some((entry) => entry.exportName === "domainOnly")).toBe(true)
    expect(TsAb02.diagnose(out)[0]?.severity).toBe("block")
  })

  test("resolves package-local @/ tsconfig aliases as real consumers", async () => {
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/app/package.json", { name: "@repo/app", version: "0.0.0" })
    await repo.write(
      "packages/app/src/components/dialog.ts",
      "export const DialogSelectModel = () => null\n",
    )
    await repo.write(
      "packages/app/src/components/lazy-dialog.ts",
      "export const LazyDialog = () => null\n",
    )
    await repo.write(
      "packages/app/src/pages/session.ts",
      "import { DialogSelectModel } from '@/components/dialog'\nexport const page = DialogSelectModel\n",
    )
    await repo.write(
      "packages/app/src/pages/lazy.ts",
      "export const lazy = () => import('@/components/lazy-dialog').then((x) => x.LazyDialog)\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const entry = out.exports.find((item) => item.exportName === "DialogSelectModel")
    expect(entry?.classification).toBe("cross-module")
    const lazyEntry = out.exports.find((item) => item.exportName === "LazyDialog")
    expect(lazyEntry?.classification).toBe("cross-module")
  })

  test("namespace imports only mark concretely accessed exports reachable", async () => {
    await repo.write(
      "src/api.ts",
      ["export const used = 1", "export const unused = 2", ""].join("\n"),
    )
    await repo.write(
      "src/consumer.ts",
      "import * as api from './api'\nexport const value = api.used\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("used")?.classification).toBe("cross-module")
    expect(byName.get("used")?.referenceFiles).toContain(`${repo.root}/src/consumer.ts`)
    expect(byName.get("unused")?.classification).toBe("unused")
  })

  test("namespace import reachability ignores shadowed local names", async () => {
    await repo.write(
      "src/api.ts",
      ["export const used = 1", "export const unused = 2", ""].join("\n"),
    )
    await repo.write(
      "src/consumer.ts",
      [
        "import * as api from './api'",
        "function shadow(api: { unused: number }) { return api.unused }",
        "export const value = api.used + shadow({ unused: 0 })",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("used")?.classification).toBe("cross-module")
    expect(byName.get("unused")?.classification).toBe("unused")
  })

  test("dynamic imports only mark concretely accessed exports reachable", async () => {
    await repo.write(
      "src/api.ts",
      ["export const used = 1", "export const unused = 2", ""].join("\n"),
    )
    await repo.write(
      "src/consumer.ts",
      "export const load = () => import('./api').then((module) => module.used)\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("used")?.classification).toBe("cross-module")
    expect(byName.get("used")?.referenceFiles).toContain(`${repo.root}/src/consumer.ts`)
    expect(byName.get("unused")?.classification).toBe("unused")
  })

  test("parenthesized dynamic imports preserve concrete export reachability", async () => {
    await repo.write(
      "src/api.ts",
      ["export const used = 1", "export const unused = 2", ""].join("\n"),
    )
    await repo.write(
      "src/consumer.ts",
      "export const load = () => (import('./api')).then((module) => module.used)\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("used")?.classification).toBe("cross-module")
    expect(byName.get("unused")?.classification).toBe("unused")
  })

  test("treats package manifest entrypoints as externally consumed exports", async () => {
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/plugin/package.json", {
      name: "@repo/plugin",
      version: "0.0.0",
      main: "./dist/server.js",
      exports: {
        "./server": "./dist/server.js",
        "./tui": "./dist/tui.js",
      },
    })
    await repo.write("packages/plugin/src/server.ts", "export default { name: 'server' }\n")
    await repo.write("packages/plugin/src/tui.ts", "export default { name: 'tui' }\n")
    await repo.write("packages/plugin/src/internal.ts", "export default { name: 'internal' }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byFile = new Map(out.exports.map((entry) => [entry.exportFile, entry]))

    expect(byFile.get(`${repo.root}/packages/plugin/src/server.ts`)?.classification).toBe("cross-package")
    expect(byFile.get(`${repo.root}/packages/plugin/src/tui.ts`)?.classification).toBe("cross-package")
    expect(byFile.get(`${repo.root}/packages/plugin/src/internal.ts`)?.classification).toBe("unused")
  })

  test("treats declarations re-exported from public entry barrels as externally consumed", async () => {
    await repo.writeJson("packages/sdk/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/sdk/package.json", {
      name: "@repo/sdk",
      version: "0.0.0",
    })
    await repo.write("packages/sdk/src/index.ts", "export * from './domain/action'\n")
    await repo.write(
      "packages/sdk/src/domain/action.ts",
      [
        "export interface PublicAction { kind: string }",
        "export const createPublicAction = (): PublicAction => ({ kind: 'public' })",
        "",
      ].join("\n"),
    )
    await repo.write("packages/sdk/src/domain/internal.ts", "export interface InternalOnly { value: string }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("PublicAction")?.classification).toBe("cross-package")
    expect(byName.get("createPublicAction")?.classification).toBe("cross-package")
    expect(byName.get("InternalOnly")?.classification).toBe("unused")
  })

  test("public entry imports do not make imported internals public API", async () => {
    await repo.write("src/index.ts", "import { helper } from './helper'\nexport const api = helper\n")
    await repo.write("src/helper.ts", "export const helper = 1\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("api")?.classification).toBe("cross-package")
    expect(byName.get("helper")?.classification).toBe("cross-module")
  })

  test("runtime API modules are treated as public entry surfaces", async () => {
    await repo.write("extensions/plugin/runtime-api.ts", "export type RuntimeHandle = { id: string }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const entry = out.exports.find((item) => item.exportName === "RuntimeHandle")

    expect(entry?.classification).toBe("cross-package")
  })

  test("reports Convex runtime exports as unused without calibration", async () => {
    await repo.write(
      "convex/lifecycle.ts",
      "export const syncLifecycle = mutation({ handler: async () => null })\n",
    )
    await repo.write("src/internal.ts", "export const ordinaryUnused = true\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("syncLifecycle")?.classification).toBe("unused")
    expect(byName.get("ordinaryUnused")?.classification).toBe("unused")
    expect(out.calibrationDecisions).toEqual([])
  })

  test("project modules can mark Convex runtime exports as public entrypoints", async () => {
    await repo.write(
      "convex/lifecycle.ts",
      [
        "const syncLifecycle = mutation({ handler: async () => null })",
        "export { syncLifecycle as syncLifecyclePublic }",
      ].join("\n"),
    )
    await repo.write("src/internal.ts", "export const ordinaryUnused = true\n")
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["convex", "typescript"],
        sourceExtensions: [".ts"],
      } satisfies RepoFacts,
      processors: [
        defineCalibrationProcessor<"typescript.export-reachability">({
          id: "convex-public-entrypoints",
          moduleId: "@skastr0/pulsar-project-module-convex",
          moduleVersion: "0.0.0",
          slot: "typescript.export-reachability",
          role: "resolver",
          priority: 20,
          fingerprint: "convex-public-entrypoints-v1",
          process: (current) =>
            Effect.sync(() => {
              const localName = current.value.sourceExportSpecifiers?.find((specifier) =>
                specifier.exportedName === current.value.exportName
              )?.localName ?? current.value.exportName
              const localCall = current.value.sourceLocalBindings?.find((binding) =>
                binding.localName === localName
              )?.initializerCall
              if (
                !current.value.exportFile.includes("/convex/") ||
                localCall?.calleeName !== "mutation"
              ) {
                return current
              }
              return appendCalibrationDecision(
                current,
                {
                  moduleId: "@skastr0/pulsar-project-module-convex",
                  processorId: "convex-public-entrypoints",
                  slot: "typescript.export-reachability",
                  action: "mark-public-entrypoint",
                  confidence: "high",
                  reason: "Convex runtime module exports are invoked externally by the Convex runtime",
                  evidence: [
                    { kind: "path", value: current.value.exportFile },
                    { kind: "symbol", value: current.value.exportName },
                  ],
                },
                {
                  ...current.value,
                  isPublicEntrypoint: true,
                },
              )
            }),
        }),
      ],
    })

    const out = await Effect.runPromise(
      TsAb02.compute(TsAb02.defaultConfig, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ),
    )
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("syncLifecyclePublic")?.classification).toBe("cross-package")
    expect(byName.get("ordinaryUnused")?.classification).toBe("unused")
    expect(out.calibrationDecisions).toHaveLength(1)
    expect(out.calibrationDecisions[0]).toMatchObject({
      moduleId: "@skastr0/pulsar-project-module-convex",
      processorId: "convex-public-entrypoints",
      slot: "typescript.export-reachability",
      action: "mark-public-entrypoint",
      confidence: "high",
      reason: "Convex runtime module exports are invoked externally by the Convex runtime",
    })
    expect(out.calibrationDecisions[0]?.evidence).toContainEqual({
      kind: "path",
      value: `${repo.root}/convex/lifecycle.ts`,
    })
    expect(out.calibrationDecisions[0]?.evidence).toContainEqual({
      kind: "symbol",
      value: "syncLifecyclePublic",
    })
  })

  test("Next App Router calibration excludes framework-consumed exports before scoring", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
      },
      include: ["**/*.ts", "**/*.tsx"],
    })
    await repo.writeJson("package.json", {
      name: "next-fixture",
      private: true,
      dependencies: { next: "^16.0.0" },
    })
    await repo.write(
      "app/blog/[slug]/page.tsx",
      [
        "export const metadata = { title: 'Blog' }",
        "export const dynamic = 'force-static'",
        "export async function generateStaticParams() { return [] }",
        "export default function Page() { return null }",
        "export const unusedHelper = () => 'still unused'",
        "",
      ].join("\n"),
    )
    await repo.write(
      "app/api/search/route.ts",
      [
        "export const runtime = 'edge'",
        "export function GET() { return Response.json({ ok: true }) }",
        "",
      ].join("\n"),
    )
    await repo.write(
      "app/blog/opengraph-image.tsx",
      [
        "export const alt = 'Blog'",
        "export const size = { width: 1200, height: 630 }",
        "export const contentType = 'image/png'",
        "export default function Image() { return new Response() }",
        "",
      ].join("\n"),
    )

    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-nextjs-v1",
        detectedTechnologies: ["next", "typescript"],
        sourceExtensions: [".ts", ".tsx"],
      } satisfies RepoFacts,
      activeModules: [nextjsProjectModule.activeModule],
      processors: nextjsProjectModule.processors,
    })

    const out = await Effect.runPromise(
      TsAb02.compute(TsAb02.defaultConfig, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ),
    )
    const byName = new Map(out.exports.map((entry) => [
      `${entry.exportFile.replaceAll("\\", "/").replace(`${repo.root}/`, "")}:${entry.exportName}`,
      entry,
    ]))

    expect(byName.get("app/blog/[slug]/page.tsx:metadata")?.classification).toBe("framework-consumed")
    expect(byName.get("app/blog/[slug]/page.tsx:dynamic")?.classification).toBe("framework-consumed")
    expect(byName.get("app/blog/[slug]/page.tsx:generateStaticParams")?.classification).toBe("framework-consumed")
    expect(byName.get("app/blog/[slug]/page.tsx:default")?.classification).toBe("framework-consumed")
    expect(byName.get("app/api/search/route.ts:GET")?.classification).toBe("framework-consumed")
    expect(byName.get("app/api/search/route.ts:runtime")?.classification).toBe("framework-consumed")
    expect(byName.get("app/blog/opengraph-image.tsx:alt")?.classification).toBe("framework-consumed")
    expect(byName.get("app/blog/[slug]/page.tsx:unusedHelper")?.classification).toBe("unused")
    expect(TsAb02.score(out)).toBe(0)
    expect(TsAb02.diagnose(out).map((diagnostic) => diagnostic.data?.exportName)).toEqual([
      "unusedHelper",
    ])
    expect(out.calibrationDecisions).toHaveLength(10)
    expect(out.calibrationDecisions[0]).toMatchObject({
      moduleId: "@skastr0/pulsar-project-module-nextjs",
      processorId: "nextjs-app-router-export-contracts",
      slot: "typescript.export-reachability",
      action: "mark-framework-consumed",
      ruleId: "nextjs.app-router.export-contract.v1",
    })
  })

  test("diagnostics omit healthy cross-module and cross-package exports", async () => {
    await repo.write("src/index.ts", "export { publicApi } from './api'\n")
    await repo.write(
      "src/api.ts",
      [
        "export const publicApi = 1",
        "export const internalUsed = 2",
        "export const unused = 3",
        "const local = internalUsed",
        "export const localUse = local",
      ].join("\n"),
    )
    await repo.write("src/consumer.ts", "import { localUse } from './api'\nexport const value = localUse\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const diagnosticClassifications = TsAb02.diagnose(out).map(
      (diagnostic) => diagnostic.data?.classification,
    )

    expect(diagnosticClassifications).toContain("unused")
    expect(diagnosticClassifications).toContain("internal-only")
    expect(diagnosticClassifications).not.toContain("cross-module")
    expect(diagnosticClassifications).not.toContain("cross-package")
  })

  test("weights type-only and test-hook unused exports below runtime unused exports", async () => {
    await repo.write(
      "src/api.ts",
      [
        "export const runtimeUnused = 1",
        "export interface TypeOnlyUnused { value: string }",
        "export const createSessionForTest = () => ({})",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("runtimeUnused")?.evidence).toBe("runtime")
    expect(byName.get("runtimeUnused")?.penaltyWeight).toBe(1)
    expect(byName.get("TypeOnlyUnused")?.evidence).toBe("type-only")
    expect(byName.get("TypeOnlyUnused")?.penaltyWeight).toBe(0.35)
    expect(byName.get("createSessionForTest")?.evidence).toBe("test-hook")
    expect(byName.get("createSessionForTest")?.penaltyWeight).toBe(0.2)

    const diagnostics = TsAb02.diagnose(out)
    expect(diagnostics[0]?.message).toContain("runtimeUnused")
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics.some((diagnostic) =>
      diagnostic.message.includes("TypeOnlyUnused") &&
      diagnostic.message.includes("type-only") &&
      diagnostic.severity === "info",
    )).toBe(true)
    expect(diagnostics.some((diagnostic) =>
      diagnostic.message.includes("createSessionForTest") &&
      diagnostic.message.includes("test-hook") &&
      diagnostic.severity === "info",
    )).toBe(true)
  })

  test("score uses weighted unused and internal-only penalties over all exports", async () => {
    await repo.write(
      "src/api.ts",
      [
        "export const runtimeUnused = 1",
        "export const internalOnly = 2",
        "export interface TypeOnlyUnused { value: string }",
        "export const createSessionForTest = () => ({})",
        "export const crossModule = 3",
        "const local = internalOnly",
        "",
      ].join("\n"),
    )
    await repo.write(
      "src/consumer.ts",
      "import { crossModule } from './api'\nconst value = crossModule\nvoid value\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("runtimeUnused")?.classification).toBe("unused")
    expect(byName.get("internalOnly")?.classification).toBe("internal-only")
    expect(byName.get("TypeOnlyUnused")?.classification).toBe("unused")
    expect(byName.get("createSessionForTest")?.classification).toBe("unused")
    expect(byName.get("crossModule")?.classification).toBe("cross-module")
    expect(TsAb02.score(out)).toBeCloseTo(1 - (1 + 0.5 + 0.35 + 0.2) / 5)
  })

  test("diagnostics include ordered boundary and unused payloads", async () => {
    await repo.write(
      "src/domain/api.ts",
      "export const domainOnly = 1\n",
    )
    await repo.write(
      "src/domain/use.ts",
      "import { domainOnly } from './api'\nconst value = domainOnly\nvoid value\n",
    )
    await repo.write(
      "src/other/api.ts",
      "export const runtimeUnused = 2\n",
    )

    const out = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      boundary_rules: [{ name: "domain", globs: ["**/src/domain/**"] }],
    })
    const diagnostics = TsAb02.diagnose(out)
    const boundary = diagnostics.find((diagnostic) =>
      diagnostic.data?.exportName === "domainOnly"
    )
    const unused = diagnostics.find((diagnostic) =>
      diagnostic.data?.exportName === "runtimeUnused"
    )

    expect(diagnostics[0]?.data?.exportName).toBe("domainOnly")
    expect(boundary).toMatchObject({
      severity: "block",
      location: { file: `${repo.root}/src/domain/api.ts` },
      data: {
        hash: expect.any(String),
        exportFile: `${repo.root}/src/domain/api.ts`,
        exportName: "domainOnly",
        classification: "cross-module",
        referenceFiles: [`${repo.root}/src/domain/use.ts`],
      },
    })
    expect(unused).toMatchObject({
      severity: "warn",
      location: { file: `${repo.root}/src/other/api.ts` },
      data: {
        exportFile: `${repo.root}/src/other/api.ts`,
        exportName: "runtimeUnused",
        declarationFiles: [`${repo.root}/src/other/api.ts`],
        classification: "unused",
        evidence: "runtime",
        penaltyWeight: 1,
        referenceFiles: [],
        sameFileReferenceCount: 0,
        viaReExport: false,
        boundaryStatus: "unmapped",
        crossBoundaryFiles: [],
      },
    })
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await repo.write(
      "src/api.ts",
      ["export const alpha = 1", "export const beta = 2", "export const gamma = 3", ""].join("\n"),
    )

    const capped = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    expect(capped.diagnosticLimit).toBe(1)
    expect(TsAb02.diagnose(capped)).toHaveLength(1)

    const negative = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      top_n_diagnostics: -1,
    })
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAb02.diagnose(negative)).toEqual([])

    const nan = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    expect(nan.diagnosticLimit).toBe(0)
    expect(TsAb02.diagnose(nan)).toEqual([])

    const infinite = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsAb02.diagnose(infinite)).toEqual([])
  })

  test("deterministic: same project, same ordering, diagnostics, and score", async () => {
    await repo.write(
      "src/api.ts",
      [
        "export const zeta = 1",
        "export interface Alpha { value: string }",
        "export const createFixtureForTest = () => ({})",
        "",
      ].join("\n"),
    )

    const out1 = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const out2 = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)

    expect(projectOutput(out2)).toEqual(projectOutput(out1))
    expect(TsAb02.diagnose(out2)).toEqual(TsAb02.diagnose(out1))
    expect(TsAb02.score(out2)).toBe(TsAb02.score(out1))
  })

  test("treats pi extension files as externally consumed entrypoints", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: [".pi/**/*.ts"],
    })
    await repo.write(".pi/extensions/files.ts", "export default { name: 'files' }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const entry = out.exports.find((item) => item.exportFile === `${repo.root}/.pi/extensions/files.ts`)

    expect(entry?.classification).toBe("cross-package")
  })

  test("treats framework config files as externally consumed entrypoints", async () => {
    await repo.write("playwright.config.ts", "export default { testDir: './e2e' }\n")
    await repo.write("vite.config.ts", "export const config = { plugins: [] }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byFile = new Map(out.exports.map((entry) => [entry.exportFile, entry]))

    expect(byFile.get(`${repo.root}/playwright.config.ts`)?.classification).toBe("cross-package")
    expect(byFile.get(`${repo.root}/vite.config.ts`)?.classification).toBe("cross-package")
  })

  test("excludes test support exports from production reachability diagnostics", async () => {
    await repo.write("src/api.ts", "export const productionUnused = true\n")
    await repo.write("__tests__/helpers.ts", "export const createFixture = () => ({})\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const names = out.exports.map((entry) => entry.exportName)

    expect(names).toContain("productionUnused")
    expect(names).not.toContain("createFixture")
  })

  test("excludes example and generated exports from production reachability diagnostics", async () => {
    await repo.write("src/api.ts", "export const productionUnused = true\n")
    await repo.write("example/convex/_generated/api.d.ts", "export const api: unknown\n")
    await repo.write("examples/demo.ts", "export const demoOnly = true\n")
    await repo.write("playground/src/components/ui/accordion.tsx", "export const Accordion = () => null\n")
    await repo.write("src/generated/client.ts", "export const generatedClient = true\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const names = out.exports.map((entry) => entry.exportName)

    expect(names).toContain("productionUnused")
    expect(names).not.toContain("api")
    expect(names).not.toContain("demoOnly")
    expect(names).not.toContain("Accordion")
    expect(names).not.toContain("generatedClient")
  })

  test("expands exported destructuring patterns into real binding names", async () => {
    await repo.write(
      "src/context.ts",
      "const context = { use: () => true, provider: () => true }\nexport const { use: useThing, provider: ThingProvider } = context\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const names = out.exports.map((entry) => entry.exportName)
    expect(names).toContain("useThing")
    expect(names).toContain("ThingProvider")
    expect(names.some((name) => name.includes("{"))).toBe(false)
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb02.configSchema)(TsAb02.defaultConfig)
    expect(decoded.exclude_globs).toContain("**/node_modules/**")
    expect(decoded.public_entry_globs).toContain("**/src/index.ts")
    expect(decoded.public_entry_globs).toContain("**/*.config.ts")
    expect(decoded.boundary_rules).toEqual([])
    expect(decoded.top_n_diagnostics).toBe(20)
  })
})

const projectOutput = (out: TsAb02Result): unknown => ({
  exports: out.exports,
  counts: out.counts,
  boundaryConfined: out.boundaryConfined,
  diagnosticLimit: out.diagnosticLimit,
})
