import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAb03 } from "../signals/ts-ab-03-type-indirection-depth.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ab-03-regressions-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-03 type indirection regressions", () => {
  test("resolves imported alias chains across source files", async () => {
    await repo.write(
      "src/types.ts",
      [
        "export type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )
    await repo.write(
      "src/public.ts",
      "import type { C } from './types'\nexport type Public = C\n",
    )

    const out = await runSignal(repo.root, TsAb03, TsAb03.defaultConfig)
    const publicAlias = out.declarations.find((entry) => entry.name === "Public")

    expect(publicAlias?.depth).toBe(4)
    expect(publicAlias?.chain).toEqual(["Public", "C", "B", "A"])
  })

  test("resolves import-type alias qualifiers across source files", async () => {
    await repo.write(
      "src/types.ts",
      [
        "export type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )
    await repo.write(
      "src/public.ts",
      "export type PublicImport = import('./types').C\n",
    )

    const out = await runSignal(repo.root, TsAb03, TsAb03.defaultConfig)
    const publicAlias = out.declarations.find((entry) => entry.name === "PublicImport")

    expect(publicAlias?.depth).toBe(5)
    expect(publicAlias?.chain).toEqual(["PublicImport", "<import-type>", "C", "B", "A"])
  })
})
