import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeReferenceData } from "../context.js"
import {
  COVERAGE_REFERENCE_DATA_KEY,
  type CoverageFacts,
} from "../coverage-facts.js"
import { type SchemaConventions } from "../conventions.js"
import { loadCanonicalReferenceDataEntries } from "../reference-data-loader.js"

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

  test("malformed coverage is unknown instead of a reference-data load failure", async () => {
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await writeFile(join(tmp, "coverage", "coverage-final.json"), "{", "utf8")

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const coverage = entries.get(COVERAGE_REFERENCE_DATA_KEY) as CoverageFacts

    expect(coverage.state).toBe("unknown")
    expect(coverage.message).toContain("Failed to parse coverage reference data")
  })
})
