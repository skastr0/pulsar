import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ObserverOutput as ObserverOutputSchema, createTimeSeriesServices } from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")
const aiSlopDefensePresetPath = resolve(
  import.meta.dir,
  "../../../core/presets/ai-slop-defense.json",
)

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

const initRepo = async (
  files: ReadonlyArray<{ path: string; content: string }>,
): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "pulsar-score-cli-"))
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
        include: ["**/*.ts"],
      },
      null,
      2,
    ),
  )

  for (const file of files) {
    await writeRepoFile(repoPath, file.path, file.content)
  }

  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const simpleRepoFiles = (): ReadonlyArray<{ path: string; content: string }> => [
  { path: "src/a.ts", content: "export const a = 1\n" },
  {
    path: "src/b.ts",
    content: "import { a } from './a'\nexport const b = a + 1\n",
  },
]

const cycleRepoFiles = (): ReadonlyArray<{ path: string; content: string }> => [
  {
    path: "src/a.ts",
    content: "import { b } from './b'\nexport const a = b + 1\n",
  },
  {
    path: "src/b.ts",
    content: "import { a } from './a'\nexport const b = a + 1\n",
  },
]

const broadCycleRepoFiles = (): ReadonlyArray<{ path: string; content: string }> =>
  Array.from({ length: 10 }, (_, index) => [
    {
      path: `src/cycle-${index}/a.ts`,
      content: `import { b } from './b'\nexport const a${index} = b + 1\n`,
    },
    {
      path: `src/cycle-${index}/b.ts`,
      content: `import { a${index} } from './a'\nexport const b = a${index} + 1\n`,
    },
  ]).flat()

const healthyCoupledRepoFiles = (): ReadonlyArray<{ path: string; content: string }> => [
  {
    path: "src/types.ts",
    content: "export interface User { readonly id: string }\n",
  },
  {
    path: "src/use-user.ts",
    content: "import type { User } from './types'\nexport const idOf = (user: User) => user.id\n",
  },
]

