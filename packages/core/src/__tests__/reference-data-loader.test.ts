import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeReferenceData } from "../context.js"
import {
  buildCoverageFactsArtifact,
  CANONICAL_COVERAGE_FACTS_RELATIVE_PATH,
  COVERAGE_REFERENCE_DATA_KEY,
  type CoverageFacts,
} from "../coverage-facts.js"
import {
  CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
  type ContractFreshnessFacts,
} from "../contract-freshness.js"
import {
  DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
  type DomainConstructionFacts,
} from "../domain-construction.js"
import { type SchemaConventions } from "../conventions.js"
import { loadCanonicalReferenceDataEntries } from "../reference-data-loader.js"
import { computeReferenceVersionHash } from "../scoring-engine-observer-cache.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-reference-data-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("loadCanonicalReferenceDataEntries", () => {
  test("loads canonical glossary and conventions into ReferenceData", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await writeFile(
      join(tmp, ".pulsar", "glossary.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          extracted_at_sha: "abc123",
          confirmed_at: "2026-04-19T01:00:00.000Z",
          terms: [],
          rejected_terms: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    await writeFile(
      join(tmp, ".pulsar", "conventions.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          extracted_at_sha: "abc123",
          boundaries: {},
          rust_crate_boundaries: {
            core: {
              visibility: "public-api",
              allowed_dependents: ["app"],
              public_modules: ["crate", "crate::api"],
            },
          },
          naming_conventions: {
            function: "camelCase",
            class: "PascalCase",
            interface: "PascalCase",
            type: "PascalCase",
            const: "camelCase | UPPER_SNAKE_CASE",
            enum: "PascalCase",
          },
          architectural_rules: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const referenceData = makeReferenceData(entries)

    const conventions = await Effect.runPromise(
      referenceData.require<SchemaConventions>("TS-AD-01", "schema-conventions"),
    )
    const glossary = await Effect.runPromise(referenceData.require("TS-LD-05", "glossary"))

    expect(conventions.rust_crate_boundaries?.core?.allowed_dependents).toEqual(["app"])
    expect(glossary).toBeDefined()

    const coverage = await Effect.runPromise(
      referenceData.require<CoverageFacts>("SHARED-COV-01", COVERAGE_REFERENCE_DATA_KEY),
    )
    expect(coverage.state).toBe("absent")
    expect(coverage.checkedPaths).toEqual([
      ".pulsar/coverage/coverage-facts.json",
      "coverage/lcov.info",
      "coverage/coverage-final.json",
    ])
  })

  test("loads canonical coverage into ReferenceData", async () => {
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await writeFile(
      join(tmp, "coverage", "lcov.info"),
      ["SF:src/a.ts", "DA:1,1", "DA:2,0", "end_of_record"].join("\n"),
      "utf8",
    )

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const coverage = entries.get(COVERAGE_REFERENCE_DATA_KEY) as CoverageFacts

    expect(coverage.state).toBe("present")
    expect(coverage.tool).toBe("lcov")
    expect(coverage.summary.lines).toEqual({ covered: 1, total: 2, pct: 0.5 })
  })

  test("prefers repo-owned coverage facts over canonical reports", async () => {
    await mkdir(join(tmp, ".pulsar", "coverage"), { recursive: true })
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await writeFile(
      join(tmp, "coverage", "lcov.info"),
      ["SF:src/a.ts", "DA:1,0", "DA:2,0", "end_of_record"].join("\n"),
      "utf8",
    )
    await writeFile(
      join(tmp, CANONICAL_COVERAGE_FACTS_RELATIVE_PATH),
      `${JSON.stringify(
        buildCoverageFactsArtifact({
          state: "present",
          tool: "istanbul",
          sourcePath: "/repo/custom/coverage-final.json",
          checkedPaths: [CANONICAL_COVERAGE_FACTS_RELATIVE_PATH],
          files: [
            {
              file: "src/a.ts",
              lines: { covered: 9, total: 10, pct: 0.9 },
              functions: { covered: 1, total: 1, pct: 1 },
              branches: { covered: 1, total: 2, pct: 0.5 },
            },
          ],
          summary: {
            lines: { covered: 9, total: 10, pct: 0.9 },
            functions: { covered: 1, total: 1, pct: 1 },
            branches: { covered: 1, total: 2, pct: 0.5 },
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    )

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const coverage = entries.get(COVERAGE_REFERENCE_DATA_KEY) as CoverageFacts

    expect(coverage.tool).toBe("istanbul")
    expect(coverage.summary.lines.pct).toBe(0.9)
    expect(coverage.checkedPaths).toEqual([
      ".pulsar/coverage/coverage-facts.json",
      "coverage/lcov.info",
      "coverage/coverage-final.json",
    ])
  })

  test("malformed coverage is unknown instead of a reference-data load failure", async () => {
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await writeFile(join(tmp, "coverage", "coverage-final.json"), "{", "utf8")

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const coverage = entries.get(COVERAGE_REFERENCE_DATA_KEY) as CoverageFacts

    expect(coverage.state).toBe("unknown")
    expect(coverage.message).toContain("Failed to parse coverage reference data")
  })

  test("loads contract freshness facts and changes reference hash with declared source content", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "contracts"), { recursive: true })
    await mkdir(join(tmp, "src", "generated"), { recursive: true })
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const artifactContent = "export const client = {}\n"
    await writeFile(join(tmp, "contracts", "openapi.json"), sourceContent, "utf8")
    await writeFile(join(tmp, "src", "generated", "client.ts"), artifactContent, "utf8")
    await writeFile(
      join(tmp, ".pulsar", "contract-freshness.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          contracts: [
            {
              id: "api-client",
              group_id: "openapi",
              source_paths: ["contracts/openapi.json"],
              source_hashes: {
                "contracts/openapi.json": sha256(sourceContent),
              },
              artifact_path: "src/generated/client.ts",
              artifact_sha256: sha256(artifactContent),
              generator: "openapi-generator",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const beforeEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const beforeFacts = beforeEntries.get(
      CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
    ) as ContractFreshnessFacts
    const beforeReferenceHash = computeReferenceVersionHash(beforeEntries)

    expect(beforeFacts.state).toBe("zero")
    expect(beforeFacts.contracts[0]?.sourceHashes["contracts/openapi.json"]).toBe(
      sha256(sourceContent),
    )

    await writeFile(
      join(tmp, "contracts", "openapi.json"),
      JSON.stringify({ openapi: "3.1.0", paths: { "/users": {} } }),
      "utf8",
    )
    const afterEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const afterFacts = afterEntries.get(
      CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
    ) as ContractFreshnessFacts
    const afterReferenceHash = computeReferenceVersionHash(afterEntries)

    expect(afterReferenceHash).not.toBe(beforeReferenceHash)
    expect(afterFacts.state).toBe("present")
    expect(afterFacts.findings.map((finding) => finding.kind)).toContain("stale-artifact")
  })

  test("loads domain construction facts and changes reference hash with evidence content", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    const declarationContent = [
      "export class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = [
      "import { UserId } from './user-id'",
      "export const parseUserId = (value: string): UserId => value as unknown as UserId",
      "",
    ].join("\n")
    await writeFile(join(tmp, "src", "domain", "user-id.ts"), declarationContent, "utf8")
    await writeFile(join(tmp, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
    await writeFile(
      join(tmp, ".pulsar", "domain-construction.json"),
      `${JSON.stringify(
        {
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
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const beforeEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const beforeFacts = beforeEntries.get(
      DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
    ) as DomainConstructionFacts
    const beforeReferenceHash = computeReferenceVersionHash(beforeEntries)

    expect(beforeFacts.state).toBe("zero")
    expect(beforeFacts.constructs[0]?.sourceHashes["src/domain/parse-user-id.ts"]).toBe(
      sha256(parserContent),
    )

    await writeFile(
      join(tmp, "src", "domain", "parse-user-id.ts"),
      parserContent.replace("value as unknown as UserId", "String(value) as unknown as UserId"),
      "utf8",
    )
    const afterEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const afterFacts = afterEntries.get(
      DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
    ) as DomainConstructionFacts
    const afterReferenceHash = computeReferenceVersionHash(afterEntries)

    expect(afterReferenceHash).not.toBe(beforeReferenceHash)
    expect(afterFacts.state).toBe("present")
    expect(afterFacts.findings.map((finding) => finding.kind)).toContain("stale-source")
  })
})

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
