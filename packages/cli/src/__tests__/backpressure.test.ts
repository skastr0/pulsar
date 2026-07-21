import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  createTimeSeriesServices,
  type TimeSeriesEntry,
} from "@skastr0/pulsar-core/time-series"
import { Effect } from "effect"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")

interface TestRepo {
  readonly rootPath: string
  readonly repoPath: string
  readonly stateHome: string
  readonly homePath: string
}

type ReadinessSnapshot = NonNullable<
  TimeSeriesEntry["observerOutput"]["readiness"]
>

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    )
  }
}

const initRepo = async (): Promise<TestRepo> => {
  const rootPath = await mkdtemp(join(tmpdir(), "pulsar-backpressure-cli-"))
  const repoPath = join(rootPath, "repo")
  const stateHome = join(rootPath, "state")
  const homePath = join(rootPath, "home")
  await mkdir(join(repoPath, "src"), { recursive: true })
  await mkdir(homePath, { recursive: true })
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  await writeFile(
    join(repoPath, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { module: "ESNext" },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  )
  await writeFile(
    join(repoPath, "src", "index.ts"),
    "export const value = 1\n",
    "utf8",
  )
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return { rootPath, repoPath, stateHome, homePath }
}

const makeReadiness = (status: "unknown" | "failed"): ReadinessSnapshot => ({
  score: status === "failed" ? 0 : 1,
  pressure: status === "failed" ? 1 : 0,
  status,
  aggregation: {
    strategy: "pressure-pnorm-local-max",
    p: 12,
    mean_pressure: status === "failed" ? 1 : 0,
    pnorm_pressure: status === "failed" ? 1 : 0,
    max_local_pressure: status === "failed" ? 1 : 0,
    failed_signal_pressure: status === "failed" ? 1 : 0,
    hard_gate_pressure: 0,
    hard_gate_score_cap: 0.2,
    local_warning_threshold: 0.4,
    local_poison_threshold: 0.75,
    local_warning_gain: 0.75,
    applicable_signal_count: 1,
    ignored_signal_count: 0,
    failed_signal_count: status === "failed" ? 1 : 0,
  },
  top_pressures: [],
})

const makeEntry = (
  sha: string,
  timestamp: string,
  score: number,
  readiness?: ReadinessSnapshot,
): TimeSeriesEntry => ({
  sha,
  timestamp,
  source: "raw",
  observerOutput: {
    categories: {
      "architectural-drift": {
        score,
        signals: { A: score },
        signalCount: 1,
        ...(readiness !== undefined ? { applicableSignalCount: 1 } : {}),
        activeSignalIds: ["A"],
      },
      "dependency-entropy": {
        score: 1,
        signals: {},
        signalCount: 0,
        ...(readiness !== undefined ? { applicableSignalCount: 0 } : {}),
        activeSignalIds: [],
      },
      "abstraction-bloat": {
        score: 1,
        signals: {},
        signalCount: 0,
        ...(readiness !== undefined ? { applicableSignalCount: 0 } : {}),
        activeSignalIds: [],
      },
      "legibility-decay": {
        score: 1,
        signals: {},
        signalCount: 0,
        ...(readiness !== undefined ? { applicableSignalCount: 0 } : {}),
        activeSignalIds: [],
      },
      "generated-slop": {
        score: 1,
        signals: {},
        signalCount: 0,
        ...(readiness !== undefined ? { applicableSignalCount: 0 } : {}),
        activeSignalIds: [],
      },
      "review-pain": {
        score: 1,
        signals: {},
        signalCount: 0,
        ...(readiness !== undefined ? { applicableSignalCount: 0 } : {}),
        activeSignalIds: [],
      },
    },
    minimum: {
      signal: "A",
      category: "architectural-drift",
      score,
      detail: "detail",
    },
    weighted_mean: score,
    ...(readiness !== undefined ? { readiness } : {}),
    hard_gate_status: "pass",
    hard_gate_violations: [],
  },
  signalDiagnostics: {
    A: [{ severity: "warn", message: "Reuse existing domain terms." }],
  },
  inactiveSignals: [],
})

const createServices = (repo: TestRepo) => {
  const previousStateHome = process.env.PULSAR_STATE_HOME
  process.env.PULSAR_STATE_HOME = repo.stateHome
  try {
    return createTimeSeriesServices(repo.repoPath)
  } finally {
    if (previousStateHome === undefined) {
      delete process.env.PULSAR_STATE_HOME
    } else {
      process.env.PULSAR_STATE_HOME = previousStateHome
    }
  }
}

const appendEntries = async (
  repo: TestRepo,
  entries: ReadonlyArray<TimeSeriesEntry>,
): Promise<void> => {
  const services = createServices(repo)
  for (const entry of entries) {
    await Effect.runPromise(services.writer.append(entry))
  }
}

const runCli = (repo: TestRepo, args: ReadonlyArray<string>) =>
  spawnSync("bun", [binPath, ...args], {
    cwd: repo.repoPath,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: repo.homePath,
      XDG_CONFIG_HOME: join(repo.homePath, ".config"),
      PULSAR_STATE_HOME: repo.stateHome,
    },
  })

