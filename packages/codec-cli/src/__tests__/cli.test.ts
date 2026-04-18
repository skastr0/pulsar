import { describe, expect, test } from "bun:test"
import { CLI_VERSION } from "../index.js"

describe("codec-cli", () => {
  test("exports a version string", () => {
    expect(typeof CLI_VERSION).toBe("string")
  })
})
