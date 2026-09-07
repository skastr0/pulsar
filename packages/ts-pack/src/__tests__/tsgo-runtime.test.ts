import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  analysisPlatformPackageName,
  registerEmbeddedTsgoPath,
  resolveTsgoExecutablePath,
} from "../tsgo-runtime.js"

describe("native tsgo runtime", () => {
  test("resolves the pinned host payload", async () => {
    const packageName = analysisPlatformPackageName()
    expect(packageName).toBeDefined()
    const executablePath = await Effect.runPromise(resolveTsgoExecutablePath())
    expect(executablePath.endsWith("/lib/tsc")).toBe(true)
    expect(await Bun.file(executablePath).exists()).toBe(true)
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
    } finally {
      registerEmbeddedTsgoPath("")
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })
})
