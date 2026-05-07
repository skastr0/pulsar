import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAb04 } from "../signals/ts-ab-04-interface-impl-ratio.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ab-04-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-04 (interface to implementation ratio)", () => {
  test("flags a single production implementation without a test substitute", async () => {
    await repo.write(
      "src/service.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "export class ServiceImpl implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.flaggedPairs).toHaveLength(1)
    expect(out.flaggedPairs[0]?.interfaceName).toBe("IService")
  })

  test("test substitutes prevent a single-implementation pair from being flagged", async () => {
    await repo.write(
      "src/service.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "export class ServiceImpl implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/service.test.ts",
      [
        "import type { IService } from './service'",
        "export const fakeService: IService = {",
        "  run() {",
        "    return 'fake'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.pairs[0]?.hasTestSubstitute).toBe(true)
  })

  test("multiple implementations are not flagged", async () => {
    await repo.write(
      "src/multi.ts",
      [
        "export interface IHandler { handle(): string }",
        "export class One implements IHandler { handle() { return '1' } }",
        "export class Two implements IHandler { handle() { return '2' } }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.flaggedPairs).toHaveLength(0)
  })

  test("dead interfaces are surfaced separately", async () => {
    await repo.write(
      "src/dead.ts",
      [
        "export interface IDead {",
        "  run(): void",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.deadInterfaces[0]?.interfaceName).toBe("IDead")
    expect(out.deadInterfaceRatio).toBe(1)
    expect(TsAb04.score(out)).toBe(0.75)
  })

  test("test-only interfaces are excluded from the ratio", async () => {
    await repo.write(
      "src/only.test.ts",
      [
        "interface IOnlyTest { run(): void }",
        "const fake: IOnlyTest = { run() {} }",
        "export { fake }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.totalInterfaces).toBe(0)
    expect(TsAb04.outputMetadata?.(out)?.applicability).toBe("not_applicable")
  })
})
