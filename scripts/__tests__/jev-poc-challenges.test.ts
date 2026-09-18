import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { TS_PACK_SIGNALS } from "../../packages/ts-pack/src/pack.ts"
import { runSignal } from "../../packages/ts-pack/src/__tests__/test-repo.ts"
import {
  applyPocChallenge,
  copyPocWorkspace,
  listPocChallenges,
  POC_CHALLENGES,
  POC_COPY_EXCLUSIONS,
  POC_PREFERENCES,
  PocAnchorDriftError,
  type PocChallenge,
} from "../jev-poc/challenges.ts"

const REPO = resolve(import.meta.dir, "../..")
const TSC = resolve(REPO, "node_modules/.bin/tsc")

/**
 * The signal and behavioural checks read real Pulsar code through the built
 * package entry points, so they need `packages/core/dist` and
 * `packages/ts-pack/dist`. `bun run test` builds first through turbo; a bare
 * `bun test` on an unbuilt checkout records a skip instead of failing, and the
 * skip is reported by the last test in this file rather than passing silently.
 */
const BUILT = existsSync(resolve(REPO, "packages/core/dist")) && existsSync(resolve(REPO, "packages/ts-pack/dist"))
const skips: string[] = []
const requireBuilt = (label: string): boolean => {
  if (BUILT) return true
  skips.push(label)
  return false
}

