import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"
import { TsLd01 } from "../signals/ts-ld-01-complexity.js"

describe("TS-LD-01 (cyclomatic complexity)", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-ld-01-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("nested callbacks do not inflate outer function complexity", async () => {
    await repo.write(
      "src/index.ts",
      `
export function outer(items: Array<number>) {
  items.map((item) => {
    if (item > 0 && item < 10) {
      return item
    }
    return 0
  })
  return items.length
}
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const outer = out.functions.find((fn) => fn.name === "outer")
    const callback = out.functions.find((fn) => fn.name === "<anonymous>")

    expect(outer?.complexity).toBe(1)
    expect(callback?.complexity).toBe(3)
  })

  test("names object-property callbacks with callsite context", async () => {
    await repo.write(
      "src/index.ts",
      `
const Effect = {
  tryPromise: (options: { try: () => unknown; catch: (error: unknown) => unknown }) => options,
}

export const result = Effect.tryPromise({
  try: () => {
    if (enabled() && ready()) {
      return run()
    }
    return fallback()
  },
  catch: (error) => error,
})
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const callback = out.functions.find((fn) => fn.name === "result/Effect.tryPromise/try")

    expect(callback?.complexity).toBe(3)
    expect(out.functions.some((fn) => fn.name === "try")).toBe(false)
  })

  test("counts branches and boolean operators in one function", async () => {
    await repo.write(
      "src/index.ts",
      `
export function classify(a: boolean, b: boolean, c: boolean) {
  if (a && b) return "ab"
  if (c || b) return "cb"
  return "none"
}
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const classify = out.functions.find((fn) => fn.name === "classify")

    expect(classify?.complexity).toBe(5)
  })
})
