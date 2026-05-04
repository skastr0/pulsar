import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAd03 } from "../signals/ts-ad-03-reexport-depth.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-ad-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AD-03 (re-export depth)", () => {
  test("files without re-exports have zero chain depth", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAd03, TsAd03.defaultConfig)
    expect(out.stats.max).toBe(0)
    expect(out.chainsOverThreshold).toHaveLength(0)
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
    const data = diagnostic?.data as
      | { readonly hops?: ReadonlyArray<string>; readonly displayHops?: ReadonlyArray<string> }
      | undefined
    expect(data?.hops?.[0]).toContain(repo.root)
    expect(data?.displayHops?.[0]).toBe("src/index.ts")
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
