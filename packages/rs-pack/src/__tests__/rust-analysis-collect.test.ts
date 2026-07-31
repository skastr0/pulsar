import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeRustProject } from "../project.js"
import { collectRustProjectFacts } from "../rust-analysis.js"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(
  TEST_DIR,
  "../../src/__tests__/fixtures/basic-workspace",
)

describe("Rust project fact collection", () => {
  test("shares a cached Rust fact graph for concurrent reads of the same project", async () => {
    const project = await Effect.runPromise(makeRustProject(FIXTURE_ROOT))
    const firstRequest = collectRustProjectFacts(project)
    const secondRequest = collectRustProjectFacts(project)
    const [firstFacts, secondFacts] = await Promise.all([firstRequest, secondRequest])

    expect(firstFacts).toBe(secondFacts)
  })

  test("isolates cache entries across separate project instances", async () => {
    const [leftProject, rightProject] = await Promise.all([
      Effect.runPromise(makeRustProject(FIXTURE_ROOT)),
      Effect.runPromise(makeRustProject(FIXTURE_ROOT)),
    ])
    const [leftFacts, rightFacts] = await Promise.all([
      collectRustProjectFacts(leftProject),
      collectRustProjectFacts(rightProject),
    ])

    expect(leftFacts).not.toBe(rightFacts)
  })
})

