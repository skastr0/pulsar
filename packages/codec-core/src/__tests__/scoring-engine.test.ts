import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Schema } from "effect"
import { buildRegistry } from "../registry.js"
import {
  ScoringEngineLayer,
  ScoringEngineTag,
  computeContentHash,
} from "../scoring-engine.js"
import type { Signal } from "../signal.js"

/**
 * Initialize a tiny git repo with one commit containing `files`.
 * Returns the repo path and the HEAD SHA. Caller is responsible for
 * cleaning up via rm(repoPath, { recursive: true, force: true }).
 */
const initRepo = async (
  files: ReadonlyArray<{ path: string; content: string }>,
): Promise<{ repoPath: string; sha: string }> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-codec-test-repo-"))
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
const makeCountingSignal = (counter: Ref.Ref<number>): Signal<{}, { readonly n: number }, never> => ({
  id: "MOCK-ENG-01",
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
          name.startsWith(`taste-codec-worktree-${sha.slice(0, 12)}-`) &&
          existsSync(join(tmpdir(), name)),
      )
      expect(lingering.length).toBe(0)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })
})
