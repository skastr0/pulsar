import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { existsSync, lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Schema } from "effect"
import {
  CalibrationContextTag,
  activateProjectModule,
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "../calibration.js"
import { buildRegistry } from "../registry.js"
import {
  OBSERVER_AGGREGATION_CACHE_VERSION,
  ScoringEngineLayer,
  ScoringEngineTag,
  computeConfigHash,
  computeObserverConfigHash,
  collectWorktreeChangedHunks,
} from "../scoring-engine.js"
import {
  computeContentHash,
  computeGitRevisionContextHash,
  computeWorktreeContentHash,
} from "../scoring-engine-git-content-hash.js"
import { ReferenceDataTag, SignalContextTag } from "../context.js"
import type { Glossary } from "../glossary.js"
import type { Signal } from "../signal.js"
import type { PulsarVector } from "../vector.js"

/**
 * Initialize a tiny git repo with one commit containing `files`.
 * Returns the repo path and the HEAD SHA. Caller is responsible for
 * cleaning up via rm(repoPath, { recursive: true, force: true }).
 */
const initRepo = async (
  files: ReadonlyArray<{ path: string; content: string }>,
): Promise<{ repoPath: string; sha: string }> => {
  const repoPath = await mkdtemp(join(tmpdir(), "pulsar-test-repo-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  sh("git", ["config", "commit.gpgsign", "false"], repoPath)
  for (const f of files) {
    const full = join(repoPath, f.path)
    await mkdir(join(full, ".."), { recursive: true })
    await writeFile(full, f.content)
  }
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  const headOut = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
    encoding: "utf8",
  })
  return { repoPath, sha: headOut.stdout.trim() }
}

/**
 * Append a new commit that rewrites `path` with `content`. Returns the
 * new HEAD SHA.
 */
const addCommit = (
  repoPath: string,
  path: string,
  content: string,
  message: string,
): string => {
  const full = join(repoPath, path)
  require("node:fs").writeFileSync(full, content)
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", message], repoPath)
  const headOut = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
    encoding: "utf8",
  })
  return headOut.stdout.trim()
}

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    )
  }
}

/**
 * Build a counter-backed mock signal. Each compute invocation bumps the
 * counter so cache hit/miss is observable.
 */
const makeCountingSignal = (
  counter: Ref.Ref<number>,
  id = "MOCK-ENG-01",
): Signal<{}, { readonly n: number }, never> => ({
  id,
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      yield* Ref.update(counter, (n) => n + 1)
      const n = yield* Ref.get(counter)
      return { n }
    }),
  score: (out) => 1 - out.n * 0.01,
  diagnose: () => [],
})

const makeFileContentSignal = (): Signal<
  {},
  { readonly content: string },
  SignalContextTag
> => ({
  id: "MOCK-FILE-CONTENT",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const content = require("node:fs").readFileSync(
        join(context.worktreePath, "a.ts"),
        "utf8",
      ) as string
      return { content }
    }),
  score: (out) => (out.content.includes("999") ? 0.42 : 1),
  diagnose: () => [],
})

const makeCalibrationFingerprintSignal = (): Signal<
  {},
  { readonly fingerprint: string },
  CalibrationContextTag
> => ({
  id: "MOCK-CALIBRATION-FINGERPRINT",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const calibration = yield* CalibrationContextTag
      return { fingerprint: calibration.fingerprint }
    }),
  score: () => 1,
  diagnose: () => [],
})

const makeReferenceDataSignal = (): Signal<
  {},
  { readonly glossaryTerms: number },
  ReferenceDataTag
> => ({
  id: "MOCK-REFERENCE-DATA",
  tier: 2,
  category: "architectural-drift",
  kind: "structural",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const referenceData = yield* ReferenceDataTag
      const glossary = yield* referenceData.require<Glossary>(
        "MOCK-REFERENCE-DATA",
        "glossary",
      )
      return { glossaryTerms: glossary.terms.length }
    }),
  score: (out) => (out.glossaryTerms > 0 ? 1 : 0.5),
  diagnose: () => [],
})

const glossaryJson = (terms: Glossary["terms"]): string =>
  `${JSON.stringify(
    {
      schema_version: 1,
      extracted_at_sha: "abc123",
      confirmed_at: "2026-05-10T00:00:00.000Z",
      terms,
      rejected_terms: [],
    },
    null,
    2,
  )}\n`

const mockRepoFacts = (fingerprint: string): RepoFacts => ({
  repoRoot: "/repo",
  fingerprint,
  detectedTechnologies: ["typescript"],
  sourceExtensions: [".ts"],
})

const makeChangedHunksSignal = (): Signal<
  {},
  { readonly count: number; readonly files: ReadonlyArray<string> },
  SignalContextTag
> => ({
  id: "MOCK-HUNKS",
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      return {
        count: context.changedHunks.length,
        files: context.changedHunks.map((hunk) => hunk.file),
      }
    }),
  score: (out) => (out.count > 0 ? 0.5 : 1),
  diagnose: () => [],
})

