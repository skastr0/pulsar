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
    expect(TsAd03.diagnose(out)[0]?.message).toContain("depth 6")
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
