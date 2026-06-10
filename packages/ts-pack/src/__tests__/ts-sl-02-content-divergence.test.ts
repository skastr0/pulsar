import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TsSl02 } from "../signals/ts-sl-02-inconsistent-clones.js"
import { normalizedCloneTokens } from "../signals/ts-sl-02-content.js"
import type { TsSl01Output } from "../signals/ts-sl-01-model.js"

const git = (repo: string, args: Array<string>, env?: Record<string, string>): void => {
  const result = spawnSync("git", args, {
    cwd: repo,
    env: { ...process.env, ...(env ?? {}) },
    encoding: "utf-8",
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  }
}

const makeCommit = (repo: string, path: string, content: string, dateIso: string): void => {
  writeFileSync(join(repo, path), content)
  git(repo, ["add", path])
  git(repo, ["commit", "-m", `edit ${path}`, "-q"], {
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  })
}

const makeCommitMany = (
  repo: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  dateIso: string,
): void => {
  for (const file of files) {
    writeFileSync(join(repo, file.path), file.content)
    git(repo, ["add", file.path])
  }
  git(repo, ["commit", "-m", "edit clone group", "-q"], {
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  })
}

const runTsSl02 = async (repo: string, inputs: ReadonlyMap<string, unknown>) =>
  Effect.runPromise(
    TsSl02.compute(TsSl02.defaultConfig, inputs).pipe(
      Effect.provide(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
      ),
    ),
  )

const singleGroupInputs = (
  repo: string,
  members: ReadonlyArray<{ file: string; name: string; startLine: number; endLine: number }>,
): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    [
      "TS-SL-01",
      {
        groups: [
          {
            groupId: "content-group",
            kind: "structural" as const,
            tokenCount: 60,
            members: members.map((member) => ({ ...member, file: join(repo, member.file) })),
            structuralHash: "content-hash",
          },
        ],
        totalFunctionsAnalyzed: members.length,
        scoreBudgetFunctions: members.length,
        scopeMode: "whole-tree",
      } as TsSl01Output,
    ],
  ])

