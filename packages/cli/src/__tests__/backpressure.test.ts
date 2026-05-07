import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import { createTimeSeriesServices, type TimeSeriesEntry } from "@skastr0/pulsar-core"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "pulsar-backpressure-cli-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  await mkdir(join(repoPath, "src"), { recursive: true })
  await writeFile(
    join(repoPath, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "ESNext" }, include: ["src/**/*.ts"] }, null, 2),
    "utf8",
  )
  await writeFile(join(repoPath, "src", "index.ts"), "export const value = 1\n", "utf8")
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const makeEntry = (sha: string, timestamp: string, score: number): TimeSeriesEntry => ({
  sha,
  timestamp,
  source: "raw",
  observerOutput: {
    categories: {
      "architectural-drift": { score, signals: { A: score } },
      "dependency-entropy": { score: 1, signals: {} },
      "abstraction-bloat": { score: 1, signals: {} },
      "legibility-decay": { score: 1, signals: {} },
      "generated-slop": { score: 1, signals: {} },
      "review-pain": { score: 1, signals: {} },
    },
    minimum: {
      signal: "A",
      category: "architectural-drift",
      score,
      detail: "detail",
    },
    weighted_mean: score,
    hard_gate_status: "pass",
    hard_gate_violations: [],
  },
  signalDiagnostics: {
    A: [{ severity: "warn", message: "Reuse existing domain terms." }],
  },
  inactiveSignals: [],
})

const runCli = (cwd: string, args: ReadonlyArray<string>) =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
  })

describe("pulsar backpressure", () => {
  test("renders the current overall pressure and rationale", async () => {
    const repoPath = await initRepo()
    try {
      const services = createTimeSeriesServices(repoPath)
      await Effect.runPromise(services.writer.append(makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92)))
      await Effect.runPromise(services.writer.append(makeEntry("b", "2026-04-10T10:00:00.000Z", 0.58)))

      const out = runCli(repoPath, ["backpressure", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Overall:         red")
      expect(out.stdout).toContain("architectural-drift")
      expect(out.stdout).toContain("Rationale")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--trend prints the persisted history table", async () => {
    const repoPath = await initRepo()
    try {
      const services = createTimeSeriesServices(repoPath)
      await Effect.runPromise(services.writer.append(makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92)))
      await Effect.runPromise(services.writer.append(makeEntry("b", "2026-04-10T10:00:00.000Z", 0.88)))

      const out = runCli(repoPath, ["backpressure", "--trend", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Trend:")
      expect(out.stdout).toContain("2026-04-01T10:00:00.000Z")
      expect(out.stdout).toContain("weighted=0.92")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
