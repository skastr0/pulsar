import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
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

const writeRepoFile = async (
  repoPath: string,
  relPath: string,
  content: string,
): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "pulsar-coverage-cli-"))
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
  await writeRepoFile(repoPath, "src/a.ts", "export const a = 1\n")
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
    env: process.env,
  })

const readCoverageArtifact = async (repoPath: string): Promise<any> =>
  JSON.parse(
    await readFile(join(repoPath, ".pulsar", "coverage", "coverage-facts.json"), "utf8"),
  )

describe("pulsar coverage ingest", () => {
  test("ingests lcov reports into repo-owned coverage facts", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(
        repoPath,
        "coverage/lcov.info",
        [
          "SF:src/a.ts",
          "DA:1,1",
          "DA:2,0",
          "FNDA:1,makeA",
          "FNDA:0,makeB",
          "BRDA:1,0,0,1",
          "BRDA:1,0,1,0",
          "end_of_record",
        ].join("\n"),
      )

      const out = runCli(repoPath, [
        "coverage",
        "ingest",
        "coverage/lcov.info",
        "--no-progress",
        ".",
      ])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain(
        "Coverage facts written: .pulsar/coverage/coverage-facts.json",
      )
      expect(out.stdout).toContain("Lines: 50.0%")

      const artifact = await readCoverageArtifact(repoPath)
      expect(artifact.schema_version).toBe(1)
      expect(artifact.facts).toMatchObject({
        state: "present",
        tool: "lcov",
        checkedPaths: ["coverage/lcov.info"],
      })
      expect(artifact.facts.summary.lines).toEqual({ covered: 1, total: 2, pct: 0.5 })
      expect(artifact.facts.summary.functions).toEqual({
        covered: 1,
        total: 2,
        pct: 0.5,
      })
      expect(artifact.facts.summary.branches).toEqual({
        covered: 1,
        total: 2,
        pct: 0.5,
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("ingests istanbul reports even when forced format disagrees with extension", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(
        repoPath,
        "reports/coverage.txt",
        JSON.stringify({
          "src/a.ts": {
            path: "src/a.ts",
            s: { "0": 1, "1": 0 },
            f: { "0": 1 },
            b: { "0": [1, 0] },
          },
        }),
      )

      const out = runCli(repoPath, [
        "coverage",
        "ingest",
        "reports/coverage.txt",
        "--format",
        "istanbul",
        "--no-progress",
        ".",
      ])
      expect(out.status).toBe(0)

      const artifact = await readCoverageArtifact(repoPath)
      expect(artifact.facts).toMatchObject({
        state: "present",
        tool: "istanbul",
        checkedPaths: ["reports/coverage.txt"],
      })
      expect(artifact.facts.summary.lines).toEqual({ covered: 1, total: 2, pct: 0.5 })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("rejects unsupported auto-detected report extensions", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(repoPath, "coverage/report.txt", "not coverage")

      const out = runCli(repoPath, [
        "coverage",
        "ingest",
        "coverage/report.txt",
        "--no-progress",
        ".",
      ])
      expect(out.status).toBe(1)
      expect(out.stderr).toContain("--format auto supports .info, .lcov, and .json")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("surfaces malformed istanbul reports as CLI failures", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(repoPath, "coverage/coverage-final.json", "{")

      const out = runCli(repoPath, [
        "coverage",
        "ingest",
        "coverage/coverage-final.json",
        "--no-progress",
        ".",
      ])
      expect(out.status).toBe(1)
      expect(out.stderr).toContain("Failed to parse istanbul coverage report")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("agent-view trust metadata reports ingested coverage state", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(
        repoPath,
        "coverage/lcov.info",
        ["SF:src/a.ts", "DA:1,1", "DA:2,1", "end_of_record"].join("\n"),
      )
      const ingest = runCli(repoPath, [
        "coverage",
        "ingest",
        "coverage/lcov.info",
        "--no-progress",
        ".",
      ])
      expect(ingest.status).toBe(0)

      await writeRepoFile(repoPath, "src/a.ts", "export const a = 2\n")
      const score = runCli(repoPath, [
        "score",
        "--diff",
        "HEAD..WORKTREE",
        "--agent-view",
        "--json",
        "--no-progress",
        ".",
      ])
      expect([0, 2]).toContain(score.status ?? -1)
      const parsed = JSON.parse(String(score.stdout))
      expect(parsed.trust.coverage_state).toBe("present")
      expect(parsed.trust.missing_evidence).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ signal_id: "SHARED-COV-01-coverage-facts" }),
        ]),
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
