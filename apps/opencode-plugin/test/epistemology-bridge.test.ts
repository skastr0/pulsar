import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { createTimeSeriesServices } from "@taste-codec/core"
import {
  createEpistemologyBridgeState,
  observeEpistemologyBusEvent,
  renderEpistemologyObserverContext,
} from "../src/server/epistemology-bridge"
import { observeCurrentWorktree } from "../src/server/codec-observer"

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-epist-bridge-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  await mkdir(join(repoPath, "src"), { recursive: true })
  await mkdir(join(repoPath, ".opencode"), { recursive: true })
  await mkdir(join(repoPath, ".agents", "messages"), { recursive: true })
  await writeFile(
    join(repoPath, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "ESNext" }, include: ["src/**/*.ts"] }, null, 2),
    "utf8",
  )
  await writeFile(join(repoPath, "src", "index.ts"), "export const value = 1\n", "utf8")
  await writeFile(
    join(repoPath, ".opencode", "policy.toml"),
    `[[rules]]\nid = "no-raw-sql"\n`,
    "utf8",
  )
  await writeFile(
    join(
      repoPath,
      ".agents",
      "messages",
      "2026-04-19T10-00-00-000Z-epistemology-framework-policy-no-raw-sql.json",
    ),
    `${JSON.stringify(
      {
        content: {
          data: {
            rule_id: "no-raw-sql",
            message: "Detected raw SQL in db adapter",
            paths: ["src/index.ts"],
          },
        },
        metadata: {
          timestamp: "2026-04-19T10:00:00.000Z",
          schema_id: "epistemology-framework/policy-violation/v1",
          blocking: true,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

describe("epistemology bridge", () => {
  test("auto-signals flow into the persisted time series", async () => {
    const repoPath = await initRepo()
    try {
      await observeCurrentWorktree({
        worktree: repoPath,
        vector: undefined,
        persistTimeSeries: true,
      })
      const latest = await Effect.runPromise(
        createTimeSeriesServices(repoPath).reader.latest,
      )
      expect(latest._tag).toBe("Some")
      if (latest._tag === "Some") {
        expect(
          latest.value.observerOutput.categories["generated-slop"].signals["EPIST-no-raw-sql"],
        ).toBeDefined()
      }
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("renders an epistemology bridge context block for the system prompt", async () => {
    const repoPath = await initRepo()
    try {
      await observeCurrentWorktree({
        worktree: repoPath,
        vector: undefined,
        persistTimeSeries: true,
      })
      const state = createEpistemologyBridgeState()
      await observeEpistemologyBusEvent({
        event: { type: "tool.execute.after" },
        worktree: repoPath,
        state,
      })
      const rendered = await renderEpistemologyObserverContext({
        worktree: repoPath,
        vector: undefined,
        state,
      })
      expect(rendered).toContain("taste-codec/epistemology-bridge/v1")
      expect(rendered).toContain("no-raw-sql")
      expect(rendered).toContain("Epistemology rule no-raw-sql fired 1 time(s)")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
