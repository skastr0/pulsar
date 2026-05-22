import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAd03 } from "../signals/ts-ad-03-reexport-depth.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ad-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

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

describe("TS-AD-03 (re-export depth)", () => {
  test("files without re-exports have zero chain depth", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    expect(out.stats.max).toBe(0)
    expect(out.chainsOverThreshold).toHaveLength(0)
    expect(TsAd03.outputMetadata?.(out)).toBeUndefined()
    expect(TsAd03.score(out)).toBe(1)
    expect(TsAd03.diagnose(out)).toEqual([])
  })

  test("a single re-export produces depth 1", async () => {
    const indexPath = await repo.write("src/index.ts", "export { value } from './value'\n")
    await repo.write("src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 0,
    })
    expect(out.byFile.get(indexPath)?.maxChainDepth).toBe(1)
  })

  test("barrels of barrels surface deeper chains", async () => {
    const rootIndex = await repo.write("src/index.ts", "export * from './lib'\n")
    await repo.write("src/lib/index.ts", "export * from './services'\n")
    await repo.write("src/lib/services/index.ts", "export * from './user-service'\n")
    await repo.write("src/lib/services/user-service/index.ts", "export { userService } from './user-service'\n")
    await repo.write("src/lib/services/user-service/user-service.ts", "export const userService = 1\n")

    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    expect(out.byFile.get(rootIndex)?.maxChainDepth).toBe(4)
    expect(out.stats.max).toBe(4)
  })

  test("workspace package-name re-exports participate in chain detection", async () => {
    await writePackage("core", "@scope/core")
    await writePackage("facade", "@scope/facade")
    const facadePath = await repo.write("packages/facade/src/index.ts", "export * from '@scope/core'\n")
    const corePath = await repo.write("packages/core/src/index.ts", "export { value } from './value'\n")
    const valuePath = await repo.write("packages/core/src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
    })

    expect(out.chainsOverThreshold[0]).toMatchObject({
      start: facadePath,
      end: valuePath,
      depth: 2,
      hops: [facadePath, corePath, valuePath],
    })
    expect(TsAd03.diagnose(out)[0]?.message).toContain("packages/facade/src/index.ts")
  })

  test("package-local source alias re-exports participate in chain detection", async () => {
    await writePackage("app", "@scope/app")
    const indexPath = await repo.write("packages/app/src/index.ts", "export * from '@/features'\n")
    const featuresPath = await repo.write(
      "packages/app/src/features/index.ts",
      "export { value } from './value'\n",
    )
    const valuePath = await repo.write("packages/app/src/features/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
    })

    expect(out.chainsOverThreshold[0]).toMatchObject({
      start: indexPath,
      end: valuePath,
      depth: 2,
      hops: [indexPath, featuresPath, valuePath],
    })
    expect(TsAd03.diagnose(out)[0]?.message).toContain("packages/app/src/index.ts")
  })

  test("very deep chains exceed the threshold and appear in diagnostics", async () => {
    await repo.write("src/index.ts", "export * from './l1'\n")
    await repo.write("src/l1/index.ts", "export * from './l2'\n")
    await repo.write("src/l1/l2/index.ts", "export * from './l3'\n")
    await repo.write("src/l1/l2/l3/index.ts", "export * from './l4'\n")
    await repo.write("src/l1/l2/l3/l4/index.ts", "export * from './l5'\n")
    await repo.write("src/l1/l2/l3/l4/l5/index.ts", "export { value } from './value'\n")
    await repo.write("src/l1/l2/l3/l4/l5/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    expect(out.stats.max).toBe(6)
    const diagnostic = TsAd03.diagnose(out)[0]
    expect(diagnostic?.message).toContain("depth 6")
    expect(diagnostic?.message).toContain("src/index.ts")
    expect(diagnostic?.message).not.toContain(repo.root)
    expect(diagnostic).toEqual(
      expect.objectContaining({
        severity: "warn",
        location: expect.objectContaining({
          file: expect.stringContaining("src/index.ts"),
        }),
        data: expect.objectContaining({
          start: expect.stringContaining("src/index.ts"),
          end: expect.stringContaining("src/l1/l2/l3/l4/l5/value.ts"),
          depth: 6,
          effectiveDepth: 4,
          cycle: false,
        }),
      }),
    )
    expect(TsAd03.score(out)).toBeCloseTo(2 / 3)
    const data = diagnostic?.data as
      | { readonly hops?: ReadonlyArray<string>; readonly displayHops?: ReadonlyArray<string> }
      | undefined
    expect(data?.hops?.[0]).toContain(repo.root)
    expect(data?.displayHops?.[0]).toBe("src/index.ts")
  })

  test("directory index barrel relays are discounted in score but still diagnosed", async () => {
    await repo.write("src/index.ts", "export * from './l1'\n")
    await repo.write("src/l1/index.ts", "export * from './l2'\n")
    await repo.write("src/l1/l2/index.ts", "export * from './l3'\n")
    await repo.write("src/l1/l2/l3/index.ts", "export * from './l4'\n")
    await repo.write("src/l1/l2/l3/l4/index.ts", "export * from './value'\n")
    await repo.write("src/l1/l2/l3/l4/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    const diagnostic = TsAd03.diagnose(out)[0]
    const data = diagnostic?.data as { readonly effectiveDepth?: number } | undefined

    expect(out.stats.max).toBe(5)
    expect(data?.effectiveDepth).toBe(3)
    expect(TsAd03.score(out)).toBe(1)
    expect(diagnostic?.message).toContain("depth 5")
  })

  test("deduplicates identical chains from repeated re-export declarations", async () => {
    await repo.write("src/index.ts", "export * from './lib'\nexport { value } from './lib'\n")
    await repo.write("src/lib/index.ts", "export { value } from './value'\n")
    await repo.write("src/lib/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 0,
    })

    const messages = TsAd03.diagnose(out).map((diagnostic) => diagnostic.message)
    expect(new Set(messages).size).toBe(messages.length)
  })

  test("diagnostics prefer representative starts before repeated branches", async () => {
    const indexPath = await repo.write("src/index.ts", "export * from './a'\nexport * from './b'\n")
    await repo.write("src/a/index.ts", "export { value as a } from './value'\n")
    await repo.write("src/a/value.ts", "export const value = 1\n")
    await repo.write("src/b/index.ts", "export { value as b } from './value'\n")
    await repo.write("src/b/value.ts", "export const value = 1\n")
    const otherPath = await repo.write("src/other.ts", "export * from './c'\n")
    await repo.write("src/c/index.ts", "export { value as c } from './value'\n")
    await repo.write("src/c/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
      top_n_diagnostics: 2,
    })

    const files = TsAd03.diagnose(out).map((diagnostic) => diagnostic.location?.file)
    expect(files).toContain(indexPath)
    expect(files).toContain(otherPath)
  })

  test("diagnostics honor top_n_diagnostics as a sanitized chain cap", async () => {
    await repo.write("src/index.ts", "export * from './a'\nexport * from './b'\n")
    await repo.write("src/a/index.ts", "export { value as a } from './value'\n")
    await repo.write("src/a/value.ts", "export const value = 1\n")
    await repo.write("src/b/index.ts", "export { value as b } from './value'\n")
    await repo.write("src/b/value.ts", "export const value = 1\n")
    await repo.write("src/other.ts", "export * from './c'\n")
    await repo.write("src/c/index.ts", "export { value as c } from './value'\n")
    await repo.write("src/c/value.ts", "export const value = 1\n")

    const fractional = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
      top_n_diagnostics: 1.8,
    })
    const negative = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
      top_n_diagnostics: -1,
    })
    const nanLimit = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 1,
      top_n_diagnostics: Infinity,
    })

    expect(fractional.chainsOverThreshold.length).toBeGreaterThan(1)
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsAd03.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAd03.diagnose(negative)).toEqual([])
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsAd03.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsAd03.diagnose(infiniteLimit)).toEqual([])
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAd03.configSchema)(TsAd03.defaultConfig)

    expect(decoded.chain_threshold).toBe(3)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
  })

  test("pack registration exposes identity, cache version, and config factor ledger", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")
    const registered = registeredTsAd03()
    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    const factorLedger = registered.factorLedger?.(out)

    expect(registered.id).toBe("TS-AD-03-reexport-depth")
    expect(registered.aliases).toContain("TS-AD-03")
    expect(registered.title).toBe("Re-export depth")
    expect(registered.cacheVersion).toContain(TsAd03.cacheVersion)
    expect(factorLedger?.signalId).toBe(TsAd03.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("circular re-exports are capped and diagnosed", async () => {
    await repo.write("src/a.ts", "export * from './b'\n")
    await repo.write("src/b.ts", "export * from './a'\n")

    const out = await runSignal(repo.root, TsAd03, {
      ...TsAd03.defaultConfig,
      chain_threshold: 0,
    })
    expect(out.chainsOverThreshold.some((chain) => chain.cycle)).toBe(true)
  })
})

const registeredTsAd03 = () => {
  const signal = TS_PACK_SIGNALS.find((candidate) => candidate.id === TsAd03.id)
  if (signal === undefined) throw new Error("TS-AD-03 is not registered")
  return signal
}
