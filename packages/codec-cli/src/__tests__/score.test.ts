import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { ObserverOutput as ObserverOutputSchema, createTimeSeriesServices } from "@taste-codec/core"
import { Effect, Schema } from "effect"

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

const initRepo = async (
  files: ReadonlyArray<{ path: string; content: string }>,
): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-score-cli-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  sh("git", ["config", "commit.gpgsign", "false"], repoPath)

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
        include: ["**/*.ts"],
      },
      null,
      2,
    ),
  )

  for (const file of files) {
    await writeRepoFile(repoPath, file.path, file.content)
  }

  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const simpleRepoFiles = (): ReadonlyArray<{ path: string; content: string }> => [
  { path: "src/a.ts", content: "export const a = 1\n" },
  {
    path: "src/b.ts",
    content: "import { a } from './a'\nexport const b = a + 1\n",
  },
]

const cycleRepoFiles = (): ReadonlyArray<{ path: string; content: string }> => [
  {
    path: "src/a.ts",
    content: "import { b } from './b'\nexport const a = b + 1\n",
  },
  {
    path: "src/b.ts",
    content: "import { a } from './a'\nexport const b = a + 1\n",
  },
]

describe("taste score", () => {
  test("full observer mode prints the category table, minimum, and gate", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Architectural Drift")
      expect(out.stdout).toContain("Weighted Mean")
      expect(out.stdout).toContain("Minimum")
      expect(out.stdout).toContain("Hard Gate")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--json emits ObserverOutput JSON", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--json", "."])
      expect(out.status).toBe(0)
      const parsed = JSON.parse(String(out.stdout))
      const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(parsed)
      expect(decoded.hard_gate_status === "pass" || decoded.hard_gate_status === "fail").toBe(
        true,
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--category narrows human output and omits weighted mean + gate", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--category", "abstraction-bloat", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Category: abstraction-bloat")
      expect(out.stdout).toContain("TS-AB-01")
      expect(out.stdout).not.toContain("Weighted Mean")
      expect(out.stdout).not.toContain("Hard Gate")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("default vector discovery prefers worktree then personal config", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    const homePath = await mkdtemp(join(tmpdir(), "taste-score-home-"))
    try {
      await writeRepoFile(
        repoPath,
        ".taste-codec/vector.json",
        JSON.stringify(
          {
            id: "worktree-default",
            domain: "typescript",
            signal_overrides: { "TS-AB-01": { active: false } },
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        homePath,
        ".config/taste-codec/vector.json",
        JSON.stringify(
          {
            id: "personal-default",
            domain: "typescript",
            signal_overrides: { "TS-LD-01": { active: false } },
          },
          null,
          2,
        ),
      )

      const worktreeOut = runCli(repoPath, ["score", "."], { HOME: homePath })
      expect(worktreeOut.status).toBe(0)
      expect(worktreeOut.stdout).toContain("Vector: worktree-default")

      await rm(join(repoPath, ".taste-codec"), { recursive: true, force: true })
      const personalOut = runCli(repoPath, ["score", "."], { HOME: homePath })
      expect(personalOut.status).toBe(0)
      expect(personalOut.stdout).toContain("Vector: personal-default")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("human output explains why AI-assisted thresholds are active", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        ".taste-codec/vector.json",
        JSON.stringify(
          {
            id: "ai-slop-defense",
            domain: "typescript",
            modes: { ai_assisted: true },
            signal_overrides: {},
            provenance: [
              {
                source: "ai-assisted-detection",
                recorded_at: "2026-04-19T00:00:00.000Z",
                summary: "Accepted AI-assisted detection proposal",
              },
            ],
          },
          null,
          2,
        ),
      )

      const out = runCli(repoPath, ["score", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("AI Mode: active")
      expect(out.stdout).toContain("accepted AI-assisted detection proposal")
      expect(out.stdout).toContain("vector.modes.ai_assisted")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--ci without a baseline warns and exits 0", async () => {
    const repoPath = await initRepo(cycleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--ci", "."])
      expect(out.status).toBe(0)
      expect(out.stderr).toContain("baseline=missing")
      expect(out.stderr).toContain("taste baseline set")
      const entries = await Effect.runPromise(
        createTimeSeriesServices(repoPath).reader.entries(),
      )
      expect(entries).toHaveLength(1)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("baseline set/show and --ci keeps passing when no new hard-gate identities surface", async () => {
    const repoPath = await initRepo(cycleRepoFiles())
    try {
      const baselineSet = runCli(repoPath, ["baseline", "set", "."])
      expect(baselineSet.status).toBe(0)

      const baselineJson = JSON.parse(
        await readFile(join(repoPath, ".taste-codec", "baseline.json"), "utf8"),
      )
      expect(Object.keys(baselineJson.violations)).toContain("TS-AD-02")

      const baselineShow = runCli(repoPath, ["baseline", "show", "."])
      expect(baselineShow.status).toBe(0)
      expect(baselineShow.stdout).toContain("Baseline SHA")
      expect(baselineShow.stdout).toContain("TS-AD-02")

      const ratchetedPass = runCli(repoPath, ["score", "--ci", "."])
      expect(ratchetedPass.status).toBe(0)
      expect(ratchetedPass.stderr).toContain("status=pass")
      expect(ratchetedPass.stderr).toContain("tolerated=1")

      await writeRepoFile(
        repoPath,
        "src/c.ts",
        "import { d } from './d-impl'\nexport const c = d + 1\n",
      )
      await writeRepoFile(
        repoPath,
        "src/d-impl.ts",
        "import { c } from './c'\nexport const d = c + 1\n",
      )

      const ratchetedFail = runCli(repoPath, ["score", "--ci", "."])
      expect(ratchetedFail.status).toBe(0)
      expect(ratchetedFail.stderr).toContain("status=pass")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("baseline refresh accepts an extended bypass deadline", async () => {
    const repoPath = await initRepo([
      {
        path: "src/a.ts",
        content:
          "// taste-allow ENG-123 until:2000-01-01 temporary cycle\nimport { b } from './b'\nexport const a = b + 1\n",
      },
      {
        path: "src/b.ts",
        content: "import { a } from './a'\nexport const b = a + 1\n",
      },
    ])
    try {
      const set = runCli(repoPath, ["baseline", "set", "."])
      expect(set.status).toBe(0)

      await writeRepoFile(
        repoPath,
        "src/a.ts",
        "// taste-allow ENG-123 until:2099-01-01 temporary cycle\nimport { b } from './b'\nexport const a = b + 1\n",
      )

      const refresh = runCli(repoPath, ["baseline", "refresh", "."])
      expect(refresh.status).toBe(0)

      const show = runCli(repoPath, ["baseline", "show", "."])
      expect(show.status).toBe(0)
      expect(show.stdout).toContain("Tolerated:     1")

      const ci = runCli(repoPath, ["score", "--ci", "."])
      expect(ci.status).toBe(0)
      expect(ci.stderr).toContain("status=pass")
      expect(ci.stderr).toContain("new=0")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal mode still prints the legacy surface", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--signal", "TS-LD-01", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Signal: TS-LD-01")
      expect(out.stdout).toContain("Score:")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("explicit vectors fail loud on unknown signal ids", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    const vectorDir = await mkdtemp(join(tmpdir(), "taste-score-vector-"))
    try {
      const vectorPath = join(vectorDir, "vector.json")
      await writeFile(
        vectorPath,
        JSON.stringify(
          {
            id: "bad-vector",
            domain: "typescript",
            signal_overrides: { "DOES-NOT-EXIST": { active: true } },
          },
          null,
          2,
        ),
        "utf8",
      )

      const out = runCli(repoPath, ["score", "--vector", vectorPath, "."])
      expect(out.status).toBe(1)
      expect(out.stderr).toContain("Unknown signal id in taste vector")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(vectorDir, { recursive: true, force: true })
    }
  }, 120_000)
})
