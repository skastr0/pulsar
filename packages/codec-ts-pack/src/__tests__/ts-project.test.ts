import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import {
  CalibrationContextTag,
  appendCalibrationDecision,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@taste-codec/core"
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

const initGitRepo = (): void => {
  sh("git", ["init", "-q", "-b", "main"])
  sh("git", ["config", "user.email", "test@test.test"])
  sh("git", ["config", "user.name", "test"])
  sh("git", ["config", "commit.gpgsign", "false"])
  sh("git", ["add", "."])
  sh("git", ["commit", "-q", "-m", "initial"])
}

const sh = (cmd: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd: tmp, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const repoFacts = (): RepoFacts => ({
  repoRoot: tmp,
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["typescript"],
  sourceExtensions: [".ts"],
})

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
    await write("src/_generated/api.ts", "export const generatedApi = true\n")

    const project = await Effect.runPromise(makeTsProject(tmp))
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.includes("/.metadata/"))).toBe(false)
    expect(files.some((file) => file.includes("/_generated/"))).toBe(false)
  })

  test("production-only file discovery also skips hidden metadata files", async () => {
    await write("src/index.ts", "export const product = true\n")
    await write(".metadata/policy.ts", "export const ambientMetadata = true\n")

    const project = await Effect.runPromise(makeTsProjectWithOptions(tmp, { productionOnly: true }))
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.includes("/.metadata/"))).toBe(false)
  })

  test("production-only file discovery skips test utility files", async () => {
    await write("src/index.ts", "export const product = true\n")
    await write("src/test-utils/render.tsx", "export const renderForTest = true\n")
    await write("src/render.test-utils.ts", "export const renderForTest = true\n")
    await write("src/_generated/api.ts", "export const generatedApi = true\n")

    const project = await Effect.runPromise(makeTsProjectWithOptions(tmp, { productionOnly: true }))
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.includes("/test-utils/"))).toBe(false)
    expect(files.some((file) => file.endsWith("render.test-utils.ts"))).toBe(false)
    expect(files.some((file) => file.includes("/_generated/"))).toBe(false)
  })

  test("production-only file discovery honors calibrated taxonomy exclusions", async () => {
    await write("src/index.ts", "export const product = true\n")
    await write("src/scratch.ts", "export const generatedByProjectTool = true\n")
    initGitRepo()
    const processor = defineCalibrationProcessor({
      id: "scratch-taxonomy",
      moduleId: "acme.project",
      moduleVersion: "1.0.0",
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 10,
      fingerprint: "scratch-taxonomy-v1",
      process: (current) =>
        Effect.sync(() => {
          if (!current.value.path.endsWith("src/scratch.ts")) return current
          return appendCalibrationDecision(
            current,
            {
              moduleId: "acme.project",
              processorId: "scratch-taxonomy",
              slot: "taxonomy.file-classifier",
              action: "classify-generated",
              confidence: "medium",
              reason: "Project scratch source is generated by local tooling",
              evidence: [{ kind: "path", value: current.value.path }],
            },
            {
              ...current.value,
              categories: [...current.value.categories, "generated"],
            },
          )
        }),
    })
    const context = makeResolvedCalibrationContext({
      repoFacts: repoFacts(),
      processors: [processor],
    })

    const project = await Effect.runPromise(
      makeTsProjectWithOptions(tmp, { productionOnly: true }).pipe(
        Effect.provide(Layer.succeed(CalibrationContextTag, context)),
      ),
    )
    const files = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())

    expect(files.some((file) => file.endsWith("src/index.ts"))).toBe(true)
    expect(files.some((file) => file.endsWith("src/scratch.ts"))).toBe(false)
  })
})
