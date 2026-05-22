import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsDe03 } from "../signals/ts-de-03-propagation-cost.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
type TsDe03Result = Parameters<typeof TsDe03.score>[0]

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-de-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-DE-03 (propagation cost)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-DE-03"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsDe03]))
    const out = await runTsDe03()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsDe03).toMatchObject({
      id: "TS-DE-03-propagation-cost",
      title: "Propagation cost",
      aliases: ["TS-DE-03"],
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "diagnostic-limit-and-module-resolution-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsDe03.id)
    expect(registered?.title).toBe(TsDe03.title)
    expect(registered?.cacheVersion).toContain(TsDe03.cacheVersion)
    expect(registry.byId.get("TS-DE-03")?.id).toBe(TsDe03.id)
    expect(factorLedger?.signalId).toBe(TsDe03.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.target",
        value: 0.3,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.scale",
        value: 0.4,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.small_sample_threshold",
        value: 20,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("trivial graph has zero propagation cost", async () => {
    await repo.write("src/a.ts", "export const a = 1\n")

    const out = await runTsDe03()
    expect(out.totalModules).toBe(1)
    expect(out.propagationCost).toBe(0)
    expect(out.diagnosticLimit).toBe(10)
    expect(TsDe03.outputMetadata?.(out)).toBeUndefined()
    expect(TsDe03.inputs).toEqual([])
    expect(TsDe03.score(out)).toBe(1)
    expect(out.byModule.get(`${repo.root}/src/a.ts`)?.reverseReach).toBe(0)
  })

  test("diamond graph computes reverse reach correctly", async () => {
    await repo.write("src/base.ts", "export const base = 1\n")
    await repo.write("src/left.ts", "import { base } from './base'\nexport const left = base\n")
    await repo.write("src/right.ts", "import { base } from './base'\nexport const right = base\n")
    await repo.write(
      "src/top.ts",
      "import { left } from './left'\nimport { right } from './right'\nexport const top = left + right\n",
    )

    const out = await runTsDe03()
    const base = out.byModule.get(`${repo.root}/src/base.ts`)
    const left = out.byModule.get(`${repo.root}/src/left.ts`)
    expect(out.propagationCost).toBeCloseTo(5 / 16)
    expect(base?.reverseReach).toBe(3)
    expect(left?.reverseReach).toBe(1)
  })

  test("type-only imports do not increase propagation reach", async () => {
    await repo.write("src/types.ts", "export interface User { readonly id: string }\n")
    await repo.write(
      "src/view.ts",
      "import type { User } from './types'\nexport interface View { readonly user: User }\n",
    )
    await repo.write(
      "src/consumer.ts",
      "import { View } from './view'\nexport interface Consumer { readonly view: View }\n",
    )

    const out = await runTsDe03()
    expect(out.byModule.get(`${repo.root}/src/types.ts`)?.reverseReach).toBe(0)
    expect(out.byModule.get(`${repo.root}/src/view.ts`)?.reverseReach).toBe(0)
    expect(out.propagationCost).toBe(0)
  })

  test("re-export declarations do not count as propagation edges", async () => {
    await repo.write("src/target.ts", "export const value = 1\n")
    await repo.write("src/types.ts", "export interface User { readonly id: string }\n")
    await repo.write("src/barrel.ts", "export { value } from './target'\n")
    await repo.write("src/type-barrel.ts", "export type { User } from './types'\n")

    const out = await runTsDe03()

    expect(out.byModule.get(`${repo.root}/src/target.ts`)?.reverseReach).toBe(0)
    expect(out.byModule.get(`${repo.root}/src/types.ts`)?.reverseReach).toBe(0)
    expect(out.byModule.get(`${repo.root}/src/barrel.ts`)?.forwardReach).toBe(0)
    expect(out.byModule.get(`${repo.root}/src/type-barrel.ts`)?.forwardReach).toBe(0)
    expect(out.propagationCost).toBe(0)
  })

  test("package-local source aliases contribute propagation edges", async () => {
    await writePackage("app", "@repo/app")
    await repo.write("packages/app/src/base.ts", "export const base = 1\n")
    await repo.write(
      "packages/app/src/consumer.ts",
      "import { base } from '@/base'\nexport const value = base\n",
    )

    const out = await runTsDe03()

    expect(out.byModule.get(`${repo.root}/packages/app/src/base.ts`)?.reverseReach).toBe(1)
    expect(out.byModule.get(`${repo.root}/packages/app/src/consumer.ts`)?.forwardReach).toBe(1)
  })

  test("workspace package-name imports contribute propagation edges", async () => {
    await writePackage("app", "@repo/app")
    await writePackage("core", "@repo/core")
    await repo.write("packages/core/src/index.ts", "export const core = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { core } from '@repo/core'\nexport const app = core\n",
    )

    const out = await runTsDe03()

    expect(out.byModule.get(`${repo.root}/packages/core/src/index.ts`)?.reverseReach).toBe(1)
    expect(out.byModule.get(`${repo.root}/packages/app/src/index.ts`)?.forwardReach).toBe(1)
  })

  test("cycles count peers inside the strongly connected component", async () => {
    await repo.write("src/a.ts", "import { b } from './b'\nexport const a = b\n")
    await repo.write("src/b.ts", "import { a } from './a'\nexport const b = a\n")

    const out = await runTsDe03()
    expect(out.byModule.get(`${repo.root}/src/a.ts`)?.forwardReach).toBe(1)
    expect(out.byModule.get(`${repo.root}/src/b.ts`)?.reverseReach).toBe(1)
    expect(out.propagationCost).toBe(0.5)
  })

  test("SCCs add intra-component peers and external reverse reach", async () => {
    await repo.write("src/a.ts", "import { b } from './b'\nexport const a = b + 1\n")
    await repo.write("src/b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    await repo.write("src/d.ts", "import { a } from './a'\nexport const d = a + 1\n")
    await repo.write("src/e.ts", "import { d } from './d'\nexport const e = d + 1\n")

    const out = await runTsDe03()

    expect(out.byModule.get(`${repo.root}/src/a.ts`)?.reverseReach).toBe(3)
    expect(out.byModule.get(`${repo.root}/src/b.ts`)?.reverseReach).toBe(3)
    expect(out.byModule.get(`${repo.root}/src/d.ts`)?.forwardReach).toBe(2)
    expect(out.propagationCost).toBeCloseTo(7 / 16)
  })

  test("star graph ranks the hub as the top propagator", async () => {
    await repo.write("src/core.ts", "export const core = 1\n")
    for (let index = 0; index < 5; index += 1) {
      await repo.write(
        `src/consumer-${index}.ts`,
        `import { core } from './core'\nexport const value${index} = core + ${index}\n`,
      )
    }

    const out = await runTsDe03()
    expect(out.top10Propagators[0]?.file).toBe(`${repo.root}/src/core.ts`)
    expect(out.top10Propagators[0]?.reverseReach).toBe(5)
  })

  test("does not diagnose top propagators when propagation cost is under target", async () => {
    await repo.write("src/core.ts", "export const core = 1\n")
    for (let index = 0; index < 5; index += 1) {
      await repo.write(
        `src/consumer-${index}.ts`,
        `import { core } from './core'\nexport const value${index} = core + ${index}\n`,
      )
    }

    const out = await runTsDe03({
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
    })
    expect(TsDe03.score(out)).toBe(1)
    expect(TsDe03.diagnose(out)).toHaveLength(0)
  })

  test("diagnoses top propagators when propagation cost exceeds target", async () => {
    await writeChain(5)

    const out = await runTsDe03({
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
    })
    const diagnostics = TsDe03.diagnose(out)

    expect(out.propagationCost).toBeCloseTo(15 / 36)
    expect(TsDe03.score(out)).toBeCloseTo(1 - ((15 / 36 - 0.3) / 0.4))
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("High propagation cost module"),
      location: { file: `${repo.root}/src/base.ts` },
      data: {
        file: `${repo.root}/src/base.ts`,
        reverseReach: 5,
        propagationCost: out.propagationCost,
        reachabilityMode: "bitset",
      },
    })
  })

  test("diagnostics honor top_n_diagnostics as a sanitized top-propagator cap", async () => {
    await writeChain(5)
    const baseConfig = {
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
    }

    const fractional = await runTsDe03({
      ...baseConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await runTsDe03({
      ...baseConfig,
      top_n_diagnostics: -1,
    })
    const nanLimit = await runTsDe03({
      ...baseConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await runTsDe03({
      ...baseConfig,
      top_n_diagnostics: Infinity,
    })

    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsDe03.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsDe03.diagnose(negative)).toEqual([])
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsDe03.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsDe03.diagnose(infiniteLimit)).toEqual([])
  })

  test("diagnostic cap can exceed the legacy top-10 output list", async () => {
    await writeChain(12)

    const out = await runTsDe03({
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
      top_n_diagnostics: 12,
    })
    const diagnostics = TsDe03.diagnose(out)

    expect(out.top10Propagators).toHaveLength(10)
    expect(out.topPropagators.length).toBeGreaterThanOrEqual(12)
    expect(diagnostics).toHaveLength(12)
    expect(diagnostics[0]?.location?.file).toBe(`${repo.root}/src/base.ts`)
    expect(diagnostics[11]?.location?.file).toBe(`${repo.root}/src/level-11.ts`)
  })

  test("small sample warning appears below the configured threshold", async () => {
    await repo.write("src/a.ts", "export const a = 1\n")
    await repo.write("src/b.ts", "import { a } from './a'\nexport const b = a\n")

    const out = await runTsDe03()
    const diagnostic = TsDe03.diagnose(out)[0]

    expect(diagnostic).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("sample size is small"),
      data: {
        totalModules: 2,
        threshold: 20,
      },
    })
  })

  test("default exclusions ignore TS and TSX test files", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
      },
      include: ["**/*.ts", "**/*.tsx"],
    })
    await repo.write("src/base.ts", "export const base = 1\n")
    for (const path of [
      "src/consumer.test.ts",
      "src/consumer.spec.ts",
      "src/consumer.test.tsx",
      "src/consumer.spec.tsx",
    ]) {
      await repo.write(path, "import { base } from './base'\nexport const value = base\n")
    }

    const out = await runTsDe03()

    expect(out.totalModules).toBe(1)
    expect(out.byModule.get(`${repo.root}/src/base.ts`)?.reverseReach).toBe(0)
  })

  test("configured exclude_globs remove custom files from the propagation graph", async () => {
    await repo.write("src/base.ts", "export const base = 1\n")
    await repo.write("src/ignored.ts", "import { base } from './base'\nexport const value = base\n")

    const out = await runTsDe03({
      ...TsDe03.defaultConfig,
      exclude_globs: [...TsDe03.defaultConfig.exclude_globs, "**/ignored.ts"],
    })

    expect(out.totalModules).toBe(1)
    expect(out.byModule.has(`${repo.root}/src/ignored.ts`)).toBe(false)
    expect(out.byModule.get(`${repo.root}/src/base.ts`)?.reverseReach).toBe(0)
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsDe03.configSchema)(TsDe03.defaultConfig)
    expect(decoded.target).toBe(0.3)
    expect(decoded.scale).toBe(0.4)
    expect(decoded.small_sample_threshold).toBe(20)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
    expect(decoded.exclude_globs).toContain("**/*.spec.ts")
    expect(decoded.exclude_globs).toContain("**/*.test.tsx")
    expect(decoded.exclude_globs).toContain("**/*.spec.tsx")
  })
})

const runTsDe03 = async (
  config = TsDe03.defaultConfig,
): Promise<TsDe03Result> =>
  runSignal(repo.root, TsDe03, config)

const writePackage = async (slug: string, name: string): Promise<void> => {
  await repo.writeJson(`packages/${slug}/package.json`, {
    name,
    version: "0.0.0",
    private: true,
  })
  await repo.writeJson(`packages/${slug}/tsconfig.json`, {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  })
}

const writeChain = async (lastLevel: number): Promise<void> => {
  await repo.write("src/base.ts", "export const value0 = 0\n")
  for (let index = 1; index <= lastLevel; index += 1) {
    await repo.write(
      `src/level-${index}.ts`,
      `import { value${index - 1} } from './${index === 1 ? "base" : `level-${index - 1}`}'\n` +
        `export const value${index} = value${index - 1} + 1\n`,
    )
  }
}
