import { describe, expect, test } from "bun:test"
import { decodeGlossaryDraftSync, decodeGlossarySync } from "../glossary.js"

describe("Glossary schemas", () => {
  test("decodes glossary drafts with candidate decisions", () => {
    const decoded = decodeGlossaryDraftSync({
      schema_version: 1,
      extracted_at_sha: "abc123",
      extracted_at: "2026-04-19T00:00:00.000Z",
      include_parameter_names: true,
      candidate_terms: [
        {
          term: "user",
          normalized: "user",
          frequency: 3,
          provenance: [
            {
              package: "packages/auth",
              file: "packages/auth/src/user-service.ts",
              line: 2,
              identifier: "createUserService",
              identifier_kind: "function",
            },
          ],
          co_occurs_with: ["create", "service"],
          decision: { action: "accept" },
        },
      ],
      candidate_synonyms: [
        {
          terms: ["user", "member"],
          score: 0.9,
          shared_context_terms: ["service"],
        },
      ],
    })

    expect(decoded.candidate_terms[0]?.decision?.action).toBe("accept")
    expect(decoded.candidate_synonyms[0]?.terms).toEqual(["user", "member"])
  })

  test("decodes canonical glossary files separately from drafts", () => {
    const decoded = decodeGlossarySync({
      schema_version: 1,
      extracted_at_sha: "abc123",
      confirmed_at: "2026-04-19T01:00:00.000Z",
      terms: [
        {
          canonical: "user",
          aliases: ["member"],
          frequency: 5,
          provenance: [
            {
              package: "packages/auth",
              file: "packages/auth/src/user-service.ts",
              line: 2,
              identifier: "createUserService",
              identifier_kind: "function",
            },
          ],
        },
      ],
      rejected_terms: ["temp"],
    })

    expect(decoded.terms[0]?.aliases).toEqual(["member"])
    expect(decoded.rejected_terms).toEqual(["temp"])
  })
})