const copies: string[] = []
afterAll(() => {
  while (copies.length > 0) {
    const root = copies.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

const workspace = (label: string, challengeId?: string): string => {
  const root = mkdtempSync(join(tmpdir(), `poc-${label}-`))
  copies.push(root)
  copyPocWorkspace(REPO, root)
  if (challengeId !== undefined) applyPocChallenge(root, challengeId)
  return root
}

/**
 * The lines a mutation introduces. Pre-existing lines are discounted by
 * multiset difference, so an edited file's own wording is never mistaken for a
 * fixture hint.
 */
const addedText = (pristine: string, mutated: string): string => {
  const remaining = new Map<string, number>()
  for (const line of pristine.split("\n")) remaining.set(line, (remaining.get(line) ?? 0) + 1)
  const added: string[] = []
  for (const line of mutated.split("\n")) {
    const count = remaining.get(line) ?? 0
    if (count > 0) remaining.set(line, count - 1)
    else added.push(line)
  }
  return added.join("\n")
}

/** SHA256-free content digests of every file a challenge owns. */
const contentsOf = (root: string, challenge: PocChallenge): Record<string, string> => {
  const contents: Record<string, string> = {}
  for (const mutation of challenge.mutations) contents[mutation.path] = readFileSync(join(root, mutation.path), "utf8")
  return contents
}

type CloneGroup = {
  readonly kind: string
  readonly tokenCount: number
  readonly members: ReadonlyArray<{ readonly file: string; readonly name: string }>
}
type ComplexityFunction = {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly complexity: number
}
type SignalOutput = {
  readonly groups?: ReadonlyArray<CloneGroup>
  /** Every function the complexity signal reports, including below-threshold ones. */
  readonly functions?: ReadonlyArray<ComplexityFunction>
  readonly totalFunctions?: number
  readonly complexityThreshold?: number
  readonly overThresholdCount?: number
  readonly oversizedFunctionCount?: number
  readonly ratioPressure?: number
  readonly diagnosticLimit?: number
}

/** Index of the first raw complexity entry matching a name or path fragment. */
const functionIndexOf = (output: SignalOutput, fragment: string): number =>
  (output.functions ?? []).findIndex((entry) => entry.name.includes(fragment) || entry.file.includes(fragment))

/** Index of a raw complexity entry under a descending-complexity ordering. */
const functionRankByComplexity = (output: SignalOutput, fragment: string): number => {
  const ordered = [...(output.functions ?? [])].sort((left, right) => right.complexity - left.complexity)
  return ordered.findIndex((entry) => entry.name.includes(fragment) || entry.file.includes(fragment))
}

const runSignalById = async (root: string, id: string): Promise<SignalOutput> => {
  const signal = TS_PACK_SIGNALS.find(
    (candidate) => candidate.id === id || (candidate as { aliases?: ReadonlyArray<string> }).aliases?.includes(id),
  )
  if (signal === undefined) throw new Error(`unknown signal ${id}`)
  return (await runSignal(root, signal as never, signal.defaultConfig as never)) as SignalOutput
}

const unusedCount = (output: SignalOutput): number =>
  ((output as { exports?: ReadonlyArray<{ classification: string }> }).exports ?? []).filter(
    (entry) => entry.classification === "unused",
  ).length

const groupsTouching = (output: SignalOutput, fragment: string): ReadonlyArray<CloneGroup> =>
  (output.groups ?? []).filter((group) => group.members.some((member) => member.file.includes(fragment)))

const rankOf = (output: SignalOutput, fragment: string): number =>
  (output.groups ?? []).findIndex((group) => group.members.some((member) => member.file.includes(fragment)))

const baselineCache = new Map<string, SignalOutput>()
const baseline = async (id: string): Promise<SignalOutput> => {
  const cached = baselineCache.get(id)
  if (cached !== undefined) return cached
  const output = await runSignalById(REPO, id)
  baselineCache.set(id, output)
  return output
}

const challengeById = (id: string): PocChallenge => {
  const challenge = POC_CHALLENGES.find((candidate) => candidate.id === id)
  if (challenge === undefined) throw new Error(`unknown challenge ${id}`)
  return challenge
}

describe("challenge inventory", () => {
  test("declares the bounded set with opposite preferences and no universal style claim", () => {
    const inventory = listPocChallenges()
    expect(inventory.map((entry) => entry.id)).toEqual([
      "duplicated-rule",
      "unnecessary-abstraction",
      "similar-shape-different-rule",
      "healthy-padding",
      "beyond-top-n",
    ])
    for (const challenge of POC_CHALLENGES) {
      expect(challenge.expectedDirections.length).toBeGreaterThanOrEqual(2)
      for (const direction of challenge.expectedDirections) {
        const preference = POC_PREFERENCES[direction.preference]
        expect(preference).toBeDefined()
        // Every declared direction is paired with an explicitly opposite one,
        // so no fixture asserts that one style is universally good.
        expect(challenge.expectedDirections.some((other) => other.preference === preference.opposite)).toBe(true)
      }
      expect(challenge.detectorReach.evidence.length).toBeGreaterThan(0)
      expect(challenge.behavioralPreservation.length).toBeGreaterThan(0)
      // A padding fixture must never be rewarded: every declared direction is
      // a wash. A discovery fixture may still declare a real regression.
      if (challenge.id === "healthy-padding") {
        expect(challenge.expectedDirections.every((entry) => entry.direction === "unchanged")).toBe(true)
      }
    }
    expect(inventory.filter((entry) => entry.adversarial).map((entry) => entry.id)).toEqual([
      "healthy-padding",
      "beyond-top-n",
    ])
    // Every fixture is a candidate in the outputs the pipeline consumes. A
    // detector miss would be recorded as covered:false, and none is claimed now
    // that the raw complexity function list is inspected.
    expect(inventory.every((entry) => entry.covered)).toBe(true)
    for (const challenge of POC_CHALLENGES) {
      expect(challenge.detectorReach.candidateRanking.length).toBeGreaterThan(0)
    }
    expect(listPocChallenges().every((entry) => !("mutations" in entry))).toBe(true)
  })

  test("challenge shapes match their declared kind and regions", () => {
    const expectedKind: Record<string, PocChallenge["kind"]> = {
      "duplicated-rule": "duplicated-rule",
      "unnecessary-abstraction": "unnecessary-abstraction",
      "similar-shape-different-rule": "similar-shape-different-rule",
      "healthy-padding": "gaming-padding",
      "beyond-top-n": "gaming-beyond-top-n",
    }
    for (const challenge of POC_CHALLENGES) {
      expect(challenge.kind).toBe(expectedKind[challenge.id]!)
      // Non-gaming fixtures must declare the regions the pipeline has to
      // rediscover; pure padding legitimately has none.
      if (!challenge.adversarial || challenge.id === "beyond-top-n") {
        expect(challenge.affectedRegions.length).toBeGreaterThan(0)
      } else {
        expect(challenge.affectedRegions.length).toBe(0)
      }
    }
  })
})

describe("determinism and fail-closed application", () => {
  test("applying a challenge to two copies yields identical bytes", () => {
    const challenge = challengeById("duplicated-rule")
    const first = workspace("det-a", "duplicated-rule")
    const second = workspace("det-b", "duplicated-rule")
    const a = contentsOf(first, challenge)
    const b = contentsOf(second, challenge)
    expect(a).toEqual(b)
    expect(Object.keys(a).length).toBeGreaterThan(0)
  })

  test("a drifted anchor fails closed instead of producing a wrong mutation", () => {
    const root = workspace("drift")
    const path = join(root, "packages/core/src/observer-readiness.ts")
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("hasPoisonAuthority(signal)", "hasPoisonAuthorityOf(signal)"),
    )
    expect(() => applyPocChallenge(root, "duplicated-rule")).toThrow(PocAnchorDriftError)
  })

  test("an existing target for a created module fails closed", () => {
    const root = workspace("exists")
    writeFileSync(join(root, "packages/core/src/evidence-poison.ts"), "// occupied\n")
    expect(() => applyPocChallenge(root, "similar-shape-different-rule")).toThrow(/expects .* to be absent/)
  })

  test("the Pulsar checkout itself is refused", () => {
    expect(() => applyPocChallenge(REPO, "duplicated-rule")).toThrow(/refuses to mutate the Pulsar checkout/)
  })

  test("the copy excludes dependencies and git but keeps built output for tests", () => {
    const root = workspace("copy")
    // Repository history, caches and local research state are never copied.
    for (const excluded of [".git", ".turbo", ".pulsar"]) {
      expect(POC_COPY_EXCLUSIONS).toContain(excluded)
      expect(existsSync(join(root, excluded))).toBe(false)
    }
    // Dependency trees are recreated as symlinks so the copy can run the
    // repository's own compiler and tests without a second install.
    expect(POC_COPY_EXCLUSIONS).toContain("node_modules")
    expect(lstatSync(join(root, "node_modules")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(root, "packages/core/src/enforcement.ts"))).toBe(true)
    expect(lstatSync(join(root, "packages/core/node_modules")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(root, "packages/core/dist"))).toBe(true)
  })
})

describe("verdict-hint hygiene", () => {
  test("mutated source carries no case id, label, preference, direction, or expected outcome", () => {
    const forbidden = [
      ...POC_CHALLENGES.map((challenge) => challenge.id),
      ...Object.keys(POC_PREFERENCES),
      "expected",
      "expectation",
      "fixture",
      "challenge",
      "verdict",
      "golden",
      "poc",
      "should be",
      "case id",
    ]
    for (const challenge of POC_CHALLENGES) {
      const root = workspace(`hygiene-${challenge.id}`, challenge.id)
      for (const mutation of challenge.mutations) {
        const mutated = readFileSync(join(root, mutation.path), "utf8")
        // Only the text the mutation introduces is checked. An edited file
        // keeps its own existing comments, which are not part of the fixture.
        const pristine = mutation.kind === "edit" ? readFileSync(join(REPO, mutation.path), "utf8") : ""
        const haystack = `${mutation.path}\n${addedText(pristine, mutated)}`.toLowerCase()
        for (const token of forbidden) {
          expect(`${challenge.id}|${mutation.path}|${token}|${haystack.includes(token.toLowerCase())}`).toBe(
            `${challenge.id}|${mutation.path}|${token}|false`,
          )
        }
      }
    }
  })
})

describe("detector reach", () => {
  test(
    "duplicated-rule adds a clone group and a below-threshold complexity candidate",
    async () => {
      if (!requireBuilt("duplicated-rule pointers")) return
      const before = await baseline("TS-SL-01")
      const after = await runSignalById(workspace("c1", "duplicated-rule"), "TS-SL-01")
      expect((after.groups ?? []).length).toBe((before.groups ?? []).length + 1)
      const groups = groupsTouching(after, "observer-readiness.ts")
      expect(groups.length).toBe(1)
      expect(groups[0]?.kind).toBe("exact")
      expect(groups[0]?.tokenCount).toBe(29)
      expect(groups[0]?.members.map((member) => member.name).sort()).toEqual([
        "hasPoisonAuthority",
        "localPoisonAuthority",
      ])
      // Beyond the signal's own diagnostic limit, so a top-N pointer budget misses it.
      expect(rankOf(after, "observer-readiness.ts")).toBeGreaterThan(after.diagnosticLimit ?? 0)

      // A second pointer exists in the raw complexity function list. It is below
      // the threshold, so a threshold-only reading would miss it: the risk is
      // ranking and cap, not absence.
      const beforeComplexity = await baseline("TS-LD-01")
      const afterComplexity = await runSignalById(workspace("c1-cx", "duplicated-rule"), "TS-LD-01")
      expect(afterComplexity.totalFunctions).toBe((beforeComplexity.totalFunctions ?? 0) + 1)
      const index = functionIndexOf(afterComplexity, "localPoisonAuthority")
      expect(index).toBeGreaterThanOrEqual(0)
      expect(afterComplexity.functions?.[index]?.complexity).toBe(4)
      expect(afterComplexity.functions?.[index]?.complexity).toBeLessThan(afterComplexity.complexityThreshold ?? 0)
      expect(afterComplexity.overThresholdCount).toBe(beforeComplexity.overThresholdCount)
      expect(functionRankByComplexity(afterComplexity, "localPoisonAuthority")).toBeGreaterThan(100)
    },
    180_000,
  )

  test(
    "unnecessary-abstraction is a candidate pointer but creates no finding",
    async () => {
      if (!requireBuilt("unnecessary-abstraction detector reach")) return
      const beforeClone = await baseline("TS-SL-01")
      const beforeComplexity = await baseline("TS-LD-01")
      const beforeSize = await baseline("TS-LD-02")
      const root = workspace("c2", "unnecessary-abstraction")
      const afterClone = await runSignalById(root, "TS-SL-01")
      const afterComplexity = await runSignalById(root, "TS-LD-01")
      const afterSize = await runSignalById(root, "TS-LD-02")

      // The wrapper IS a candidate: discovery consumes the full function list,
      // not only the above-threshold subset.
      expect(afterComplexity.totalFunctions).toBe((beforeComplexity.totalFunctions ?? 0) + 1)
      const wrapperIndex = functionIndexOf(afterComplexity, "applySeverityCeiling")
      expect(wrapperIndex).toBeGreaterThanOrEqual(0)
      expect(afterComplexity.functions?.[wrapperIndex]?.complexity).toBe(1)
      // A top-100 complexity budget misses it, regardless of repository growth.
      expect(functionRankByComplexity(afterComplexity, "applySeverityCeiling")).toBeGreaterThan(100)

      // It creates no finding anywhere: no clone group, no over-threshold
      // complexity, no size outlier. A re-export facade is not a function.
      expect((afterClone.groups ?? []).length).toBe((beforeClone.groups ?? []).length)
      expect(groupsTouching(afterClone, "enforcement-facade")).toEqual([])
      expect(afterComplexity.overThresholdCount).toBe(beforeComplexity.overThresholdCount)
      expect(afterSize.oversizedFunctionCount).toBe(beforeSize.oversizedFunctionCount)
      // The added low-complexity function lowers both pressure ratios, so a
      // ratio-driven aggregate reads the wrapper as a marginal improvement.
      expect(afterComplexity.ratioPressure ?? 0).toBeLessThan(beforeComplexity.ratioPressure ?? 0)
      expect(afterSize.ratioPressure ?? 0).toBeLessThan(beforeSize.ratioPressure ?? 0)

      // Outside the candidate set: the unused-export signal is the only other
      // detector that reacts, and only because the facade re-exports two names
      // nothing consumes.
      const beforeUnused = await baseline("TS-AB-02")
      const afterUnused = await runSignalById(root, "TS-AB-02")
      expect(unusedCount(afterUnused)).toBe(unusedCount(beforeUnused) + 3)
    },
    180_000,
  )

  test(
    "similar-shape-different-rule raises similarity but sits below the impact floor",
    async () => {
      if (!requireBuilt("similar-shape-different-rule pointers")) return
      const before = await baseline("TS-SL-01")
      const after = await runSignalById(workspace("c3", "similar-shape-different-rule"), "TS-SL-01")
      expect((after.groups ?? []).length).toBe((before.groups ?? []).length + 1)
      const groups = groupsTouching(after, "evidence-poison.ts")
      expect(groups.length).toBe(1)
      expect(groups[0]?.kind).toBe("exact")
      expect(groups[0]?.tokenCount).toBe(17)
      // Below the whole-tree impact floor, so the detector itself charges zero.
      expect(groups[0]?.tokenCount).toBeLessThan(20)
      expect(rankOf(after, "evidence-poison.ts")).toBeGreaterThan(after.diagnosticLimit ?? 0)
      const complexity = await runSignalById(workspace("c3-cx", "similar-shape-different-rule"), "TS-LD-01")
      expect(functionIndexOf(complexity, "evidenceClassAllowsPoison")).toBeGreaterThanOrEqual(0)
    },
    180_000,
  )

  test(
    "healthy-padding adds 48 candidates and no finding while the size pressure improves",
    async () => {
      if (!requireBuilt("healthy-padding pressure movement")) return
      const before = await baseline("TS-SL-01")
      const beforeComplexity = await baseline("TS-LD-01")
      const beforeSize = await baseline("TS-LD-02")
      const root = workspace("g1", "healthy-padding")
      const after = await runSignalById(root, "TS-SL-01")
      const afterComplexity = await runSignalById(root, "TS-LD-01")
      const afterSize = await runSignalById(root, "TS-LD-02")
      expect((after.groups ?? []).length).toBe((before.groups ?? []).length)
      expect(afterSize.oversizedFunctionCount).toBe(beforeSize.oversizedFunctionCount)
      expect(afterSize.ratioPressure ?? 0).toBeLessThan(beforeSize.ratioPressure ?? 0)

      // Padding does add candidates: 48 new low-complexity entries, so the
      // population grows while no finding appears.
      expect(afterComplexity.totalFunctions).toBe((beforeComplexity.totalFunctions ?? 0) + 48)
      const padding = (afterComplexity.functions ?? []).filter((entry) => entry.file.includes("/walkthrough/"))
      expect(padding.length).toBe(48)
      // 24 normalizers at complexity 1 and 24 describers at complexity 2, all
      // far below the threshold, so every added candidate is a low-signal entry.
      expect(padding.filter((entry) => entry.complexity === 1).length).toBe(24)
      expect(padding.filter((entry) => entry.complexity === 2).length).toBe(24)
      expect(padding.every((entry) => entry.complexity < (afterComplexity.complexityThreshold ?? 0))).toBe(true)
      expect(afterComplexity.overThresholdCount).toBe(beforeComplexity.overThresholdCount)
    },
    180_000,
  )

  test(
    "beyond-top-n is present in both candidate outputs and ranks beyond a top-N budget",
    async () => {
      if (!requireBuilt("beyond-top-n rank")) return
      const before = await baseline("TS-SL-01")
      const after = await runSignalById(workspace("g2", "beyond-top-n"), "TS-SL-01")
      expect((after.groups ?? []).length).toBe((before.groups ?? []).length + 1)
      const groups = groupsTouching(after, "file-category-support.ts")
      expect(groups.length).toBe(1)
      expect(groups[0]?.tokenCount).toBe(19)
      const rank = rankOf(after, "file-category-support.ts")
      expect(rank).toBeGreaterThan((after.diagnosticLimit ?? 0) * 10)
      const beforeComplexity = await baseline("TS-LD-01")
      const complexity = await runSignalById(workspace("g2-cx", "beyond-top-n"), "TS-LD-01")
      expect(complexity.totalFunctions).toBe((beforeComplexity.totalFunctions ?? 0) + 2)
      expect(functionIndexOf(complexity, "hasMixedProductionCategory")).toBeGreaterThanOrEqual(0)
    },
    180_000,
  )
})

describe("behavioural preservation", () => {
  const BEHAVIOUR_TESTS = [
    "packages/core/src/__tests__/enforcement.test.ts",
    "packages/core/src/__tests__/observer.test.ts",
  ]

  test(
    "the repository's own tests pass on each semantic mutation",
    () => {
      if (!requireBuilt("behavioural test runs")) return
      for (const id of ["duplicated-rule", "unnecessary-abstraction", "similar-shape-different-rule"]) {
        const root = workspace(`behaviour-${id}`, id)
        const result = Bun.spawnSync({
          cmd: ["bun", "test", ...BEHAVIOUR_TESTS],
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
        })
        const output = `${result.stdout.toString()}${result.stderr.toString()}`
        expect(`${id}|${result.exitCode}|${output.includes(" 0 fail")}`).toBe(`${id}|0|true`)
      }
    },
    600_000,
  )

  test(
    "each mutated file typechecks under the repository's strict flags",
    () => {
      if (!requireBuilt("typechecks")) return
      for (const challenge of POC_CHALLENGES) {
        const root = workspace(`typecheck-${challenge.id}`, challenge.id)
        const files = challenge.behavioralPreservation
          .filter((entry) => entry.kind === "typecheck")
          .map((entry) => entry.target)
        expect(files.length).toBeGreaterThan(0)
        const result = Bun.spawnSync({
          cmd: [
            TSC,
            "--noEmit",
            "--ignoreConfig",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "Bundler",
            "--strict",
            "--exactOptionalPropertyTypes",
            "--noUncheckedIndexedAccess",
            "--skipLibCheck",
            "--types",
            "bun",
            ...files,
          ],
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
        })
        const output = `${result.stdout.toString()}${result.stderr.toString()}`.slice(0, 900)
        expect(`${challenge.id}|${result.exitCode}|${output}`).toBe(`${challenge.id}|0|`)
      }
    },
    600_000,
  )
})

describe("behavioural sensitivity", () => {
  const BEHAVIOUR_TESTS = [
    "packages/core/src/__tests__/enforcement.test.ts",
    "packages/core/src/__tests__/observer.test.ts",
  ]

  test(
    "corrupting each semantic mutation makes the declared tests fail",
    () => {
      if (!requireBuilt("behavioural sensitivity probes")) return
      const probes = POC_CHALLENGES.filter((entry) => entry.sensitivity !== undefined)
      expect(probes.length).toBe(3)
      for (const challenge of probes) {
        const sensitivity = challenge.sensitivity!
        const root = workspace(`sensitivity-${challenge.id}`, challenge.id)
        const path = join(root, sensitivity.path)
        const corrupted = sensitivity.corrupt(readFileSync(path, "utf8"))
        expect(corrupted).not.toBe(readFileSync(path, "utf8"))
        writeFileSync(path, corrupted)
        const result = Bun.spawnSync({ cmd: ["bun", "test", ...BEHAVIOUR_TESTS], cwd: root, stdout: "pipe", stderr: "pipe" })
        const output = `${result.stdout.toString()}${result.stderr.toString()}`
        // A clean copy passes; the corrupted copy must not. This is what makes
        // the preservation claim non-vacuous.
        expect(`${challenge.id}|${result.exitCode}|${output.includes(" 0 fail")}`).toBe(`${challenge.id}|1|false`)
      }
    },
    600_000,
  )
})

describe("build prerequisite", () => {
  test("every declared detector movement names a signal the pipeline can run", () => {
    const known = new Set(TS_PACK_SIGNALS.map((signal) => signal.id))
    for (const challenge of POC_CHALLENGES) {
      for (const evidence of challenge.detectorReach.evidence) {
        expect(known.has(evidence.signalId)).toBe(true)
        expect(evidence.measured.length).toBeGreaterThan(10)
      }
    }
  })

  test("built-output checks either ran or are reported as skipped", () => {
    // This is the anti-silence guard: a skipped detector or behavioural check
    // must be visible, never a passing test that verified nothing.
    if (BUILT) expect(skips).toEqual([])
    else {
      console.warn(`[jev-poc-challenges] SKIPPED ${skips.length} checks: ${skips.join(", ")}`)
      expect(skips.length).toBeGreaterThan(0)
    }
  })
})
