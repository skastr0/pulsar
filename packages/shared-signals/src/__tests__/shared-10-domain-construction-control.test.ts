import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceDataTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import {
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  buildNotConfiguredDomainConstructionFacts,
  loadCanonicalReferenceDataEntries,
  type DomainConstructionManifest,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Layer } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { Shared10DomainConstructionControl } from "../shared-10-domain-construction-control.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-domain-construction-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const runSignal = async (
  repoRoot = tmp,
  config = Shared10DomainConstructionControl.defaultConfig,
) => {
  const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(repoRoot))
  return Effect.runPromise(
    Shared10DomainConstructionControl.compute(config, new Map()).pipe(
      Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(entries))),
    ) as Effect.Effect<any, any, never>,
  )
}

describe("SHARED-10 domain construction control", () => {
  test("distinguishes not configured reference data from zero findings", async () => {
    const out = await runSignal()

    expect(out.state).toBe("not_configured")
    expect(out.totalFindings).toBe(0)
    expect(Shared10DomainConstructionControl.score(out)).toBe(1)
    expect(Shared10DomainConstructionControl.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(out.cacheContributors).toContain("reference-data.domain-construction")
  })

  test("uses the canonical not-configured facts when reference data key is absent", async () => {
    const out = await Effect.runPromise(
      Shared10DomainConstructionControl.compute(
        Shared10DomainConstructionControl.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(new Map()))),
      ) as Effect.Effect<any, any, never>,
    )
    const expected = buildNotConfiguredDomainConstructionFacts([
      CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
    ])

    expect(out.state).toBe("not_configured")
    expect(out.checkedPaths).toEqual(expected.checkedPaths)
    expect(out.sourceFingerprint).toBe(expected.sourceFingerprint)
    expect(out.message).toBe(expected.message)
  })

  test("treats an empty manifest as not applicable instead of measured zero", async () => {
    await writeManifest({
      schema_version: 1,
      constructs: [],
    })

    const out = await runSignal()

    expect(out.state).toBe("not_applicable")
    expect(Shared10DomainConstructionControl.score(out)).toBe(1)
    expect(Shared10DomainConstructionControl.outputMetadata?.(out)).toEqual({
      applicability: "not_applicable",
    })
  })

  test("reports zero for a controlled construct with parser evidence and current hashes", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest(declarationContent, parserContent),
    })

    const out = await runSignal()

    expect(out.state).toBe("zero")
    expect(out.totalFindings).toBe(0)
    expect(out.configuredConstructCount).toBe(1)
    expect(out.controlledConstructCount).toBe(1)
    expect(out.compositeConsumers).toContain("boundary integrity")
    expect(Shared10DomainConstructionControl.score(out)).toBe(1)
  })

  test("flags public constructor exports for controlled constructs", async () => {
    const declarationContent = [
      "export class UserId {",
      "  constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest(declarationContent, parserContent),
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "uncontrolled-constructor-export",
        symbol: "UserId",
        severity: "warn",
      }),
    ])
    expect(Shared10DomainConstructionControl.score(out)).toBeLessThan(1)
  })

  test("flags controlled constructs with no parser or smart-constructor evidence", async () => {
    const declarationContent = controlledUserIdDeclaration()
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "user-id.ts"), declarationContent, "utf8")
    await writeManifest({
      schema_version: 1,
      constructs: [
        {
          id: "user-id",
          symbol: "UserId",
          kind: "value-object",
          declaration_path: "src/domain/user-id.ts",
          source_hashes: {
            "src/domain/user-id.ts": sha256(declarationContent),
          },
          control: {
            intent: "controlled",
            controlled_exports: [
              {
                path: "src/domain/user-id.ts",
                symbol: "UserId",
              },
            ],
          },
        },
      ],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings.map((finding: { kind: string }) => finding.kind)).toContain(
      "missing-construction-evidence",
    )
  })

  test("flags declared parser evidence that is missing or symbol-mismatched", async () => {
    const declarationContent = controlledUserIdDeclaration()
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "user-id.ts"), declarationContent, "utf8")
    await writeFile(
      join(tmp, "src", "domain", "parse-user-id.ts"),
      parserSource().replace("parseUserId", "parseOtherId"),
      "utf8",
    )
    await writeManifest({
      schema_version: 1,
      constructs: [
        {
          id: "user-id",
          symbol: "UserId",
          kind: "value-object",
          declaration_path: "src/domain/user-id.ts",
          source_hashes: {
            "src/domain/user-id.ts": sha256(declarationContent),
          },
          control: {
            intent: "controlled",
            parsers: [
              {
                path: "src/domain/parse-user-id.ts",
                symbol: "parseUserId",
              },
              {
                path: "src/domain/missing-parser.ts",
                symbol: "parseMissingUserId",
              },
            ],
          },
        },
      ],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-construction-evidence",
          file: "src/domain/parse-user-id.ts",
          evidence: expect.arrayContaining([
            expect.stringContaining("parseUserId"),
          ]),
        }),
        expect.objectContaining({
          kind: "missing-construction-evidence",
          file: "src/domain/missing-parser.ts",
          evidence: expect.arrayContaining([
            "declared parser or smart-constructor evidence file is missing",
          ]),
        }),
      ]),
    )
  })

  test("keeps explicitly open constructs visible without score pressure", async () => {
    const declarationContent = [
      "export class PluginToken {",
      "  constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "plugin-token.ts"), declarationContent, "utf8")
    await writeManifest({
      schema_version: 1,
      constructs: [
        {
          id: "plugin-token",
          symbol: "PluginToken",
          kind: "wrapper",
          declaration_path: "src/domain/plugin-token.ts",
          source_hashes: {
            "src/domain/plugin-token.ts": sha256(declarationContent),
          },
          control: {
            intent: "intentionally_open",
            reason: "plugin boundary accepts host-provided token wrappers",
            allow_public_constructor: true,
          },
        },
      ],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.explicitlyOpenConstructCount).toBe(1)
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "explicitly-open-construct",
        severity: "info",
      }),
    ])
    expect(out.weightedFindings).toBe(0)
    expect(Shared10DomainConstructionControl.score(out)).toBe(1)
  })

  test("flags stale declaration or evidence hashes", async () => {
    const oldDeclarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent: oldDeclarationContent.replace("private constructor", "private constructor "),
      parserContent,
      manifest: controlledManifest(oldDeclarationContent, parserContent),
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings.map((finding: { kind: string }) => finding.kind)).toContain(
      "stale-source",
    )
  })

  test("diagnostics are capped and rank score-bearing findings before open facts", async () => {
    const userIdDeclarationContent = [
      "export class UserId {",
      "  constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    const pluginTokenDeclarationContent = [
      "export class PluginToken {",
      "  constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "user-id.ts"), userIdDeclarationContent, "utf8")
    await writeFile(join(tmp, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
    await writeFile(
      join(tmp, "src", "domain", "plugin-token.ts"),
      pluginTokenDeclarationContent,
      "utf8",
    )
    await writeManifest({
      schema_version: 1,
      constructs: [
        controlledManifest(userIdDeclarationContent, parserContent).constructs[0]!,
        {
          id: "plugin-token",
          symbol: "PluginToken",
          kind: "wrapper",
          declaration_path: "src/domain/plugin-token.ts",
          source_hashes: {
            "src/domain/plugin-token.ts": sha256(pluginTokenDeclarationContent),
          },
          control: {
            intent: "intentionally_open",
            reason: "plugin boundary accepts host-provided token wrappers",
            allow_public_constructor: true,
          },
        },
      ],
    })

    const out = await runSignal(tmp, {
      ...Shared10DomainConstructionControl.defaultConfig,
      top_n_diagnostics: 1,
    })
    const diagnostics = Shared10DomainConstructionControl.diagnose(out)

    expect(out.findings.map((finding: { kind: string }) => finding.kind)).toEqual([
      "uncontrolled-constructor-export",
      "explicitly-open-construct",
    ])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("Uncontrolled constructor/export")
  })

  test("treats malformed domain construction data as unknown", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await writeFile(join(tmp, ".pulsar", "domain-construction.json"), "{", "utf8")

    const out = await runSignal()
    const diagnostics = Shared10DomainConstructionControl.diagnose(out)

    expect(out.state).toBe("unknown")
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(Shared10DomainConstructionControl.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
  })

  test("is registered in the shared pack", () => {
    expect(SHARED_SIGNALS.map((signal) => signal.id)).toContain(
      "SHARED-10-domain-construction-control",
    )
  })
})

const writeDomainFixture = async (args: {
  readonly declarationContent: string
  readonly parserContent: string
  readonly manifest: DomainConstructionManifest
}) => {
  await mkdir(join(tmp, ".pulsar"), { recursive: true })
  await mkdir(join(tmp, "src", "domain"), { recursive: true })
  await writeFile(join(tmp, "src", "domain", "user-id.ts"), args.declarationContent, "utf8")
  await writeFile(join(tmp, "src", "domain", "parse-user-id.ts"), args.parserContent, "utf8")
  await writeManifest(args.manifest)
}

const writeManifest = async (manifest: DomainConstructionManifest) => {
  await mkdir(join(tmp, ".pulsar"), { recursive: true })
  await writeFile(
    join(tmp, ".pulsar", "domain-construction.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
}

const controlledManifest = (
  declarationContent: string,
  parserContent: string,
): DomainConstructionManifest => ({
  schema_version: 1,
  constructs: [
    {
      id: "user-id",
      symbol: "UserId",
      kind: "value-object",
      declaration_path: "src/domain/user-id.ts",
      source_hashes: {
        "src/domain/user-id.ts": sha256(declarationContent),
        "src/domain/parse-user-id.ts": sha256(parserContent),
      },
      control: {
        intent: "controlled",
        parsers: [
          {
            path: "src/domain/parse-user-id.ts",
            symbol: "parseUserId",
          },
        ],
      },
    },
  ],
})

const controlledUserIdDeclaration = (): string =>
  [
    "export class UserId {",
    "  private constructor(readonly value: string) {}",
    "}",
    "",
  ].join("\n")

const parserSource = (): string =>
  [
    "import { UserId } from './user-id'",
    "export const parseUserId = (value: string): UserId => value as unknown as UserId",
    "",
  ].join("\n")

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
