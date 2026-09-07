import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAd04, TsAd04Config } from "../signals/ts-ad-04-boundary-parser-coverage.js"
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
    const decoded = Schema.decodeSync(TsAd04Config)(TsAd04.defaultConfig)

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
    expect(diagnostics).toHaveLength(2)
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
    expect(diagnostics[1]).toMatchObject({
      severity: "info",
      data: {
        kind: "boundary-parser-coverage-audit",
        coveredTotal: 1,
        excludedTotal: 0,
        coveredTruncated: false,
        excludedTruncated: false,
        covered: [expect.objectContaining({ symbol: "POST" })],
        excluded: [],
      },
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

  test("follows one stable local alias from weak input to parser evidence", async () => {
    await repo.write(
      "src/routes/webhook.ts",
      [
        "const WebhookSchema = { safeParse: (value: unknown) => ({ success: true, data: value }) }",
        "export async function POST(input: APIEvent) {",
        "  const body = await input.request.json()",
        "  return WebhookSchema.safeParse(body)",
        "}",
        "export function PUT(input: unknown) {",
        "  let payload = input",
        "  return WebhookSchema.safeParse(payload)",
        "}",
        "export function PATCH(input: unknown) {",
        "  return WebhookSchema.safeParse(input)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("zero")
    expect(out.findings).toEqual([])
    expect(out.covered).toMatchObject([
      { symbol: "POST", parserEvidence: ["WebhookSchema.safeParse"] },
      { symbol: "PUT", parserEvidence: ["WebhookSchema.safeParse"] },
      { symbol: "PATCH", parserEvidence: ["WebhookSchema.safeParse"] },
    ])
  })

  test("rejects reassigned, shadowed, two-hop, and unrelated aliases", async () => {
    await repo.write(
      "src/routes/webhook.ts",
      [
        "const WebhookSchema = { safeParse: (value: unknown) => ({ success: true, data: value }) }",
        "export function POST(input: unknown) {",
        "  let body = input",
        "  body = { unrelated: true }",
        "  return WebhookSchema.safeParse(body)",
        "}",
        "export function PUT(input: unknown) {",
        "  const body = input",
        "  const payload = body",
        "  return WebhookSchema.safeParse(payload)",
        "}",
        "export function PATCH(input: unknown) {",
        "  const body = { unrelated: true }",
        "  WebhookSchema.safeParse(body)",
        "  return input",
        "}",
        "export function DELETE(input: unknown) {",
        "  const body = input",
        "  {",
        "    const body = { unrelated: true }",
        "    WebhookSchema.safeParse(body)",
        "  }",
        "  return input",
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
      { symbol: "DELETE" },
    ])
  })

  test("does not credit nested-block shadowing or compound writes as parser evidence", async () => {
    await repo.write(
      "src/routes/shadow.ts",
      [
        "const WebhookSchema = { safeParse: (value: unknown) => ({ success: true, data: value }) }",
        "export function POST(input: unknown) {",
        "  {",
        "    const copy = input",
        "  }",
        "  const copy = { unrelated: true }",
        "  return WebhookSchema.safeParse(copy)",
        "}",
        "export function PUT(input: unknown) {",
        "  let body = input",
        "  body += \"\"",
        "  return WebhookSchema.safeParse(body)",
        "}",
        "export function PATCH(input: unknown) {",
        "  let body = input",
        "  body ||= {}",
        "  return WebhookSchema.safeParse(body)",
        "}",
        "export function DELETE(input: unknown) {",
        "  let body = input",
        "  body &&= {}",
        "  return WebhookSchema.safeParse(body)",
        "}",
        "export function OPTIONS(input: unknown) {",
        "  let body = input",
        "  body ??= {}",
        "  return WebhookSchema.safeParse(body)",
        "}",
      ].join("\n"),
    )

    const out = await run()
    expect(out.covered).toEqual([])
    expect(out.findings.map((finding) => finding.symbol).sort()).toEqual([
      "DELETE",
      "OPTIONS",
      "PATCH",
      "POST",
      "PUT",
    ])
  })

  test("keeps cast-only boundary body aliases uncovered", async () => {
    await repo.write(
      "src/routes/enterprise.ts",
      [
        "export async function POST(event: APIEvent) {",
        "  const body = (await event.request.json()) as EnterpriseFormData",
        "  return body",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("present")
    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([{ symbol: "POST" }])
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

  test("requires direct parser evidence to resolve to the weak parameter in the same function", async () => {
    await repo.write(
      "src/api/user.ts",
      [
        "const UserSchema = { safeParse: (value: unknown) => value }",
        "export function POST(input: unknown) {",
        "  {",
        "    const input = { unrelated: true }",
        "    UserSchema.safeParse(input)",
        "  }",
        "  return input",
        "}",
        "export function PUT(input: unknown) {",
        "  function deferred() {",
        "    return UserSchema.safeParse(input)",
        "  }",
        "  return input",
        "}",
        "export function PATCH(input: unknown) {",
        "  const deferred = () => UserSchema.safeParse(input)",
        "  return input",
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

  test("limits candidates to supported untrusted ingress sources", async () => {
    await repo.write(
      "node_modules/vendor-sdk/package.json",
      JSON.stringify({ name: "vendor-sdk", version: "1.0.0", types: "index.d.ts" }),
    )
    await repo.write(
      "node_modules/vendor-sdk/index.d.ts",
      "export function fetchRaw(): unknown\n",
    )
    await repo.write(
      "src/adapters/ingress.ts",
      [
        "import { readFileSync } from 'node:fs'",
        "import { execSync } from 'node:child_process'",
        "import { ipcRenderer } from 'electron'",
        "import { fetchRaw } from 'vendor-sdk'",
        "type Domain = { readonly id: string }",
        "export function fromUnknown(input: unknown): Domain { return input as Domain }",
        "export function fromUntyped(input): Domain { return input as Domain }",
        "export function fromWire(text: string): Domain { return JSON.parse(text) as Domain }",
        "export function fromEnvironment(): Domain { return { id: process.env.DOMAIN_ID as string } }",
        "export function fromFilesystem(): Domain { return readFileSync('/tmp/domain.json') as unknown as Domain }",
        "export function fromSubprocess(): Domain { return execSync('domain') as unknown as Domain }",
        "export async function fromIpc(): Promise<Domain> { return await ipcRenderer.invoke('domain') as Domain }",
        "export function fromSdk(): Domain { return fetchRaw() as Domain }",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "fromUnknown",
      "fromUntyped",
      "fromWire",
      "fromEnvironment",
      "fromFilesystem",
      "fromSubprocess",
      "fromIpc",
      "fromSdk",
    ])
    expect(out.findings.map((finding) => finding.ingressSources[0]?.kind)).toEqual([
      "unknown",
      "untyped",
      "parsed-wire",
      "environment",
      "filesystem",
      "subprocess",
      "ipc",
      "external-sdk",
    ])
    expect(out.findings.every((finding) =>
      finding.candidateReason === "supported-untrusted-ingress" &&
      finding.parserEvidence.length === 0
    )).toBe(true)
  })

  test("requires symbol-proven JSON, environment, and subprocess ingress", async () => {
    await repo.write(
      "src/adapters/local-lookalikes.ts",
      [
        "type Domain = { readonly id: string }",
        "type Handle = { readonly pid: number }",
        "const model = { json: (): Domain => ({ id: 'local' }) }",
        "const JSON = { parse: (_text: string): Domain => ({ id: 'local' }) }",
        "const Bun = { spawn: (_cmd: string): Handle => ({ pid: 1 }) }",
        "const process = { env: { DOMAIN_ID: 'local' } }",
        "export const typedAccessor = (): Domain => model.json()",
        "export const shadowedJson = (): Domain => JSON.parse('local')",
        "export const shadowedSpawn = (): Handle => Bun.spawn('local')",
        "export const shadowedEnvironment = (): Domain => ({ id: process.env.DOMAIN_ID })",
      ].join("\n"),
    )

    const out = await run()

    expect(out.state).toBe("not_applicable")
    expect(out.findings).toEqual([])
    expect(out.covered).toEqual([])
    expect(out.excluded).toEqual([])
  })

  test("excludes semantic non-ingress shapes while paired raw-domain controls remain findings", async () => {
    await repo.write(
      "src/adapters/projections.ts",
      [
        "type Domain = { readonly id: string }",
        "type Snapshot = { readonly entities: ReadonlyArray<Domain> }",
        "declare namespace Either { type Either<R, L> = { readonly _tag: 'Right'; readonly right: R } | { readonly _tag: 'Left'; readonly left: L } }",
        "declare namespace Effect { type Effect<A, E, R> = { readonly _A: A; readonly _E: E; readonly _R: R } }",
        "type CreativeRequest = { readonly requestId: string }",
        "type RequestRow = { readonly id: string }",
        "export const mapBoothRequestRows = (rows: ReadonlyArray<CreativeRequest>): ReadonlyArray<RequestRow> =>",
        "  rows.map((row) => ({ id: row.requestId }))",
        "export const buildBoothBundle = (result: Either.Either<ReadonlyArray<Domain>, unknown>): Snapshot =>",
        "  result._tag === 'Left' ? { entities: [] } : { entities: result.right }",
        "export const isSdkError = (value: unknown): value is Domain =>",
        "  typeof value === 'object' && value !== null && 'id' in value",
        "export const describeSdkError = (error: unknown): string =>",
        "  error instanceof Error ? error.message : 'failed'",
        "export const formatPayloadJson = (payload: unknown): string | undefined =>",
        "  payload === undefined ? undefined : JSON.stringify(payload)",
        "export const resolved = <A, E>(effect: Effect.Effect<A, E, any>): Effect.Effect<A, E, never> =>",
        "  effect as Effect.Effect<A, E, never>",
        "export const buildTowerBundle = (result: Either.Either<ReadonlyArray<Domain>, unknown>): Snapshot =>",
        "  result._tag === 'Left' ? { entities: [] } : { entities: result.right }",
        "export const unsafeMapper = (rows: ReadonlyArray<unknown>): ReadonlyArray<Domain> =>",
        "  rows as ReadonlyArray<Domain>",
        "export const unsafeEnvelope = (result: unknown): Snapshot => result as Snapshot",
        "export const dishonestPredicate = (_value: unknown): _value is Domain => true",
        "export const unsafeGuard = (value: unknown): Domain =>",
        "  value instanceof Error ? value as unknown as Domain : value as Domain",
        "export const unsafeProjection = (value: unknown): Domain => value as Domain",
        "export const unsafeEffectPayload = (effect: Effect.Effect<any, never, never>): Domain =>",
        "  effect as unknown as Domain",
      ].join("\n"),
    )

    const out = await run()

    expect(out.excluded).toMatchObject([
      { symbol: "mapBoothRequestRows", exclusionReason: "typed-input-projection" },
      { symbol: "buildBoothBundle", exclusionReason: "typed-error-envelope" },
      { symbol: "isSdkError", exclusionReason: "runtime-type-refinement" },
      { symbol: "describeSdkError", exclusionReason: "terminal-output-projection" },
      { symbol: "formatPayloadJson", exclusionReason: "terminal-output-projection" },
      { symbol: "resolved", exclusionReason: "effect-requirement-wrapper" },
      { symbol: "buildTowerBundle", exclusionReason: "typed-error-envelope" },
    ])
    expect(out.findings.map((finding) => finding.symbol)).toEqual([
      "unsafeMapper",
      "unsafeEnvelope",
      "dishonestPredicate",
      "unsafeGuard",
      "unsafeProjection",
      "unsafeEffectPayload",
    ])
  })

  test("keeps raw carriers and primitive formatters out of the denominator but counts runtime validation", async () => {
    await repo.write(
      "src/adapters/body-ingress.ts",
      [
        "import { readFileSync } from 'node:fs'",
        "declare namespace NodeJS { interface ProcessEnv { readonly [key: string]: string | undefined } }",
        "type Domain = { readonly id: string }",
        "export const copyEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env })",
        "export const renderAvatar = (): string => readFileSync('/tmp/avatar.png').toString('base64')",
        "export const parseDomain = (text: string): Domain | undefined => {",
        "  const parsed: unknown = JSON.parse(text)",
        "  if (parsed === null || typeof parsed !== 'object' || !('id' in parsed)) return undefined",
        "  return parsed as Domain",
        "}",
        "type ParsedDomain = { readonly ok: true; readonly value: Domain } | { readonly ok: false; readonly error: string }",
        "export const parseTaggedDomain = (text: string): ParsedDomain => {",
        "  const parsed: unknown = JSON.parse(text)",
        "  if (parsed === null || typeof parsed !== 'object' || !('id' in parsed)) return { ok: false, error: 'invalid' }",
        "  return { ok: true, value: parsed as Domain }",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.excluded).toMatchObject([
      { symbol: "copyEnvironment", exclusionReason: "raw-ingress-carrier" },
      { symbol: "renderAvatar", exclusionReason: "terminal-output-projection" },
    ])
    expect(out.covered).toMatchObject([
      {
        symbol: "parseDomain",
        ingressSources: [{ kind: "parsed-wire" }],
        parserEvidence: ["runtime-refinement"],
      },
      {
        symbol: "parseTaggedDomain",
        ingressSources: [{ kind: "parsed-wire" }],
        parserEvidence: ["runtime-refinement"],
      },
    ])
  })

  test("inherits parser evidence into an already-decoded one-hop adapter stage", async () => {
    await repo.write(
      "src/adapters/domain.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const handle = (input: unknown): Domain => {",
        "  const decoded = parse(input)",
        "  return adapt(decoded)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.covered).toMatchObject([
      {
        symbol: "handle",
        candidateReason: "supported-untrusted-ingress",
        parserEvidence: ["parse"],
      },
    ])
    expect(out.excluded).toMatchObject([
      {
        symbol: "adapt",
        exclusionReason: "already-decoded-input",
        parserEvidence: ["caller:parse"],
      },
    ])
  })

  test("does not inherit decoder evidence when any local call site passes raw input", async () => {
    await repo.write(
      "src/adapters/mixed-domain.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const decodedPath = (input: unknown): Domain => adapt(parse(input))",
        "export const rawPath = (input: unknown): Domain => adapt(input)",
      ].join("\n"),
    )

    const out = await run()

    expect(out.excluded.some((entry) => entry.symbol === "adapt")).toBe(false)
    expect(out.findings).toMatchObject([{ symbol: "adapt" }, { symbol: "rawPath" }])
    expect(out.covered).toMatchObject([{ symbol: "decodedPath" }])
  })

  test("lets a raw caller outside boundary globs poison decoded-stage inheritance", async () => {
    await repo.write(
      "src/adapters/domain.ts",
      [
        "export type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const decodedPath = (input: unknown): Domain => adapt(parse(input))",
      ].join("\n"),
    )
    await repo.write(
      "src/services/raw.ts",
      [
        "import { adapt, type Domain } from '../adapters/domain'",
        "export const rawPath = (input: unknown): Domain => adapt(input)",
      ].join("\n"),
    )

    const out = await run()

    expect(out.excluded.some((entry) => entry.symbol === "adapt")).toBe(false)
    expect(out.findings).toMatchObject([{ symbol: "adapt" }])
    expect(out.covered).toMatchObject([{ symbol: "decodedPath" }])
  })

  test("does not inherit decoder evidence through a reassigned caller alias", async () => {
    await repo.write(
      "src/adapters/reassigned-domain.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const handle = (input: unknown): Domain => {",
        "  let decoded = parse(input)",
        "  decoded = input as Domain",
        "  return adapt(decoded)",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.excluded.some((entry) => entry.symbol === "adapt")).toBe(false)
    expect(out.findings).toMatchObject([{ symbol: "adapt" }])
    expect(out.covered).toMatchObject([{ symbol: "handle" }])
  })

  test("does not inherit decoder evidence from an unrelated same-name function", async () => {
    await repo.write(
      "src/adapters/lonely.ts",
      [
        "type Domain = { readonly id: string }",
        "export const adapt = (value: unknown): Domain => value as Domain",
      ].join("\n"),
    )
    await repo.write(
      "src/adapters/decoded.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const handle = (input: unknown): Domain => adapt(parse(input))",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toMatchObject([{ symbol: "adapt", file: expect.stringContaining("lonely.ts") }])
    expect(out.excluded).toMatchObject([
      {
        symbol: "adapt",
        file: expect.stringContaining("decoded.ts"),
        exclusionReason: "already-decoded-input",
      },
    ])
  })

  test("does not inherit decoder evidence through a shadowed decoded binding", async () => {
    await repo.write(
      "src/adapters/shadowed-domain.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const adapt = (value: unknown): Domain => value as Domain",
        "export const handle = (input: unknown): Domain => {",
        "  const decoded = parse(input)",
        "  {",
        "    const decoded = input as Domain",
        "    return adapt(decoded)",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.excluded.some((entry) => entry.symbol === "adapt")).toBe(false)
    expect(out.findings).toMatchObject([{ symbol: "adapt" }])
    expect(out.covered).toMatchObject([{ symbol: "handle" }])
  })

  test("does not treat a successful refinement branch as rejection evidence", async () => {
    await repo.write(
      "src/adapters/non-rejecting-refinement.ts",
      [
        "type Domain = { readonly id: string }",
        "export const convert = (input: unknown): Domain => {",
        "  if (typeof input === 'string') return input as unknown as Domain",
        "  return input as Domain",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.covered).toEqual([])
    expect(out.findings).toMatchObject([{
      symbol: "convert",
      parserEvidence: [],
    }])
  })

  test("reports ingress and parser attribution in diagnostic data", async () => {
    await repo.write(
      "src/api/domain.ts",
      "export function POST(input: unknown) { return input as { id: string } }\n",
    )

    const out = await run()
    expect(TsAd04.diagnose(out)[0]?.data).toMatchObject({
      symbol: "POST",
      candidateReason: "supported-untrusted-ingress",
      ingressSources: [
        {
          kind: "unknown",
          evidence: "parameter input: unknown",
        },
      ],
      parserEvidence: [],
    })
  })

  test("publishes covered and excluded classification evidence in one audit diagnostic", async () => {
    await repo.write(
      "src/adapters/audit.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        "export const decoded = (input: unknown): Domain => parse(input)",
        "export const isDomain = (input: unknown): input is Domain =>",
        "  typeof input === 'object' && input !== null && 'id' in input",
      ].join("\n"),
    )

    const out = await run()
    const diagnostics = TsAd04.diagnose(out)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: "info",
      data: {
        kind: "boundary-parser-coverage-audit",
        coveredTotal: 1,
        excludedTotal: 1,
        coveredTruncated: false,
        excludedTruncated: false,
        covered: [{
          symbol: "decoded",
          candidateReason: "supported-untrusted-ingress",
          ingressSources: [{ kind: "unknown" }],
          parserEvidence: ["parse"],
        }],
        excluded: [{
          symbol: "isDomain",
          exclusionReason: "runtime-type-refinement",
          ingressSources: [{ kind: "unknown" }],
        }],
      },
    })
  })

  test("bounds audit evidence and exposes deterministic truncation totals", async () => {
    await repo.write(
      "src/adapters/bounded-audit.ts",
      [
        "type Domain = { readonly id: string }",
        "const parse = (value: unknown): Domain => value as Domain",
        ...Array.from(
          { length: 3 },
          (_, index) =>
            `export const decoded${index} = (input: unknown): Domain => parse(input)`,
        ),
        ...Array.from(
          { length: 3 },
          (_, index) => [
            `export const isDomain${index} = (input: unknown): input is Domain =>`,
            "  typeof input === 'object' && input !== null && 'id' in input",
          ].join("\n"),
        ),
      ].join("\n"),
    )

    const out = await run({
      ...TsAd04.defaultConfig,
      top_n_diagnostics: 1,
    })
    const audit = TsAd04.diagnose(out).find((diagnostic) =>
      diagnostic.data?.kind === "boundary-parser-coverage-audit"
    )

    expect(audit?.data).toMatchObject({
      kind: "boundary-parser-coverage-audit",
      coveredTotal: 3,
      excludedTotal: 3,
      coveredTruncated: true,
      excludedTruncated: true,
      covered: [expect.objectContaining({ symbol: "decoded0" })],
      excluded: [expect.objectContaining({ symbol: "isDomain0" })],
    })
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
