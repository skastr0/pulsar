import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const initRepo = async (
  dependencies: Record<string, string> = {
    effect: "^3.0.0",
    convex: "^1.0.0",
  },
): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-calibrate-cli-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  sh("git", ["config", "commit.gpgsign", "false"], repoPath)
  await writeFile(
    join(repoPath, "package.json"),
    JSON.stringify(
      {
        name: "calibrate-fixture",
        dependencies,
      },
      null,
      2,
    ),
  )
  await mkdir(join(repoPath, "src"), { recursive: true })
  await writeFile(join(repoPath, "src", "index.ts"), "export const ready = true\n")
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (
  cwd: string,
  args: ReadonlyArray<string>,
): ReturnType<typeof spawnSync> =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
  })

describe("taste calibrate", () => {
  test("suggest is deterministic and read-only by default", async () => {
    const repoPath = await initRepo()
    try {
      const first = runCli(repoPath, ["calibrate", "suggest", "--json", "."])
      const second = runCli(repoPath, ["calibrate", "suggest", "--json", "."])

      expect(first.status).toBe(0)
      expect(second.status).toBe(0)
      expect(first.stdout).toBe(second.stdout)
      expect(existsSync(join(repoPath, ".taste-codec"))).toBe(false)

      const parsed = JSON.parse(String(first.stdout))
      expect(parsed.score_command_read_only).toBe(true)
      expect(parsed.status).toMatchObject({
        vector: "missing",
        conventions: "missing",
        glossary: "missing",
        baseline: "missing",
        project_modules: "missing",
      })
      expect(parsed.suggestions.map((item: { id: string }) => item.id)).toContain(
        "reference-data.conventions.extract",
      )
      expect(parsed.suggested_project_modules.map((item: { packageName: string }) => item.packageName)).toEqual([
        "@taste-codec/project-module-convex",
        "@taste-codec/project-module-effect",
      ])
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("suggest --write writes only the suggestion report", async () => {
    const repoPath = await initRepo()
    try {
      const out = runCli(repoPath, ["calibrate", "suggest", "--write", "--json", "."])

      expect(out.status).toBe(0)
      const parsed = JSON.parse(String(out.stdout))
      expect(parsed.mode).toBe("write-report")
      expect(parsed.write_path).toEndWith(".taste-codec/calibration-suggestions.json")
      expect(JSON.parse(await readFile(parsed.write_path, "utf8"))).toEqual(parsed)
      expect(existsSync(join(repoPath, ".taste-codec", "vector.json"))).toBe(false)
      expect(existsSync(join(repoPath, ".taste-codec", "project-modules.json"))).toBe(false)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("suggest ignores package manifests under generated and cache directories", async () => {
    const repoPath = await initRepo({})
    try {
      const skippedDirs = [
        ".next",
        ".nuxt",
        ".output",
        ".cache",
        "target",
        "vendor",
        "gen",
        "generated",
      ]
      for (const dir of skippedDirs) {
        await mkdir(join(repoPath, dir), { recursive: true })
        await writeFile(
          join(repoPath, dir, "package.json"),
          JSON.stringify(
            {
              name: `${dir.replaceAll(".", "")}-fixture`,
              dependencies: {
                effect: "^3.0.0",
                convex: "^1.0.0",
              },
            },
            null,
            2,
          ),
        )
      }

      const out = runCli(repoPath, ["calibrate", "suggest", "--json", "."])

      expect(out.status).toBe(0)
      const parsed = JSON.parse(String(out.stdout))
      expect(parsed.suggested_project_modules).toEqual([])
      expect(parsed.suggestions.map((item: { id: string }) => item.id)).not.toContain(
        "project-modules.manifest",
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