describe("TS-SL-02 content-grounded divergence", () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "ts-sl-02-content-"))
    git(repo, ["init", "-q"])
    git(repo, ["config", "user.email", "test@example.com"])
    git(repo, ["config", "user.name", "Test"])
    await writeFile(join(repo, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022" } }))
    await writeFile(join(repo, "package.json"), JSON.stringify({ name: "test" }))
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  test("content-identical clones (modulo identifiers) with divergent git history produce no findings", async () => {
    const wrapper = (name: string, schema: string) =>
      [
        `export const ${name} = (input: unknown) => {`,
        `  const parsed = ${schema}.safeParse(input)`,
        `  if (!parsed.success) {`,
        `    return undefined`,
        `  }`,
        `  return parsed.data`,
        `}`,
        "",
      ].join("\n")
    makeCommit(repo, "parse-trait.ts", wrapper("parseTrait", "traitSchema"), "2024-06-01T00:00:00Z")
    makeCommit(repo, "parse-agent.ts", wrapper("parseAgent", "agentSchema"), "2024-06-20T00:00:00Z")

    const out = await runTsSl02(
      repo,
      singleGroupInputs(repo, [
        { file: "parse-trait.ts", name: "parseTrait", startLine: 1, endLine: 7 },
        { file: "parse-agent.ts", name: "parseAgent", startLine: 1, endLine: 7 },
      ]),
    )

    expect(out.totalGroups).toBe(1)
    expect(out.analyzedGroups).toBe(1)
    expect(out.analysisLimitHit).toBe(false)
    expect(out.divergentGroups).toEqual([])
    expect(TsSl02.score(out)).toBe(1)
    expect(TsSl02.diagnose(out)).toEqual([])
  })

  test("flags clones whose only drift is a numeric constant", async () => {
    // A constant that changed in one twin but not the other (timeouts,
    // limits, multipliers) is the classic inconsistent-clone bug shape, so
    // numeric literals are content, not abstraction.
    const handler = (name: string, value: number) =>
      `export function ${name}(input: number) {\n  return input * ${value}\n}\n`
    makeCommit(repo, "scale-a.ts", handler("scaleA", 2), "2024-06-01T00:00:00Z")
    makeCommit(repo, "scale-b.ts", handler("scaleB", 3), "2024-06-20T00:00:00Z")

    const out = await runTsSl02(
      repo,
      singleGroupInputs(repo, [
        { file: "scale-a.ts", name: "scaleA", startLine: 1, endLine: 3 },
        { file: "scale-b.ts", name: "scaleB", startLine: 1, endLine: 3 },
      ]),
    )

    expect(out.analyzedGroups).toBe(1)
    expect(out.divergentGroups).toHaveLength(1)
    expect(out.divergentGroups[0]).toMatchObject({
      contentVariantCount: 2,
      comparedMemberCount: 2,
    })
  })

  test("flags clones where one member carries a guard its twin lacks, with measured wording", async () => {
    makeCommit(
      repo,
      "load-user.ts",
      "export function loadUser(id: string) {\n  const record = cache.get(id)\n  return record\n}\n",
      "2024-06-01T00:00:00Z",
    )
    makeCommit(
      repo,
      "read-user.ts",
      "export function readUser(id: string) {\n  const record = cache.get(id)\n" +
        "  if (record === undefined) {\n    throw new Error(\"missing user\")\n  }\n  return record\n}\n",
      "2024-06-20T00:00:00Z",
    )

    const out = await runTsSl02(
      repo,
      singleGroupInputs(repo, [
        { file: "load-user.ts", name: "loadUser", startLine: 1, endLine: 4 },
        { file: "read-user.ts", name: "readUser", startLine: 1, endLine: 7 },
      ]),
    )
    const diagnostics = TsSl02.diagnose(out)

    expect(out.divergentGroups).toHaveLength(1)
    expect(out.divergentGroups[0]).toMatchObject({
      groupId: "content-group",
      divergenceScore: 1,
      confidence: "high",
      evidenceKind: "clone-drift",
      comparedMemberCount: 2,
      contentVariantCount: 2,
      maxTokenDelta: 14,
    })
    expect(TsSl02.score(out)).toBeLessThan(1)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.message).toContain("2 content variants differing by up to 14 normalized tokens")
    expect(diagnostics[0]?.message).toContain("divergence=1.00")
    expect(diagnostics[0]?.message).toContain("last edits 19 days apart")
    expect(diagnostics[0]?.data).toMatchObject({
      contentVariantCount: 2,
      maxTokenDelta: 14,
      comparedMemberCount: 2,
    })
  })

  test("drifted clones last co-edited in the same commit downgrade to medium confidence", async () => {
    makeCommitMany(
      repo,
      [
        {
          path: "load-user.ts",
          content:
            "export function loadUser(id: string) {\n  const record = cache.get(id)\n  return record\n}\n",
        },
        {
          path: "read-user.ts",
          content:
            "export function readUser(id: string) {\n  const record = cache.get(id)\n" +
            "  if (record === undefined) {\n    throw new Error(\"missing user\")\n  }\n  return record\n}\n",
        },
      ],
      "2024-06-20T00:00:00Z",
    )

    const out = await runTsSl02(
      repo,
      singleGroupInputs(repo, [
        { file: "load-user.ts", name: "loadUser", startLine: 1, endLine: 4 },
        { file: "read-user.ts", name: "readUser", startLine: 1, endLine: 7 },
      ]),
    )
    const diagnostics = TsSl02.diagnose(out)

    expect(out.divergentGroups).toHaveLength(1)
    expect(out.divergentGroups[0]).toMatchObject({
      divergenceScore: 1,
      confidence: "medium",
      contentVariantCount: 2,
    })
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.message).toContain("confidence=medium")
  })

  test("normalized clone tokens abstract identifier names but keep identifier equality patterns", () => {
    const tokensFor = (source: string) => normalizedCloneTokens(source).join(" ")

    expect(tokensFor("const total = add(total, step)")).toBe(
      tokensFor("const sum = plus(sum, delta)"),
    )
    expect(tokensFor("const total = add(total, total)")).not.toBe(
      tokensFor("const sum = plus(sum, delta)"),
    )
    expect(tokensFor("return retry(3)")).not.toBe(tokensFor("return retry(5)"))
    expect(tokensFor("throw new Error(\"missing user\")")).not.toBe(
      tokensFor("throw new Error(\"missing trait\")"),
    )
  })
})
