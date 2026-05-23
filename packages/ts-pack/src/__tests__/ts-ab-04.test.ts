import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb04 } from "../signals/ts-ab-04-interface-impl-ratio.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
type TsAb04Result = Parameters<typeof TsAb04.score>[0]

const stableTsAb04Output = (out: TsAb04Result): unknown => ({
  pairs: out.pairs,
  flaggedPairs: out.flaggedPairs,
  totalInterfaces: out.totalInterfaces,
  ratio: out.ratio,
  deadInterfaces: out.deadInterfaces,
  deadInterfaceRatio: out.deadInterfaceRatio,
  singleImplementationPressure: out.singleImplementationPressure,
  deadInterfacePressure: out.deadInterfacePressure,
  diagnosticLimit: out.diagnosticLimit,
})

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ab-04-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-04 (interface to implementation ratio)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AB-04"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("TS-AB-04")
    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsAb04).toMatchObject({
      id: "TS-AB-04-interface-implementation-ratio",
      title: "Interface implementation ratio",
      aliases: ["TS-AB-04"],
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "interface-implementation-ratio-v15-composed-substitutes-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsAb04.id)
    expect(registered?.title).toBe(TsAb04.title)
    expect(registered?.cacheVersion).toContain(TsAb04.cacheVersion)
    expect(registry.byId.get("TS-AB-04")?.id).toBe(TsAb04.id)
    expect(factorLedger?.signalId).toBe(TsAb04.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.test_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.public_entry_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 20,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("no production interfaces: neutral output, score 1, and no diagnostics", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toEqual([])
    expect(out.flaggedPairs).toEqual([])
    expect(out.deadInterfaces).toEqual([])
    expect(out.totalInterfaces).toBe(0)
    expect(out.ratio).toBe(0)
    expect(out.deadInterfaceRatio).toBe(0)
    expect(out.singleImplementationPressure).toBe(0)
    expect(out.deadInterfacePressure).toBe(0)
    expect(out.diagnosticLimit).toBe(20)
    expect(TsAb04.score(out)).toBe(1)
    expect(TsAb04.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    expect(TsAb04.diagnose(out)).toEqual([])
  })

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

  test("satisfies and as object literals count as test substitutes", async () => {
    await repo.write(
      "src/service.ts",
      [
        "export interface ISatisfiesService { run(): string }",
        "export interface ICastService { run(): string }",
        "export class SatisfiesService implements ISatisfiesService {",
        "  run() { return 'ok' }",
        "}",
        "export class CastService implements ICastService {",
        "  run() { return 'ok' }",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/service.test.ts",
      [
        "import type { ICastService, ISatisfiesService } from './service'",
        "export const satisfiesFake = {",
        "  run() { return 'fake' },",
        "} satisfies ISatisfiesService",
        "export const castFake = {",
        "  run() { return 'fake' },",
        "} as ICastService",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(
      out.pairs
        .map((pair) => [pair.interfaceName, pair.hasTestSubstitute])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["ICastService", true],
      ["ISatisfiesService", true],
    ])
    expect(out.flaggedPairs).toHaveLength(0)
  })

  test("composed object literal substitute types resolve interface references", async () => {
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
        "type WithMeta = { readonly meta: string }",
        "export const fakeService = {",
        "  meta: 'test',",
        "  run() {",
        "    return 'fake'",
        "  },",
        "} satisfies IService & WithMeta",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toEqual([
      expect.objectContaining({
        interfaceName: "IService",
        hasTestSubstitute: true,
      }),
    ])
    expect(out.flaggedPairs).toHaveLength(0)
  })

  test("non-object casts do not count as test substitutes", async () => {
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
        "declare function makeFake(): unknown",
        "export const fakeService = makeFake() as IService",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs[0]?.hasTestSubstitute).toBe(false)
    expect(out.flaggedPairs).toHaveLength(1)
  })

  test("non-object casts do not hide otherwise dead interfaces", async () => {
    await repo.write(
      "src/dead-cast.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "declare function makeFake(): unknown",
        "export const fakeService = makeFake() as IService",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(1)
    expect(out.deadInterfaces).toEqual([
      expect.objectContaining({
        interfaceName: "IService",
      }),
    ])
    expect(TsAb04.score(out)).toBe(0.75)
  })

  test("type-only references to non-object cast bindings do not hide dead interfaces", async () => {
    await repo.write(
      "src/type-query-cast.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "const payload = readPayload() as Payload",
        "export type PayloadShape = typeof payload",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(1)
    expect(out.deadInterfaces).toEqual([
      expect.objectContaining({
        interfaceName: "Payload",
      }),
    ])
    expect(TsAb04.score(out)).toBe(0.75)
  })

  test("consumed non-object casts count as structural data usage", async () => {
    await repo.write(
      "src/parsed.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "const payload = readPayload() as Payload",
        "export const value = payload.value",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
    expect(TsAb04.score(out)).toBe(1)
  })

  test("property access on a non-object cast counts as structural data usage", async () => {
    await repo.write(
      "src/global.ts",
      [
        "export interface RuntimeBridge {",
        "  readonly run: () => string",
        "}",
        "const run = (globalThis as unknown as { readonly bridge?: RuntimeBridge }).bridge",
        "export const value = run?.run()",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("call arguments with non-object casts count as structural data usage", async () => {
    await repo.write(
      "src/call.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "function consume(payload: unknown) {",
        "  return payload",
        "}",
        "export const value = consume(readPayload() as Payload)",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("returned non-object casts count as structural data usage", async () => {
    await repo.write(
      "src/return.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "export function loadPayload() {",
        "  return readPayload() as Payload",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("parenthesized non-object casts count as structural data usage", async () => {
    await repo.write(
      "src/parenthesized.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "export function loadPayload() {",
        "  return (readPayload() as Payload)",
        "}",
        "export const value = ((readPayload() as Payload)).value",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("destructured non-object casts count as structural data usage", async () => {
    await repo.write(
      "src/destructured.ts",
      [
        "export interface Payload {",
        "  readonly value: string",
        "}",
        "declare function readPayload(): unknown",
        "const { value } = readPayload() as Payload",
        "export const result = value",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
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

  test("class expressions count as production implementations", async () => {
    await repo.write(
      "src/class-expression.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "export const ServiceImpl = class implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toEqual([
      expect.objectContaining({
        interfaceName: "IService",
        implementationName: "ServiceImpl",
      }),
    ])
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("nested class declarations count as production implementations", async () => {
    await repo.write(
      "src/factory.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "export function makeService(): IService {",
        "  class ServiceImpl implements IService {",
        "    run() {",
        "      return 'ok'",
        "    }",
        "  }",
        "  return new ServiceImpl()",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toEqual([
      expect.objectContaining({
        interfaceName: "IService",
        implementationName: "ServiceImpl",
      }),
    ])
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("same-named interfaces in different files are matched independently", async () => {
    const unusedFile = await repo.write(
      "src/unused-service.ts",
      [
        "export interface IService {",
        "  stale(): string",
        "}",
      ].join("\n"),
    )
    const liveFile = await repo.write(
      "src/live-service.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
        "export class LiveService implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toHaveLength(1)
    expect(out.flaggedPairs).toEqual([
      expect.objectContaining({
        interfaceFile: liveFile,
        interfaceName: "IService",
        implementationName: "LiveService",
      }),
    ])
    expect(out.deadInterfaces).toEqual([
      expect.objectContaining({
        interfaceFile: unusedFile,
        interfaceName: "IService",
      }),
    ])
    expect(out.totalInterfaces).toBe(2)
  })

  test("namespace-qualified implementations and typed substitutes resolve to the interface", async () => {
    const interfaceFile = await repo.write(
      "src/contracts.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
      ].join("\n"),
    )
    const implementationFile = await repo.write(
      "src/service.ts",
      [
        "import * as contracts from './contracts'",
        "export class ServiceImpl implements contracts.IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/service.test.ts",
      [
        "import * as contracts from './contracts'",
        "export const fakeService: contracts.IService = {",
        "  run() {",
        "    return 'fake'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.pairs).toEqual([
      expect.objectContaining({
        interfaceFile,
        implementationFile,
        implementationName: "ServiceImpl",
        hasTestSubstitute: true,
      }),
    ])
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("public named re-export chains exclude implementation contracts", async () => {
    await repo.write(
      "src/contracts.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
      ].join("\n"),
    )
    await repo.write("src/public.ts", "export { IService } from './contracts'\n")
    await repo.write("src/index.ts", "export { IService } from './public'\n")
    await repo.write(
      "src/service.ts",
      [
        "import type { IService } from './contracts'",
        "export class ServiceImpl implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("public package-local alias re-exports exclude implementation contracts", async () => {
    await repo.write(
      "src/contracts.ts",
      [
        "export interface IService {",
        "  run(): string",
        "}",
      ].join("\n"),
    )
    await repo.write("src/index.ts", "export { IService } from '@/contracts'\n")
    await repo.write(
      "src/service.ts",
      [
        "import type { IService } from './contracts'",
        "export class ServiceImpl implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("public entry local export lists exclude implementation contracts", async () => {
    await repo.write(
      "src/index.ts",
      [
        "interface IService {",
        "  run(): string",
        "}",
        "interface ITypeOnly {",
        "  run(): string",
        "}",
        "export { IService }",
        "export type { ITypeOnly }",
      ].join("\n"),
    )
    await repo.write(
      "src/service.ts",
      [
        "import type { IService } from './index'",
        "export class ServiceImpl implements IService {",
        "  run() {",
        "    return 'ok'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.deadInterfaces).toHaveLength(0)
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

  test("score uses the maximum of single-implementation and dead-interface pressure", async () => {
    await repo.write(
      "src/score.ts",
      [
        "export interface IFlag { run(): string }",
        "export class Only implements IFlag { run() { return 'only' } }",
        "export interface IDead1 { run(): void }",
        "export interface IDead2 { run(): void }",
        "export interface IDead3 { run(): void }",
        "export interface IDead4 { run(): void }",
        "export interface IDead5 { run(): void }",
        "export interface IDead6 { run(): void }",
        "export interface IDead7 { run(): void }",
        "export interface IDead8 { run(): void }",
        "export interface IDead9 { run(): void }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(10)
    expect(out.flaggedPairs).toHaveLength(1)
    expect(out.deadInterfaces).toHaveLength(9)
    expect(out.ratio).toBeCloseTo(0.1)
    expect(out.deadInterfaceRatio).toBeCloseTo(0.9)
    expect(out.singleImplementationPressure).toBeCloseTo(0.2)
    expect(out.deadInterfacePressure).toBeCloseTo(0.225)
    expect(TsAb04.score(out)).toBeCloseTo(0.775)
  })

  test("diagnostics include deterministic pair/dead payloads and order", async () => {
    const interfaceAFile = await repo.write(
      "src/contract-a.ts",
      [
        "export interface IAService {",
        "  run(): string",
        "}",
      ].join("\n"),
    )
    const implementationAFile = await repo.write(
      "src/impl-a.ts",
      [
        "import type { IAService } from './contract-a'",
        "export class AServiceImpl implements IAService {",
        "  run() {",
        "    return 'a'",
        "  }",
        "}",
      ].join("\n"),
    )
    const interfaceBFile = await repo.write(
      "src/contract-b.ts",
      [
        "export interface IBService {",
        "  run(): string",
        "}",
      ].join("\n"),
    )
    const implementationBFile = await repo.write(
      "src/impl-b.ts",
      [
        "import type { IBService } from './contract-b'",
        "export class BServiceImpl implements IBService {",
        "  run() {",
        "    return 'b'",
        "  }",
        "}",
      ].join("\n"),
    )
    const deadAFile = await repo.write(
      "src/dead-a.ts",
      "export interface IADead { run(): void }\n",
    )
    const deadBFile = await repo.write(
      "src/dead-b.ts",
      "export interface IBDead { run(): void }\n",
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    const diagnostics = TsAb04.diagnose(out)

    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warn",
        message: "Single-implementation interface IAService -> AServiceImpl",
        location: { file: interfaceAFile },
        data: {
          interfaceFile: interfaceAFile,
          interfaceName: "IAService",
          implementationFile: implementationAFile,
          implementationName: "AServiceImpl",
        },
      }),
      expect.objectContaining({
        severity: "warn",
        message: "Single-implementation interface IBService -> BServiceImpl",
        location: { file: interfaceBFile },
        data: {
          interfaceFile: interfaceBFile,
          interfaceName: "IBService",
          implementationFile: implementationBFile,
          implementationName: "BServiceImpl",
        },
      }),
      expect.objectContaining({
        severity: "warn",
        message: "Dead interface with no implementation: IADead",
        location: { file: deadAFile, line: 1 },
        data: {
          interfaceFile: deadAFile,
          interfaceName: "IADead",
        },
      }),
      expect.objectContaining({
        severity: "warn",
        message: "Dead interface with no implementation: IBDead",
        location: { file: deadBFile, line: 1 },
        data: {
          interfaceFile: deadBFile,
          interfaceName: "IBDead",
        },
      }),
    ])
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await repo.write(
      "src/service-a.ts",
      [
        "export interface IServiceA { run(): string }",
        "export class ServiceA implements IServiceA { run() { return 'a' } }",
      ].join("\n"),
    )
    await repo.write(
      "src/service-b.ts",
      [
        "export interface IServiceB { run(): string }",
        "export class ServiceB implements IServiceB { run() { return 'b' } }",
      ].join("\n"),
    )

    const fractional = await runSignal(repo.root, TsAb04, {
      ...TsAb04.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await runSignal(repo.root, TsAb04, {
      ...TsAb04.defaultConfig,
      top_n_diagnostics: -1,
    })
    const nan = await runSignal(repo.root, TsAb04, {
      ...TsAb04.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infinite = await runSignal(repo.root, TsAb04, {
      ...TsAb04.defaultConfig,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })

    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsAb04.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(nan.diagnosticLimit).toBe(0)
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsAb04.diagnose(negative)).toEqual([])
    expect(TsAb04.diagnose(nan)).toEqual([])
    expect(TsAb04.diagnose(infinite)).toEqual([])
  })

  test("referenced structural data interfaces are not dead implementation contracts", async () => {
    await repo.write(
      "src/options.ts",
      [
        "export interface CommandOptions {",
        "  readonly cwd: string",
        "  readonly verbose?: boolean",
        "}",
        "export function runCommand(options: CommandOptions) {",
        "  return options.cwd",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
    expect(TsAb04.outputMetadata?.(out)?.applicability).toBe("not_applicable")
  })

  test("structural data interfaces with object defaults are not implementation contracts", async () => {
    await repo.write(
      "src/options.ts",
      [
        "export interface CommandOptions {",
        "  readonly cwd: string",
        "  readonly verbose?: boolean",
        "}",
        "export const defaultOptions: CommandOptions = {",
        "  cwd: process.cwd(),",
        "}",
        "export function runCommand(options: CommandOptions) {",
        "  return options.cwd",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(out.totalInterfaces).toBe(0)
    expect(out.pairs).toHaveLength(0)
    expect(out.flaggedPairs).toHaveLength(0)
    expect(out.deadInterfaces).toHaveLength(0)
    expect(TsAb04.score(out)).toBe(1)
  })

  test("interfaces extended by another interface are treated as structural type usage", async () => {
    await repo.write(
      "src/events.ts",
      [
        "interface BaseEvent {",
        "  readonly id: string",
        "}",
        "export interface ProjectEvent extends BaseEvent {",
        "  readonly projectId: string",
        "}",
        "export function handle(event: ProjectEvent) {",
        "  return event.projectId",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    expect(out.totalInterfaces).toBe(0)
    expect(out.deadInterfaces).toHaveLength(0)
  })

  test("configured exclude_globs remove matching production interfaces", async () => {
    await repo.write(
      "src/ignored/service.ts",
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

    const out = await runSignal(repo.root, TsAb04, {
      ...TsAb04.defaultConfig,
      exclude_globs: [...TsAb04.defaultConfig.exclude_globs, "**/ignored/**"],
    })

    expect(out.totalInterfaces).toBe(0)
    expect(out.pairs).toEqual([])
    expect(out.flaggedPairs).toEqual([])
    expect(out.deadInterfaces).toEqual([])
    expect(TsAb04.score(out)).toBe(1)
  })

  test("analysis output and diagnostics are deterministic for the same repo", async () => {
    await repo.write(
      "src/service.ts",
      [
        "export interface IService { run(): string }",
        "export class ServiceImpl implements IService { run() { return 'ok' } }",
        "export interface IDead { run(): void }",
      ].join("\n"),
    )

    const first = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)
    const second = await runSignal(repo.root, TsAb04, TsAb04.defaultConfig)

    expect(stableTsAb04Output(second)).toEqual(stableTsAb04Output(first))
    expect(TsAb04.diagnose(second)).toEqual(TsAb04.diagnose(first))
    expect(TsAb04.score(second)).toBe(TsAb04.score(first))
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

  test("config schema decodes the default contract", () => {
    const decoded = Schema.decodeUnknownSync(TsAb04.configSchema)(TsAb04.defaultConfig)

    expect(decoded.exclude_globs).toContain("**/node_modules/**")
    expect(decoded.test_globs).toContain("**/*.test.ts")
    expect(decoded.public_entry_globs).toContain("**/src/index.ts")
    expect(decoded.top_n_diagnostics).toBe(20)
  })
})
