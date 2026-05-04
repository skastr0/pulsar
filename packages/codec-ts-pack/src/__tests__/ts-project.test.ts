import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { makeTsProject, makeTsProjectWithOptions } from "../ts-project.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "taste-codec-ts-project-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const write = async (relPath: string, content: string): Promise<void> => {
  const fullPath = join(tmp, relPath)
  await mkdir(join(fullPath, ".."), { recursive: true })
  await writeFile(fullPath, content)
}

describe("TsProject", () => {
  test("does not include hidden metadata files from broad tsconfig globs", async () => {
    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
        },
        include: ["**/*.ts"],
      }),
    )
    await write("src/index.ts", "export const product = true\n")
    await write(".metadata/policy.ts", "export const ambientMetadata = true\n")

    const project = await Effect.runPromise(makeTsProject(tmp))
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.includes("/.metadata/"))).toBe(false)
  })

  test("production-only file discovery also skips hidden metadata files", async () => {
    await write("src/index.ts", "export const product = true\n")
    await write(".metadata/policy.ts", "export const ambientMetadata = true\n")

    const project = await Effect.runPromise(makeTsProjectWithOptions(tmp, { productionOnly: true }))
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.includes("/.metadata/"))).toBe(false)
  })
})