describe("pulsar score", () => {
  test("full observer mode prints the category table, minimum, and gate", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Architectural Drift")
      expect(out.stdout).toContain("Readiness")
      expect(out.stdout).toContain("Evidence Mean")
      expect(out.stdout).toContain("Minimum")
      expect(out.stdout).toContain("Hard Gate")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("default full observer uses detected language packs in mixed-language repos", async () => {
    const repoPath = await initRepo([
      ...simpleRepoFiles(),
      {
        path: "Cargo.toml",
        content: "[package]\nname = \"mixed\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
      },
      { path: "src/lib.rs", content: "pub fn rust_api() {}\n" },
    ])
    try {
      const out = runCli(repoPath, ["score", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Vector: all-defaults")
      expect(out.stdout).toContain("TS-")
      expect(out.stdout).toContain("RS-")

      const jsonOut = runCli(repoPath, ["score", "--json", "."])
      expect(jsonOut.status).toBe(0)
      const parsed = JSON.parse(String(jsonOut.stdout))
      expect(parsed.vector).toMatchObject({
        id: "all-defaults",
        source: "fallback",
        trust_boundary: "built-in-defaults",
        source_label: "built-in defaults",
      })
      const signalIds = Object.values(parsed.categories).flatMap((category: any) =>
        Object.keys(category.signals ?? {}),
      )
      expect(signalIds.some((id) => id.startsWith("TS-"))).toBe(true)
      expect(signalIds.some((id) => id.startsWith("RS-"))).toBe(true)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("default category observer uses Rust signals in Rust-only repos", async () => {
    const repoPath = await initRepo([
      {
        path: "Cargo.toml",
        content: "[package]\nname = \"rust-only\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
      },
      { path: "src/lib.rs", content: "pub fn rust_api() { let _ = Some(1).unwrap(); }\n" },
    ])
    try {
      sh("git", ["rm", "tsconfig.json", "-q"], repoPath)
      sh("git", ["commit", "-q", "-m", "remove tsconfig"], repoPath)
      const out = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Vector:   all-defaults")
      expect(out.stdout).toContain("RS-SL-")
      expect(out.stdout).not.toContain("TS-SL-")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--json emits ObserverOutput JSON with vector source metadata", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--json", "."])
      expect(out.status).toBe(0)
      const parsed = JSON.parse(String(out.stdout))
      const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(parsed)
      expect(parsed.vector).toMatchObject({
        id: "all-defaults",
        source: "fallback",
        trust_boundary: "built-in-defaults",
        source_label: "built-in defaults",
      })
      expect(decoded.hard_gate_status === "pass" || decoded.hard_gate_status === "fail").toBe(
        true,
      )
      expect(typeof decoded.categories["generated-slop"].aggregation?.aggregateScore).toBe("number")
      expect(decoded.categories["generated-slop"].aggregation?.weights).toBeDefined()
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("score rejects unknown flags instead of silently ignoring them", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", ".", "--format", "json"])
      expect(out.status).toBe(1)
      expect(out.stderr).toContain("score does not accept --format")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--profile emits runtime attribution for observer runs", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--profile", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Runtime")
      expect(out.stdout).toContain("Environment Setup")
      expect(out.stdout).toContain("Observer")
      expect(out.stdout).toContain("diagnostics=")
      expect(out.stdout.indexOf("Runtime")).toBeLessThan(out.stdout.indexOf("Environment Setup"))
      expect(out.stdout.indexOf("Runtime")).toBeLessThan(out.stdout.indexOf("Observer"))
      expect(out.stdout.indexOf("Observer")).toBeLessThan(out.stdout.indexOf("diagnostics="))
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--json --profile includes runtime_profile", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--json", "--profile", "."])
      expect(out.status).toBe(0)
      const parsed = JSON.parse(String(out.stdout))
      const decoded = Schema.decodeUnknownSync(ObserverOutputSchema)(parsed)
      expect(decoded.observer_semantics).toBe("applicability-aware-readiness-v1")
      expect(parsed.vector.trust_boundary).toBe("built-in-defaults")
      expect(decoded.runtime_profile?.total_ms).toBeGreaterThanOrEqual(0)
      expect(decoded.runtime_profile?.stages?.["environment-setup"]?.duration_ms).toBeGreaterThanOrEqual(0)
      expect(decoded.runtime_profile?.stages?.observer?.duration_ms).toBeGreaterThanOrEqual(0)
      expect(Object.keys(decoded.runtime_profile?.signals ?? {}).length).toBeGreaterThan(0)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--category narrows human output and omits aggregate summary plus passing gate", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--category", "abstraction-bloat", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Category: abstraction-bloat")
      expect(out.stdout).toContain("TS-AB-01")
      expect(out.stdout).not.toContain("RS-")
      expect(out.stdout).not.toContain("Readiness")
      expect(out.stdout).not.toContain("Evidence Mean")
      expect(out.stdout).not.toContain("Hard Gate")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("category output explains score math and signal weights", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Score Math")
      expect(out.stdout).toContain("aggregate")
      expect(out.stdout).toContain("pressure")
      expect(out.stdout).toContain("lowest")
      expect(out.stdout).toContain("weights")
      expect(out.stdout).toContain("TS-SL-01-duplication=")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("ai-slop-defense vector stays quiet on a clean simple repo", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, [
        "score",
        "--category",
        "generated-slop",
        "--vector",
        aiSlopDefensePresetPath,
        ".",
      ])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Vector:   ai-slop-defense")
      expect(out.stdout).toContain("AI Mode:  active")
      expect(out.stdout).toContain("Generated Slop         1.00")
      expect(out.stdout).not.toContain("Top Findings")

      const jsonOut = runCli(repoPath, ["score", "--json", "--vector", aiSlopDefensePresetPath, "."])
      expect(jsonOut.status).toBe(0)
      const parsed = JSON.parse(String(jsonOut.stdout))
      expect(parsed.vector).toMatchObject({
        id: "ai-slop-defense",
        source: "explicit",
        trust_boundary: "explicit-path",
      })
      expect(parsed.categories["generated-slop"].score).toBeGreaterThanOrEqual(0.99)
      expect(parsed.hard_gate_status).toBe("pass")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("category top findings compact repo-root paths in messages", async () => {
    const repoPath = await initRepo(cycleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--category", "architectural-drift", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Top Findings")
      expect(out.stdout).toContain("TS-AD-02-circular-dependencies WARN")
      const findings = out.stdout.slice(out.stdout.indexOf("Top Findings"))
      expect(findings).not.toContain(repoPath)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("category top findings omit healthy non-blocking diagnostics", async () => {
    const repoPath = await initRepo(healthyCoupledRepoFiles())
    try {
      const signalOut = runCli(repoPath, ["score", "--signal", "TS-DE-01", "."])
      expect(signalOut.status).toBe(0)
      expect(signalOut.stdout).toContain("Vector Source: built-in defaults")
      expect(signalOut.stdout).toContain("Score:  1.000")
      expect(signalOut.stdout).toContain("(no diagnostics)")

      const categoryOut = runCli(repoPath, ["score", "--category", "dependency-entropy", "."])
      expect(categoryOut.status).toBe(0)
      expect(categoryOut.stdout).toContain("Dependency Entropy     1.00")
      expect(categoryOut.stdout).not.toContain("Top Findings")
      expect(categoryOut.stdout).not.toContain("Type coupling")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("full observer mode scores uncommitted current worktree content", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        "src/dirty-suppression.ts",
        "// @ts-ignore\nexport const risky: string = 42 as never\n",
      )

      const out = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Category: generated-slop")
      expect(out.stdout).toContain("TS-SL-03-suppressions")
      expect(out.stdout).toContain("Top Findings")
      expect(out.stdout).toContain("TS-SL-03-suppressions WARN")
      expect(out.stdout).toContain("ts-ignore is missing justification")
      expect(out.stdout).toContain("at src/dirty-suppression.ts:1")

      const fullOut = runCli(repoPath, ["score", "."])
      expect(fullOut.status).toBe(0)
      expect(fullOut.stdout).toContain("Top Findings")
      expect(fullOut.stdout).toContain("TS-SL-03-suppressions WARN")
      expect(fullOut.stdout).toContain("at src/dirty-suppression.ts:1")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("review-pain output shows largest files for PR surface", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        "src/large.ts",
        Array.from({ length: 90 }, (_, index) => `export const large${index} = ${index}`).join("\n"),
      )
      await writeRepoFile(
        repoPath,
        "src/medium.ts",
        Array.from({ length: 30 }, (_, index) => `export const medium${index} = ${index}`).join("\n"),
      )

      const out = runCli(repoPath, ["score", "--category", "review-pain", "."])

      expect(out.status).toBe(0)
      expect(out.stdout).toContain("TS-RP-02")
      expect(out.stdout).toContain("largest files src/large.ts")
      expect(out.stdout).toContain("src/medium.ts")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("generated-slop scoring surfaces changed code copied from unchanged files", async () => {
    const duplicateBody = `
  const doubled = value * 2
  if (doubled > 10) {
    return doubled - 1
  }
  return doubled + 1
`
    const repoPath = await initRepo([
      {
        path: "src/existing.ts",
        content: `export function existingHandler(value: number): number {${duplicateBody}}\n`,
      },
    ])
    try {
      await writeRepoFile(
        repoPath,
        "src/changed.ts",
        `export function copiedHandler(value: number): number {${duplicateBody}}\n`,
      )

      const out = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("TS-SL-01")
      expect(out.stdout).toContain("existingHandler")
      expect(out.stdout).toContain("copiedHandler")
      expect(out.stdout).toContain("members src/changed.ts:1 copiedHandler; src/existing.ts:1 existingHandler")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("explicit pulsar vector can tighten diff scoring for small copied edits", async () => {
    const smallDuplicateBody = `
  const out = value + 1
  return out
`
    const repoPath = await initRepo([
      {
        path: "src/existing.ts",
        content: `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      },
      {
        path: "src/existing-two.ts",
        content: `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      },
    ])
    try {
      await writeRepoFile(
        repoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/micro-copy-defense.json",
        JSON.stringify(
          {
            id: "micro-copy-defense",
            domain: "typescript",
            signal_overrides: {
              "TS-SL-01": {
                config: {
                  min_tokens: 8,
                },
              },
            },
            modes: {
              ai_assisted: true,
            },
            provenance: [
              {
                source: "manual",
                recorded_at: "2026-05-03T00:00:00.000Z",
                summary: "Tighten duplicate detection for small AI-assisted edits.",
              },
            ],
          },
          null,
          2,
        ),
      )

      const defaultOut = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(defaultOut.status).toBe(0)
      expect(defaultOut.stdout).not.toContain("existingTiny")
      expect(defaultOut.stdout).not.toContain("copiedTiny")

      const vectorOut = runCli(repoPath, [
        "score",
        "--category",
        "generated-slop",
        "--vector",
        ".pulsar/micro-copy-defense.json",
        ".",
      ])
      expect(vectorOut.status).toBe(0)
      expect(vectorOut.stdout).toContain("Vector:   micro-copy-defense")
      expect(vectorOut.stdout).toContain("existingTiny")
      expect(vectorOut.stdout).toContain("copiedTiny")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("category top findings include the weakest actionable signal", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        "src/stubs.ts",
        `
export function stubA() { throw new Error("Not implemented") }
export function stubB() { throw new Error("Not implemented") }
export function stubC() { throw new Error("Not implemented") }
export function stubD() { throw new Error("Not implemented") }
export function stubE() { throw new Error("Not implemented") }
export function stubF() { throw new Error("Not implemented") }
`,
      )
      await writeRepoFile(
        repoPath,
        "src/suppression.ts",
        Array.from(
          { length: 70 },
          (_, index) => `// @ts-ignore\nexport const risky${index}: string = 42 as never\n`,
        ).join("\n"),
      )

      const out = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Top Findings")
      expect(out.stdout).toContain("Hard Gate             FAIL")
      expect(out.stdout).toContain("TS-SL-04-unfinished-implementations BLOCK")
      expect(out.stdout).toContain("TS-SL-03-suppressions WARN")
      expect(out.stdout).toContain("ts-ignore is missing justification")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("repo-local project modules calibrate single-signal scoring", async () => {
    const repoPath = await initRepo([
      {
        path: "src/contracts.ts",
        content: "export function projectContract() {}\n",
      },
    ])
    try {
      const before = runCli(repoPath, ["score", "--signal", "TS-SL-04", "."])
      expect(before.status).toBe(0)
      expect(before.stdout).toContain("empty-body")
      expect(before.stdout).not.toContain("(no diagnostics)")

      const effectModuleUrl = pathToFileURL(
        resolve(import.meta.dir, "../../node_modules/effect/dist/esm/index.js"),
      ).href
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/project-contract-noops.mjs",
        [
          `import { Effect } from ${JSON.stringify(effectModuleUrl)}`,
          "",
          "export default {",
          "  id: 'repo.project-contract-noops',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  processors: [",
          "    {",
          "      id: 'project-contract-noops',",
          "      slot: 'typescript.noop-classifier',",
          "      role: 'normalizer',",
          "      priority: 10,",
          "      fingerprint: 'project-contract-noops-v1',",
          "      process: (current) => Effect.sync(() => {",
          "        if (!current.value.file.endsWith('src/contracts.ts')) return current",
          "        return {",
          "          value: {",
          "            ...current.value,",
          "            classification: 'intentional_noop',",
          "            confidence: 'high',",
          "          },",
          "          decisions: [",
          "            ...current.decisions,",
          "            {",
          "              moduleId: 'repo.project-contract-noops',",
          "              processorId: 'project-contract-noops',",
          "              slot: 'typescript.noop-classifier',",
          "              action: 'classify-intentional-noop',",
          "              confidence: 'high',",
          "              reason: 'Project contract hook is intentionally empty until host runtime binds it.',",
          "              evidence: [",
          "                { kind: 'path', value: current.value.file },",
          "                { kind: 'symbol', value: current.value.name },",
          "              ],",
          "            },",
          "          ],",
          "        }",
          "      }),",
          "    },",
          "  ],",
          "}",
        ].join("\n"),
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/project-modules.json",
        JSON.stringify(
          {
            modules: [
              {
                id: "repo.project-contract-noops",
                kind: "repo-local",
                path: ".pulsar/modules/project-contract-noops.mjs",
              },
            ],
          },
          null,
          2,
        ),
      )
      sh("git", ["add", ".pulsar"], repoPath)
      sh("git", ["commit", "-q", "-m", "add project module"], repoPath)

      const after = runCli(repoPath, ["score", "--signal", "TS-SL-04", "."])
      expect(after.status).toBe(0)
      expect(after.stdout).toContain("Score:  1.000")
      expect(after.stdout).toContain("(no diagnostics)")
      expect(after.stdout).toContain("Calibration Decisions (1)")
      expect(after.stdout).toContain("repo.project-contract-noops/project-contract-noops")
      expect(after.stdout).toContain("classify-intentional-noop")
      expect(after.stdout).not.toContain("empty-body")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("explicit TypeScript vector can drive category scoring", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        ".pulsar/ts-dependency-vector.json",
        JSON.stringify(
          {
            id: "ts-dependency-baseline",
            domain: "typescript",
            signal_overrides: {},
            provenance: [
              {
                source: "manual",
                recorded_at: "2026-05-03T00:00:00.000Z",
                summary: "Control vector for TypeScript dependency-entropy scoring.",
              },
            ],
          },
          null,
          2,
        ),
      )

      const out = runCli(repoPath, [
        "score",
        "--category",
        "dependency-entropy",
        "--vector",
        ".pulsar/ts-dependency-vector.json",
        ".",
      ])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Vector:   ts-dependency-baseline")
      expect(out.stdout).toContain("Category: dependency-entropy")
      expect(out.stdout).toContain("TS-DE-04")
      expect(out.stdout).not.toContain("RS-DE-")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("worktree vector can relax a default hard gate explicitly", async () => {
    const repoPath = await initRepo([
      {
        path: "src/session.ts",
        content: "export function createSession() { throw new Error('Not implemented') }\n",
      },
    ])
    try {
      const defaultOut = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(defaultOut.status).toBe(0)
      expect(defaultOut.stdout).toContain("Vector:   all-defaults")
      expect(defaultOut.stdout).toContain("TS-SL-04-unfinished-implementations BLOCK")

      await writeRepoFile(
        repoPath,
        ".pulsar/vector.json",
        JSON.stringify(
          {
            id: "protocol-stub-tolerant",
            domain: "typescript",
            signal_overrides: {
              "TS-SL-04": {
                config: {
                  hard_gate_production: false,
                },
              },
            },
            provenance: [
              {
                source: "manual",
                recorded_at: "2026-05-03T00:00:00.000Z",
                summary: "This project accepts explicit protocol stubs during integration.",
              },
            ],
          },
          null,
          2,
        ),
      )

      const vectorOut = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(vectorOut.status).toBe(0)
      expect(vectorOut.stdout).toContain("Vector:   protocol-stub-tolerant")
      expect(vectorOut.stdout).toContain("TS-SL-04-unfinished-implementations WARN")
      expect(vectorOut.stdout).not.toContain("TS-SL-04 BLOCK")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("default vector discovery prefers worktree then organization config", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    const homePath = await mkdtemp(join(tmpdir(), "pulsar-score-home-"))
    try {
      await writeRepoFile(
        repoPath,
        ".pulsar/vector.json",
        JSON.stringify(
          {
            id: "worktree-default",
            domain: "typescript",
            signal_overrides: { "TS-AB-01": { active: false } },
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        homePath,
        ".config/pulsar/vector.json",
        JSON.stringify(
          {
            id: "organization-default",
            domain: "typescript",
            signal_overrides: { "TS-LD-01": { active: false } },
          },
          null,
          2,
        ),
      )

      const worktreeOut = runCli(repoPath, ["score", "."], { HOME: homePath })
      expect(worktreeOut.status).toBe(0)
      expect(worktreeOut.stdout).toContain("Vector: worktree-default")
      expect(worktreeOut.stdout).toContain(
        "Vector Source: repo-local .pulsar/vector.json",
      )
      expect(worktreeOut.stdout).not.toContain("organization fallback")

      await rm(join(repoPath, ".pulsar"), { recursive: true, force: true })
      const organizationOut = runCli(repoPath, ["score", "."], { HOME: homePath })
      expect(organizationOut.status).toBe(0)
      expect(organizationOut.stdout).toContain("Vector: organization-default")
      expect(organizationOut.stdout).toContain(
        "Vector Source: organization fallback ~/.config/pulsar/vector.json",
      )
      const organizationSignalOut = runCli(repoPath, ["score", "--signal", "TS-AB-01", "."], {
        HOME: homePath,
      })
      expect(organizationSignalOut.status).toBe(0)
      expect(organizationSignalOut.stdout).toContain(
        "Vector Source: organization fallback ~/.config/pulsar/vector.json",
      )
      const organizationJson = runCli(repoPath, ["score", "--json", "."], { HOME: homePath })
      expect(organizationJson.status).toBe(0)
      const organizationJsonBody = JSON.parse(String(organizationJson.stdout))
      expect(organizationJsonBody.vector).toMatchObject({
        id: "organization-default",
        source: "organization",
        trust_boundary: "organization-standard-fallback",
        source_label: "organization fallback ~/.config/pulsar/vector.json",
      })

      const baselineOut = runCli(repoPath, ["baseline", "set", "."], { HOME: homePath })
      expect(baselineOut.status).toBe(0)
      expect(baselineOut.stdout).toContain("Vector:   organization-default")
      expect(baselineOut.stdout).toContain(
        "Vector Source: organization fallback ~/.config/pulsar/vector.json",
      )
      const baseline = JSON.parse(
        await readFile(join(repoPath, ".pulsar", "baseline.json"), "utf8"),
      )
      expect(baseline.vector_source).toBe(
        "organization fallback ~/.config/pulsar/vector.json",
      )
      expect(baseline.vector_trust_boundary).toBe("organization-standard-fallback")

      const baselineShow = runCli(repoPath, ["baseline", "show", "."], { HOME: homePath })
      expect(baselineShow.status).toBe(0)
      expect(baselineShow.stdout).toContain(
        "Vector Source: organization fallback ~/.config/pulsar/vector.json",
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("human output explains why AI-assisted thresholds are active", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      await writeRepoFile(
        repoPath,
        ".pulsar/vector.json",
        JSON.stringify(
          {
            id: "ai-slop-defense",
            domain: "typescript",
            modes: { ai_assisted: true },
            signal_overrides: {},
            provenance: [
              {
                source: "ai-assisted-detection",
                recorded_at: "2026-04-19T00:00:00.000Z",
                summary: "Accepted AI-assisted detection proposal",
              },
            ],
          },
          null,
          2,
        ),
      )

      const out = runCli(repoPath, ["score", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("AI Mode: active")
      expect(out.stdout).toContain("accepted AI-assisted detection proposal")
      expect(out.stdout).toContain("vector.modes.ai_assisted")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("--ci without a baseline warns and exits 0", async () => {
    const repoPath = await initRepo(cycleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--ci", "."])
      expect(out.status).toBe(0)
      expect(out.stderr).toContain("baseline=missing")
      expect(out.stderr).toContain("pulsar baseline set")
      const entries = await Effect.runPromise(
        createTimeSeriesServices(repoPath).reader.entries(),
      )
      expect(entries).toHaveLength(1)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("baseline set/show and --ci ratchets new current-worktree hard-gate identities", async () => {
    const repoPath = await initRepo(broadCycleRepoFiles())
    try {
      const baselineSet = runCli(repoPath, ["baseline", "set", "."])
      expect(baselineSet.status).toBe(0)

      const baselineJson = JSON.parse(
        await readFile(join(repoPath, ".pulsar", "baseline.json"), "utf8"),
      )
      expect(Object.keys(baselineJson.violations)).toContain("TS-AD-02-circular-dependencies")
      expect(baselineJson.vector_id).toBe("all-defaults")
      expect(typeof baselineJson.observer_config_hash).toBe("string")

      const baselineShow = runCli(repoPath, ["baseline", "show", "."])
      expect(baselineShow.status).toBe(0)
      expect(baselineShow.stdout).toContain("Baseline SHA")
      expect(baselineShow.stdout).toContain("Vector:        all-defaults")
      expect(baselineShow.stdout).toContain("TS-AD-02-circular-dependencies")

      const ratchetedPass = runCli(repoPath, ["score", "--ci", "."])
      expect(ratchetedPass.status).toBe(0)
      expect(ratchetedPass.stderr).toContain("status=pass")
      expect(ratchetedPass.stderr).toContain("tolerated=1")

      await writeRepoFile(
        repoPath,
        "src/c.ts",
        "import { d } from './d-impl'\nexport const c = d + 1\n",
      )
      await writeRepoFile(
        repoPath,
        "src/d-impl.ts",
        "import { c } from './c'\nexport const d = c + 1\n",
      )

      const ratchetedFail = runCli(repoPath, ["score", "--ci", "."])
      expect(ratchetedFail.status).toBe(2)
      expect(ratchetedFail.stderr).toContain("status=fail")
      expect(ratchetedFail.stderr).toContain("new=")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("score --ci fails loudly when the active vector differs from the baseline vector", async () => {
    const repoPath = await initRepo([
      {
        path: "src/session.ts",
        content: "export function createSession() { throw new Error('Not implemented') }\n",
      },
    ])
    try {
      const baselineSet = runCli(repoPath, ["baseline", "set", "."])
      expect(baselineSet.status).toBe(0)

      await writeRepoFile(
        repoPath,
        ".pulsar/vector.json",
        JSON.stringify(
          {
            id: "protocol-stub-tolerant",
            domain: "typescript",
            signal_overrides: {
              "TS-SL-04": {
                config: {
                  hard_gate_production: false,
                },
              },
            },
          },
          null,
          2,
        ),
      )

      const ci = runCli(repoPath, ["score", "--ci", "."])
      expect(ci.status).toBe(2)
      expect(ci.stderr).toContain("reason=observer-config-mismatch")
      expect(ci.stderr).toContain("baseline_vector=all-defaults")
      expect(ci.stderr).toContain("current_vector=protocol-stub-tolerant")
      expect(ci.stderr).toContain("pulsar baseline refresh")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("score --ci fails when project module source differs from the baseline", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const writeProjectModule = (marker: string) =>
        writeRepoFile(
          repoPath,
          ".pulsar/modules/local.mjs",
          [
            `// ${marker}`,
            "export default {",
            "  id: 'repo.local-module',",
            "  version: '1.0.0',",
            "  scope: 'repository',",
            "  processors: []",
            "}",
          ].join("\n"),
        )

      await writeProjectModule("baseline")
      await writeRepoFile(
        repoPath,
        ".pulsar/project-modules.json",
        JSON.stringify(
          {
            modules: [
              {
                id: "repo.local-module",
                kind: "repo-local",
                path: ".pulsar/modules/local.mjs",
              },
            ],
          },
          null,
          2,
        ),
      )
      sh("git", ["add", ".pulsar"], repoPath)
      sh("git", ["commit", "-q", "-m", "add project module"], repoPath)

      const human = runCli(repoPath, ["score", "."])
      expect(human.status).toBe(0)
      expect(human.stdout).toContain("Calibration: 1 module")

      const json = runCli(repoPath, ["score", "--json", "."])
      expect(json.status).toBe(0)
      const observerJson = JSON.parse(String(json.stdout))
      expect(observerJson.calibration.active_modules[0]).toMatchObject({
        id: "repo.local-module",
        source: "repo-local",
        source_ref: ".pulsar/modules/local.mjs",
      })

      const baselineSet = runCli(repoPath, ["baseline", "set", "."])
      expect(baselineSet.status).toBe(0)
      const baselineJson = JSON.parse(
        await readFile(join(repoPath, ".pulsar", "baseline.json"), "utf8"),
      )
      expect(typeof baselineJson.observer_config_hash).toBe("string")

      await writeProjectModule("changed")
      const ci = runCli(repoPath, ["score", "--ci", "."])

      expect(ci.status).toBe(2)
      expect(ci.stderr).toContain("reason=observer-config-mismatch")
      expect(ci.stderr).toContain("baseline_vector=all-defaults")
      expect(ci.stderr).toContain("current_vector=all-defaults")
      expect(ci.stderr).toContain(`baseline_config=${baselineJson.observer_config_hash}`)
      expect(ci.stderr).toContain("pulsar baseline refresh")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("baseline refresh accepts an extended bypass deadline", async () => {
    const repoPath = await initRepo([
      {
        path: "src/a.ts",
        content:
          "// pulsar-allow ENG-123 until:2000-01-01 temporary cycle\nimport { b } from './b'\nexport const a = b + 1\n",
      },
      {
        path: "src/b.ts",
        content: "import { a } from './a'\nexport const b = a + 1\n",
      },
    ])
    try {
      const set = runCli(repoPath, ["baseline", "set", "."])
      expect(set.status).toBe(0)

      await writeRepoFile(
        repoPath,
        "src/a.ts",
        "// pulsar-allow ENG-123 until:2099-01-01 temporary cycle\nimport { b } from './b'\nexport const a = b + 1\n",
      )

      const refresh = runCli(repoPath, ["baseline", "refresh", "."])
      expect(refresh.status).toBe(0)

      const show = runCli(repoPath, ["baseline", "show", "."])
      expect(show.status).toBe(0)
      expect(show.stdout).toContain("Tolerated:     0")

      const ci = runCli(repoPath, ["score", "--ci", "."])
      expect(ci.status).toBe(0)
      expect(ci.stderr).toContain("status=pass")
      expect(ci.stderr).toContain("new=0")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal mode still prints the legacy surface", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--signal", "TS-LD-01", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Signal: TS-LD-01")
      expect(out.stdout).toContain("Score:")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal mode summarizes score-bearing factor audit details", async () => {
    const repoPath = await initRepo([
      {
        path: "src/auth.ts",
        content: "export function authenticate() { throw new Error('Not implemented') }\n",
      },
    ])
    try {
      const out = runCli(repoPath, [
        "score",
        "--signal",
        "TS-SL-04-unfinished-implementations",
        ".",
      ])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("Factor Audit")
      expect(out.stdout).toContain("stub_kinds.throw-not-implemented.score_cap=0.8")
      expect(out.stdout).toContain("score-cap")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("invalid single-signal option combinations print clean CLI errors", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    try {
      const out = runCli(repoPath, ["score", "--signal", "TS-AD-02", "--profile", "."])

      expect(out.status).toBe(1)
      expect(out.stderr).toContain(
        "pulsar score failed: pulsar score --profile is only supported in full Observer mode",
      )
      expect(out.stderr).not.toContain("FiberFailure")
      expect(out.stderr).not.toContain("validateScoreOptions")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal diagnostics render readable repo-relative locations", async () => {
    const repoPath = await initRepo([
      {
        path: "src/problem.ts",
        content: "// @ts-ignore\nexport const risky: string = 42 as never\n",
      },
    ])
    try {
      const out = runCli(repoPath, ["score", "--signal", "TS-SL-03", "."])
      expect(out.status).toBe(0)
      expect(out.stdout).toContain("WARN  ts-ignore is missing justification")
      expect(out.stdout).toContain("      at src/problem.ts:1")
      expect(out.stdout).not.toContain(`${repoPath}/src/problem.ts`)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("explicit vectors fail loud on unknown signal ids", async () => {
    const repoPath = await initRepo(simpleRepoFiles())
    const vectorDir = await mkdtemp(join(tmpdir(), "pulsar-score-vector-"))
    try {
      const vectorPath = join(vectorDir, "vector.json")
      await writeFile(
        vectorPath,
        JSON.stringify(
          {
            id: "bad-vector",
            domain: "typescript",
            signal_overrides: { "DOES-NOT-EXIST": { active: true } },
          },
          null,
          2,
        ),
        "utf8",
      )

      const out = runCli(repoPath, ["score", "--vector", vectorPath, "."])
      expect(out.status).toBe(1)
      expect(out.stderr).toContain("Unknown signal id in pulsar vector")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(vectorDir, { recursive: true, force: true })
    }
  }, 120_000)
})
