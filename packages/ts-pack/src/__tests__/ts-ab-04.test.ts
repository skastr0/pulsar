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
