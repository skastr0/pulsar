import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { chmodSync, copyFileSync, lstatSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    const fixturePath = join(fixtureDirectory, "tsc")
    mkdirSync(fixtureDirectory, { recursive: true })
    copyFileSync(sourcePath, fixturePath)
    chmodSync(fixturePath, 0o755)
    registerEmbeddedTsgoPath(fixturePath)
    try {
      const extracted = await Effect.runPromise(resolveTsgoExecutablePath())
      expect(extracted.includes("/pulsar-tsgo-")).toBe(true)
      expect(await Bun.file(extracted).exists()).toBe(true)
      const extractDirectory = join(extracted, "..")
      expect((lstatSync(extractDirectory).mode & 0o777)).toBe(0o700)
    } finally {
      registerEmbeddedTsgoPath("")
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })
})
