import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
} from "@skastr0/pulsar-core/signal"
import type { ChangedHunk, Signal } from "@skastr0/pulsar-core/signal"
import { withConfigFactorLedger } from "@skastr0/pulsar-core/factors"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { TsProjectLayer } from "../ts-project.js"
import { TsBp01, type TsBp01Output } from "../signals/ts-bp-01-public-api-signature-diff.js"
import { TsCc01 } from "../signals/ts-cc-01-async-failure-control.js"
import { TsCc02 } from "../signals/ts-cc-02-unbounded-concurrency.js"
import { TsSec01 } from "../signals/ts-sec-01-dangerous-capability-surface.js"
import { TsSec02 } from "../signals/ts-sec-02-untrusted-boundary-sinks.js"
import { TsSec03 } from "../signals/ts-sec-03-secret-material.js"
import { TsSl05 } from "../signals/ts-sl-05-phantom-tests.js"
import { TsSl06 } from "../signals/ts-sl-06-confidence-claim-mismatch.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

const NEW_TRUST_SIGNALS = [
  TsSec01,
  TsSec02,
  TsSec03,
  TsCc01,
  TsCc02,
  TsBp01,
  TsSl05,
  TsSl06,
] as const

describe("TypeScript trust-domain and AI-slop signals", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-trust-signals-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("declare identity, pack registration, default config, cache versions, and factor ledger", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")
    const registrySignals = NEW_TRUST_SIGNALS.map((signal) =>
      withConfigFactorLedger(signal as Signal<any, any, any>),
    )
    const registry = await Effect.runPromise(buildRegistry(registrySignals))

    for (const signal of NEW_TRUST_SIGNALS) {
      const alias = signal.aliases?.[0]
      expect(alias).toBeDefined()
      const registered = registry.byId.get(alias!)
      const decoded = Schema.decodeUnknownSync(signal.configSchema as any)(signal.defaultConfig)
      const out = await runSignal(repo.root, signal as Signal<any, any, any>, signal.defaultConfig)
      const factorLedger = registered?.factorLedger?.(out)

      expect(registered?.id).toBe(signal.id)
      expect(registered?.cacheVersion).toContain(signal.cacheVersion)
      expect(decoded).toEqual(signal.defaultConfig)
      expect(factorLedger?.signalId).toBe(signal.id)
      expect(factorLedger?.entries.some((entry) => entry.path === "config.top_n_diagnostics")).toBe(true)
    }
  })

  test("TS-SEC-01 flags dangerous capability surfaces and excludes test fixtures", async () => {
    await repo.write(
      "src/runtime.ts",
      [
        "import { exec } from 'node:child_process'",
        "export function run(input: string) {",
        "  eval(input)",
        "  exec(input)",
        "}",
      ].join("\n"),
    )
    await repo.write("src/runtime.test.ts", "export const fake = eval('1')\n")

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)
    const diagnostics = TsSec01.diagnose(out)

    expect(out.state).toBe("present")
    expect(out.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["shell-process", "eval"]),
    )
    expect(TsSec01.score(out)).toBeLessThan(1)
    expect(diagnostics[0]?.fixHints?.[0]?.kind).toBe("security-review-route")
    expect(out.findings.some((finding) => finding.file.endsWith("runtime.test.ts"))).toBe(false)
  })

  test("TS-SEC-02 routes raw boundary sinks but accepts schema-wrapped parsing", async () => {
    await repo.write(
      "src/api/route.ts",
      [
        "declare const UserSchema: { parse(value: unknown): unknown }",
        "export function POST(raw: string) {",
        "  const unsafe = JSON.parse(raw)",
        "  void fetch(raw)",
        "  return unsafe",
        "}",
        "export function safe(raw: string) {",
        "  return UserSchema.parse(JSON.parse(raw))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec02, TsSec02.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["raw-json-parse", "unconstrained-fetch-url"]),
    )
    expect(out.findings).toHaveLength(2)
    expect(TsSec02.score(out)).toBeLessThan(1)
    expect(TsSec02.diagnose(out)[0]?.fixHints?.[0]?.kind).toBe("add-boundary-parser")
  })

  test("TS-SEC-03 blocks committed secret-shaped literals and ignores placeholders", async () => {
    await repo.write(
      "src/secrets.ts",
      [
        "export const apiKey = 'sk-1234567890abcdef1234567890'",
        "export const placeholderToken = 'test-token-placeholder'",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec03, TsSec03.defaultConfig)
    const diagnostics = TsSec03.diagnose(out)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.kind).toBe("known-secret-prefix")
    expect(TsSec03.score(out)).toBeLessThan(1)
    expect(diagnostics[0]).toMatchObject({
      severity: "block",
      fixHints: [expect.objectContaining({ kind: "remove-secret-material" })],
    })
  })

  test("TS-CC-01 flags floating promises and swallowed rejection paths", async () => {
    await repo.write(
      "src/async.ts",
      [
        "declare function fetch(input: string): Promise<Response>",
        "export function start() {",
        "  fetch('/api')",
        "  Promise.reject(new Error('boom')).catch(() => {})",
        "  try { throw new Error('x') } catch {}",
        "}",
        "export async function safe() {",
        "  await fetch('/api')",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["floating-promise", "swallowed-rejection", "empty-catch"]),
    )
    expect(TsCc01.score(out)).toBeLessThan(1)
    expect(TsCc01.diagnose(out)[0]?.fixHints?.[0]?.kind).toBe("async-failure-control")
  })

  test("TS-CC-02 flags Promise fanout without limiter evidence", async () => {
    await repo.write(
      "src/fanout.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare function pLimit(size: number): <A>(fn: () => Promise<A>) => Promise<A>",
        "export async function unsafe(items: string[]) {",
        "  await Promise.all(items.map(async (item) => work(item)))",
        "}",
        "export async function safe(items: string[]) {",
        "  const limit = pLimit(2)",
        "  await Promise.all(items.map((item) => limit(() => work(item))))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.kind).toBe("promise-all-map")
    expect(TsCc02.diagnose(out)[0]?.fixHints?.[0]?.kind).toBe("add-concurrency-limiter")
  })

  test("TS-BP-01 routes public API changes only when changed hunks touch exports", async () => {
    await repo.write(
      "src/api.ts",
      [
        "export interface User { readonly id: string }",
        "export function loadUser(id: string): User {",
        "  return { id }",
        "}",
      ].join("\n"),
    )

    const changed = await runBp([
      { file: "src/api.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
    ])
    const unchanged = await runBp([])

    expect(changed.state).toBe("present")
    expect(changed.changedPublicSignatures[0]).toMatchObject({
      exportName: "User",
      declarationKind: "InterfaceDeclaration",
    })
    expect(TsBp01.diagnose(changed)[0]?.fixHints?.[0]?.kind).toBe("document-api-change")
    expect(TsBp01.score(changed)).toBeLessThan(1)
    expect(unchanged.state).toBe("zero")
    expect(TsBp01.diagnose(unchanged)).toEqual([])
  })

  test("TS-SL-05 flags test blocks with no oracle", async () => {
    await repo.write(
      "src/foo.test.ts",
      [
        "import { test, expect } from 'bun:test'",
        "test('phantom', () => {",
        "  const value = 1 + 1",
        "})",
        "test('real', () => {",
        "  expect(1 + 1).toBe(2)",
        "})",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl05, TsSl05.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.testName).toBe("phantom")
    expect(TsSl05.diagnose(out)[0]?.fixHints?.[0]?.kind).toBe("add-test-oracle")
  })

  test("TS-SL-06 flags validate/parse/assert symbols that do not validate", async () => {
    await repo.write(
      "src/claims.ts",
      [
        "export function validateUser(value: unknown) { return true }",
        "export function parseUser(raw: unknown) { return raw as { id: string } }",
        "export function isString(value: unknown): value is string { return typeof value === 'string' }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings.map((finding) => finding.symbol)).toEqual(["validateUser", "parseUser"])
    expect(TsSl06.score(out)).toBeLessThan(1)
    expect(TsSl06.diagnose(out)[0]?.fixHints?.[0]?.kind).toBe("align-confidence-claim")
  })

  const runBp = async (changedHunks: ReadonlyArray<ChangedHunk>): Promise<TsBp01Output> => {
    const layer = Layer.mergeAll(
      TsProjectLayer(repo.root),
      Layer.succeed(SignalContextTag, {
        gitSha: "TEST",
        worktreePath: repo.root,
        changedHunks,
      }),
      Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
    )

    return Effect.runPromise(
      TsBp01.compute(TsBp01.defaultConfig, new Map()).pipe(Effect.provide(layer)),
    )
  }
})
