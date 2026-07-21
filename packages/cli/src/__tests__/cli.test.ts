import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { CLI_BUILD_INFO, CLI_VERSION } from "../index.js"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")
const packageJsonPath = resolve(import.meta.dir, "../../package.json")
const repoRoot = resolve(import.meta.dir, "../../../../")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { readonly version: string }
const rootPackageJson = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8"),
) as { readonly version: string }

describe("cli", () => {
  test("reports the package version", () => {
    expect(String(CLI_VERSION)).toBe(packageJson.version)
    expect(packageJson.version).toBe(rootPackageJson.version)

    const out = spawnSync("bun", [binPath, "--version"], {
      encoding: "utf-8",
    })

    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe(packageJson.version)
  })

  test("reports source artifact provenance as structured build info", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567"
    const out = spawnSync("bun", [binPath, "--build-info"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        PULSAR_SOURCE_COMMIT: commit,
        PULSAR_SOURCE_DIRTY: "false",
      },
    })

    expect(out.status).toBe(0)
    expect(JSON.parse(out.stdout)).toEqual({
      schema_version: "pulsar/build-info/v1",
      version: packageJson.version,
      commit,
      dirty: false,
      artifact: "source",
      distribution: "source",
      target: `${process.platform}-${process.arch}`,
    })
    expect(CLI_BUILD_INFO.schema_version).toBe("pulsar/build-info/v1")
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
    expect(out.stdout).toContain("opt-in vector profile templates")
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
    expect(out.stdout).toContain("Optional opt-in preset prior")
    expect(out.stdout).toContain("--no-parameters")
    expect(out.stdout).toContain("pulsar bisect --range <from>..<to>")
    expect(out.stdout).toContain("pulsar --build-info")
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
