import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { InMemoryCacheLayer, ReferenceDataTag, SignalContextTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import { observe } from "@skastr0/pulsar-core/observer"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer } from "effect"
import { inferCasingPattern } from "../casing.js"
import { TsLd04 } from "../signals/ts-ld-04-naming-conventions.js"
import { TsProjectLayer } from "../ts-project.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

const NAMING_CONVENTIONS = {
  schema_version: 1,
  extracted_at_sha: "HEAD",
  boundaries: {},
  naming_conventions: {
    function: "camelCase",
    class: "PascalCase",
    interface: "PascalCase",
    type: "PascalCase",
    const: "camelCase | UPPER_SNAKE_CASE",
    enum: "PascalCase",
  },
  architectural_rules: [],
}

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ld-04-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-LD-04 (naming convention consistency)", () => {
  test("classifies canonical casing examples", () => {
    expect(inferCasingPattern("buildUser")).toBe("camelCase")
    expect(inferCasingPattern("UserService")).toBe("PascalCase")
    expect(inferCasingPattern("MAX_RETRIES")).toBe("UPPER_SNAKE_CASE")
    expect(inferCasingPattern("user_profile")).toBe("snake_case")
    expect(inferCasingPattern("user-profile")).toBe("kebab-case")
    expect(inferCasingPattern("weird_PASCAL_mix")).toBe("unrecognized")
  })

  test("reports no violations when identifiers follow configured conventions", async () => {
    await repo.write(
      "src/consistent.ts",
      [
        "export function buildUser() { return true }",
        "export class UserService {}",
        "export interface UserProfile { id: string }",
        "export type SessionToken = string",
        "export enum StatusCode { Ok = 'ok' }",
        "export const retryBudget = 2",
        "export const MAX_RETRIES = 3",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig, {
      "schema-conventions": NAMING_CONVENTIONS,
    })

    expect(out.violations).toEqual([])
    expect(out.totalIdentifiers).toBe(7)
    expect(TsLd04.score(out)).toBe(1)
    expect(out.byKind.get("const")).toEqual({ total: 2, violating: 0 })
  })

  test("honors context-aware const conventions", async () => {
    await repo.write(
      "src/contextual.ts",
      [
        "export const MAX_RETRIES = 3",
        "export const UserSchema = { id: 'string' } as const",
        "export function buildUser() {",
        "  const retryBudget = MAX_RETRIES",
        "  return { retryBudget }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig, {
      "schema-conventions": {
        ...NAMING_CONVENTIONS,
        naming_conventions: {
          ...NAMING_CONVENTIONS.naming_conventions,
          const: "camelCase | PascalCase | UPPER_SNAKE_CASE",
        },
      },
    })

    expect(out.violations).toEqual([])
    expect(out.byKind.get("const")).toEqual({ total: 3, violating: 0 })
  })

  test("uses the same applicability in single-signal and observer paths", async () => {
    await repo.write(
      "src/consistent.ts",
      [
        "export const MAX_RETRIES = 3",
        "export function buildUser() {",
        "  const retryBudget = MAX_RETRIES",
        "  return retryBudget",
        "}",
        "",
      ].join("\n"),
    )

    const referenceEntries = { "schema-conventions": NAMING_CONVENTIONS }
    const single = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig, referenceEntries)
    const observer = await runObserverTsLd04(repo.root, referenceEntries)
    const observerResult = observer.signalResults.get("TS-LD-04")

    expect(TsLd04.outputMetadata?.(single)?.applicability ?? "applicable").toBe("applicable")
    expect(observerResult?.metadata?.applicability ?? "applicable").toBe("applicable")
  })

  test("flags one violation per identifier kind and includes diagnostic hashes", async () => {
    await repo.write(
      "src/inconsistent.ts",
      [
        "export function get_user_data() { return true }",
        "export class bad_class {}",
        "export interface bad_interface { id: string }",
        "export type bad_type = string",
        "export enum bad_enum { Ok = 'ok' }",
        "export const BadConst = 1",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig, {
      "schema-conventions": NAMING_CONVENTIONS,
    })

    expect(out.violations.map((violation) => violation.kind).sort()).toEqual([
      "class",
      "const",
      "enum",
      "function",
      "interface",
      "type",
    ])
    expect(out.byKind.get("function")).toEqual({ total: 1, violating: 1 })
    expect(out.byKind.get("const")).toEqual({ total: 1, violating: 1 })

    const diagnostics = TsLd04.diagnose(out)
    expect(diagnostics).toHaveLength(6)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warn")).toBe(true)
    expect(diagnostics.every((diagnostic) => typeof diagnostic.data?.hash === "string")).toBe(true)
  })

  test("surfaces mixed casing as unrecognized", async () => {
    await repo.write("src/mixed.ts", "export const weird_PASCAL_mix = 1\n")

    const out = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig, {
      "schema-conventions": NAMING_CONVENTIONS,
    })

    expect(out.violations[0]?.actualPattern).toBe("unrecognized")
  })

  test("gracefully degrades when no naming conventions are configured", async () => {
    await repo.write("src/sample.ts", "export function get_user() { return true }\n")

    const out = await runSignal(repo.root, TsLd04, TsLd04.defaultConfig)

    expect(out.referenceDataStatus).toBe("missing")
    expect(TsLd04.score(out)).toBe(1)
    expect(TsLd04.diagnose(out)).toEqual([
      { severity: "info", message: "no naming conventions configured" },
    ])
  })
})

const runObserverTsLd04 = async (
  repoRoot: string,
  referenceEntries: Readonly<Record<string, unknown>>,
) => {
  const program = Effect.gen(function* () {
    const registry = yield* buildRegistry([TsLd04])
    const EnvLayer = Layer.mergeAll(
      TsProjectLayer(repoRoot),
      InMemoryCacheLayer,
      Layer.succeed(SignalContextTag, {
        gitSha: "TEST",
        worktreePath: repoRoot,
        changedHunks: [],
      }),
      Layer.succeed(
        ReferenceDataTag,
        makeReferenceData(new Map(Object.entries(referenceEntries))),
      ),
    )
    return yield* (
      Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
        ObserverOutput,
        unknown,
        never
      >
    )
  })

  return Effect.runPromise(program)
}
