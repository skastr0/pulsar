import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { materializeAnalysisConfigs, removeAnalysisConfigBundle } from "../analysis-config.js"

describe("analysis config derivation", () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  test("preserves include globs that look like block comments", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-analysis-config-"))
    const tsconfigPath = join(repo, "tsconfig.json")
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
        },
        include: ["**/*.ts", "**/*.tsx"],
      }),
    )

    const bundle = await Effect.runPromise(materializeAnalysisConfigs(repo, [tsconfigPath]))
    cleanup = async () => {
      await Effect.runPromise(removeAnalysisConfigBundle(bundle))
      await rm(repo, { recursive: true, force: true })
    }

    const derived = JSON.parse(await readFile(bundle.configs[0]!.derivedPath, "utf8")) as {
      readonly include: ReadonlyArray<string>
    }
    expect(derived.include).toEqual([
      `${repo.replaceAll("\\", "/")}/**/*.ts`,
      `${repo.replaceAll("\\", "/")}/**/*.tsx`,
    ])
  })

  test("parses JSONC comments and trailing commas", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-analysis-jsonc-"))
    const tsconfigPath = join(repo, "tsconfig.json")
    await writeFile(
      tsconfigPath,
      [
        "{",
        '  // comment',
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        "  },",
        '  "include": ["src/**/*.ts"],',
        "}",
      ].join("\n"),
    )

    const bundle = await Effect.runPromise(materializeAnalysisConfigs(repo, [tsconfigPath]))
    cleanup = async () => {
      await Effect.runPromise(removeAnalysisConfigBundle(bundle))
      await rm(repo, { recursive: true, force: true })
    }

    const derived = JSON.parse(await readFile(bundle.configs[0]!.derivedPath, "utf8")) as {
      readonly include: ReadonlyArray<string>
    }
    expect(derived.include).toEqual([
      `${repo.replaceAll("\\", "/")}/src/**/*.ts`,
      `${repo.replaceAll("\\", "/")}/src/**/*.tsx`,
    ])
  })

  test("extends the original config by filesystem path", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-analysis-extends-"))
    const tsconfigPath = join(repo, "tsconfig.json")
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext" },
        include: ["src/**/*.ts"],
      }),
    )
    const bundle = await Effect.runPromise(materializeAnalysisConfigs(repo, [tsconfigPath]))
    cleanup = async () => {
      await Effect.runPromise(removeAnalysisConfigBundle(bundle))
      await rm(repo, { recursive: true, force: true })
    }
    const derived = JSON.parse(await readFile(bundle.configs[0]!.derivedPath, "utf8")) as {
      readonly extends: string
    }
    expect(derived.extends).toBe(tsconfigPath.replaceAll("\\", "/"))
    expect(derived.extends.startsWith("file:")).toBe(false)
  })

  test("does not invent include for files-only configs", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-analysis-files-"))
    const tsconfigPath = join(repo, "tsconfig.json")
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { target: "ES2022" },
        files: ["src/index.ts"],
      }),
    )
    const bundle = await Effect.runPromise(materializeAnalysisConfigs(repo, [tsconfigPath]))
    cleanup = async () => {
      await Effect.runPromise(removeAnalysisConfigBundle(bundle))
      await rm(repo, { recursive: true, force: true })
    }
    const derived = JSON.parse(await readFile(bundle.configs[0]!.derivedPath, "utf8")) as {
      readonly files?: ReadonlyArray<string>
      readonly include?: ReadonlyArray<string>
    }
    expect(derived.include).toBeUndefined()
    expect(derived.files).toEqual([`${repo.replaceAll("\\", "/")}/src/index.ts`])
  })

  test("rebases an explicit baseUrl and leaves inherited includes unset", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-analysis-baseurl-"))
    const tsconfigPath = join(repo, "tsconfig.json")
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          baseUrl: "./src",
          paths: { "@/*": ["./*"] },
        },
      }),
    )
    const bundle = await Effect.runPromise(materializeAnalysisConfigs(repo, [tsconfigPath]))
    cleanup = async () => {
      await Effect.runPromise(removeAnalysisConfigBundle(bundle))
      await rm(repo, { recursive: true, force: true })
    }
    const derived = JSON.parse(await readFile(bundle.configs[0]!.derivedPath, "utf8")) as {
      readonly include?: ReadonlyArray<string>
      readonly compilerOptions: { readonly baseUrl?: string }
    }
    expect(derived.include).toBeUndefined()
    expect(derived.compilerOptions.baseUrl).toBe(`${repo.replaceAll("\\", "/")}/src`)
  })
})
