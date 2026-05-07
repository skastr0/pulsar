import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsDe03 } from "../signals/ts-de-03-propagation-cost.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-de-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-DE-03 (propagation cost)", () => {
  test("trivial graph has zero propagation cost", async () => {
    await repo.write("src/a.ts", "export const a = 1\n")

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
    expect(out.propagationCost).toBe(0)
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

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
    const base = out.byModule.get(`${repo.root}/src/base.ts`)
    const left = out.byModule.get(`${repo.root}/src/left.ts`)
    expect(base?.reverseReach).toBe(3)
    expect(left?.reverseReach).toBe(1)
  })

  test("type-only imports do not increase propagation reach", async () => {
    await repo.write("src/types.ts", "export interface User { readonly id: string }\n")
    await repo.write(
      "src/view.ts",
      "import { User } from './types'\nexport interface View { readonly user: User }\n",
    )
    await repo.write(
      "src/consumer.ts",
      "import { View } from './view'\nexport interface Consumer { readonly view: View }\n",
    )

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
    expect(out.byModule.get(`${repo.root}/src/types.ts`)?.reverseReach).toBe(0)
    expect(out.byModule.get(`${repo.root}/src/view.ts`)?.reverseReach).toBe(0)
    expect(out.propagationCost).toBe(0)
  })

  test("cycles count peers inside the strongly connected component", async () => {
    await repo.write("src/a.ts", "import { b } from './b'\nexport const a = b\n")
    await repo.write("src/b.ts", "import { a } from './a'\nexport const b = a\n")

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
    expect(out.byModule.get(`${repo.root}/src/a.ts`)?.forwardReach).toBe(1)
    expect(out.byModule.get(`${repo.root}/src/b.ts`)?.reverseReach).toBe(1)
  })

  test("star graph ranks the hub as the top propagator", async () => {
    await repo.write("src/core.ts", "export const core = 1\n")
    for (let index = 0; index < 5; index += 1) {
      await repo.write(
        `src/consumer-${index}.ts`,
        `import { core } from './core'\nexport const value${index} = core + ${index}\n`,
      )
    }

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
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

    const out = await runSignal(repo.root, TsDe03, {
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
    })
    expect(TsDe03.score(out)).toBe(1)
    expect(TsDe03.diagnose(out)).toHaveLength(0)
  })

  test("diagnoses top propagators when propagation cost exceeds target", async () => {
    await repo.write("src/base.ts", "export const value0 = 0\n")
    for (let index = 1; index <= 5; index += 1) {
      await repo.write(
        `src/level-${index}.ts`,
        `import { value${index - 1} } from './${index === 1 ? "base" : `level-${index - 1}`}'\n` +
          `export const value${index} = value${index - 1} + 1\n`,
      )
    }

    const out = await runSignal(repo.root, TsDe03, {
      ...TsDe03.defaultConfig,
      small_sample_threshold: 0,
    })
    expect(TsDe03.score(out)).toBeLessThan(1)
    expect(TsDe03.diagnose(out)[0]?.message).toContain("High propagation cost module")
  })

  test("small sample warning appears below the configured threshold", async () => {
    await repo.write("src/a.ts", "export const a = 1\n")
    await repo.write("src/b.ts", "import { a } from './a'\nexport const b = a\n")

    const out = await runSignal(repo.root, TsDe03, TsDe03.defaultConfig)
    expect(TsDe03.diagnose(out)[0]?.message).toContain("sample size is small")
  })
})
