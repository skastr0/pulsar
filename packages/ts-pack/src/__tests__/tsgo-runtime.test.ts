import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync, lstatSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  analysisPlatformPackageName,
  registerEmbeddedTsgoPath,
  resolveTsgoExecutablePath,
} from "../tsgo-runtime.js"
import { TSGO_ANALYSIS_TYPESCRIPT_VERSION } from "../ts-analysis-version.js"

describe("native tsgo runtime", () => {
  test("resolves the pinned host payload", async () => {
    const packageName = analysisPlatformPackageName()
    expect(packageName).toBeDefined()
    const executablePath = await Effect.runPromise(resolveTsgoExecutablePath())
    expect(executablePath.endsWith("/lib/tsc")).toBe(true)
    expect(await Bun.file(executablePath).exists()).toBe(true)
    const manifest = JSON.parse(
      await Bun.file(join(executablePath, "..", "..", "package.json")).text(),
    ) as { readonly version?: unknown }
    expect(manifest.version).toBe(TSGO_ANALYSIS_TYPESCRIPT_VERSION)
  })

  test("extracts a registered embedded payload", async () => {
    const sourcePath = await Effect.runPromise(resolveTsgoExecutablePath())
    const fixtureDirectory = join(tmpdir(), "pulsar-tsgo-embed-fixture")
    const fixturePath = join(fixtureDirectory, "tsgo-lib.tar")
    mkdirSync(fixtureDirectory, { recursive: true })
    const packed = Bun.spawnSync(
      ["tar", "--format=ustar", "-cf", fixturePath, "-C", dirname(sourcePath), "tsc", "lib.d.ts"],
    )
    expect(packed.exitCode).toBe(0)
    registerEmbeddedTsgoPath(fixturePath)
    try {
      const extracted = await Effect.runPromise(resolveTsgoExecutablePath())
      expect(extracted.includes("/pulsar-tsgo-")).toBe(true)
      expect(await Bun.file(extracted).exists()).toBe(true)
      expect(existsSync(join(extracted, "..", "lib.d.ts"))).toBe(true)
      const extractDirectory = join(extracted, "..")
      expect((lstatSync(extractDirectory).mode & 0o777)).toBe(0o700)
      const version = Bun.spawnSync([extracted, "--version"], { stdout: "pipe", stderr: "pipe" })
      expect(version.exitCode).toBe(0)
      expect(version.stdout.toString()).toContain(TSGO_ANALYSIS_TYPESCRIPT_VERSION)
    } finally {
      registerEmbeddedTsgoPath("")
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })
})
