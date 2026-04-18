import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { Effect } from "effect"
import { findCulprits, runBisectCommand, type CommitScore } from "../bisect.js"

const repoRoot = resolve(import.meta.dir, "../../../..")

const headSha = (): string => {
  const out = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf-8",
  })
  return out.stdout.trim()
}

const nthParent = (n: number): string => {
  const out = spawnSync("git", ["rev-parse", `HEAD~${n}`], {
    cwd: repoRoot,
    encoding: "utf-8",
  })
  return out.stdout.trim()
}

const makeCommit = (sha: string, score: number): CommitScore => ({
  sha,
  score,
  diagnosticsCount: 0,
  firstDiagnostic: undefined,
})

describe("findCulprits", () => {
  test("ranks adjacent drops by magnitude and ignores improvements", () => {
    const trajectory = [
      makeCommit("a", 1.0),
      makeCommit("b", 0.4), // drop 0.6
      makeCommit("c", 0.9), // improvement — skip
      makeCommit("d", 0.5), // drop 0.4 from c
    ]
    const out = findCulprits(trajectory, 5)
    expect(out.map((c) => c.sha)).toEqual(["b", "d"])
    expect(out[0]?.drop).toBeCloseTo(0.6)
    expect(out[1]?.drop).toBeCloseTo(0.4)
  })

  test("caps at topN", () => {
    const trajectory = [
      makeCommit("a", 1.0),
      makeCommit("b", 0.9), // drop 0.1
      makeCommit("c", 0.7), // drop 0.2
      makeCommit("d", 0.3), // drop 0.4
    ]
    const out = findCulprits(trajectory, 2)
    expect(out.length).toBe(2)
    expect(out.map((c) => c.sha)).toEqual(["d", "c"])
  })

  test("returns empty when trajectory is flat or ascending", () => {
    const flat = [makeCommit("a", 1.0), makeCommit("b", 1.0), makeCommit("c", 1.0)]
    expect(findCulprits(flat, 3)).toEqual([])
    const ascending = [makeCommit("a", 0.3), makeCommit("b", 0.6), makeCommit("c", 0.9)]
    expect(findCulprits(ascending, 3)).toEqual([])
  })

  test("returns empty when trajectory has 0 or 1 commits", () => {
    expect(findCulprits([], 3)).toEqual([])
    expect(findCulprits([makeCommit("a", 0.5)], 3)).toEqual([])
  })
})

describe("taste bisect (integration)", () => {
  test("replays a 3-commit range and produces a trajectory", async () => {
    const from = nthParent(3)
    const to = headSha()
    expect(from.length).toBe(40)
    expect(to.length).toBe(40)

    const spy = { printed: [] as Array<string> }
    const origLog = console.log
    console.log = (...args: Array<unknown>) => {
      spy.printed.push(args.map(String).join(" "))
    }
    try {
      await Effect.runPromise(
        runBisectCommand({
          signalId: "TS-RP-01",
          fromSha: from,
          toSha: to,
          repoPath: repoRoot,
          concurrency: 2,
          topCulprits: 3,
          json: true,
        }),
      )
    } finally {
      console.log = origLog
    }

    const out = spy.printed.join("\n")
    const parsed = JSON.parse(out)
    expect(parsed.signalId).toBe("TS-RP-01")
    expect(parsed.trajectory.length).toBe(3)
    for (const entry of parsed.trajectory) {
      expect(typeof entry.sha).toBe("string")
      expect(entry.sha.length).toBe(40)
      expect(typeof entry.score).toBe("number")
      expect(entry.score).toBeGreaterThanOrEqual(0)
      expect(entry.score).toBeLessThanOrEqual(1)
    }
    expect(Array.isArray(parsed.culprits)).toBe(true)
    expect(parsed.minScore).toBeLessThanOrEqual(parsed.maxScore)
  }, 60_000)
})
