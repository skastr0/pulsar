import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsSl06 } from "../signals/ts-sl-06-confidence-claim-mismatch.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-SL-06 confidence claim behavior", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-sl-06-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("accepts returned filesystem existence but not ignored or uninvoked checks", async () => {
    await repo.write(
      "src/existence.ts",
      [
        "import { existsSync } from 'node:fs'",
        "export const hasProjectConfig = (path: string): boolean => existsSync(path)",
        "export function validateIgnoredExistence(path: string): boolean {",
        "  existsSync(path)",
        "  return true",
        "}",
        "export function validateUninvokedExistence(path: string): boolean {",
        "  const inspect = () => existsSync(path)",
        "  return true",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "validateIgnoredExistence",
      "validateUninvokedExistence",
    ])
  })

  test("accepts truthy regular-expression test and match results but not ignored mutations", async () => {
    await repo.write(
      "src/regex.ts",
      [
        "export const isPackageName = (value: string): boolean => /^[a-z][a-z0-9-]+$/.test(value)",
        "export const hasTicketPrefix = (value: string): boolean => Boolean(value.match(/^PUL-[0-9]+$/))",
        "export function validateIgnoredRegex(value: string): boolean {",
        "  /^[a-z]+$/.test(value)",
        "  return true",
        "}",
        "export function validateNestedRegex(value: string): boolean {",
        "  const inspect = () => value.match(/^PUL-/)",
        "  return true",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "validateIgnoredRegex",
      "validateNestedRegex",
    ])
  })

  test("accepts finite positive and bounded ranges but not an ignored range mutation", async () => {
    await repo.write(
      "src/numbers.ts",
      [
        "export const isPositiveLimit = (value: number): boolean => Number.isFinite(value) && value > 0",
        "export const validateRatio = (value: number): boolean =>",
        "  Number.isFinite(value) && value >= 0 && value <= 1",
        "export function validateIgnoredPort(value: number): boolean {",
        "  Number.isFinite(value) && value > 0 && value <= 65_535",
        "  return true",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual(["validateIgnoredPort"])
  })

  test("accepts returned regex sanitization but not ignored replacement or opaque transforms", async () => {
    await repo.write(
      "src/sanitize.ts",
      [
        "declare const transform: (value: string) => string",
        "export const parseSignalId = (raw: string): string => raw.replace(/[^A-Z0-9-]/g, '')",
        "export function parseIgnoredSignalId(raw: string): string {",
        "  raw.replace(/[^A-Z0-9-]/g, '')",
        "  return raw",
        "}",
        "export const parseOpaqueTransform = (raw: string): string => transform(raw)",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "parseIgnoredSignalId",
      "parseOpaqueTransform",
    ])
  })

  test("accepts direct checked-validator delegation without trusting names alone", async () => {
    await repo.write(
      "src/delegation.ts",
      [
        "declare const transform: (value: string) => unknown",
        "declare const parseRemote: (value: string) => unknown",
        "declare const UserSchema: { safeParse(value: unknown): unknown }",
        "const validateLocally = (value: string): boolean => /^[a-z]+$/.test(value)",
        "const parseOpaque = (value: string): unknown => transform(value)",
        "export const validateUserName = (value: string): boolean => validateLocally(value)",
        "export const validateNormalizedUserName = (value: string): boolean => {",
        "  const normalized = value.trim()",
        "  return validateLocally(normalized)",
        "}",
        "export const validateUserPayload = (value: unknown): unknown => UserSchema.safeParse(value)",
        "export const validateKnownOnly = (_value: string): boolean => validateLocally('known')",
        "export const validateKnownPayload = (_value: unknown): unknown => UserSchema.safeParse({ known: true })",
        "export const parseLocalOpaque = (value: string): unknown => parseOpaque(value)",
        "export const parseImportedOpaque = (value: string): unknown => parseRemote(value)",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "parseOpaque",
      "validateKnownOnly",
      "validateKnownPayload",
      "parseLocalOpaque",
      "parseImportedOpaque",
    ])
  })

  test("keeps findings when a guard mutation leaves every outcome successful", async () => {
    await repo.write(
      "src/all-success.ts",
      [
        "export function validateNullable(value: unknown): boolean {",
        "  if (value === null) return true",
        "  return true",
        "}",
        "export function validateNullableControl(value: unknown): boolean {",
        "  if (value === null) return false",
        "  return true",
        "}",
        "export const validateNullableTernary = (value: unknown): boolean =>",
        "  value === null ? true : true",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "validateNullable",
      "validateNullableTernary",
    ])
    expect(out.findings[0]?.observedBehavior).toContain("unconditional success")
    expect(out.findings[0]?.missingBehavior).toEqual([
      "a non-success outcome tied to the claimed check",
    ])
  })

  test("keeps hollow claims and explains claimed, supporting, observed, and missing behavior", async () => {
    await repo.write(
      "src/hollow.ts",
      [
        "type User = { id: string }",
        "export const parseCast = (raw: unknown): User => raw as User",
        "export const parseNonNull = (raw: User | undefined): User => raw!",
        "export const validateAlways = (_value: unknown): boolean => true",
        "export function assertUser(_value: unknown): asserts _value is User { return }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSl06, TsSl06.defaultConfig)
    const diagnostics = TsSl06.diagnose(out)

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "parseCast",
      "parseNonNull",
      "validateAlways",
      "assertUser",
    ])
    expect(out.findings[0]).toMatchObject({
      claimedGuarantee: "runtime parsing or sanitization",
      supportingBehavior: [],
      observedBehavior: ["type cast only"],
      missingBehavior: ["returned parsing, sanitization, or checked-validator behavior"],
    })
    expect(diagnostics[0]?.message).toContain("claims runtime parsing or sanitization")
    expect(diagnostics[0]?.message).toContain("supporting behavior: none")
    expect(diagnostics[0]?.message).toContain("observed behavior: type cast only")
    expect(diagnostics[0]?.message).toContain(
      "missing behavior: returned parsing, sanitization, or checked-validator behavior",
    )
  })
})
