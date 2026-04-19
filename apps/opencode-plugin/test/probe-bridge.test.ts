import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { maybeHandleProbeSessionOpen } from "../src/server/probe-bridge"

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const initTsRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-probe-bridge-"))
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

const initProbeSession = async (probeHome: string, sessionId: string): Promise<void> => {
  await mkdir(join(probeHome, "sessions", sessionId, "meta"), { recursive: true })
  await writeFile(
    join(probeHome, "sessions", sessionId, "meta", "session-manifest.json"),
    `${JSON.stringify({ sessionId, state: "ready" }, null, 2)}\n`,
    "utf8",
  )
}

describe("probe bridge", () => {
  test("attaches precomputed codec metadata to a Probe session manifest", async () => {
    const repoPath = await initTsRepo()
    const probeHome = await mkdtemp(join(tmpdir(), "taste-probe-home-"))
    try {
      await initProbeSession(probeHome, "ses-123")
      const metadata = await maybeHandleProbeSessionOpen({
        tool: "bash",
        args: { command: "probe session open --json" },
        output: JSON.stringify({ sessionId: "ses-123", state: "ready" }),
        worktree: repoPath,
        vector: undefined,
        probeHome,
      })

      expect(metadata?.supported).toBe(true)
      const manifest = JSON.parse(
        await readFile(
          join(probeHome, "sessions", "ses-123", "meta", "session-manifest.json"),
          "utf8",
        ),
      ) as { extensions?: { tasteCodec?: { supported?: boolean } } }
      expect(manifest.extensions?.tasteCodec?.supported).toBe(true)

      const outputs = await readdir(join(probeHome, "sessions", "ses-123", "outputs"))
      expect(outputs.some((file) => file.includes("taste-codec-snapshot"))).toBe(true)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(probeHome, { recursive: true, force: true })
    }
  }, 120_000)

  test("records an unsupported-language note when the target is outside TS/Rust", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "taste-probe-unsupported-"))
    const probeHome = await mkdtemp(join(tmpdir(), "taste-probe-home-"))
    try {
      sh("git", ["init", "-q", "-b", "main"], repoPath)
      sh("git", ["config", "user.email", "test@test.test"], repoPath)
      sh("git", ["config", "user.name", "test"], repoPath)
      await writeFile(join(repoPath, "README.md"), "# unsupported\n", "utf8")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "initial"], repoPath)
      await initProbeSession(probeHome, "ses-unsupported")

      const metadata = await maybeHandleProbeSessionOpen({
        tool: "bash",
        args: { command: "probe session open --json" },
        output: JSON.stringify({ sessionId: "ses-unsupported", state: "ready" }),
        worktree: repoPath,
        vector: undefined,
        probeHome,
      })
      expect(metadata?.supported).toBe(false)
      expect(metadata?.note).toContain("not supported")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(probeHome, { recursive: true, force: true })
    }
  }, 120_000)
})
