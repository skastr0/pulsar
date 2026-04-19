import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeReferenceData } from "../context.js"
import { type SchemaConventions } from "../conventions.js"
import { loadCanonicalReferenceDataEntries } from "../reference-data-loader.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "taste-codec-reference-data-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("loadCanonicalReferenceDataEntries", () => {
  test("loads canonical glossary and conventions into ReferenceData", async () => {
    await mkdir(join(tmp, ".taste-codec"), { recursive: true })
    await writeFile(
      join(tmp, ".taste-codec", "glossary.json"),
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
      join(tmp, ".taste-codec", "conventions.json"),
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
  })
})
