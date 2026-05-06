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

const writeRepoFile = async (repoPath: string, relPath: string, content: string): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-elicit-cli-"))
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

describe("taste elicit", () => {
  test("bootstrap writes a pending revealed-preference proposal from synthetic git history", async () => {
    const repoPath = await initRepo()
    const homePath = await mkdtemp(join(tmpdir(), "taste-elicit-home-"))
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
      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/math.ts",
        "export const sum = (a: number, b: number, c = 0) => {\n  if (a > 0) {\n    if (b > 0) {\n      if (c > 0) {\n        return a + b + c\n      }\n    }\n  }\n  return a + b + c\n}\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "expand branching in math helper"], repoPath)

      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "cleanup branching in math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/suppress.ts",
        "// @ts-ignore\nexport const risky: string = 42 as never\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add suppression example"], repoPath)
      sh("git", ["revert", "--no-edit", "HEAD"], repoPath)

      const out = runCli(
        repoPath,
        [
          "elicit",
          "bootstrap",
          "--commits",
          "6",
          "--preset",
          "ai-slop-defense",
          ".",
        ],
        { HOME: homePath },
      )

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Revealed-preference bootstrap")
      expect(out.stdout).toContain("Base vector:     organization-default")
      expect(out.stdout).toContain(
        "Vector Source:   organization fallback ~/.config/taste-codec/vector.json",
      )
      expect(out.stdout).toContain("accepted")
      expect(out.stdout).toContain("revised")
      expect(out.stdout).toContain("reverted")

      const pendingDir = join(repoPath, ".taste-codec", "proposals", "pending")
      const files = await (await import("node:fs/promises")).readdir(pendingDir)
      const proposalPath = join(pendingDir, files.find((entry) => entry.includes("proposal-revealed-"))!)
      const proposal = JSON.parse(await readFile(proposalPath, "utf8"))
      expect(proposal.source).toBe("revealed-preference")
      expect(proposal.confidence).toBeGreaterThan(0)
      expect(Array.isArray(proposal.deltas)).toBe(true)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("bootstrap labels built-in defaults when no vector or preset is used", async () => {
    const repoPath = await initRepo()
    const homePath = await mkdtemp(join(tmpdir(), "taste-elicit-home-"))
    try {
      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/math.ts",
        "export const sum = (a: number, b: number, c = 0) => {\n  if (a > 0) {\n    if (b > 0) {\n      if (c > 0) {\n        return a + b + c\n      }\n    }\n  }\n  return a + b + c\n}\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "expand branching in math helper"], repoPath)

      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "cleanup branching in math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/suppress.ts",
        "// @ts-ignore\nexport const risky: string = 42 as never\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add suppression example"], repoPath)
      sh("git", ["revert", "--no-edit", "HEAD"], repoPath)

      const out = runCli(repoPath, ["elicit", "bootstrap", "--commits", "6", "."], {
        HOME: homePath,
      })

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Base vector:     all-defaults")
      expect(out.stdout).toContain("Vector Source:   built-in defaults")
      expect(out.stdout).not.toContain("preset fallback")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("bootstrap labels preset fallback when a preset supplies the base vector", async () => {
    const repoPath = await initRepo()
    const homePath = await mkdtemp(join(tmpdir(), "taste-elicit-home-"))
    try {
      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/math.ts",
        "export const sum = (a: number, b: number, c = 0) => {\n  if (a > 0) {\n    if (b > 0) {\n      if (c > 0) {\n        return a + b + c\n      }\n    }\n  }\n  return a + b + c\n}\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "expand branching in math helper"], repoPath)

      await writeRepoFile(repoPath, "src/math.ts", "export const sum = (a: number, b: number) => a + b\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "cleanup branching in math helper"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/suppress.ts",
        "// @ts-ignore\nexport const risky: string = 42 as never\n",
      )
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "add suppression example"], repoPath)
      sh("git", ["revert", "--no-edit", "HEAD"], repoPath)

      const out = runCli(
        repoPath,
        [
          "elicit",
          "bootstrap",
          "--commits",
          "6",
          "--preset",
          "ai-slop-defense",
          ".",
        ],
        { HOME: homePath },
      )

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Base vector:     ai-slop-defense")
      expect(out.stdout).toContain("Vector Source:   preset fallback")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("review, accept, and reject commands manage pending proposals deterministically", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(
        repoPath,
        ".taste-codec/proposals/pending/proposal-passive.json",
        JSON.stringify(
          {
            schema_version: 1,
            id: "proposal-passive",
            source: "passive-extraction",
            domain: "typescript",
            created_at: "2026-04-19T00:00:00.000Z",
            status: "pending-confirmation",
            confidence: 1,
            summary: "Observed edit flow strengthened TS-SL-03",
            changed_files: ["src/index.ts"],
            evidence: [{ kind: "score-delta", summary: "TS-SL-03 improved from 0.40 to 0.90" }],
            deltas: [
              {
                signal_id: "TS-SL-03",
                previous_score: 0.4,
                current_score: 0.9,
                previous_weight: 1,
                proposed_weight: 1.25,
                rationale: "Recent cleanup strengthened suppression hygiene.",
              },
            ],
            mode_deltas: [],
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        ".taste-codec/proposals/pending/proposal-ai-assisted-mode.json",
        JSON.stringify(
          {
            schema_version: 1,
            id: "proposal-ai-assisted-mode",
            source: "ai-assisted-detection",
            domain: "typescript",
            created_at: "2026-04-19T00:00:00.000Z",
            status: "pending-confirmation",
            confidence: 0.95,
            summary: "Detected agent-mediated editing; keep AI-assisted thresholds explicit instead of hidden.",
            changed_files: ["src/index.ts"],
            evidence: [{ kind: "observation", summary: "Observed edit tool activity." }],
            deltas: [],
            mode_deltas: [
              {
                mode: "ai_assisted",
                previous: false,
                proposed: true,
                rationale: "Agent edit tools were active.",
              },
            ],
          },
          null,
          2,
        ),
      )

      const review = runCli(repoPath, ["elicit", "review", "."])
      expect(review.status).toBe(0)
      expect(review.stdout).toContain("proposal-passive")
      expect(review.stdout).toContain("proposal-ai-assisted-mode")
      expect(review.stdout).toContain("The codec does not silently enable AI-assisted mode")

      const accept = runCli(repoPath, ["elicit", "accept", "proposal-passive", "."])
      expect(accept.status).toBe(0)
      expect(accept.stdout).toContain("Accepted proposal: proposal-passive")
      expect(accept.stdout).toContain("Weight deltas:")

      const vector = JSON.parse(await readFile(join(repoPath, ".taste-codec/vector.json"), "utf8"))
      expect(vector.signal_overrides["TS-SL-03"].weight).toBe(1.25)
      expect(vector.provenance.at(-1).source).toBe("passive-extraction")

      const reject = runCli(repoPath, ["elicit", "reject", "proposal-ai-assisted-mode", "."])
      expect(reject.status).toBe(0)
      expect(reject.stdout).toContain("Rejected proposal: proposal-ai-assisted-mode")
      expect(reject.stdout).toContain("will not silently tighten thresholds")

      const acceptedProposal = await readFile(
        join(repoPath, ".taste-codec/proposals/accepted/proposal-passive.json"),
        "utf8",
      )
      const rejectedProposal = await readFile(
        join(repoPath, ".taste-codec/proposals/rejected/proposal-ai-assisted-mode.json"),
        "utf8",
      )
      expect(JSON.parse(acceptedProposal).status).toBe("accepted")
      expect(JSON.parse(rejectedProposal).status).toBe("rejected")

      const finalReview = runCli(repoPath, ["elicit", "review", "."])
      expect(finalReview.status).toBe(0)
      expect(finalReview.stdout).toContain("No pending elicitation proposals")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
