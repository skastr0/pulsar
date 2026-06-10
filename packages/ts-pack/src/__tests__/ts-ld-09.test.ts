import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsLd09 } from "../signals/ts-ld-09-error-channel-opacity.js"
import type {
  ErrorChannelOpacityKind,
  TsLd09Output,
} from "../signals/ts-ld-09-types.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

const run = (repo: TempRepo, config = TsLd09.defaultConfig): Promise<TsLd09Output> =>
  runSignal(repo.root, TsLd09, config)

describe("TS-LD-09 (error channel opacity)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write("src/value.ts", "export const value = 1\n")

      const packRegistered = TS_PACK_SIGNALS.find((signal) =>
        signal.aliases?.includes("TS-LD-09"),
      )
      expect(packRegistered).toBeDefined()
      const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
      const registered = registry.byId.get("TS-LD-09")
      const out = await run(repo)
      const factorLedger = registered?.factorLedger?.(out)

      expect(TsLd09).toMatchObject({
        id: "TS-LD-09-error-channel-opacity",
        title: "Error channel opacity",
        aliases: ["TS-LD-09"],
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        cacheVersion: "ts-error-channel-opacity-v9-surfaced-error-classification-v1",
        inputs: [],
      })
      expect(registered?.id).toBe(TsLd09.id)
      expect(registered?.title).toBe(TsLd09.title)
      expect(registered?.cacheVersion).toContain(TsLd09.cacheVersion)
      expect(registry.byId.get("TS-LD-09")?.id).toBe(TsLd09.id)
      expect(factorLedger?.signalId).toBe(TsLd09.id)
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.exclude_globs",
          source: "signal-default",
          scoreRole: "metadata",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.expected_failure_name_patterns",
          source: "signal-default",
          scoreRole: "metadata",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.max_weighted_opacity_per_kloc",
          value: 18,
          source: "signal-default",
          scoreRole: "weight",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.max_boundary_weighted_opacity",
          value: 36,
          source: "signal-default",
          scoreRole: "weight",
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
    } finally {
      await repo.cleanup()
    }
  })

  test("flags boundary broad throws and opaque expected-failure Promise APIs", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/api.ts",
        [
          "interface User { readonly id: string }",
          "export async function loadUser(id: string): Promise<User> {",
          "  if (id === '') throw new Error('missing id')",
          "  return { id }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      const kinds = new Set(out.findings.map((finding) => finding.kind))

      expect(out.state).toBe("present")
      expect(kinds).toEqual(new Set(["opaque-promise-api", "broad-throw"]))
      expect(out.boundaryFindings).toBe(2)
      expect(out.boundaryWeightedOpacity).toBe(out.weightedOpacity)
      expect(out.weightedOpacity).toBe(13)
      expect(out.densityPressure).toBeCloseTo(13 / 18)
      expect(out.boundaryPressure).toBeCloseTo(13 / 36)
      expect(TsLd09.score(out)).toBeCloseTo(1 / (1 + 13 / 18))
      expect(TsLd09.diagnose(out)[0]).toMatchObject({
        severity: "warn",
        location: { file: expect.stringContaining("src/api.ts"), line: 2, column: 1 },
        data: expect.objectContaining({
          symbol: "loadUser",
          boundary: true,
          densityThreshold: 18,
          boundaryThreshold: 36,
        }),
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("does not flag domain error construction or typed Effect failures", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/domain.ts",
        [
          "import { Effect } from 'effect'",
          "class DomainError extends Error {}",
          "export function parseUser(raw: string): string {",
          "  if (raw === '') throw new DomainError('empty')",
          "  return raw",
          "}",
          "export const failure = Effect.fail(new DomainError('bad'))",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("flags catch fallbacks but not catch blocks that map to domain errors", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/catch.ts",
        [
          "class LoadConfigError extends Error {}",
          "declare function readConfig(): string",
          "export function loadConfig(): string {",
          "  try {",
          "    return readConfig()",
          "  } catch (error) {",
          "    console.error(error)",
          "    return 'default'",
          "  }",
          "}",
          "export function loadStrict(): string {",
          "  try {",
          "    return readConfig()",
          "  } catch (error) {",
          "    throw new LoadConfigError(String(error))",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(kinds(out)).toEqual(["catch-without-narrowing"])
      expect(out.findings[0]).toMatchObject({
        symbol: "loadConfig",
        boundary: true,
        collapseMode: "fallback",
      })
    } finally {
      await repo.cleanup()
    }
  })

  test("does not flag guarded absence fallbacks that propagate other errors", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/optional-read.ts",
        [
          "class ReadConfigError extends Error {}",
          "declare function readConfig(): string",
          "const errorCodeOf = (error: unknown): string | undefined =>",
          "  typeof error === 'object' && error !== null && 'code' in error",
          "    ? String((error as { code?: unknown }).code)",
          "    : undefined",
          "export function readOptionalConfig(): string | undefined {",
          "  try {",
          "    return readConfig()",
          "  } catch (error) {",
          "    if (errorCodeOf(error) === 'ENOENT') return undefined",
          "    throw new ReadConfigError(String(error))",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("flags swallowed catches, void Promise catches, and weak Effect catch mappers", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/swallow.ts",
        [
          "import { Effect } from 'effect'",
          "declare function readConfig(): string",
          "declare function fetchUser(): Promise<string>",
          "const weakCatch = () => undefined",
          "function swallow(): void { return void 0 }",
          "export function loadOptional(): void {",
          "  try {",
          "    readConfig()",
          "  } catch (error) {",
          "    console.error(error)",
          "  }",
          "}",
          "export function loadSilent(): void {",
          "  try {",
          "    readConfig()",
          "  } catch {}",
          "}",
          "export function recoverUser(): Promise<string | void> {",
          "  return fetchUser().catch(() => {})",
          "}",
          "export function recoverUndefined(): Promise<string | undefined> {",
          "  return fetchUser().catch(() => undefined)",
          "}",
          "export function recoverViaHandler(): Promise<string | void> {",
          "  return fetchUser().catch(swallow)",
          "}",
          "export const weak = Effect.tryPromise({",
          "  try: () => fetch('/users'),",
          "  catch: () => 'offline'",
          "})",
          "export const weakUndefined = Effect.tryPromise({",
          "  try: () => fetch('/users'),",
          "  catch: () => undefined",
          "})",
          "export const weakViaHandler = Effect.tryPromise({",
          "  try: () => fetch('/users'),",
          "  catch: weakCatch",
          "})",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings.filter((finding) => finding.kind === "catch-without-narrowing")).toHaveLength(
        2,
      )
      expect(out.findings.filter((finding) => finding.kind === "promise-catch-collapse")).toHaveLength(
        3,
      )
      expect(out.findings.filter((finding) => finding.kind === "effect-error-collapse")).toHaveLength(
        3,
      )
      expect(out.findings.some((finding) => finding.collapseMode === "swallowed")).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })

  test("flags Effect unknown-exception and error-channel collapse patterns", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/effect.ts",
        [
          "import { Effect } from 'effect'",
          "class NetworkError extends Error {}",
          "declare const operation: Effect.Effect<string, NetworkError>",
          "export const raw = Effect.tryPromise(() => fetch('/users'))",
          "export const typed = Effect.tryPromise({",
          "  try: () => fetch('/users'),",
          "  catch: (error) => new NetworkError(String(error))",
          "})",
          "export const fatal = Effect.orDie(operation)",
          "export const fallback = operation.pipe(Effect.orElseSucceed(() => 'offline'))",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(kinds(out)).toEqual([
        "effect-error-collapse",
        "effect-error-collapse",
        "effect-unknown-exception",
      ])
      expect(out.findings.some((finding) =>
        finding.kind === "effect-unknown-exception" &&
        finding.expectedFailureEvidence.includes("Effect.tryPromise without typed catch mapper")
      )).toBe(true)
      expect(out.findings.some((finding) => finding.expressionText.includes("orElseSucceed"))).toBe(
        true,
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("does not flag internal async helpers without expected-failure names", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/internal.ts",
        [
          "async function computeValue(): Promise<string> {",
          "  return 'ok'",
          "}",
          "export const ready = true",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.state).toBe("zero")
      expect(out.findings).toEqual([])
    } finally {
      await repo.cleanup()
    }
  })

  test("exported Effect values are boundary error-channel APIs", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/effect-boundary.ts",
        [
          "import { Effect } from 'effect'",
          "declare function fetchUser(): Promise<string>",
          "declare const operation: Effect.Effect<string, Error>",
          "export const loadUser = Effect.tryPromise(() => fetchUser())",
          "export const loadFallback = operation.pipe(Effect.orElseSucceed(() => 'offline'))",
        ].join("\n"),
      )

      const out = await run(repo)
      const bySymbol = new Map(out.findings.map((finding) => [finding.symbol, finding]))

      expect(bySymbol.get("loadUser")).toEqual(
        expect.objectContaining({
          kind: "effect-unknown-exception",
          boundary: true,
          severity: "warn",
        }),
      )
      expect(bySymbol.get("loadFallback")).toEqual(
        expect.objectContaining({
          kind: "effect-error-collapse",
          collapseMode: "success-channel",
          boundary: true,
          severity: "warn",
        }),
      )
      expect(out.boundaryFindings).toBe(2)
      expect(TsLd09.diagnose(out).every((diagnostic) => diagnostic.severity === "warn")).toBe(
        true,
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("expected-failure name patterns are configurable", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/custom-name.ts",
        [
          "export async function computeValue(): Promise<string> {",
          "  if (Math.random() > 0.5) throw new Error('compute')",
          "  return 'ok'",
          "}",
        ].join("\n"),
      )

      const defaultOut = await run(repo)
      const customOut = await run(repo, {
        ...TsLd09.defaultConfig,
        expected_failure_name_patterns: ["compute"],
      })

      expect(defaultOut.findings.some((finding) => finding.kind === "opaque-promise-api")).toBe(
        false,
      )
      const customOpaqueApis = customOut.findings.filter(
        (finding) => finding.kind === "opaque-promise-api",
      )
      expect(customOpaqueApis).toHaveLength(1)
      expect(customOpaqueApis[0]).toEqual(
        expect.objectContaining({
          kind: "opaque-promise-api",
          symbol: "computeValue",
          expectedFailureEvidence: ["name matches expected-failure pattern `compute`"],
        }),
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("expected-failure patterns apply to Effect.promise detection", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/effect-promise.ts",
        [
          "import { Effect } from 'effect'",
          "declare function queryUser(): Promise<string>",
          "export const operation = Effect.promise(() => queryUser())",
        ].join("\n"),
      )

      const defaultOut = await run(repo)
      const customOut = await run(repo, {
        ...TsLd09.defaultConfig,
        expected_failure_name_patterns: ["query"],
      })

      expect(defaultOut.findings).toEqual([])
      expect(customOut.findings).toEqual([
        expect.objectContaining({
          kind: "effect-unknown-exception",
          symbol: "operation",
          boundary: true,
          collapseMode: "promise-rejection",
        }),
      ])
    } finally {
      await repo.cleanup()
    }
  })

  test("does not flag expected-failure Promise APIs with typed Result or Either returns", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/result.ts",
        [
          "type Result<Value, Failure> =",
          "  | { readonly ok: true; readonly value: Value }",
          "  | { readonly ok: false; readonly error: Failure }",
          "type Either<Failure, Value> =",
          "  | { readonly _tag: 'Left'; readonly left: Failure }",
          "  | { readonly _tag: 'Right'; readonly right: Value }",
          "interface User { readonly id: string }",
          "class LoadUserError extends Error {}",
          "class RequestError extends Error {}",
          "export function loadUser(id: string): Promise<Result<User, LoadUserError>> {",
          "  return Promise.resolve({ ok: false, error: new LoadUserError(id) })",
          "}",
          "export function requestUser(id: string): Promise<Either<RequestError, User>> {",
          "  return Promise.resolve({ _tag: 'Left', left: new RequestError(id) })",
          "}",
          "export async function loadOpaque(id: string): Promise<User> {",
          "  if (id === '') throw new Error('missing id')",
          "  return { id }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      const opaqueApis = out.findings.filter((finding) => finding.kind === "opaque-promise-api")

      expect(opaqueApis).toHaveLength(1)
      expect(opaqueApis[0]).toEqual(
        expect.objectContaining({
          symbol: "loadOpaque",
          returnTypeText: "Promise<User>",
        }),
      )
      expect(out.findings.map((finding) => finding.symbol)).not.toContain("loadUser")
      expect(out.findings.map((finding) => finding.symbol)).not.toContain("requestUser")
    } finally {
      await repo.cleanup()
    }
  })

  test("non-Effect and non-Promise APIs with matching method names are ignored", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/non-effect.ts",
        [
          "const box = { orDie: () => 'ok', orElseSucceed: (_fn: () => string) => 'ok' }",
          "const client = { promise: (_name: string) => 'ok', tryPromise: () => 'ok' }",
          "const stream = { catch: (_handler: () => void) => 'ok' }",
          "export const boxed = box.orDie()",
          "export const fallback = box.orElseSucceed(() => 'offline')",
          "export const promised = client.promise('fetch-user')",
          "export const tried = client.tryPromise()",
          "export function loadStream(): string { return stream.catch(() => {}) }",
        ].join("\n"),
      )

      const out = await run(repo)

      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("catch domain-error construction does not hide fallback collapse", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/mixed-catch.ts",
        [
          "import { Effect } from 'effect'",
          "class LoadConfigError extends Error {}",
          "declare function readConfig(): string",
          "declare function fetchConfig(): Promise<string>",
          "export function loadConfig(): string {",
          "  try {",
          "    return readConfig()",
          "  } catch (error) {",
          "    const mapped = new LoadConfigError(String(error))",
          "    return 'default'",
          "  }",
          "}",
          "export const loadEffect = Effect.tryPromise({",
          "  try: () => fetchConfig(),",
          "  catch: (error) => {",
          "    const mapped = new LoadConfigError(String(error))",
          "    return 'offline'",
          "  }",
          "})",
        ].join("\n"),
      )

      const out = await run(repo)

      expect(out.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "catch-without-narrowing",
            symbol: "loadConfig",
            collapseMode: "fallback",
          }),
          expect.objectContaining({
            kind: "effect-error-collapse",
            symbol: "loadEffect",
            collapseMode: "fallback",
          }),
        ]),
      )
    } finally {
      await repo.cleanup()
    }
  })

  test("callback handler resolution respects lexical shadowing", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/shadowing.ts",
        [
          "import { Effect } from 'effect'",
          "function handler(): undefined { return undefined }",
          "declare function fetchUser(): Promise<string>",
          "export function loadUser(): Promise<string> {",
          "  const handler = () => { throw new Error('mapped') }",
          "  return fetchUser().catch(handler)",
          "}",
          "export function loadEffect() {",
          "  const handler = () => { throw new Error('mapped') }",
          "  return Effect.tryPromise({ try: () => fetchUser(), catch: handler })",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)

      expect(out.findings.some((finding) => finding.kind === "promise-catch-collapse")).toBe(false)
      expect(out.findings.some((finding) => finding.kind === "effect-error-collapse")).toBe(false)
    } finally {
      await repo.cleanup()
    }
  })

  test("same-line findings have unique column-bearing identifiers", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/same-line.ts",
        "export function loadUser(): string { if (Math.random()) throw new Error('a'); if (Math.random()) throw new Error('b'); return 'ok' }\n",
      )

      const out = await run(repo)
      const broadThrows = out.findings.filter((finding) => finding.kind === "broad-throw")
      const ids = broadThrows.map((finding) => finding.findingId)
      const diagnosticIds = TsLd09.diagnose(out).map((diagnostic) => diagnostic.data?.findingId)

      expect(broadThrows).toHaveLength(2)
      expect(new Set(ids).size).toBe(2)
      expect(ids.every((id) => id.startsWith("1:"))).toBe(true)
      expect(broadThrows[0]?.line).toBe(1)
      expect(broadThrows[0]?.column).toBeLessThan(broadThrows[1]?.column ?? 0)
      expect(new Set(diagnosticIds).size).toBe(2)
    } finally {
      await repo.cleanup()
    }
  })

  test("generated, declaration, and test files are excluded by default", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write("src/generated/client.ts", "export function loadUser() { throw new Error('x') }\n")
      await repo.write("src/types.d.ts", "export function loadUser(): Promise<string>\n")
      await repo.write("src/api.test.ts", "export function loadUser() { throw new Error('x') }\n")
      await repo.write("src/real.ts", "export const ok = true\n")

      const out = await run(repo)
      expect(out.analyzedFiles).toBe(1)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("all-excluded repositories are not applicable", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write("src/test-support/helper.ts", "export function loadUser() { throw new Error('x') }\n")
      await repo.write("src/test-helpers.ts", "export function readUser() { throw new Error('x') }\n")
      await repo.write("src/test-mocks.ts", "export function fetchUser() { throw new Error('x') }\n")
      await repo.write("src/test-harness.ts", "export function requestUser() { throw new Error('x') }\n")
      await repo.write("src/happydom.ts", "export function parseDom() { throw new Error('x') }\n")

      const out = await run(repo)
      expect(out.state).toBe("not_applicable")
      expect(out.analyzedFiles).toBe(0)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
      expect(TsLd09.diagnose(out)).toEqual([])
      expect(TsLd09.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostics are stable and capped by config", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/api.ts",
        [
          "export async function loadAlpha(): Promise<string> { throw new Error('a') }",
          "export async function loadBeta(): Promise<string> { throw new Error('b') }",
        ].join("\n"),
      )

      const out = await run(repo, { ...TsLd09.defaultConfig, top_n_diagnostics: 1 })
      expect(out.findings.length).toBeGreaterThan(1)
      expect(out.topFindings).toHaveLength(1)
      expect(TsLd09.diagnose(out)).toHaveLength(1)
      expect(out.byKind.get("opaque-promise-api")).toBe(2)
      expect(out.byFile.size).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("diagnostic cap is finite-safe", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-")
    try {
      await repo.write(
        "src/api.ts",
        [
          "export async function loadAlpha(): Promise<string> { throw new Error('a') }",
          "export async function loadBeta(): Promise<string> { throw new Error('b') }",
        ].join("\n"),
      )

      const fractional = await run(repo, { ...TsLd09.defaultConfig, top_n_diagnostics: 1.8 })
      expect(fractional.diagnosticLimit).toBe(1)
      expect(fractional.topFindings).toHaveLength(1)
      expect(TsLd09.diagnose(fractional)).toHaveLength(1)

      const negative = await run(repo, { ...TsLd09.defaultConfig, top_n_diagnostics: -1 })
      expect(negative.diagnosticLimit).toBe(0)
      expect(negative.topFindings).toEqual([])
      expect(TsLd09.diagnose(negative)).toEqual([])

      const nan = await run(repo, { ...TsLd09.defaultConfig, top_n_diagnostics: Number.NaN })
      expect(nan.diagnosticLimit).toBe(0)
      expect(nan.topFindings).toEqual([])
      expect(TsLd09.diagnose(nan)).toEqual([])

      const infinity = await run(repo, {
        ...TsLd09.defaultConfig,
        top_n_diagnostics: Number.POSITIVE_INFINITY,
      })
      expect(infinity.diagnosticLimit).toBe(0)
      expect(infinity.topFindings).toEqual([])
      expect(TsLd09.diagnose(infinity)).toEqual([])
    } finally {
      await repo.cleanup()
    }
  })

  test("pack registration exposes TS-LD-09 with cache version", () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-LD-09"),
    )
    expect(registered?.id).toBe("TS-LD-09-error-channel-opacity")
    expect(registered?.cacheVersion).toContain(TsLd09.cacheVersion)
  })

  test("default config decodes", () => {
    const decoded = Schema.decodeUnknownSync(TsLd09.configSchema)(TsLd09.defaultConfig)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
    expect(decoded.expected_failure_name_patterns).toContain("load")
    expect(decoded.max_weighted_opacity_per_kloc).toBeGreaterThan(0)
    expect(decoded.max_boundary_weighted_opacity).toBeGreaterThan(0)
  })
})

const kinds = (out: TsLd09Output): ReadonlyArray<ErrorChannelOpacityKind> =>
  out.findings.map((finding) => finding.kind).sort()