describe("pulsar backpressure", () => {
  test("renders an evidenced current pressure and rationale", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92),
        makeEntry("b", "2026-04-10T10:00:00.000Z", 0.58),
      ])

      const out = runCli(repo, ["backpressure", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Overall:         red")
      expect(out.stdout).toContain("Evidence State:  available")
      expect(out.stdout).toContain("Evidence Count:  2/2 usable observations")
      expect(out.stdout).toContain("architectural-drift")
      expect(out.stdout).toContain("score=0.58")
      expect(out.stdout).toContain("Rationale")
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("first run reports unavailable without synthetic quality metrics", async () => {
    const repo = await initRepo()
    try {
      const out = runCli(repo, ["backpressure", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Overall:         unavailable")
      expect(out.stdout).toContain("Evidence State:  insufficient-evidence")
      expect(out.stdout).toContain("Evidence Count:  0/0 usable observations")
      expect(out.stdout).toContain("Reason:          no-history")
      expect(out.stdout).toContain("Goodhart:        unavailable")
      expect(out.stdout).not.toContain("score=1.00")
      expect(out.stdout).not.toContain("slope=0.000")
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("first observation exposes its score but no level or slope", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.82),
      ])

      const out = runCli(repo, ["backpressure", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Overall:         unavailable")
      expect(out.stdout).toContain("Reason:          first-observation")
      expect(out.stdout).toContain(
        "architectural-drift    unavailable score=0.82 observations=1 reason=insufficient-category-history",
      )
      expect(out.stdout).not.toContain("slope=0.000")
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("failed latest observation is operationally unavailable, not red", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92),
        makeEntry(
          "b",
          "2026-04-10T10:00:00.000Z",
          0.99,
          makeReadiness("failed"),
        ),
      ])

      const out = runCli(repo, ["backpressure", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Overall:         unavailable")
      expect(out.stdout).toContain("Evidence State:  failed")
      expect(out.stdout).toContain("Reason:          latest-readiness-failed")
      expect(out.stdout).not.toContain("Overall:         red")
      expect(out.stdout).not.toContain("score=0.99")
      expect(out.stdout).not.toContain("slope=0.000")
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("unknown latest observation is unavailable in human and JSON output", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92),
        makeEntry(
          "b",
          "2026-04-10T10:00:00.000Z",
          0.99,
          makeReadiness("unknown"),
        ),
      ])

      const humanOut = runCli(repo, ["backpressure", "."])
      expect(humanOut.status).toBe(0)
      expect(humanOut.stdout).toContain("Overall:         unavailable")
      expect(humanOut.stdout).toContain(
        "Evidence State:  insufficient-evidence",
      )
      expect(humanOut.stdout).toContain(
        "Reason:          latest-readiness-unknown",
      )
      expect(humanOut.stdout).not.toContain("score=0.99")
      expect(humanOut.stdout).not.toContain("slope=0.000")

      const jsonOut = runCli(repo, ["backpressure", "--json", "."])
      expect(jsonOut.status).toBe(0)
      const json = JSON.parse(jsonOut.stdout) as Record<string, unknown> & {
        categories: Record<string, Record<string, unknown>>
      }
      expect(json).toMatchObject({
        overall: "unavailable",
        evidence_state: "insufficient-evidence",
        evidence_reason: "latest-readiness-unknown",
        observation_count: 2,
        evidence_observation_count: 1,
      })
      expect(json).not.toHaveProperty("goodhart")
      expect(json.categories["architectural-drift"]).not.toHaveProperty(
        "current_score",
      )
      expect(json.categories["architectural-drift"]).not.toHaveProperty(
        "trajectory_slope",
      )
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--json emits deterministic unavailable evidence without numeric placeholders", async () => {
    const repo = await initRepo()
    try {
      const out = runCli(repo, ["backpressure", "--json", "."])

      expect(out.status).toBe(0)
      const json = JSON.parse(out.stdout) as Record<string, unknown> & {
        categories: Record<string, Record<string, unknown>>
      }
      expect(json).toMatchObject({
        backpressure_semantics: "evidence-qualified-v1",
        overall: "unavailable",
        evidence_state: "insufficient-evidence",
        evidence_reason: "no-history",
        observation_count: 0,
        evidence_observation_count: 0,
        trajectory_days: 14,
      })
      expect(json.repo).toBe(await realpath(repo.repoPath))
      expect(json.vector).toMatchObject({
        id: "all-defaults",
        source: "fallback",
        trust_boundary: "built-in-defaults",
      })
      expect(json).not.toHaveProperty("goodhart")
      expect(json).not.toHaveProperty("trend")
      expect(json.categories["architectural-drift"]).toMatchObject({
        level: "unavailable",
        evidence_state: "insufficient-evidence",
        evidence_reason: "no-history",
        observation_count: 0,
      })
      expect(json.categories["architectural-drift"]).not.toHaveProperty(
        "current_score",
      )
      expect(json.categories["architectural-drift"]).not.toHaveProperty(
        "trajectory_slope",
      )
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--json distinguishes first evidence and failed latest state", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.82),
      ])

      const firstOut = runCli(repo, ["backpressure", "--json", "."])
      expect(firstOut.status).toBe(0)
      const firstJson = JSON.parse(firstOut.stdout) as {
        readonly evidence_reason: string
        readonly categories: Record<string, Record<string, unknown>>
      }
      expect(firstJson.evidence_reason).toBe("first-observation")
      expect(firstJson.categories["architectural-drift"]).toMatchObject({
        level: "unavailable",
        current_score: 0.82,
        observation_count: 1,
      })
      expect(firstJson.categories["architectural-drift"]).not.toHaveProperty(
        "trajectory_slope",
      )

      await appendEntries(repo, [
        makeEntry(
          "b",
          "2026-04-10T10:00:00.000Z",
          0.99,
          makeReadiness("failed"),
        ),
      ])
      const failedOut = runCli(repo, ["backpressure", "--json", "."])
      expect(failedOut.status).toBe(0)
      const failedJson = JSON.parse(failedOut.stdout) as Record<string, unknown> & {
        categories: Record<string, Record<string, unknown>>
      }
      expect(failedJson).toMatchObject({
        overall: "unavailable",
        evidence_state: "failed",
        evidence_reason: "latest-readiness-failed",
        observation_count: 2,
        evidence_observation_count: 1,
      })
      expect(failedJson.categories["architectural-drift"]).not.toHaveProperty(
        "current_score",
      )
      expect(failedJson.categories["architectural-drift"]).not.toHaveProperty(
        "trajectory_slope",
      )
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--trend omits weighted metrics from the first unevidenced row", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92),
        makeEntry("b", "2026-04-10T10:00:00.000Z", 0.88),
      ])

      const out = runCli(repo, ["backpressure", "--trend", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Trend:")
      expect(out.stdout).toContain(
        "2026-04-01T10:00:00.000Z a            unavailable evidence=1/1 reason=first-observation",
      )
      expect(out.stdout).not.toContain(
        "2026-04-01T10:00:00.000Z a            unavailable weighted=",
      )
      expect(out.stdout).toContain(
        "2026-04-10T10:00:00.000Z b            green       weighted=0.88 evidence=2/2",
      )
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--trend --json preserves the evidence-qualified row shape", async () => {
    const repo = await initRepo()
    try {
      await appendEntries(repo, [
        makeEntry("a", "2026-04-01T10:00:00.000Z", 0.92),
        makeEntry("b", "2026-04-10T10:00:00.000Z", 0.88),
      ])

      const out = runCli(repo, ["backpressure", "--trend", "--json", "."])

      expect(out.status).toBe(0)
      const json = JSON.parse(out.stdout) as {
        readonly trend: ReadonlyArray<Record<string, unknown>>
      }
      expect(json.trend[0]).toMatchObject({
        overall: "unavailable",
        evidence_state: "insufficient-evidence",
        evidence_reason: "first-observation",
        observation_count: 1,
        evidence_observation_count: 1,
      })
      expect(json.trend[0]).not.toHaveProperty("weighted_mean")
      expect(json.trend[1]).toMatchObject({
        overall: "green",
        evidence_state: "available",
        weighted_mean: 0.88,
        observation_count: 2,
        evidence_observation_count: 2,
      })
    } finally {
      await rm(repo.rootPath, { recursive: true, force: true })
    }
  }, 120_000)
})
