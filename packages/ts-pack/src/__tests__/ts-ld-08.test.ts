import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import {
  TsLd08,
  type TsLd08Output,
} from "../signals/ts-ld-08-exhaustiveness-erosion.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-LD-08 (exhaustiveness erosion)", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-ld-08-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  const run = async (config = TsLd08.defaultConfig): Promise<TsLd08Output> =>
    runSignal(repo.root, TsLd08, config)

  const writeFindingFixture = async (): Promise<{
    readonly routeFile: string
    readonly parseFile: string
  }> => {
    const routeFile = await repo.write(
      "src/route.ts",
      [
        "type Route = 'home' | 'settings' | 'billing' | 'admin' | 'audit'",
        "export function routeToLabel(route: Route): string {",
        "  switch (route) {",
        "    case 'home': return 'Home'",
        "    case 'settings': return 'Settings'",
        "    case 'billing': return 'Billing'",
        "    case 'admin': return 'Admin'",
        `    default: return '${"x".repeat(220)}'`,
        "  }",
        "}",
        "",
      ].join("\n"),
    )
    const parseFile = await repo.write(
      "src/parse.ts",
      [
        "type Token = 'word' | 'space' | 'number' | 'punctuation'",
        "export function parseToken(token: Token): string {",
        "  switch (token) {",
        "    case 'word': return 'word'",
        "    case 'space': return 'space'",
        "    default: return 'other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )
    return { routeFile, parseFile }
  }

  const stableOutput = (out: TsLd08Output): unknown => ({
    findings: out.findings,
    analyzedSwitches: out.analyzedSwitches,
    analyzedFiniteSwitches: out.analyzedFiniteSwitches,
    findingCount: out.findingCount,
    topDiagnostics: out.topDiagnostics,
    score: TsLd08.score(out),
    diagnostics: TsLd08.diagnose(out),
    metadata: TsLd08.outputMetadata?.(out),
  })

  test("declares identity, pack registration, config schema, and factor ledger", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-LD-08"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("TS-LD-08")
    const decoded = Schema.decodeUnknownSync(TsLd08.configSchema)(TsLd08.defaultConfig)
    const out = await run()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsLd08).toMatchObject({
      id: "TS-LD-08-exhaustiveness-erosion",
      title: "Exhaustiveness erosion",
      aliases: ["TS-LD-08"],
      tier: 1,
      category: "legibility-decay",
      kind: "legibility",
      cacheVersion: "switch-default-v4-finite-domain-never-guard-exclusions-v1",
      inputs: [],
    })
    expect(decoded).toEqual(TsLd08.defaultConfig)
    expect(registered?.id).toBe(TsLd08.id)
    expect(registered?.title).toBe(TsLd08.title)
    expect(registered?.cacheVersion).toContain(TsLd08.cacheVersion)
    expect(registry.byId.get("TS-LD-08")?.id).toBe(TsLd08.id)
    expect(factorLedger?.signalId).toBe(TsLd08.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_case_clauses",
        value: 2,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("no switches are not applicable and score neutrally", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const out = await run()

    expect(out.analyzedSwitches).toBe(0)
    expect(out.analyzedFiniteSwitches).toBe(0)
    expect(out.findings).toEqual([])
    expect(out.findingCount).toBe(0)
    expect(TsLd08.score(out)).toBe(1)
    expect(TsLd08.diagnose(out)).toEqual([])
    expect(TsLd08.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
  })

  test("open primitive, boolean, and partially open union defaults are not finite evidence", async () => {
    await repo.write(
      "src/open.ts",
      [
        "type Mixed = 'known' | number",
        "export function label(value: string): string {",
        "  switch (value) {",
        "    case 'a': return 'A'",
        "    case 'b': return 'B'",
        "    default: return 'Other'",
        "  }",
        "}",
        "",
        "export function flag(value: boolean): string {",
        "  switch (value) {",
        "    case true: return 'yes'",
        "    default: return 'no'",
        "  }",
        "}",
        "",
        "export function amount(value: number): string {",
        "  switch (value) {",
        "    case 1: return 'one'",
        "    case 2: return 'two'",
        "    default: return 'many'",
        "  }",
        "}",
        "",
        "export function mixed(value: Mixed): string {",
        "  switch (value) {",
        "    case 'known': return 'known'",
        "    case 1: return 'one'",
        "    default: return 'other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await run({ ...TsLd08.defaultConfig, min_case_clauses: 1 })

    expect(out.analyzedSwitches).toBe(4)
    expect(out.analyzedFiniteSwitches).toBe(0)
    expect(out.findings).toEqual([])
    expect(TsLd08.score(out)).toBe(1)
    expect(TsLd08.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
  })

  test("literal unions and enums with catch-all defaults produce grounded findings", async () => {
    const { routeFile, parseFile } = await writeFindingFixture()
    await repo.write(
      "src/enum.ts",
      [
        "export enum Mode { Start = 'start', Stop = 'stop', Pause = 'pause' }",
        "export function modeLabel(mode: Mode): string {",
        "  switch (mode) {",
        "    case Mode.Start: return 'Start'",
        "    case Mode.Stop: return 'Stop'",
        "    default: return 'Other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await run()
    const diagnostics = TsLd08.diagnose(out)

    expect(out.analyzedSwitches).toBe(3)
    expect(out.analyzedFiniteSwitches).toBe(3)
    expect(out.findingCount).toBe(3)
    expect(TsLd08.score(out)).toBeCloseTo(1 / (1 + 3 / 10))
    expect(out.findings[0]).toEqual({
      file: routeFile,
      line: 3,
      column: 3,
      expression: "route",
      typeText: "Route",
      caseCount: 4,
      variantCount: 5,
      handledVariantCount: 4,
      unhandledVariantCount: 1,
      defaultText: expect.stringMatching(/^default: return 'x+/),
    })
    expect(out.findings[0]?.defaultText).toHaveLength(160)
    expect(out.findings[1]).toEqual(
      expect.objectContaining({
        file: parseFile,
        line: 3,
        column: 3,
        expression: "token",
        typeText: "Token",
        caseCount: 2,
        variantCount: 4,
        handledVariantCount: 2,
        unhandledVariantCount: 2,
      }),
    )
    expect(out.findings[2]).toEqual(
      expect.objectContaining({
        expression: "mode",
        typeText: "Mode",
        caseCount: 2,
        variantCount: 3,
        handledVariantCount: 2,
        unhandledVariantCount: 1,
      }),
    )
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        severity: "warn",
        message:
          "Switch on `route` (Route) has a catch-all default after 4 explicit cases; " +
          "1 finite variant(s) are currently unhandled and future variants can be hidden",
        location: { file: routeFile, line: 3, column: 3 },
        data: expect.objectContaining({
          file: routeFile,
          expression: "route",
          caseCount: 4,
          variantCount: 5,
          handledVariantCount: 4,
          unhandledVariantCount: 1,
        }),
      }),
    )
  })

  test("complete finite switches without defaults stay healthy but applicable", async () => {
    await repo.write(
      "src/complete.ts",
      [
        "type Status = 'ready' | 'blocked'",
        "export function label(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await run()

    expect(out.analyzedSwitches).toBe(1)
    expect(out.analyzedFiniteSwitches).toBe(1)
    expect(out.findings).toEqual([])
    expect(TsLd08.score(out)).toBe(1)
    expect(TsLd08.diagnose(out)).toEqual([])
    expect(TsLd08.outputMetadata?.(out)).toBeUndefined()
  })

  test("explicit never defaults preserve exhaustiveness guarantees", async () => {
    await repo.write(
      "src/never.ts",
      [
        "function assertNever(value: never): never { throw new Error(String(value)) }",
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function viaCall(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    case 'done': return 'Done'",
        "    default: return assertNever(status)",
        "  }",
        "}",
        "export function viaSatisfies(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    case 'done': return 'Done'",
        "    default:",
        "      status satisfies never",
        "      return status",
        "  }",
        "}",
        "export function viaAssignment(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    case 'done': return 'Done'",
        "    default:",
        "      const exhaustive: never = status",
        "      return exhaustive",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await run()

    expect(out.analyzedSwitches).toBe(3)
    expect(out.analyzedFiniteSwitches).toBe(3)
    expect(out.findings).toEqual([])
    expect(TsLd08.score(out)).toBe(1)
  })

  test("never-looking catch-alls do not suppress findings when the compiler cannot prove never", async () => {
    await repo.write(
      "src/non-exhaustive.ts",
      [
        "function assertNever(value: never): never { throw new Error(String(value)) }",
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function missingVariant(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    default: return assertNever(status as never)",
        "  }",
        "}",
        "export function castedExhaustive(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    case 'done': return 'Done'",
        "    default: return assertNever(status as never)",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toHaveLength(2)
    expect(out.findings.map((finding) => finding.expression)).toEqual(["status", "status"])
    expect(out.findings.map((finding) => finding.unhandledVariantCount).sort()).toEqual([0, 1])
    expect(TsLd08.diagnose(out).every((diagnostic) => diagnostic.severity === "warn")).toBe(
      true,
    )
  })

  test("minimum case threshold is explicit and configurable", async () => {
    await repo.write(
      "src/small.ts",
      [
        "type Flag = 'on' | 'off'",
        "export function label(flag: Flag): string {",
        "  switch (flag) {",
        "    case 'on': return 'On'",
        "    default: return 'Off'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const defaultOut = await run()
    const strictOut = await run({ ...TsLd08.defaultConfig, min_case_clauses: 1 })

    expect(defaultOut.analyzedFiniteSwitches).toBe(1)
    expect(defaultOut.findings).toEqual([])
    expect(strictOut.findings).toHaveLength(1)
    expect(strictOut.findings[0]).toEqual(
      expect.objectContaining({
        caseCount: 1,
        variantCount: 2,
        handledVariantCount: 1,
        unhandledVariantCount: 1,
      }),
    )
  })

  test("diagnostic cap is finite-safe and applied after deterministic ordering", async () => {
    await writeFindingFixture()

    const fractional = await run({ ...TsLd08.defaultConfig, top_n_diagnostics: 1.8 })
    expect(fractional.topDiagnostics).toBe(1)
    expect(TsLd08.diagnose(fractional)).toHaveLength(1)
    expect(TsLd08.diagnose(fractional)[0]?.data?.caseCount).toBe(4)

    const negative = await run({ ...TsLd08.defaultConfig, top_n_diagnostics: -1 })
    expect(negative.topDiagnostics).toBe(0)
    expect(TsLd08.diagnose(negative)).toEqual([])

    const nan = await run({ ...TsLd08.defaultConfig, top_n_diagnostics: Number.NaN })
    expect(nan.topDiagnostics).toBe(0)
    expect(TsLd08.diagnose(nan)).toEqual([])

    const infinity = await run({ ...TsLd08.defaultConfig, top_n_diagnostics: Number.POSITIVE_INFINITY })
    expect(infinity.topDiagnostics).toBe(0)
    expect(TsLd08.diagnose(infinity)).toEqual([])
  })

  test("default and custom exclusions remove non-production switches from analysis", async () => {
    await repo.write(
      "src/__tests__/fixture.ts",
      [
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function testLabel(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    default: return 'Other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )
    await repo.write(
      "src/generated/model.generated.ts",
      [
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function generatedLabel(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    default: return 'Other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const defaultOut = await run()
    expect(defaultOut.analyzedSwitches).toBe(0)
    expect(defaultOut.findings).toEqual([])
    expect(TsLd08.outputMetadata?.(defaultOut)).toEqual({ applicability: "not_applicable" })

    await repo.write(
      "src/domain.ts",
      [
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function label(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    default: return 'Other'",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const customOut = await run({
      ...TsLd08.defaultConfig,
      exclude_globs: [...TsLd08.defaultConfig.exclude_globs, "**/domain.ts"],
    })
    expect(customOut.analyzedSwitches).toBe(0)
    expect(customOut.findings).toEqual([])
  })

  test("output remains deterministic across repeated real-project runs", async () => {
    await writeFindingFixture()

    const first = await run()
    const second = await run()

    expect(stableOutput(second)).toEqual(stableOutput(first))
  })
})
