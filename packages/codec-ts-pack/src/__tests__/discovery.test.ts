import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { discoverPackages } from "../discovery.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "taste-codec-discover-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const writeTsconfig = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext" } }),
  )
}

describe("discoverPackages", () => {
  test("finds a single root tsconfig", async () => {
    await writeTsconfig(tmp)
    const pkgs = await Effect.runPromise(discoverPackages(tmp))
    expect(pkgs.length).toBe(1)
    expect(pkgs[0]?.name).toBe("(root)")
  })

  test("finds root + nested tsconfigs in a monorepo layout", async () => {
    await writeTsconfig(tmp)
    await writeTsconfig(join(tmp, "packages", "a"))
    await writeTsconfig(join(tmp, "packages", "b"))
    await writeTsconfig(join(tmp, "modules", "renderer"))

    const pkgs = await Effect.runPromise(discoverPackages(tmp))
    const names = pkgs.map((p) => p.name).sort()
    expect(names).toEqual(["(root)", "modules/renderer", "packages/a", "packages/b"])
  })

  test("root sorts first", async () => {
    await writeTsconfig(tmp)
    await writeTsconfig(join(tmp, "packages", "a"))
    const pkgs = await Effect.runPromise(discoverPackages(tmp))
    expect(pkgs[0]?.name).toBe("(root)")
  })

  test("ignores tsconfig.json under node_modules", async () => {
    await writeTsconfig(tmp)
    await writeTsconfig(join(tmp, "node_modules", "dep"))
    const pkgs = await Effect.runPromise(discoverPackages(tmp))
    expect(pkgs.map((p) => p.name)).toEqual(["(root)"])
  })

  test("empty dir returns no packages", async () => {
    const pkgs = await Effect.runPromise(discoverPackages(tmp))
    expect(pkgs.length).toBe(0)
  })
})
