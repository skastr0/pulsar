import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsLd03 } from "../signals/ts-ld-03-nesting-depth.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-ld-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-LD-03 (nesting depth)", () => {
  test("top-level branch counts as depth 1", async () => {
    await repo.write(
      "src/flat.ts",
      [
        "export function flat(flag: boolean) {",
        "  if (flag) {",
        "    return 1",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(1)
    expect([...out.byFile.values()][0]?.max).toBe(1)
  })

  test("deeply nested control flow reaches depth 5", async () => {
    await repo.write(
      "src/deep.ts",
      [
        "export function process(items: Array<{ status: string; type: string; children: string[] }>) {",
        "  for (const item of items) {",
        "    if (item.status === 'x') {",
        "      try {",
        "        if (item.type === 'a') {",
        "          for (const child of item.children) {",
        "            console.log(child)",
        "          }",
        "        }",
        "      } catch {",
        "        return 0",
        "      }",
        "    }",
        "  }",
        "  return 1",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(5)
    expect(out.overThreshold).toHaveLength(1)
  })

  test("nested callbacks reset depth at function boundaries", async () => {
    await repo.write(
      "src/callback.ts",
      [
        "export function outer(items: number[]) {",
        "  if (items.length > 0) {",
        "    return items.map((item) => {",
        "      if (item > 0) {",
        "        return item + 1",
        "      }",
        "      return item",
        "    })",
        "  }",
        "  return []",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    const outer = out.byFunction.find((entry) => entry.name === "outer")
    const callback = out.byFunction.find((entry) => entry.name === "<anonymous>")
    expect(outer?.maxNesting).toBe(1)
    expect(callback?.maxNesting).toBe(1)
  })

  test("switch statements count as control-flow depth", async () => {
    await repo.write(
      "src/switch.ts",
      [
        "export function chooser(value: string) {",
        "  switch (value) {",
        "    case 'a':",
        "      return 1",
        "    default:",
        "      return 0",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(1)
  })

  test("threshold is configurable", async () => {
    await repo.write(
      "src/threshold.ts",
      [
        "export function nested(flag: boolean) {",
        "  if (flag) {",
        "    while (flag) {",
        "      return 1",
        "    }",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, {
      ...TsLd03.defaultConfig,
      max_nesting: 1,
    })
    expect(out.overThreshold).toHaveLength(1)
  })
})
