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

const runCli = (cwd: string, args: ReadonlyArray<string>) =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
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
      expect(diff.stdout).toContain("Weight deltas:")
      expect(diff.stdout).toContain("Mode deltas:")
      expect(diff.stdout).toContain("ai_assisted false -> true")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
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
})
