import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Diagnostic } from "../diagnostic.js"

describe("Diagnostic", () => {
  test("decodes optional structured fix hints", () => {
    const decoded = Schema.decodeUnknownSync(Diagnostic)({
      severity: "warn",
      message: "Boundary import crosses package policy",
      fixHints: [
        {
          kind: "config-allowlist",
          title: "Allow the dependency explicitly",
          summary: "Add the imported package to the boundary allowlist or remove the import.",
          confidence: "high",
          autoApplicable: false,
          diffHint: ".pulsar/conventions.json",
          data: { ruleId: "typescript.boundary-import" },
        },
      ],
    })

    expect(decoded.fixHints?.[0]).toMatchObject({
      kind: "config-allowlist",
      confidence: "high",
      autoApplicable: false,
    })
  })
})
