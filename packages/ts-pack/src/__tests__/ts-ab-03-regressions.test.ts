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

  test("importer-local aliases cannot shadow imported alias internals", async () => {
    await repo.write(
      "src/types.ts",
      [
        "type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )
    await repo.write(
      "src/public.ts",
      [
        "import type { C } from './types'",
        "type B = string",
        "export type Public = C",
        "",
      ].join("\n"),
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

  test("generic alias wrappers cannot hide concrete argument depth", async () => {
    await repo.write(
      "src/generic.ts",
      [
        "type Deep1 = string",
        "type Deep2 = Deep1",
        "type Id<T> = T",
        "export type ViaId = Id<Deep2>",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb03, TsAb03.defaultConfig)
    const viaId = out.declarations.find((entry) => entry.name === "ViaId")

    expect(viaId?.depth).toBe(4)
    expect(viaId?.chain).toEqual(["ViaId", "Id", "Deep2", "Deep1"])
  })

  test("direct interface and class heritage contributes indirection depth", async () => {
    await repo.write(
      "src/heritage-direct.ts",
      [
        "export interface Root { readonly id: string }",
        "export interface Base extends Root { readonly label: string }",
        "export interface Child extends Base { readonly name: string }",
        "export class BaseClass {}",
        "export class ChildClass extends BaseClass {}",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb03, TsAb03.defaultConfig)
    const byName = new Map(out.declarations.map((entry) => [entry.name, entry]))

    expect(byName.get("Child")?.depth).toBe(2)
    expect(byName.get("Child")?.chain).toEqual(["Base", "Root"])
    expect(byName.get("ChildClass")?.depth).toBe(1)
    expect(byName.get("ChildClass")?.chain).toEqual(["BaseClass"])
  })

  test("traversal cap evidence is preserved for zero-depth truncated branches", async () => {
    await repo.write(
      "src/truncated.ts",
      [
        "type B = string",
        "export type A = { readonly value: B }",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb03, {
      ...TsAb03.defaultConfig,
      max_traversal_steps: 2,
    })
    const alias = out.declarations.find((entry) => entry.name === "A")

    expect(alias?.truncated).toBe(true)
    expect(alias?.chain).toContain("<truncated>")
  })
})
