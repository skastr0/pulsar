import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import {
  parseCargoMetadata,
  resolveNodeIndex,
  workspacePackages,
} from "../cargo-metadata.js"
import { findDuplicateCargoLockPackages, parseCargoLock } from "../lock-file.js"
import { makeRustProject, type RustManifestInfo } from "../project.js"
import { parseRustFile, summarizeRustFile } from "../syn-walker.js"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(
  TEST_DIR,
  "../../src/__tests__/fixtures/basic-workspace",
)

describe("@taste-codec/rs-pack scaffold", () => {
  test("parses cargo metadata fixture JSON", async () => {
    const raw = await readFile(`${FIXTURE_ROOT}/cargo-metadata.json`, "utf8")
    const metadata = parseCargoMetadata(raw)

    expect(metadata.workspaceRoot).toContain("basic-workspace")
    expect(workspacePackages(metadata).map((pkg) => pkg.name)).toEqual(["fixture-crate"])
    expect(metadata.packages[0]?.dependencies[0]?.name).toBe("serde")
    expect(
      resolveNodeIndex(metadata).get(metadata.workspaceMembers[0] ?? "")?.deps[0]?.pkg,
    ).toContain("serde@1.0.210")
  })

  test("parses Cargo.lock and finds duplicate crate versions", async () => {
    const raw = await readFile(`${FIXTURE_ROOT}/Cargo.lock`, "utf8")
    const lockfile = parseCargoLock(raw)
    const duplicates = findDuplicateCargoLockPackages(lockfile)

    expect(lockfile.version).toBe(3)
    expect(lockfile.packages.length).toBeGreaterThanOrEqual(5)
    expect(duplicates).toEqual([
      {
        name: "itoa",
        versions: ["0.4.8", "1.0.11"],
        packages: [
          expect.objectContaining({ name: "itoa", version: "1.0.11" }),
          expect.objectContaining({ name: "itoa", version: "0.4.8" }),
        ],
      },
    ])
  })

  test("walks a fixture Rust AST with tree-sitter", async () => {
    const tree = await parseRustFile(`${FIXTURE_ROOT}/src/lib.rs`)
    const summary = await summarizeRustFile(`${FIXTURE_ROOT}/src/lib.rs`)

    expect(tree.rootNode.type).toBe("source_file")
    expect(summary.functionNames).toEqual(["greet", "raw_copy"])
    expect(summary.unsafeBlockCount).toBe(1)
    expect(summary.nodeCounts.function_item).toBe(2)
  }, 120_000)

  test("discovers a fixture Rust project", async () => {
    const project = await Effect.runPromise(makeRustProject(FIXTURE_ROOT))

    expect(project.manifests.map((manifest: RustManifestInfo) => manifest.name)).toEqual([
      "(root)",
    ])
    expect(project.cargoLock?.packages.length).toBeGreaterThanOrEqual(5)
  })
})
