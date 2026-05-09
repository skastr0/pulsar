import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { CLI_VERSION } from "../index.js"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")
const repoRoot = resolve(import.meta.dir, "../../../../")

describe("cli", () => {
  test("exports a version string", () => {
    expect(typeof CLI_VERSION).toBe("string")
  })

  test("documents score, baseline, backpressure, bisect, calibrate, persona, elicit, glossary, and conventions help text", () => {
    const out = spawnSync("bun", [binPath, "--help"], {
      encoding: "utf-8",
    })
    expect(out.status).toBe(0)
    expect(out.stdout).toContain("pulsar score [<repo-path>]")
    expect(out.stdout).toContain("pulsar baseline <set|refresh|show>")
    expect(out.stdout).toContain("pulsar backpressure [--trend] [--vector <path>]")
    expect(out.stdout).toContain("pulsar calibrate suggest [--write] [--json]")
    expect(out.stdout).toContain("pulsar persona <list|show|apply|diff>")
    expect(out.stdout).toContain("pulsar elicit <quiz|bootstrap|review|accept|reject>")
    expect(out.stdout).toContain("pulsar elicit bootstrap --commits 80 --preset strict-type-safety .")
    expect(out.stdout).toContain("pulsar elicit accept proposal-ai-assisted-mode .")
    expect(out.stdout).toContain("pulsar glossary extract --sha <ref>")
    expect(out.stdout).toContain("pulsar conventions confirm")
    expect(out.stdout).toContain("--ci")
    expect(out.stdout).toContain("--trend")
    expect(out.stdout).toContain("--observer")
    expect(out.stdout).toContain("--write")
    expect(out.stdout).toContain("--vector <path>")
    expect(out.stdout).toContain("--resume <path>")
    expect(out.stdout).toContain("--commits <count>")
    expect(out.stdout).toContain("--preset <name>")
    expect(out.stdout).toContain("--no-parameters")
    expect(out.stdout).toContain("pulsar bisect --range <from>..<to>")
  })

  test("reports unknown reserved Rust ids as scaffolded placeholders", () => {
    const out = spawnSync("bun", [binPath, "score", "--signal", "RS-ZZ-99", repoRoot], {
      cwd: repoRoot,
      encoding: "utf-8",
    })

    expect(out.status).toBe(0)
    expect(out.stdout).toContain("not implemented yet")
    expect(out.stdout).toContain("later Rust glyph")
  }, 120_000)
})
