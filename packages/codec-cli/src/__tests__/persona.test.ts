import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { loadQuizItems, loadTasteVectorPresets, validateVectorAgainstRegistry } from "@taste-codec/core"
import { Effect } from "effect"
import { buildCodecRegistry } from "../runtime.js"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const writeRepoFile = async (repoPath: string, relPath: string, content: string): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-persona-cli-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  await writeRepoFile(
    repoPath,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  )
  await writeRepoFile(repoPath, "src/index.ts", "export const ready = true\n")
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
) =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const duplicateHeavySource = (): string => {
  const body = `
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) {
    return "missing"
  }
  if (normalized.includes("@")) {
    return normalized
  }
  return normalized.replaceAll(" ", "-")
`
  return Array.from({ length: 40 }, (_, index) => `
export function normalize${index}(value: string): string {
${body}
}
`).join("\n")
}

describe("taste persona", () => {
  test("shipped presets and quiz items reference known registry signals", async () => {
    const registry = await Effect.runPromise(buildCodecRegistry())
    const presets = await Effect.runPromise(loadTasteVectorPresets())
    for (const preset of presets) {
      await Effect.runPromise(validateVectorAgainstRegistry(preset, registry))
    }

    const items = await Effect.runPromise(loadQuizItems("typescript"))
    for (const item of items) {
      for (const signalId of [...Object.keys(item.a_signals), ...Object.keys(item.b_signals)]) {
        expect(registry.has(signalId)).toBe(true)
      }
    }
  })

  test("list, show, apply, and diff commands work end-to-end", async () => {
    const repoPath = await initRepo()
    try {
      const list = runCli(repoPath, ["persona", "list"])
      expect(list.status).toBe(0)
      expect(list.stdout).toContain("strict-type-safety")
      expect(list.stdout).toContain("ai-slop-defense")

      const show = runCli(repoPath, ["persona", "show", "security-paranoid"])
      expect(show.status).toBe(0)
      expect(show.stdout).toContain("security-paranoid")
      expect(show.stdout).toContain("sensitive environments")

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "strict-type-safety",
        "--to",
        ".taste-codec/vector.json",
      ])
      expect(apply.status).toBe(0)

      const written = JSON.parse(await readFile(join(repoPath, ".taste-codec/vector.json"), "utf8"))
      expect(written.id).toBe("strict-type-safety")
      expect(written.provenance[0].source).toBe("preset")

      const score = runCli(repoPath, ["score", "."])
      expect(score.status).toBe(0)
      expect(score.stdout).toContain("Vector: strict-type-safety")

      const diff = runCli(repoPath, ["persona", "diff", "ai-slop-defense", repoPath])
      expect(diff.status).toBe(0)
      expect(diff.stdout).toContain("Current vector source: repo-local .taste-codec/vector.json")
      expect(diff.stdout).toContain("Weight deltas:")
      expect(diff.stdout).toContain("Mode deltas:")
      expect(diff.stdout).toContain("ai_assisted false -> true")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("diff labels organization fallback vector provenance", async () => {
    const repoPath = await initRepo()
    const homePath = await mkdtemp(join(tmpdir(), "taste-persona-home-"))
    try {
      await writeRepoFile(
        homePath,
        ".config/taste-codec/vector.json",
        JSON.stringify(
          {
            id: "organization-default",
            domain: "typescript",
            signal_overrides: { "TS-LD-01": { weight: 0.5 } },
          },
          null,
          2,
        ),
      )

      const diff = runCli(repoPath, ["persona", "diff", "ai-slop-defense", repoPath], {
        HOME: homePath,
      })
      expect(diff.status).toBe(0)
      expect(diff.stdout).toContain("Current vector:        organization-default")
      expect(diff.stdout).toContain(
        "Current vector source: organization fallback ~/.config/taste-codec/vector.json",
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied ai-slop-defense vector tightens small diff clone signal after baseline", async () => {
    const repoPath = await initRepo()
    const smallDuplicateBody = `
  const out = value + 1
  return out
`
    try {
      await writeRepoFile(
        repoPath,
        "src/existing.ts",
        `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        "src/existing-two.ts",
        `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      )
      sh("git", ["add", "src/existing.ts", "src/existing-two.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed tiny helpers"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${smallDuplicateBody}}\n`,
      )

      const baseline = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(baseline.status).toBe(0)
      expect(baseline.stdout).toContain("Vector:   all-defaults")
      expect(baseline.stdout).not.toContain("existingTiny")
      expect(baseline.stdout).not.toContain("copiedTiny")

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "ai-slop-defense",
        "--to",
        ".taste-codec/vector.json",
      ])
      expect(apply.status).toBe(0)

      const written = JSON.parse(await readFile(join(repoPath, ".taste-codec/vector.json"), "utf8"))
      expect(written.id).toBe("ai-slop-defense")
      expect(written.modes.ai_assisted).toBe(true)
      expect(written.signal_overrides["SHARED-03"].weight).toBeGreaterThan(1)
      expect(written.provenance[0].source).toBe("preset")

      const vectorScore = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(vectorScore.status).toBe(0)
      expect(vectorScore.stdout).toContain("Vector:   ai-slop-defense")
      expect(vectorScore.stdout).toContain("AI Mode:  active")
      expect(vectorScore.stdout).toContain("existingTiny")
      expect(vectorScore.stdout).toContain("copiedTiny")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied ai-slop-defense vector separates dirty copied diffs from clean alternatives", async () => {
    const seedRepo = async (): Promise<string> => {
      const repoPath = await initRepo()
      const smallDuplicateBody = `
  const out = value + 1
  return out
`
      await writeRepoFile(
        repoPath,
        "src/existing.ts",
        `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        "src/existing-two.ts",
        `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      )
      sh("git", ["add", "src/existing.ts", "src/existing-two.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed tiny helpers"], repoPath)
      return repoPath
    }

    const dirtyRepoPath = await seedRepo()
    const cleanRepoPath = await seedRepo()
    try {
      const copiedBody = `
  const out = value + 1
  return out
`
      await writeRepoFile(
        dirtyRepoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${copiedBody}}\n`,
      )

      const defaultDirty = runCli(dirtyRepoPath, ["score", "--json", "."])
      expect(defaultDirty.status).toBe(0)
      const defaultDirtyScore = JSON.parse(defaultDirty.stdout).categories["generated-slop"].score

      for (const repoPath of [dirtyRepoPath, cleanRepoPath]) {
        const apply = runCli(repoPath, [
          "persona",
          "apply",
          "ai-slop-defense",
          "--to",
          ".taste-codec/vector.json",
        ])
        expect(apply.status).toBe(0)
        sh("git", ["add", ".taste-codec/vector.json"], repoPath)
        sh("git", ["commit", "-q", "-m", "apply ai slop defense vector"], repoPath)
      }

      await writeRepoFile(
        cleanRepoPath,
        "src/changed.ts",
        `
export function formattedTiny(value: number): number {
  const incremented = value + 1
  return Number.isFinite(incremented) ? incremented : value
}
`,
      )

      const dirtyVector = runCli(dirtyRepoPath, ["score", "--json", "."])
      const cleanVector = runCli(cleanRepoPath, ["score", "--json", "."])
      expect(dirtyVector.status).toBe(0)
      expect(cleanVector.status).toBe(0)

      const dirtyGeneratedSlop = JSON.parse(dirtyVector.stdout).categories["generated-slop"]
      const cleanGeneratedSlop = JSON.parse(cleanVector.stdout).categories["generated-slop"]

      expect(dirtyGeneratedSlop.score).toBeLessThan(defaultDirtyScore)
      expect(dirtyGeneratedSlop.score).toBeLessThan(cleanGeneratedSlop.score)
      expect(dirtyGeneratedSlop.signals["TS-SL-01"]).toBeLessThan(1)
      expect(cleanGeneratedSlop.signals["TS-SL-01"]).toBe(1)
      expect(cleanGeneratedSlop.score).toBeGreaterThanOrEqual(0.99)
    } finally {
      await rm(dirtyRepoPath, { recursive: true, force: true })
      await rm(cleanRepoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("created ai-slop-defense vector changes generated-slop scoring", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(repoPath, "src/duplicates.ts", duplicateHeavySource())

      const baseline = runCli(repoPath, [
        "score",
        "--json",
        ".",
      ])
      expect(baseline.status).toBe(0)
      const baselineScore = JSON.parse(baseline.stdout).categories["generated-slop"].score

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "ai-slop-defense",
        "--to",
        ".taste-codec/vector.json",
      ])
      expect(apply.status).toBe(0)

      const vectorScore = runCli(repoPath, [
        "score",
        "--json",
        ".",
      ])
      expect(vectorScore.status).toBe(0)
      const generatedSlop = JSON.parse(vectorScore.stdout).categories["generated-slop"]
      expect(generatedSlop.score).toBeLessThan(baselineScore)
      expect(generatedSlop.signals["TS-SL-01"]).toBeLessThan(1)

      const human = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(human.status).toBe(0)
      expect(human.stdout).toContain("Vector:   ai-slop-defense")
      expect(human.stdout).toContain("AI Mode:  active")
      expect(human.stdout).toContain("TS-SL-01")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied refactor-friendly vector tightens architecture scoring after baseline", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(repoPath, "src/a.ts", "import { b } from './b'\nexport const a = b + 1\n")
      await writeRepoFile(repoPath, "src/b.ts", "import { c } from './c'\nexport const b = c + 1\n")
      await writeRepoFile(repoPath, "src/c.ts", "import { d } from './d'\nexport const c = d + 1\n")
      await writeRepoFile(repoPath, "src/d.ts", "import { a } from './a'\nexport const d = a + 1\n")
      sh("git", ["add", "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed runtime cycle"], repoPath)

      const baseline = runCli(repoPath, ["score", "--json", "."])
      expect(baseline.status).toBe(0)
      const baselineArchitecture = JSON.parse(baseline.stdout).categories["architectural-drift"]
      expect(baselineArchitecture.aggregation.weights["TS-AD-02"]).toBe(1)
      expect(baselineArchitecture.signals["TS-AD-02"]).toBeLessThan(1)

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "refactor-friendly",
        "--to",
        ".taste-codec/vector.json",
      ])
      expect(apply.status).toBe(0)

      const written = JSON.parse(await readFile(join(repoPath, ".taste-codec/vector.json"), "utf8"))
      expect(written.id).toBe("refactor-friendly")
      expect(written.signal_overrides["TS-AD-02"].weight).toBeGreaterThan(1)
      expect(written.signal_overrides["SHARED-02"].weight).toBeGreaterThan(1)
      expect(written.signal_overrides["SHARED-03"].weight).toBeGreaterThan(1)
      expect(written.provenance[0].source).toBe("preset")

      const vectorScore = runCli(repoPath, ["score", "--json", "."])
      expect(vectorScore.status).toBe(0)
      const vectorArchitecture = JSON.parse(vectorScore.stdout).categories["architectural-drift"]
      expect(vectorArchitecture.aggregation.weights["TS-AD-02"]).toBeGreaterThan(1)
      expect(vectorArchitecture.score).toBeLessThan(baselineArchitecture.score)

      const human = runCli(repoPath, ["score", "--category", "architectural-drift", "."])
      expect(human.status).toBe(0)
      expect(human.stdout).toContain("Vector:   refactor-friendly")
      expect(human.stdout).toContain("TS-AD-02")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied refactor-friendly vector separates circular diffs from clean dependency direction", async () => {
    const seedRepo = async (): Promise<string> => {
      const repoPath = await initRepo()
      await writeRepoFile(
        repoPath,
        "src/domain.ts",
        "export type DomainRecord = { readonly id: string }\nexport const makeRecord = (id: string): DomainRecord => ({ id })\n",
      )
      await writeRepoFile(
        repoPath,
        "src/service.ts",
        "import { makeRecord } from './domain'\nexport const loadRecord = (id: string) => makeRecord(id)\n",
      )
      sh("git", ["add", "src/domain.ts", "src/service.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed clean dependency direction"], repoPath)
      return repoPath
    }

    const dirtyRepoPath = await seedRepo()
    const cleanRepoPath = await seedRepo()
    try {
      await writeRepoFile(
        dirtyRepoPath,
        "src/domain.ts",
        "import { loadRecord } from './service'\nexport type DomainRecord = { readonly id: string }\nexport const makeRecord = (id: string): DomainRecord => ({ id })\nexport const hydrateRecord = (id: string) => loadRecord(id)\n",
      )

      const defaultDirty = runCli(dirtyRepoPath, ["score", "--json", "."])
      expect(defaultDirty.status).toBe(0)
      const defaultArchitecture = JSON.parse(defaultDirty.stdout).categories["architectural-drift"]
      expect(defaultArchitecture.signals["TS-AD-02"]).toBeLessThan(1)

      for (const repoPath of [dirtyRepoPath, cleanRepoPath]) {
        const apply = runCli(repoPath, [
          "persona",
          "apply",
          "refactor-friendly",
          "--to",
          ".taste-codec/vector.json",
        ])
        expect(apply.status).toBe(0)
        sh("git", ["add", ".taste-codec/vector.json"], repoPath)
        sh("git", ["commit", "-q", "-m", "apply refactor vector"], repoPath)
      }

      await writeRepoFile(
        cleanRepoPath,
        "src/use-case.ts",
        "import { loadRecord } from './service'\nexport const runUseCase = (id: string) => loadRecord(id)\n",
      )

      const dirtyVector = runCli(dirtyRepoPath, ["score", "--json", "."])
      const cleanVector = runCli(cleanRepoPath, ["score", "--json", "."])
      expect(dirtyVector.status).toBe(0)
      expect(cleanVector.status).toBe(0)

      const dirtyArchitecture = JSON.parse(dirtyVector.stdout).categories["architectural-drift"]
      const cleanArchitecture = JSON.parse(cleanVector.stdout).categories["architectural-drift"]

      expect(dirtyArchitecture.aggregation.weights["TS-AD-02"]).toBeGreaterThan(1)
      expect(dirtyArchitecture.score).toBeLessThan(defaultArchitecture.score)
      expect(dirtyArchitecture.score).toBeLessThan(cleanArchitecture.score)
      expect(dirtyArchitecture.signals["TS-AD-02"]).toBeLessThan(1)
      expect(cleanArchitecture.signals["TS-AD-02"]).toBe(1)
      expect(cleanArchitecture.score).toBe(1)
    } finally {
      await rm(dirtyRepoPath, { recursive: true, force: true })
      await rm(cleanRepoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
