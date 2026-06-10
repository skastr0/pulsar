import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAd04 } from "../signals/ts-ad-04-boundary-parser-coverage.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
type TsAd04Result = Parameters<typeof TsAd04.score>[0]

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ad-04-")
})

afterEach(async () => {
  await repo.cleanup()
})

const run = async (
  config = TsAd04.defaultConfig,
): Promise<TsAd04Result> => runSignal(repo.root, TsAd04, config)

describe("TS-AD-04 (boundary parser coverage)", () => {
  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAd04.configSchema)(TsAd04.defaultConfig)

    expect(decoded.boundary_globs).toContain("**/api/*.ts")
    expect(decoded.boundary_globs).toContain("**/src/cli/*.ts")
    expect(decoded.boundary_globs).not.toContain("**/cli/**/*.ts")
    expect(decoded.parser_call_patterns).toContain("decode")
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
    expect(decoded.top_n_diagnostics).toBe(10)
  })

  test("pack registration exposes identity, cache version, and config factor ledger", async () => {
    await repo.write(
      "src/api/user.ts",
      "export function POST(input: unknown) { return input }\n",
    )
    const registered = registeredTsAd04()
    const out = await run()
    const factorLedger = registered.factorLedger?.(out)

    expect(registered.id).toBe("TS-AD-04-boundary-parser-coverage")
    expect(registered.aliases).toContain("TS-AD-04")
    expect(registered.title).toBe("Boundary parser coverage")
    expect(registered.cacheVersion).toContain(TsAd04.cacheVersion)
    expect(factorLedger?.signalId).toBe(TsAd04.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.parser_call_patterns",
        value: expect.arrayContaining(["decode"]),
        source: "signal-default",
        scoreRole: "metadata",
        affectsScore: false,
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
        affectsScore: true,
      }),
    )
  })

  test("flags weak boundary inputs without parse or decode evidence", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "export function POST(request: Request) {",
        "  return request.url",
        "}",
      ].join("\n"),
    )

    const out = await run()
    expect(out.state).toBe("present")
    expect(out.boundaryFilesMatched).toBe(1)
    expect(out.weakBoundaryFunctions).toBe(1)
    expect(out.findings).toMatchObject([
      {
        symbol: "POST",
        weakParameters: [
          {
            name: "request",
            typeText: "Request",
            reason: "request-like",
          },
        ],
      },
    ])
    // The finding is reported at full fidelity, but a single weak function
    // is below the evidence floor: ratio 1 scaled by 1/4.
    expect(TsAd04.score(out)).toBeCloseTo(0.75)
    expect(TsAd04.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("without parse/decode evidence"),
    })
  })

  test("does not treat every file in a package named cli as a process boundary", async () => {
    await repo.write(
      "packages/cli/src/format.ts",
      [
        "export function formatCliError(err: unknown): string {",
        "  return String(err)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("absent")
    expect(out.boundaryFilesMatched).toBe(0)
    expect(out.findings).toEqual([])
    expect(TsAd04.score(out)).toBe(1)
  })

  test("records zero findings when weak boundary inputs have Effect Schema decode evidence", async () => {
    await repo.write(
      "src/routes/user.ts",
      [
        "const UserSchema = {}",
        "export const handler = (input: unknown) => {",
        "  const parsed = Schema.decodeUnknownSync(UserSchema)(input)",
        "  return parsed",
        "}",
      ].join("\n"),
    )

    const out = await run()
    expect(out.state).toBe("zero")
    expect(out.findings).toEqual([])
    expect(out.covered[0]).toMatchObject({ symbol: "handler" })
    expect(out.covered[0]?.parserEvidence).toContain(
      "Schema.decodeUnknownSync(UserSchema)",
    )
    expect(TsAd04.score(out)).toBe(1)
  })

  test("scores by uncovered weak boundary ratio and caps diagnostics", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const UserSchema = { safeParse: (value: unknown) => ({ success: true, data: value }) }",
        "export function POST(input: unknown) {",
        "  return UserSchema.safeParse(input)",
        "}",
        "export function PATCH(input: any, raw) {",
        "  return input ?? raw",
        "}",
        "export const handler = (request: Request) => {",
        "  return request.url",
        "}",
      ].join("\n"),
    )

    const out = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: 1,
    })
    const diagnostics = TsAd04.diagnose(out)

    expect(out.state).toBe("present")
    expect(out.boundaryFilesMatched).toBe(1)
    expect(out.boundaryFunctionsAnalyzed).toBe(3)
    expect(out.weakBoundaryFunctions).toBe(3)
    expect(out.coveredWeakBoundaryFunctions).toBe(1)
    expect(out.covered).toMatchObject([
      {
        symbol: "POST",
        parserEvidence: ["UserSchema.safeParse"],
      },
    ])
    expect(out.findings).toMatchObject([
      {
        symbol: "PATCH",
        weakParameters: [
          { name: "input", reason: "any" },
          { name: "raw", reason: "untyped" },
        ],
      },
      {
        symbol: "handler",
        weakParameters: [
          { name: "request", reason: "request-like" },
        ],
      },
    ])
    // ratio 2/3 scaled by the evidence factor min(1, 3/4): below the
    // 4-function evidence floor, pressure shrinks proportionally.
    expect(TsAd04.score(out)).toBeCloseTo(1 - (2 / 3) * (3 / 4))
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("PATCH"),
      location: {
        file: expect.stringContaining("src/api/user.ts"),
        line: 5,
      },
      data: expect.objectContaining({
        symbol: "PATCH",
        missingEvidence: expect.stringContaining("No parse/decode/schema/assertion call"),
      }),
    })
  })

  test("diagnostics honor top_n_diagnostics as a sanitized finding cap", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "export function POST(input: unknown) { return input }",
        "export function PUT(input: any) { return input }",
        "export function PATCH(input) { return input }",
      ].join("\n"),
    )

    const fractional = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: -1,
    })
    const nanLimit = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: Infinity,
    })

    expect(fractional.findings).toHaveLength(3)
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsAd04.diagnose(fractional)).toHaveLength(1)
    expect(negative.findings).toHaveLength(3)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAd04.diagnose(negative)).toEqual([])
    expect(nanLimit.findings).toHaveLength(3)
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsAd04.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.findings).toHaveLength(3)
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsAd04.diagnose(infiniteLimit)).toEqual([])
  })

  test("honors custom parser call patterns as parser evidence", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const sanitizeBody = (value: unknown) => value",
        "export function POST(input: unknown) {",
        "  return sanitizeBody(input)",
        "}",
      ].join("\n"),
    )

    const out = await run({
      ...TsAd04.defaultConfig,
      parser_call_patterns: ["sanitizeBody"],
    })

    expect(out.state).toBe("zero")
    expect(out.findings).toEqual([])
    expect(out.covered).toMatchObject([
      {
        symbol: "POST",
        parserEvidence: ["sanitizeBody"],
      },
    ])
    expect(TsAd04.score(out)).toBe(1)
  })

  test("does not treat parser pattern names in call arguments as parser evidence", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const schema = {}",
        "const log = (value: unknown) => value",
        "export function POST(input: unknown) {",
        "  return log(schema)",
        "}",
      ].join("\n"),
    )

    const out = await run()
    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([{ symbol: "POST" }])
  })

  test("does not treat parser pattern substrings as parser evidence", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const parseCsv = (value: unknown) => value",
        "const safeParseCsv = (value: unknown) => value",
        "const decodeUnknownCsv = (value: unknown) => value",
        "export function POST(input: unknown) {",
        "  return parseCsv(input)",
        "}",
        "export function PUT(input: unknown) {",
        "  return safeParseCsv(input)",
        "}",
        "export function PATCH(input: unknown) {",
        "  return decodeUnknownCsv(input)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([
      { symbol: "POST" },
      { symbol: "PUT" },
      { symbol: "PATCH" },
    ])
  })

  test("requires parser evidence to reference a weak boundary input", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const parse = (value: unknown) => value",
        "export function POST(input: unknown) {",
        "  parse('literal')",
        "  return input",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([{ symbol: "POST" }])
  })

  test("does not count parser calls that only reference weak input inside nested callbacks", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const parse = (value: unknown) => value",
        "export function POST(input: unknown) {",
        "  return parse(() => input)",
        "}",
        "export function PUT(input: unknown) {",
        "  return parse((input) => input)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([
      { symbol: "POST" },
      { symbol: "PUT" },
    ])
  })

  test("requires parser evidence inside the boundary function body", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const parse = (value: unknown) => value",
        "parse('warmup')",
        "export function POST(input: unknown) {",
        "  return input",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([
      {
        symbol: "POST",
        weakParameters: [
          { name: "input", reason: "unknown" },
        ],
      },
    ])
  })

  test("analyzes anonymous default-export boundary functions", async () => {
    await repo.write(
      "src/api/user.ts",
      "export default (input: unknown) => input\n",
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.boundaryFunctionsAnalyzed).toBe(1)
    expect(out.weakBoundaryFunctions).toBe(1)
    expect(out.findings).toMatchObject([{ symbol: "default" }])
  })

  test("analyzes default-export function declarations", async () => {
    await repo.write(
      "src/api/user.ts",
      "export default function(input: unknown) { return input }\n",
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.boundaryFunctionsAnalyzed).toBe(1)
    expect(out.weakBoundaryFunctions).toBe(1)
    expect(out.findings).toMatchObject([{ symbol: "default" }])
  })

  test("distinguishes absent boundary files from measured zero parser gaps", async () => {
    await repo.write(
      "src/domain/user.ts",
      "export function buildUser(name: string) { return { name } }\n",
    )

    const out = await run()
    expect(out.state).toBe("absent")
    expect(out.boundaryFilesMatched).toBe(0)
    expect(TsAd04.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(TsAd04.diagnose(out)[0]?.message).toContain("no files matching")
  })

  test("distinguishes not_configured boundary globs", async () => {
    await repo.write(
      "src/api/user.ts",
      "export function POST(input: unknown) { return input }\n",
    )

    const out = await run({
      ...TsAd04.defaultConfig,
      boundary_globs: [],
    })

    expect(out.state).toBe("not_configured")
    expect(out.findings).toEqual([])
    expect(TsAd04.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(TsAd04.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("not configured"),
    })
  })

  test("distinguishes boundary files with no weak external inputs as not_applicable", async () => {
    await repo.write(
      "src/api/health.ts",
      "export function GET(): Response { return new Response('ok') }\n",
    )

    const out = await run()
    expect(out.state).toBe("not_applicable")
    expect(out.boundaryFunctionsAnalyzed).toBe(1)
    expect(out.weakBoundaryFunctions).toBe(0)
    expect(TsAd04.outputMetadata?.(out)).toEqual({
      applicability: "not_applicable",
    })
    expect(TsAd04.score(out)).toBe(1)
    expect(TsAd04.diagnose(out)).toEqual([])
  })

  test("does not treat decoder-callback parameters as weak external input", async () => {
    // probe-cli regression: readOptionalJsonInput(decode: (value: unknown) => T)
    // was reported as accepting weak external input without parse evidence,
    // and as the only candidate it scored the signal 0.00. The unknown in a
    // function-typed parameter is consumed by the callback, not received
    // through the boundary.
    await repo.write(
      "src/cli/json.ts",
      [
        "const decodeJsonText = <T>(decode: (value: unknown) => T, raw: string): T =>",
        "  decode(JSON.parse(raw))",
        "export const readOptionalJsonInput = <T>(",
        "  decode: (value: unknown) => T,",
        "  raw: string | undefined,",
        "): T | undefined => (raw === undefined ? undefined : decodeJsonText(decode, raw))",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.weakBoundaryFunctions).toBe(0)
    expect(TsAd04.score(out)).toBe(1)
  })

  test("does not treat default-initialized parameters as weak external input", async () => {
    // flare regression: saveAuthKey(authPath = getAuthPath()) was classified
    // "untyped" weak input; the inferred type comes from an internal
    // initializer, not from untrusted callers.
    await repo.write(
      "src/cli/auth.ts",
      [
        "const getAuthPath = () => \"/tmp/auth.json\"",
        "export function saveAuthKey(key: string, authPath = getAuthPath()) {",
        "  return `${authPath}:${key}`",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.weakBoundaryFunctions).toBe(0)
  })

  test("a single uncovered weak function cannot zero the signal", async () => {
    await repo.write(
      "src/api/user.ts",
      "export function POST(input: unknown) { return input }\n",
    )

    const out = await run()

    expect(out.weakBoundaryFunctions).toBe(1)
    expect(out.findings).toHaveLength(1)
    // ratio 1 scaled by evidence factor 1/4
    expect(TsAd04.score(out)).toBeCloseTo(0.75)
  })

  test("declares composite consumers and conservative enforcement", async () => {
    await repo.write(
      "src/api/user.ts",
      "export function POST(input: any) { return input }\n",
    )

    const out = await run()
    expect(out.compositeConsumers).toEqual([
      "boundary trust breach",
      "contract safety gap",
      "AI quicksand risk",
    ])
    expect(out.cacheContributors).toContain("config.parser_call_patterns")
    expect(out.calibrationSurface).toContain("config.boundary_globs")
    expect(out.enforcementCeiling).toEqual(["soft-warning", "trend", "review-routing"])
  })
})

const registeredTsAd04 = () => {
  const signal = TS_PACK_SIGNALS.find((candidate) => candidate.id === TsAd04.id)
  if (signal === undefined) throw new Error("TS-AD-04 is not registered")
  return signal
}
