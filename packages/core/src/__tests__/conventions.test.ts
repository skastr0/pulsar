import { describe, expect, test } from "bun:test"
import { decodeSchemaConventionsSync } from "../conventions.js"

describe("SchemaConventions", () => {
  test("decodes the canonical convention shape including optional Rust crate boundaries", () => {
    const decoded = decodeSchemaConventionsSync({
      schema_version: 1,
      extracted_at_sha: "abc123",
      boundaries: {
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
          blocked_imports: ["simple-git"],
        },
        "packages/ts-pack": {
          visibility: "internal",
          allowed_imports: ["@skastr0/pulsar-core", "effect", "ts-morph"],
        },
      },
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
      architectural_rules: [
        {
          from: "adapter/*",
          to: "domain/*",
          allowed: false,
          reason: "Adapters must depend on ports, not domain",
        },
      ],
    })

    expect(decoded.naming_conventions.const).toBe("camelCase | UPPER_SNAKE_CASE")
    expect(decoded.boundaries["packages/core"]?.visibility).toBe("public-api")
    expect(decoded.rust_crate_boundaries?.core?.public_modules).toEqual(["crate", "crate::api"])
    expect(decoded.architectural_rules).toHaveLength(1)
  })
})
