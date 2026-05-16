import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import {
  TsLd09,
  type ErrorChannelOpacityKind,
  type TsLd09Output,
} from "../signals/ts-ld-09-error-channel-opacity.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

const run = (repo: TempRepo, config = TsLd09.defaultConfig): Promise<TsLd09Output> =>
  runSignal(repo.root, TsLd09, config)

describe("TS-LD-09 (error channel opacity)", () => {
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
      expect(TsLd09.score(out)).toBeLessThan(1)
      expect(TsLd09.diagnose(out)[0]).toMatchObject({
        severity: "warn",
        location: { file: expect.stringContaining("src/api.ts") },
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