describe("ScoringEngine — content hash", () => {
  test("hash is stable across repeat invocations for the same SHA", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "b.ts", content: "export const y = 2\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const h1 = yield* computeContentHash(repoPath, sha)
        const h2 = yield* computeContentHash(repoPath, sha)
        return { h1, h2 }
      })
      const { h1, h2 } = await Effect.runPromise(program)
      expect(h1).toBe(h2)
      expect(h1).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("hash changes when a .ts file changes", async () => {
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const sha2 = addCommit(repoPath, "a.ts", "export const x = 999\n", "change")
      const program = Effect.gen(function* () {
        const h1 = yield* computeContentHash(repoPath, sha1)
        const h2 = yield* computeContentHash(repoPath, sha2)
        return { h1, h2 }
      })
      const { h1, h2 } = await Effect.runPromise(program)
      expect(h1).not.toBe(h2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("hash ignores non-TypeScript files", async () => {
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# hi\n" },
    ])
    try {
      // Change only README — .ts content untouched.
      const sha2 = addCommit(repoPath, "README.md", "# bye\n", "docs")
      const program = Effect.gen(function* () {
        const h1 = yield* computeContentHash(repoPath, sha1)
        const h2 = yield* computeContentHash(repoPath, sha2)
        return { h1, h2 }
      })
      const { h1, h2 } = await Effect.runPromise(program)
      expect(h1).toBe(h2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("hash changes when package metadata changes", async () => {
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "package.json", content: "{\"dependencies\":{}}\n" },
    ])
    try {
      const sha2 = addCommit(
        repoPath,
        "package.json",
        "{\"dependencies\":{\"left-pad\":\"1.3.0\"}}\n",
        "deps",
      )
      const program = Effect.gen(function* () {
        const h1 = yield* computeContentHash(repoPath, sha1)
        const h2 = yield* computeContentHash(repoPath, sha2)
        return { h1, h2 }
      })
      const { h1, h2 } = await Effect.runPromise(program)
      expect(h1).not.toBe(h2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("worktree hash changes for uncommitted tracked and untracked pulsar files", async () => {
    const { repoPath } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const clean = await Effect.runPromise(computeWorktreeContentHash(repoPath))
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")
      const trackedDirty = await Effect.runPromise(computeWorktreeContentHash(repoPath))
      await writeFile(join(repoPath, "new.ts"), "export const y = 3\n")
      const untrackedDirty = await Effect.runPromise(computeWorktreeContentHash(repoPath))

      expect(trackedDirty).not.toBe(clean)
      expect(untrackedDirty).not.toBe(trackedDirty)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("git revision context hash changes when branch upstream changes", async () => {
    const { repoPath, sha: baseSha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const featureSha = addCommit(repoPath, "a.ts", "export const x = 2\n", "feature")
      sh("git", ["branch", "upstream-one", baseSha], repoPath)
      sh("git", ["checkout", "-q", "-b", "upstream-two", baseSha], repoPath)
      addCommit(repoPath, "README.md", "# upstream two\n", "upstream two")

      sh("git", ["checkout", "-q", "-B", "feature-one", featureSha], repoPath)
      sh("git", ["branch", "--set-upstream-to", "upstream-one"], repoPath)
      const first = await Effect.runPromise(computeGitRevisionContextHash(repoPath))

      sh("git", ["checkout", "-q", "-B", "feature-two", featureSha], repoPath)
      sh("git", ["branch", "--set-upstream-to", "upstream-two"], repoPath)
      const second = await Effect.runPromise(computeGitRevisionContextHash(repoPath))

      expect(first).not.toBe(second)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("collects changed hunks for dirty tracked and untracked worktree files", async () => {
    const { repoPath } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")
      await writeFile(join(repoPath, "new.ts"), "export const y = 3\n")

      const hunks = await Effect.runPromise(collectWorktreeChangedHunks(repoPath))

      expect(hunks.map((hunk) => hunk.file).sort()).toEqual(["a.ts", "new.ts"])
      expect(hunks.find((hunk) => hunk.file === "a.ts")).toMatchObject({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
      })
      expect(hunks.find((hunk) => hunk.file === "new.ts")).toMatchObject({
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })
})

describe("ScoringEngine — cache semantics", () => {
  test("repeat scoreCommit with same (sha, signal) hits cache; compute runs once", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const r1 = yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-01")
        const c1 = yield* Ref.get(counter)
        const r2 = yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-01")
        const c2 = yield* Ref.get(counter)

        return { r1, r2, c1, c2 }
      })
      const { r1, r2, c1, c2 } = await Effect.runPromise(program)
      expect(c1).toBe(1)
      expect(c2).toBe(1) // second call hit cache — counter did not advance
      expect(r1.score).toBe(r2.score)
      expect((r1.output as { n: number }).n).toBe(
        (r2.output as { n: number }).n,
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("scoreCommit disk cache invalidates when calibration fingerprint changes", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-score-cache-"))
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const calibrationA = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("score-cache-calibration-a"),
        })
        const calibrationB = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("score-cache-calibration-b"),
        })
        const runWithCalibration = (calibrationContext: typeof calibrationA) =>
          Effect.gen(function* () {
            const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
              cacheConfig: { cacheDir },
              calibrationContext,
            })
            const engine = yield* ScoringEngineTag.pipe(
              Effect.provide(EngineLayer),
            ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
            return yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-01")
          })

        const first = yield* runWithCalibration(calibrationA)
        const afterFirst = yield* Ref.get(counter)
        const sameCalibration = yield* runWithCalibration(calibrationA)
        const afterSameCalibration = yield* Ref.get(counter)
        const changedCalibration = yield* runWithCalibration(calibrationB)
        const afterChangedCalibration = yield* Ref.get(counter)

        return {
          first,
          sameCalibration,
          changedCalibration,
          afterFirst,
          afterSameCalibration,
          afterChangedCalibration,
        }
      })

      const result = await Effect.runPromise(program)
      expect(result.afterFirst).toBe(1)
      expect(result.afterSameCalibration).toBe(1)
      expect(result.afterChangedCalibration).toBe(2)
      expect((result.first.output as { n: number }).n).toBe(1)
      expect((result.sameCalibration.output as { n: number }).n).toBe(1)
      expect((result.changedCalibration.output as { n: number }).n).toBe(2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("observeCommit disk cache invalidates when calibration fingerprint changes", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-observer-cache-"))
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const calibrationA = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("observer-cache-calibration-a"),
        })
        const calibrationB = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("observer-cache-calibration-b"),
        })
        const runWithCalibration = (calibrationContext: typeof calibrationA) =>
          Effect.gen(function* () {
            const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
              cacheConfig: { cacheDir },
              calibrationContext,
            })
            const engine = yield* ScoringEngineTag.pipe(
              Effect.provide(EngineLayer),
            ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
            return yield* engine.observeCommit(repoPath, sha)
          })

        const first = yield* runWithCalibration(calibrationA)
        const afterFirst = yield* Ref.get(counter)
        const sameCalibration = yield* runWithCalibration(calibrationA)
        const afterSameCalibration = yield* Ref.get(counter)
        const changedCalibration = yield* runWithCalibration(calibrationB)
        const afterChangedCalibration = yield* Ref.get(counter)

        return {
          first,
          sameCalibration,
          changedCalibration,
          afterFirst,
          afterSameCalibration,
          afterChangedCalibration,
        }
      })

      const result = await Effect.runPromise(program)
      expect(result.afterFirst).toBe(1)
      expect(result.afterSameCalibration).toBe(1)
      expect(result.afterChangedCalibration).toBe(2)
      expect(result.first.signalResults.get("MOCK-ENG-01")?.output).toEqual({ n: 1 })
      expect(result.sameCalibration.signalResults.get("MOCK-ENG-01")?.output).toEqual({ n: 1 })
      expect(result.changedCalibration.signalResults.get("MOCK-ENG-01")?.output).toEqual({ n: 2 })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("observeWorktree provides changed hunks to dirty worktree signals", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")
      await writeFile(join(repoPath, "new.ts"), "export const y = 3\n")

      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([makeChangedHunksSignal()])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        return yield* engine.observeWorktree(repoPath, sha)
      })

      const output = await Effect.runPromise(program)
      const result = output.signalResults.get("MOCK-HUNKS")
      expect(result?.output).toEqual({
        count: 2,
        files: ["a.ts", "new.ts"],
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeWorktree can use caller-provided changed hunks", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")

      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([makeChangedHunksSignal()])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        return yield* engine.observeWorktree(repoPath, sha, {
          changedHunks: [
            { file: "manual.ts", oldStart: 1, oldLines: 0, newStart: 4, newLines: 2 },
          ],
        })
      })

      const output = await Effect.runPromise(program)
      expect(output.signalResults.get("MOCK-HUNKS")?.output).toEqual({
        count: 1,
        files: ["manual.ts"],
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("different signals on the same sha miss each other's cache entries", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signalA = makeCountingSignal(counter)
        const signalB: Signal<{}, { readonly n: number }, never> = {
          ...signalA,
          id: "MOCK-ENG-02",
        }
        const registry = yield* buildRegistry([signalA, signalB])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-01")
        yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-02")
        return yield* Ref.get(counter)
      })
      const count = await Effect.runPromise(program)
      // Both signals ran — same content hash but different signal ids.
      expect(count).toBe(2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("compound config hash includes input signal semantics and policy", async () => {
    const LeafConfig = Schema.Struct({
      threshold: Schema.Number,
    })
    type LeafConfig = typeof LeafConfig.Type

    const leaf: Signal<LeafConfig, { readonly n: number }, never> = {
      id: "MOCK-COMPOSITE-LEAF",
      tier: 1,
      category: "review-pain",
      kind: "legibility",
      configSchema: LeafConfig,
      defaultConfig: { threshold: 1 },
      inputs: [],
      compute: (config) => Effect.succeed({ n: config.threshold }),
      score: () => 1,
      diagnose: () => [],
    }
    const compound: Signal<{}, { readonly total: number }, never> = {
      id: "MOCK-COMPOSITE",
      tier: 1.5,
      category: "review-pain",
      kind: "compound",
      configSchema: Schema.Struct({}),
      defaultConfig: {},
      inputs: [{ id: leaf.id }],
      compute: (_config, inputs) => {
        const out = inputs.get(leaf.id) as { readonly n: number } | undefined
        return Effect.succeed({ total: out?.n ?? 0 })
      },
      score: () => 1,
      diagnose: () => [],
    }
    const compositePolicyChangedCompound: Signal<
      {},
      { readonly total: number },
      never
    > = {
      ...compound,
      inputs: [{ id: leaf.id, cacheFingerprint: "composite-input-policy-v2" }],
    }

    const versionedLeaf: Signal<LeafConfig, { readonly n: number }, never> = {
      ...leaf,
      cacheVersion: "leaf-v2",
    }
    const factorDefinedLeaf: Signal<LeafConfig, { readonly n: number }, never> = {
      ...leaf,
      factorDefinitions: [
        {
          path: "score.weight",
          title: "Score weight",
          valueKind: "number",
          scoreRole: "weight",
          defaultValue: 1,
        },
      ],
    }

    const registry = await Effect.runPromise(buildRegistry([compound, leaf]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([compound, versionedLeaf]),
    )
    const factorDefinedRegistry = await Effect.runPromise(
      buildRegistry([compound, factorDefinedLeaf]),
    )
    const compositePolicyChangedRegistry = await Effect.runPromise(
      buildRegistry([compositePolicyChangedCompound, leaf]),
    )
    const base = computeConfigHash(compound.id, registry, undefined)
    const inputVersionChanged = computeConfigHash(
      compound.id,
      versionedRegistry,
      undefined,
    )
    const inputFactorDefinitionChanged = computeConfigHash(
      compound.id,
      factorDefinedRegistry,
      undefined,
    )
    const compositePolicyChanged = computeConfigHash(
      compound.id,
      compositePolicyChangedRegistry,
      undefined,
    )
    const inputConfigChanged = computeConfigHash(compound.id, registry, {
      id: "test",
      domain: "test",
      signal_overrides: {
        [leaf.id]: { config: { threshold: 2 } },
      },
    } satisfies PulsarVector)
    const inputPolicyChanged = computeConfigHash(compound.id, registry, {
      id: "test",
      domain: "test",
      signal_overrides: {
        [leaf.id]: { factors: { "score.weight": 0.5 } },
      },
    } satisfies PulsarVector)

    expect(inputVersionChanged).not.toBe(base)
    expect(inputFactorDefinitionChanged).not.toBe(base)
    expect(compositePolicyChanged).not.toBe(base)
    expect(inputConfigChanged).not.toBe(base)
    expect(inputPolicyChanged).not.toBe(base)
    expect(inputPolicyChanged).not.toBe(inputConfigChanged)
  })

  test("scoreRange: each distinct content-hash runs compute once, shared cache serves repeats", async () => {
    // Build a repo with three commits: sha1, sha2 (changes code), sha3
    // (changes only a non-.ts file — content hash equals sha2's because
    // the .ts tree is unchanged).
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# one\n" },
    ])
    try {
      const sha2 = addCommit(repoPath, "a.ts", "export const x = 42\n", "code")
      const sha3 = addCommit(repoPath, "README.md", "# three\n", "docs")

      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const results = yield* engine.scoreRange(
          repoPath,
          sha1,
          sha3,
          "MOCK-ENG-01",
          { concurrency: 1 },
        )
        const count = yield* Ref.get(counter)
        return { results, count }
      })

      const { results, count } = await Effect.runPromise(program)
      // Range is (sha1, sha3] → sha2 and sha3 are scored.
      expect(results.length).toBe(2)
      expect(results.map((r) => r.sha)).toEqual([sha2, sha3])
      // sha2 and sha3 share a content hash (same .ts trees) so compute
      // fires exactly once.
      expect(count).toBe(1)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("scoreRange: git revision cache dependency does not reuse identical source trees", async () => {
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# one\n" },
    ])
    try {
      const sha2 = addCommit(repoPath, "a.ts", "export const x = 42\n", "code")
      const sha3 = addCommit(repoPath, "README.md", "# three\n", "docs")

      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal: Signal<{}, { readonly n: number }, never> = {
          ...makeCountingSignal(counter),
          cacheDependencies: ["git-revision-context"],
        }
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const results = yield* engine.scoreRange(
          repoPath,
          sha1,
          sha3,
          "MOCK-ENG-01",
          { concurrency: 1 },
        )
        const count = yield* Ref.get(counter)
        return { results, count }
      })

      const { results, count } = await Effect.runPromise(program)
      expect(results.map((r) => r.sha)).toEqual([sha2, sha3])
      expect(count).toBe(2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("scoreRange: compound cache propagates input git revision dependencies", async () => {
    const { repoPath, sha: sha1 } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: "README.md", content: "# one\n" },
    ])
    try {
      const sha2 = addCommit(repoPath, "a.ts", "export const x = 42\n", "code")
      const sha3 = addCommit(repoPath, "README.md", "# three\n", "docs")

      const program = Effect.gen(function* () {
        const makeCompoundSignal = (
          leaf: Signal<{}, { readonly n: number }, never>,
          counter: Ref.Ref<number>,
          id: string,
        ): Signal<{}, { readonly total: number }, never> => ({
          id,
          tier: 1.5,
          category: "review-pain",
          kind: "compound",
          configSchema: Schema.Struct({}),
          defaultConfig: {},
          inputs: [{ id: leaf.id }],
          compute: (_config, inputs) =>
            Effect.gen(function* () {
              yield* Ref.update(counter, (n) => n + 1)
              const out = inputs.get(leaf.id) as
                | { readonly n: number }
                | undefined
              return { total: out?.n ?? 0 }
            }),
          score: () => 1,
          diagnose: () => [],
        })

        const controlLeafCounter = yield* Ref.make(0)
        const controlCompoundCounter = yield* Ref.make(0)
        const controlLeaf = makeCountingSignal(
          controlLeafCounter,
          "MOCK-CONTENT-LEAF",
        )
        const controlCompound = makeCompoundSignal(
          controlLeaf,
          controlCompoundCounter,
          "MOCK-CONTENT-COMPOSITE",
        )

        const revisionLeafCounter = yield* Ref.make(0)
        const revisionCompoundCounter = yield* Ref.make(0)
        const revisionLeaf: Signal<{}, { readonly n: number }, never> = {
          ...makeCountingSignal(revisionLeafCounter, "MOCK-REVISION-LEAF"),
          cacheDependencies: ["git-revision-context"],
        }
        const revisionCompound = makeCompoundSignal(
          revisionLeaf,
          revisionCompoundCounter,
          "MOCK-REVISION-COMPOSITE",
        )
        const registry = yield* buildRegistry([
          controlCompound,
          controlLeaf,
          revisionCompound,
          revisionLeaf,
        ])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const controlResults = yield* engine.scoreRange(
          repoPath,
          sha1,
          sha3,
          "MOCK-CONTENT-COMPOSITE",
          { concurrency: 1 },
        )
        const revisionResults = yield* engine.scoreRange(
          repoPath,
          sha1,
          sha3,
          "MOCK-REVISION-COMPOSITE",
          { concurrency: 1 },
        )
        const controlLeafCount = yield* Ref.get(controlLeafCounter)
        const controlCompoundCount = yield* Ref.get(controlCompoundCounter)
        const revisionLeafCount = yield* Ref.get(revisionLeafCounter)
        const revisionCompoundCount = yield* Ref.get(revisionCompoundCounter)
        return {
          controlResults,
          revisionResults,
          controlLeafCount,
          controlCompoundCount,
          revisionLeafCount,
          revisionCompoundCount,
        }
      })

      const {
        controlResults,
        revisionResults,
        controlLeafCount,
        controlCompoundCount,
        revisionLeafCount,
        revisionCompoundCount,
      } = await Effect.runPromise(program)
      expect(controlResults.map((r) => r.sha)).toEqual([sha2, sha3])
      expect(revisionResults.map((r) => r.sha)).toEqual([sha2, sha3])
      expect(controlLeafCount).toBe(1)
      expect(controlCompoundCount).toBe(1)
      expect(revisionLeafCount).toBe(2)
      expect(revisionCompoundCount).toBe(2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("scoreCommit cleans up the worktree on scope exit", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    const { existsSync } = await import("node:fs")
    const { readdirSync } = await import("node:fs")
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.scoreCommit(repoPath, sha, "MOCK-ENG-01")
      })
      await Effect.runPromise(program)
      // No leftover worktree directories with our prefix in tmpdir.
      const lingering = readdirSync(tmpdir()).filter(
        (name) =>
          name.startsWith(`pulsar-worktree-${sha.slice(0, 12)}-`) &&
          existsSync(join(tmpdir(), name)),
      )
      expect(lingering.length).toBe(0)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("repeat observeCommit with same sha hits observer cache; compute runs once", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const r1 = yield* engine.observeCommit(repoPath, sha)
        const c1 = yield* Ref.get(counter)
        const r2 = yield* engine.observeCommit(repoPath, sha)
        const c2 = yield* Ref.get(counter)

        return { r1, r2, c1, c2 }
      })
      const { r1, r2, c1, c2 } = await Effect.runPromise(program)
      expect(c1).toBe(1)
      expect(c2).toBe(1)
      expect(r1.weighted_mean).toBe(r2.weighted_mean)
      expect(r2.signalResults.get("MOCK-ENG-01")?.score).toBe(
        r1.signalResults.get("MOCK-ENG-01")?.score,
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeCommit uses the current checkout for clean HEAD", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const worktreePaths: Array<string> = []
        const EngineLayer = ScoringEngineLayer(registry, (worktreePath) => {
          worktreePaths.push(worktreePath)
          return Layer.empty
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.observeCommit(repoPath, sha)
        return worktreePaths
      })

      const paths = await Effect.runPromise(program)
      expect(paths).toEqual([repoPath])
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeCommit falls back to a detached worktree when tracked TS files are dirty", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const worktreePaths: Array<string> = []
        const EngineLayer = ScoringEngineLayer(registry, (worktreePath) => {
          worktreePaths.push(worktreePath)
          return Layer.empty
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.observeCommit(repoPath, sha)
        return worktreePaths
      })

      const paths = await Effect.runPromise(program)
      expect(paths.length).toBe(1)
      expect(paths[0]).not.toBe(repoPath)
      expect(paths[0]).toContain("pulsar-worktree-")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeCommit links dependency directories into detached worktrees", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await mkdir(join(repoPath, "packages", "app", "node_modules"), { recursive: true })
      await writeFile(
        join(repoPath, "packages", "app", "node_modules", "sentinel.txt"),
        "dependency",
      )
      await writeFile(join(repoPath, "a.ts"), "export const x = 2\n")
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const dependencyLinks: Array<boolean> = []
        const EngineLayer = ScoringEngineLayer(registry, (worktreePath) => {
          const dependencyPath = join(worktreePath, "packages", "app", "node_modules")
          dependencyLinks.push(
            existsSync(dependencyPath) && lstatSync(dependencyPath).isSymbolicLink(),
          )
          return Layer.empty
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.observeCommit(repoPath, sha)
        return dependencyLinks
      })

      await expect(Effect.runPromise(program)).resolves.toEqual([true])
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeCommit falls back to a detached worktree when untracked TS files exist", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "new.ts"), "export const y = 2\n")
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const worktreePaths: Array<string> = []
        const EngineLayer = ScoringEngineLayer(registry, (worktreePath) => {
          worktreePaths.push(worktreePath)
          return Layer.empty
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.observeCommit(repoPath, sha)
        return worktreePaths
      })

      const paths = await Effect.runPromise(program)
      expect(paths.length).toBe(1)
      expect(paths[0]).not.toBe(repoPath)
      expect(paths[0]).toContain("pulsar-worktree-")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeWorktree scores dirty tracked files from the current checkout", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 999\n")
      const program = Effect.gen(function* () {
        const signal = makeFileContentSignal()
        const registry = yield* buildRegistry([signal])
        const worktreePaths: Array<string> = []
        const EngineLayer = ScoringEngineLayer(registry, (worktreePath) => {
          worktreePaths.push(worktreePath)
          return Layer.empty
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const result = yield* engine.observeWorktree(repoPath, sha)
        return { result, worktreePaths }
      })

      const { result, worktreePaths } = await Effect.runPromise(program)
      expect(worktreePaths).toEqual([repoPath])
      expect(result.signalResults.get("MOCK-FILE-CONTENT")?.score).toBe(0.42)
      expect(
        (result.signalResults.get("MOCK-FILE-CONTENT")?.output as { content: string }).content,
      ).toContain("999")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("repeat observeWorktree hits cache until dirty content changes", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 999\n")
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* engine.observeWorktree(repoPath, sha)
        const afterFirst = yield* Ref.get(counter)
        yield* engine.observeWorktree(repoPath, sha)
        const afterSecond = yield* Ref.get(counter)
        yield* Effect.promise(() => writeFile(join(repoPath, "a.ts"), "export const x = 1000\n"))
        yield* engine.observeWorktree(repoPath, sha)
        const afterChange = yield* Ref.get(counter)

        return { afterFirst, afterSecond, afterChange }
      })

      const counts = await Effect.runPromise(program)
      expect(counts.afterFirst).toBe(1)
      expect(counts.afterSecond).toBe(1)
      expect(counts.afterChange).toBe(2)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("observeWorktree refreshes factory calibration for a mutable worktree path", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      await writeFile(join(repoPath, "a.ts"), "export const x = 999\n")
      const program = Effect.gen(function* () {
        const resolverCalls = yield* Ref.make(0)
        const registry = yield* buildRegistry([makeCalibrationFingerprintSignal()])
        const calibrationA = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("worktree-calibration-a"),
        })
        const calibrationB = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("worktree-calibration-b"),
        })
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
          calibrationContextForWorktree: () =>
            Effect.gen(function* () {
              const call = yield* Ref.updateAndGet(resolverCalls, (n) => n + 1)
              return call === 1 ? calibrationA : calibrationB
            }),
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const first = yield* engine.observeWorktree(repoPath, sha)
        const second = yield* engine.observeWorktree(repoPath, sha)
        const calls = yield* Ref.get(resolverCalls)
        return { first, second, calls, calibrationA, calibrationB }
      })

      const result = await Effect.runPromise(program)
      expect(result.calls).toBe(2)
      expect(result.first.signalResults.get("MOCK-CALIBRATION-FINGERPRINT")?.output).toEqual({
        fingerprint: result.calibrationA.fingerprint,
      })
      expect(result.second.signalResults.get("MOCK-CALIBRATION-FINGERPRINT")?.output).toEqual({
        fingerprint: result.calibrationB.fingerprint,
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("observeWorktree cache invalidates when canonical reference data changes", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
      { path: ".pulsar/glossary.json", content: glossaryJson([]) },
    ])
    try {
      const program = Effect.gen(function* () {
        const signal = makeReferenceDataSignal()
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty)
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        const first = yield* engine.observeWorktree(repoPath, sha)
        const second = yield* engine.observeWorktree(repoPath, sha)
        yield* Effect.promise(() =>
          writeFile(
            join(repoPath, ".pulsar", "glossary.json"),
            glossaryJson([
              {
                canonical: "Pulsar",
                aliases: [],
                frequency: 1,
                provenance: [
                  {
                    package: "@skastr0/pulsar-core",
                    file: "a.ts",
                    identifier: "Pulsar",
                    identifier_kind: "const",
                  },
                ],
              },
            ]),
          ),
        )
        const afterReferenceChange = yield* engine.observeWorktree(repoPath, sha)

        return { first, second, afterReferenceChange }
      })

      const { first, second, afterReferenceChange } = await Effect.runPromise(program)
      expect(first.signalResults.get("MOCK-REFERENCE-DATA")?.score).toBe(0.5)
      expect(second.signalResults.get("MOCK-REFERENCE-DATA")?.score).toBe(0.5)
      expect(afterReferenceChange.signalResults.get("MOCK-REFERENCE-DATA")?.score).toBe(1)
      expect(afterReferenceChange.signalResults.get("MOCK-REFERENCE-DATA")?.output).toEqual({
        glossaryTerms: 1,
      })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("observer profile includes environment setup attribution", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const EngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
          observerProfile: true,
        })
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        return yield* engine.observeWorktree(repoPath, sha)
      })

      const result = await Effect.runPromise(program)
      expect(result.runtimeProfile?.totalMs).toBeGreaterThanOrEqual(0)
      expect(result.runtimeProfile?.stages?.["environment-setup"]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(result.runtimeProfile?.stages?.observer?.durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observer profile bypasses warm observer cache", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])

        const ProfileEngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
          observerProfile: true,
        })
        const profileEngine = yield* ScoringEngineTag.pipe(
          Effect.provide(ProfileEngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>

        yield* profileEngine.observeWorktree(repoPath, sha)
        const afterFirstProfile = yield* Ref.get(counter)
        const profiled = yield* profileEngine.observeWorktree(repoPath, sha)
        const afterSecondProfile = yield* Ref.get(counter)

        return { afterFirstProfile, afterSecondProfile, profiled }
      })

      const { afterFirstProfile, afterSecondProfile, profiled } = await Effect.runPromise(program)
      expect(afterFirstProfile).toBe(1)
      expect(afterSecondProfile).toBe(2)
      expect(profiled.runtimeProfile?.signals["MOCK-ENG-01"]?.durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observeCommit disk cache round-trips signalResults as a Map", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-observer-cache-"))
    try {
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const signal = makeCountingSignal(counter)
        const registry = yield* buildRegistry([signal])
        const calibrationContext = makeResolvedCalibrationContext({
          repoFacts: mockRepoFacts("observer-cache-calibration-v1"),
          activeModules: [
            activateProjectModule({
              id: "repo.module",
              version: "1.0.0",
              scope: "repository",
              source: "repo-local",
              sourceRef: ".pulsar/modules/local.mjs",
              sourceFingerprint: "sha256:local",
              contributions: [],
            }),
          ],
        })

        const FirstEngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
          cacheConfig: { cacheDir },
          calibrationContext,
        })
        const first = yield* ScoringEngineTag.pipe(
          Effect.provide(FirstEngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
        yield* first.observeCommit(repoPath, sha)

        const SecondEngineLayer = ScoringEngineLayer(registry, () => Layer.empty, undefined, {
          cacheConfig: { cacheDir },
          calibrationContext,
        })
        const second = yield* ScoringEngineTag.pipe(
          Effect.provide(SecondEngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
        const cached = yield* second.observeCommit(repoPath, sha)

        return { cached, count: yield* Ref.get(counter) }
      })

      const { cached, count } = await Effect.runPromise(program)
      expect(count).toBe(1)
      expect(cached.signalResults).toBeInstanceOf(Map)
      expect(cached.signalResults.get("MOCK-ENG-01")?.output).toEqual({ n: 1 })
      expect(cached.calibration?.fingerprint).toBeDefined()
      expect(cached.calibration?.active_modules[0]?.id).toBe("repo.module")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("observer cache config hash changes with active vector config", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0)
      const signal = makeCountingSignal(counter)
      const registry = yield* buildRegistry([signal])
      const base = computeObserverConfigHash(registry, undefined)
      const configured = computeObserverConfigHash(registry, {
        id: "strict",
        domain: "typescript",
        signal_overrides: {
          "MOCK-ENG-01": { config: { target: 0.8 } },
        },
      } satisfies PulsarVector)
      const inactive = computeObserverConfigHash(registry, {
        id: "inactive",
        domain: "typescript",
        signal_overrides: {
          "MOCK-ENG-01": { active: false },
        },
      } satisfies PulsarVector)
      const weighted = computeObserverConfigHash(registry, {
        id: "weighted",
        domain: "typescript",
        signal_overrides: {
          "MOCK-ENG-01": { weight: 1.5 },
        },
      } satisfies PulsarVector)
      const readinessConfigured = computeObserverConfigHash(registry, {
        id: "readiness-configured",
        domain: "typescript",
        signal_overrides: {},
        observer: {
          diffTimeIntegration: true,
          readiness: {
            p_norm: 8,
            local_warning_threshold: 0.4,
            local_poison_threshold: 0.75,
            local_warning_gain: 0.75,
            hard_gate_score_cap: 0.2,
            green_max_pressure: 0.15,
            red_min_pressure: 0.4,
            top_pressures: 10,
          },
        },
      } satisfies PulsarVector)
      return { base, configured, inactive, weighted, readinessConfigured }
    })

    const { base, configured, inactive, weighted, readinessConfigured } =
      await Effect.runPromise(program)
    expect(configured).not.toBe(base)
    expect(inactive).not.toBe(base)
    expect(weighted).not.toBe(base)
    expect(readinessConfigured).not.toBe(base)
  })

  test("observer cache config hash changes when poison thresholds move", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0)
      const signal = makeCountingSignal(counter)
      const registry = yield* buildRegistry([signal])
      const base = computeObserverConfigHash(registry, undefined)
      const poisonTuned = computeObserverConfigHash(registry, {
        id: "poison-tuned",
        domain: "typescript",
        signal_overrides: {},
        observer: {
          diffTimeIntegration: true,
          readiness: {
            p_norm: 4,
            local_warning_threshold: 0.4,
            local_poison_threshold: 0.8,
            local_warning_gain: 0.75,
            hard_gate_score_cap: 0.2,
            green_max_pressure: 0.15,
            red_min_pressure: 0.4,
            top_pressures: 10,
          },
        },
      } satisfies PulsarVector)
      return { base, poisonTuned }
    })

    const { base, poisonTuned } = await Effect.runPromise(program)
    expect(poisonTuned).not.toBe(base)
  })

  test("aggregation cache version is pinned so semantic changes force a conscious bump", () => {
    // If this fails you changed aggregation semantics: bump the version
    // (and this pin) so stale observer outputs cannot be served.
    expect(OBSERVER_AGGREGATION_CACHE_VERSION).toBe(
      "observer-aggregation-v6-poison-ramp-authority",
    )
  })

  test("cache config hashes include calibration fingerprint only when supplied", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0)
      const signal = makeCountingSignal(counter)
      const registry = yield* buildRegistry([signal])
      const signalBase = computeConfigHash("MOCK-ENG-01", registry, undefined)
      const signalExplicitUndefined = computeConfigHash(
        "MOCK-ENG-01",
        registry,
        undefined,
        undefined,
      )
      const signalCalibrationA = computeConfigHash(
        "MOCK-ENG-01",
        registry,
        undefined,
        "calibration-a",
      )
      const signalCalibrationB = computeConfigHash(
        "MOCK-ENG-01",
        registry,
        undefined,
        "calibration-b",
      )
      const observerBase = computeObserverConfigHash(registry, undefined)
      const observerExplicitUndefined = computeObserverConfigHash(
        registry,
        undefined,
        undefined,
      )
      const observerCalibrationA = computeObserverConfigHash(
        registry,
        undefined,
        "calibration-a",
      )
      const observerCalibrationB = computeObserverConfigHash(
        registry,
        undefined,
        "calibration-b",
      )
      const observerReferenceA = computeObserverConfigHash(
        registry,
        undefined,
        undefined,
        "reference-a",
      )
      const observerReferenceB = computeObserverConfigHash(
        registry,
        undefined,
        undefined,
        "reference-b",
      )
      return {
        signalBase,
        signalExplicitUndefined,
        signalCalibrationA,
        signalCalibrationB,
        observerBase,
        observerExplicitUndefined,
        observerCalibrationA,
        observerCalibrationB,
        observerReferenceA,
        observerReferenceB,
      }
    })

    const result = await Effect.runPromise(program)
    expect(result.signalExplicitUndefined).toBe(result.signalBase)
    expect(result.signalCalibrationA).not.toBe(result.signalBase)
    expect(result.signalCalibrationA).not.toBe(result.signalCalibrationB)
    expect(result.observerExplicitUndefined).toBe(result.observerBase)
    expect(result.observerCalibrationA).not.toBe(result.observerBase)
    expect(result.observerCalibrationA).not.toBe(result.observerCalibrationB)
    expect(result.observerReferenceA).not.toBe(result.observerBase)
    expect(result.observerReferenceA).not.toBe(result.observerReferenceB)
  })

  test("scoreCommit provides calibration context to signals when supplied", async () => {
    const { repoPath, sha } = await initRepo([
      { path: "a.ts", content: "export const x = 1\n" },
    ])
    try {
      const calibrationContext = makeResolvedCalibrationContext({
        repoFacts: mockRepoFacts("calibration-runtime-v1"),
      })
      const program = Effect.gen(function* () {
        const registry = yield* buildRegistry([makeCalibrationFingerprintSignal()])
        const EngineLayer = ScoringEngineLayer(
          registry,
          () => Layer.empty,
          undefined,
          { calibrationContext },
        )
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(EngineLayer),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
        return yield* engine.scoreCommit(
          repoPath,
          sha,
          "MOCK-CALIBRATION-FINGERPRINT",
        )
      })

      const result = await Effect.runPromise(program)
      expect(result.output).toEqual({ fingerprint: calibrationContext.fingerprint })
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("observer and signal cache config hashes change with signal cache version", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0)
      const baseSignal = makeCountingSignal(counter)
      const versionedSignal = {
        ...baseSignal,
        cacheVersion: "mock-signal-v2",
      } satisfies Signal<{}, { readonly n: number }, never>
      const baseRegistry = yield* buildRegistry([baseSignal])
      const versionedRegistry = yield* buildRegistry([versionedSignal])

      return {
        observerBase: computeObserverConfigHash(baseRegistry, undefined),
        observerVersioned: computeObserverConfigHash(versionedRegistry, undefined),
        signalBase: computeConfigHash("MOCK-ENG-01", baseRegistry, undefined),
        signalVersioned: computeConfigHash("MOCK-ENG-01", versionedRegistry, undefined),
      }
    })

    const result = await Effect.runPromise(program)
    expect(result.observerVersioned).not.toBe(result.observerBase)
    expect(result.signalVersioned).not.toBe(result.signalBase)
  })

  test("observer cache config hash changes with compound input policy", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0)
      const leaf = makeCountingSignal(counter, "MOCK-OBSERVER-LEAF")
      const compound: Signal<{}, { readonly total: number }, never> = {
        id: "MOCK-OBSERVER-COMPOSITE",
        tier: 1.5,
        category: "review-pain",
        kind: "compound",
        configSchema: Schema.Struct({}),
        defaultConfig: {},
        inputs: [{ id: leaf.id, cacheFingerprint: "observer-input-policy-v1" }],
        compute: (_config, inputs) => {
          const out = inputs.get(leaf.id) as { readonly n: number } | undefined
          return Effect.succeed({ total: out?.n ?? 0 })
        },
        score: () => 1,
        diagnose: () => [],
      }
      const policyChangedCompound: Signal<{}, { readonly total: number }, never> = {
        ...compound,
        inputs: [{ id: leaf.id, cacheFingerprint: "observer-input-policy-v2" }],
      }
      const registry = yield* buildRegistry([compound, leaf])
      const policyChangedRegistry = yield* buildRegistry([
        policyChangedCompound,
        leaf,
      ])

      return {
        observerBase: computeObserverConfigHash(registry, undefined),
        observerPolicyChanged: computeObserverConfigHash(
          policyChangedRegistry,
          undefined,
        ),
        signalBase: computeConfigHash(compound.id, registry, undefined),
        signalPolicyChanged: computeConfigHash(
          compound.id,
          policyChangedRegistry,
          undefined,
        ),
      }
    })

    const result = await Effect.runPromise(program)
    expect(result.observerPolicyChanged).not.toBe(result.observerBase)
    expect(result.signalPolicyChanged).not.toBe(result.signalBase)
  })
})
