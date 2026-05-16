import { afterEach, beforeEach, describe, expect, test } from "bun:test"
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
    expect(TsAd04.score(out)).toBe(0)
    expect(TsAd04.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("without parse/decode evidence"),
    })
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
