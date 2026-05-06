import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { CATEGORIES, createTimeSeriesServices } from "@taste-codec/core"
import { Effect, Exit } from "effect"
import {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  countFinalApplicableSignalsByCategory,
  findCulprits,
  findDriftCulprits,
  findFirstCrossing,
  initialAdaptiveIndexes,
  resolveSamplingPlan,
  runBisectCommand,
  selectMergeOnlyIndexes,
  type CommitScore,
} from "../bisect.js"
import { buildCodecRegistry } from "../runtime.js"

const repoRoot = resolve(import.meta.dir, "../../../..")

const activeRegistrySignalIds = async (): Promise<ReadonlyArray<string>> => {
  const registry = await Effect.runPromise(buildCodecRegistry(repoRoot))
  return registry.sorted.map((signal) => signal.id)
}

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

const capturePrintedOutput = async (
  effect: Effect.Effect<void, unknown, never>,
): Promise<string> => {
  const spy = { printed: [] as Array<string> }
  const origLog = console.log
  console.log = (...args: Array<unknown>) => {
    spy.printed.push(args.map(String).join(" "))
  }
  try {
    await Effect.runPromise(effect)
  } finally {
    console.log = origLog
  }
  return spy.printed.join("\n")
}

const withTempVectorFile = async <A>(
  contents: Record<string, unknown>,
  run: (vectorPath: string) => Promise<A>,
): Promise<A> => {
  const dir = await mkdtemp(join(tmpdir(), "taste-bisect-vector-"))
  const vectorPath = join(dir, "vector.json")
  await writeFile(vectorPath, JSON.stringify(contents, null, 2), "utf8")
  try {
    return await run(vectorPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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

describe("findDriftCulprits", () => {
  test("matches the step culprit when a regression never recovers", () => {
    const trajectory = [makeCommit("a", 1.0), makeCommit("b", 0.5), makeCommit("c", 0.5)]
    const out = findDriftCulprits(trajectory, 5)
    expect(out.map((culprit) => culprit.sha)).toEqual(["b"])
    expect(out[0]?.drop).toBeCloseTo(1.0)
  })

  test("surfaces gradual drift even when no single drop dominates", () => {
    const trajectory = [
      makeCommit("a", 1.0),
      makeCommit("b", 0.92),
      makeCommit("c", 0.88),
      makeCommit("d", 0.84),
    ]
    const out = findDriftCulprits(trajectory, 5)
    expect(out.map((culprit) => culprit.sha)).toEqual(["d", "c", "b"])
    expect(out[0]?.drop).toBeGreaterThan(out[1]?.drop ?? 0)
  })

  test("drops recovered segments once the running max is reached again", () => {
    const trajectory = [
      makeCommit("a", 1.0),
      makeCommit("b", 0.6),
      makeCommit("c", 1.0),
      makeCommit("d", 0.8),
    ]
    const out = findDriftCulprits(trajectory, 5)
    expect(out.map((culprit) => culprit.sha)).toEqual(["d"])
  })
})

describe("findFirstCrossing", () => {
  test("returns the first point matching a threshold query", () => {
    const out = findFirstCrossing(
      [makeCommit("a", 0.9), makeCommit("b", 0.6), makeCommit("c", 0.4)],
      { target: "TS-LD-02", op: "<", threshold: 0.5 },
    )
    expect(out?.sha).toBe("c")
    expect(out?.previousSha).toBe("b")
    expect(out?.score).toBe(0.4)
  })
})

describe("bisect sampling helpers", () => {
  test("auto keeps full scoring for small ranges and switches to adaptive for large ones", () => {
    const small = Array.from({ length: 50 }, (_, index) => ({
      sha: `small-${index}`,
      parentCount: 1,
    }))
    const large = Array.from({ length: 800 }, (_, index) => ({
      sha: `large-${index}`,
      parentCount: 1,
    }))

    expect(resolveSamplingPlan(small, "auto").applied).toBe("full")
    expect(resolveSamplingPlan(large, "auto").applied).toBe("adaptive-delta")
  })

  test("auto uses full scoring when first-crossing must be exact", () => {
    const large = Array.from({ length: 800 }, (_, index) => ({
      sha: `large-${index}`,
      parentCount: 1,
    }))

    const plan = resolveSamplingPlan(large, "auto", { hasFirstCrossing: true })
    expect(plan.applied).toBe("full")
    expect(plan.diagnostics).toEqual([
      "auto sampling chose full because first-crossing queries require exact commit order",
    ])
  })

  test("explicit adaptive sampling keeps first-crossing approximate and says so", () => {
    const commits = Array.from({ length: 800 }, (_, index) => ({
      sha: `large-${index}`,
      parentCount: 1,
    }))

    const plan = resolveSamplingPlan(commits, "adaptive-delta", { hasFirstCrossing: true })
    expect(plan.applied).toBe("adaptive-delta")
    expect(plan.diagnostics).toContain(
      "first-crossing under adaptive-delta sampling is approximate; rerun with --sample full for exact crossing",
    )
  })

  test("merge-only includes endpoints plus merge commits", () => {
    const commits = [
      { sha: "a", parentCount: 1 },
      { sha: "b", parentCount: 2 },
      { sha: "c", parentCount: 1 },
      { sha: "d", parentCount: 3 },
      { sha: "e", parentCount: 1 },
    ]
    expect(selectMergeOnlyIndexes(commits)).toEqual([0, 1, 3, 4])
  })

  test("adaptive helpers spread initial samples and refine wide or steep intervals", () => {
    expect(initialAdaptiveIndexes(5)).toEqual([0, 1, 2, 3, 4])
    expect(initialAdaptiveIndexes(100)[0]).toBe(0)
    expect(initialAdaptiveIndexes(100).at(-1)).toBe(99)
    expect(chooseAdaptiveMidpoint(0, 80, 0.9, 0.9)).toBe(40)
    expect(chooseAdaptiveMidpoint(0, 10, 1.0, 0.85)).toBe(5)
    expect(chooseAdaptiveMidpoint(0, 10, 1.0, 0.97)).toBeUndefined()
  })

  test("observer adaptive refinement responds to readiness drops independently", () => {
    expect(
      chooseObserverAdaptiveMidpoint(
        0,
        10,
        { weightedMean: 0.8, readinessScore: 1 },
        { weightedMean: 0.82, readinessScore: 0.9 },
      ),
    ).toBe(5)
    expect(
      chooseObserverAdaptiveMidpoint(
        0,
        10,
        { weightedMean: 0.8, readinessScore: 1 },
        { weightedMean: 0.82, readinessScore: 0.97 },
      ),
    ).toBeUndefined()
  })
})

describe("observer bisect report helpers", () => {
  test("HEAD category applicable signal counts use the final commit", () => {
    const finalEntry = {
      sha: "abc",
      weightedMean: 0.9,
      readinessScore: 0.9,
      readinessPressure: 0.1,
      readinessStatus: "green",
      categories: Object.fromEntries(CATEGORIES.map((category) => [category, 1])) as Record<
        (typeof CATEGORIES)[number],
        number
      >,
      categorySignalCounts: Object.fromEntries(
        CATEGORIES.map((category) => [category, category === "generated-slop" ? 2 : 0]),
      ) as Record<(typeof CATEGORIES)[number], number>,
      categoryApplicableSignalCounts: Object.fromEntries(
        CATEGORIES.map((category) => [category, category === "generated-slop" ? 1 : 0]),
      ) as Record<(typeof CATEGORIES)[number], number>,
      applicableSignalCount: 1,
      signals: {
        "TS-LIVE": 0.9,
      },
      minimum: undefined,
      hardGateStatus: "pass",
      hardGateViolationCount: 0,
    } as const

    expect(
      countFinalApplicableSignalsByCategory(
        finalEntry,
        "generated-slop",
      ),
    ).toBe(1)
  })
})

describe("taste bisect (integration)", () => {
  test("replays a 3-commit range and produces a trajectory", async () => {
    const from = nthParent(3)
    const to = headSha()
    expect(from.length).toBe(40)
    expect(to.length).toBe(40)

    const out = await capturePrintedOutput(
      runBisectCommand({
        signalId: "TS-RP-01",
        fromSha: from,
        toSha: to,
        repoPath: repoRoot,
        concurrency: 2,
        topCulprits: 3,
        sampling: "full",
        json: true,
      }),
    )

    const parsed = JSON.parse(out)
    expect(parsed.schemaVersion).toBe("signal-bisect/v2")
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
    expect(Array.isArray(parsed.driftCulprits)).toBe(true)
    expect(parsed.sampling.applied).toBe("full")
    expect(parsed.minScore).toBeLessThanOrEqual(parsed.maxScore)
  }, 60_000)

  test("replays a 5-commit range in observer mode with per-category trajectories", async () => {
    const from = nthParent(5)
    const to = headSha()

    const out = await capturePrintedOutput(
      runBisectCommand({
        observer: true,
        fromSha: from,
        toSha: to,
        repoPath: repoRoot,
        concurrency: 2,
        topCulprits: 3,
        sampling: "full",
        json: true,
      }),
    )

    const parsed = JSON.parse(out)
    const entries = await Effect.runPromise(
      createTimeSeriesServices(repoRoot).reader.entries(),
    )
    expect(parsed.vectorName).toBeNull()
    expect(parsed.schemaVersion).toBe("observer-bisect/v2")
    expect(parsed.trajectory.length).toBe(5)
    expect(parsed.commits.length).toBe(5)
    expect(parsed.curves.weightedMean.length).toBe(5)
    expect(parsed.curves.readiness.length).toBe(5)
    expect(entries.length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(parsed.perCategory).sort()).toEqual([...CATEGORIES].sort())
    expect(Object.keys(parsed.perCategoryCulprits).sort()).toEqual([...CATEGORIES].sort())
    expect(Object.keys(parsed.perCategoryDriftCulprits).sort()).toEqual([...CATEGORIES].sort())
    expect(Array.isArray(parsed.weightedMeanDriftCulprits)).toBe(true)
    expect(Array.isArray(parsed.readinessCulprits)).toBe(true)
    expect(Array.isArray(parsed.readinessDriftCulprits)).toBe(true)
    expect(parsed.sampling.applied).toBe("full")
    expect(typeof parsed.finalWeightedMean).toBe("number")
    expect(parsed.minWeightedMean).toBeLessThanOrEqual(parsed.maxWeightedMean)
    expect(typeof parsed.finalReadinessScore).toBe("number")
    expect(typeof parsed.finalApplicableSignalCount).toBe("number")
    expect(parsed.finalApplicableSignalCount).toBeGreaterThan(0)
    expect(parsed.minReadinessScore).toBeLessThanOrEqual(parsed.maxReadinessScore)
    expect(["pass", "fail"]).toContain(parsed.hardGateStatusAtFinal)
    expect(Object.keys(parsed.signalCategories).length).toBeGreaterThan(0)
    expect(Object.keys(parsed.perSignal).sort()).toEqual(
      Object.keys(parsed.signalCategories).sort(),
    )
    expect(Object.keys(parsed.perSignalCulprits).sort()).toEqual(
      Object.keys(parsed.signalCategories).sort(),
    )
    expect(Object.keys(parsed.perSignalDriftCulprits).sort()).toEqual(
      Object.keys(parsed.signalCategories).sort(),
    )

    for (const entry of parsed.trajectory) {
      expect(typeof entry.sha).toBe("string")
      expect(entry.sha.length).toBe(40)
      expect(typeof entry.weightedMean).toBe("number")
      expect(typeof entry.readinessScore).toBe("number")
      expect(typeof entry.readinessPressure).toBe("number")
      expect(["green", "yellow", "red", "blocked", "unknown"]).toContain(entry.readinessStatus)
      expect(Object.keys(entry.categories).sort()).toEqual([...CATEGORIES].sort())
      expect(Object.keys(entry.categorySignalCounts).sort()).toEqual([...CATEGORIES].sort())
      expect(Object.keys(entry.categoryApplicableSignalCounts).sort()).toEqual(
        [...CATEGORIES].sort(),
      )
      expect(typeof entry.applicableSignalCount).toBe("number")
      expect(entry.applicableSignalCount).toBeGreaterThan(0)
      expect(entry.observer).toBeUndefined()
      expect(typeof entry.signals).toBe("object")
      expect(Object.keys(entry.signals).length).toBeGreaterThan(0)
      for (const [signalId, score] of Object.entries(entry.signals)) {
        expect(parsed.signalCategories[signalId]).toBeDefined()
        expect(typeof score).toBe("number")
        expect(score as number).toBeGreaterThanOrEqual(0)
        expect(score as number).toBeLessThanOrEqual(1)
      }
      expect(typeof entry.hardGateViolationCount).toBe("number")
      expect(["pass", "fail"]).toContain(entry.hardGateStatus)
    }

    for (const category of CATEGORIES) {
      expect(parsed.perCategory[category].scores.length).toBe(parsed.trajectory.length)
      expect(Array.isArray(parsed.perCategoryCulprits[category])).toBe(true)
    }
    for (const signalId of Object.keys(parsed.signalCategories)) {
      expect(parsed.perSignal[signalId].scores.length).toBe(parsed.trajectory.length)
      expect(parsed.perSignal[signalId].category).toBe(parsed.signalCategories[signalId])
    }
  }, 120_000)

  test("supports first-crossing queries and selected signal/category scope", async () => {
    const from = nthParent(3)
    const to = headSha()

    const out = await capturePrintedOutput(
      runBisectCommand({
        observer: true,
        selectedSignals: ["TS-LD-02"],
        selectedCategories: ["legibility-decay"],
        firstCrossing: { target: "TS-LD-02", op: "<=", threshold: 1 },
        fromSha: from,
        toSha: to,
        repoPath: repoRoot,
        concurrency: 2,
        topCulprits: 2,
        sampling: "full",
        json: true,
      }),
    )

    const parsed = JSON.parse(out)
    expect(parsed.firstCrossing?.target).toBe("TS-LD-02")
    expect(parsed.firstCrossing?.sha.length).toBe(40)
    expect(Object.keys(parsed.curves.signals)).toEqual(["TS-LD-02"])
    expect(Object.keys(parsed.signalCategories)).toEqual(["TS-LD-02"])
    expect(Object.keys(parsed.curves.categories)).toEqual(["legibility-decay"])
    expect(Object.keys(parsed.trajectory[0].signals)).toEqual(["TS-LD-02"])
    expect(Object.keys(parsed.trajectory[0].categories)).toEqual(["legibility-decay"])
    expect(parsed.curves.signals["TS-LD-02"]).toEqual(
      parsed.trajectory.map((entry: { signals: Record<string, number> }) => entry.signals["TS-LD-02"]),
    )
    expect(parsed.curves.categories["legibility-decay"]).toEqual(
      parsed.trajectory.map(
        (entry: { categories: Record<string, number> }) => entry.categories["legibility-decay"],
      ),
    )
    expect(parsed.firstCrossing?.sha).toBe(parsed.trajectory[0].sha)
    expect(parsed.firstCrossing?.previousSha).toBeUndefined()
    expect(parsed.firstCrossing?.score).toBe(parsed.curves.signals["TS-LD-02"][0])
  }, 120_000)

  test("threads an optional vector through observer mode", async () => {
    const from = nthParent(1)
    const to = headSha()

    const out = await withTempVectorFile(
      {
        id: "observer-test-vector",
        domain: "typescript",
        signal_overrides: {
          "TS-AB-01": { active: false },
        },
      },
      async (vectorPath) =>
        capturePrintedOutput(
          runBisectCommand({
            observer: true,
            vectorPath,
            fromSha: from,
            toSha: to,
            repoPath: repoRoot,
            concurrency: 1,
            topCulprits: 1,
            sampling: "full",
            json: true,
          }),
        ),
    )

    const parsed = JSON.parse(out)
    expect(parsed.vectorName).toBe("observer-test-vector")
    expect(parsed.trajectory).toHaveLength(1)
    expect(parsed.signalCategories["TS-AB-01"]).toBeUndefined()
    expect(parsed.trajectory[0].signals["TS-AB-01"]).toBeUndefined()
    expect(parsed.signalCategories["TS-AB-03"]).toBe("abstraction-bloat")
    expect(parsed.signalCategories["TS-AB-05"]).toBe("abstraction-bloat")
    expect(parsed.trajectory[0].signals["TS-AB-03"]).toBeDefined()
    expect(parsed.trajectory[0].signals["TS-AB-05"]).toBeDefined()
    expect(parsed.trajectory[0].categories["abstraction-bloat"]).toBeGreaterThan(0)
    expect(parsed.trajectory[0].categories["abstraction-bloat"]).toBeLessThanOrEqual(1)
  }, 60_000)

  test("fails loud when the vector references an unknown signal id", async () => {
    const from = nthParent(1)
    const to = headSha()

    const exit = await withTempVectorFile(
      {
        id: "bad-vector",
        domain: "typescript",
        signal_overrides: {
          "DOES-NOT-EXIST": { active: true },
        },
      },
      (vectorPath) =>
        Effect.runPromiseExit(
          runBisectCommand({
            observer: true,
            vectorPath,
            fromSha: from,
            toSha: to,
            repoPath: repoRoot,
            concurrency: 1,
            topCulprits: 1,
            sampling: "full",
            json: true,
          }),
        ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect((err as { _tag?: string } | null)?._tag).toBe("UnknownSignalIdError")
    }
  }, 60_000)

  test("fails loud when observer mode has no active signals", async () => {
    const from = nthParent(1)
    const to = headSha()
    const signalIds = await activeRegistrySignalIds()

    const exit = await withTempVectorFile(
      {
        id: "inactive-vector",
        domain: "typescript",
        signal_overrides: Object.fromEntries(signalIds.map((id) => [id, { active: false }])),
      },
      (vectorPath) =>
        Effect.runPromiseExit(
          runBisectCommand({
            observer: true,
            vectorPath,
            fromSha: from,
            toSha: to,
            repoPath: repoRoot,
            concurrency: 1,
            topCulprits: 1,
            sampling: "full",
            json: true,
          }),
        ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : null
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain("Observer mode has no active signals")
    }
  }, 60_000)
})
