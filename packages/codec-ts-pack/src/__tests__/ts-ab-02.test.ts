import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import {
  CalibrationContextTag,
  appendCalibrationDecision,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@taste-codec/core"
import { TsAb02 } from "../signals/ts-ab-02-unused-exports-reachability.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-ab-02-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-02 (unused exports reachability)", () => {
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
      "export const syncLifecycle = mutation({ handler: async () => null })\n",
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
          moduleId: "@taste-codec/project-module-convex",
          moduleVersion: "0.0.0",
          slot: "typescript.export-reachability",
          role: "resolver",
          priority: 20,
          fingerprint: "convex-public-entrypoints-v1",
          process: (current) =>
            Effect.sync(() => {
              if (!current.value.exportFile.includes("/convex/")) return current
              return appendCalibrationDecision(
                current,
                {
                  moduleId: "@taste-codec/project-module-convex",
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

    expect(byName.get("syncLifecycle")?.classification).toBe("cross-package")
    expect(byName.get("ordinaryUnused")?.classification).toBe("unused")
    expect(out.calibrationDecisions).toHaveLength(1)
    expect(out.calibrationDecisions[0]?.slot).toBe("typescript.export-reachability")
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

  test("treats opencode tool files as externally consumed entrypoints", async () => {
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts", ".opencode/tools/**/*.ts"],
    })
    await repo.writeJson("packages/plugin/package.json", {
      name: "@repo/plugin",
      version: "0.0.0",
    })
    await repo.write(
      "packages/plugin/.opencode/tools/effect-status.ts",
      "export default { name: 'effect-status' }\n",
    )
    await repo.write("packages/plugin/src/internal.ts", "export default { name: 'internal' }\n")

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byFile = new Map(out.exports.map((entry) => [entry.exportFile, entry]))

    expect(
      byFile.get(`${repo.root}/packages/plugin/.opencode/tools/effect-status.ts`)?.classification,
    ).toBe("cross-package")
    expect(byFile.get(`${repo.root}/packages/plugin/src/internal.ts`)?.classification).toBe("unused")
  })

  test("treats singular opencode tool and plugin files as externally consumed entrypoints", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve" },
      include: [".opencode/**/*.ts", ".opencode/**/*.tsx"],
    })
    await repo.write(
      ".opencode/tool/github-triage.ts",
      "export default { name: 'github-triage' }\n",
    )
    await repo.write(
      ".opencode/plugins/tui-smoke.tsx",
      "export default { name: 'tui-smoke' }\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byFile = new Map(out.exports.map((entry) => [entry.exportFile, entry]))

    expect(byFile.get(`${repo.root}/.opencode/tool/github-triage.ts`)?.classification).toBe("cross-package")
    expect(byFile.get(`${repo.root}/.opencode/plugins/tui-smoke.tsx`)?.classification).toBe("cross-package")
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
})
