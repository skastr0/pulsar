import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "../context.js"
import { Shared02BusFactor } from "../shared-02-bus-factor.js"
import { createGitTestRepo } from "./git-test-repo.js"

const longFile = (label: string): string =>
  Array.from({ length: 60 }, (_, index) => `export const ${label}${index} = ${index}`).join(
    "\n",
  ) + "\n"

describe("SHARED-02 bus factor", () => {
  test("counts a solo author and excludes lock files + tiny files", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-")
    try {
      await repo.write("src/solo.ts", longFile("solo"))
      await repo.commitAll({
        message: "seed solo",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/solo.ts", longFile("solo") + "export const tail = 1\n")
      await repo.write("src/tiny.ts", "export const x = 1\n")
      await repo.write("bun.lock", "lockfile\n")
      await repo.commitAll({
        message: "touch files",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      const soloPath = join(repo.root, "src/solo.ts")
      expect(output.touchedFileCount).toBe(1)
      expect([...output.byFile.keys()]).toEqual([soloPath])
      expect(output.byFile.get(soloPath)).toEqual({
        busFactor: 1,
        primaryAuthor: "Alice",
        primaryShare: 1,
        authors: ["Alice"],
        loc: 61,
      })
      expect(output.repoAuthors).toEqual(["Alice"])
      expect(output.siloed).toEqual([{ file: soloPath, author: "Alice", loc: 61 }])
      expect(output.touchedLoc).toBe(61)
      expect(Shared02BusFactor.score(output)).toBe(1)
      expect(Shared02BusFactor.diagnose(output)[0]?.message).toContain("single-author corpus")
    } finally {
      await repo.cleanup()
    }
  })

  test("excludes tests and agent harness directories from default production bus-factor pressure", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-excludes-")
    try {
      await repo.write("src/production.ts", longFile("production"))
      await repo.write("src/production.test.ts", longFile("test"))
      await repo.write(".opencode/tool/triage.ts", longFile("tool"))
      await repo.write(".pi/extensions/files.ts", longFile("pi"))
      await repo.write("src/happydom.ts", longFile("dom"))
      await repo.commitAll({
        message: "touch production and harness files",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect([...output.byFile.keys()]).toEqual([join(repo.root, "src/production.ts")])
    } finally {
      await repo.cleanup()
    }
  })

  test("respects .mailmap author normalization", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-mailmap-")
    try {
      await repo.write(
        ".mailmap",
        "Alice Canonical <alice@example.com> Alias Alice <alias@example.com>\n",
      )
      await repo.write("src/shared.ts", longFile("shared"))
      await repo.commitAll({
        message: "alias author",
        authorName: "Alias Alice",
        authorEmail: "alias@example.com",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/shared.ts", longFile("shared") + "export const bob = 1\n")
      await repo.commitAll({
        message: "bob change",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      const authors = output.byFile.get(join(repo.root, "src/shared.ts"))?.authors
      expect(authors).toEqual(["Alice Canonical", "Bob"])
      expect(output.repoAuthors).toEqual(["Alice Canonical", "Bob"])
    } finally {
      await repo.cleanup()
    }
  })

  test("applies optional .taste-codec author aliases", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-aliases-")
    try {
      await repo.writeJson(".taste-codec/author-aliases.json", {
        "alice canonical": "Team Alice",
        "alice-canon": "Team Alice",
      })
      await repo.write("src/aliases.ts", longFile("aliases"))
      await repo.commitAll({
        message: "canonical",
        authorName: "Alice Canonical",
        authorEmail: "alice@example.com",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/aliases.ts", longFile("aliases") + "export const extra = 1\n")
      await repo.commitAll({
        message: "alias",
        authorName: "alice-canon",
        authorEmail: "alice@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      const info = output.byFile.get(join(repo.root, "src/aliases.ts"))
      expect(info?.busFactor).toBe(1)
      expect(info?.primaryAuthor).toBe("Team Alice")
      expect(info?.authors).toEqual(["Team Alice"])
    } finally {
      await repo.cleanup()
    }
  })

  test("scores and ranks siloed files by LOC impact instead of raw file count", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-weighted-")
    try {
      await repo.write("src/big.ts", longFile("big") + longFile("large") + longFile("wide") + longFile("deep"))
      await repo.commitAll({
        message: "big silo",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/small.ts", longFile("small"))
      await repo.commitAll({
        message: "small silo",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      await repo.write("src/shared.ts", longFile("shared") + longFile("owned"))
      await repo.commitAll({
        message: "shared alice",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-03-01T00:00:00Z",
      })
      await repo.write("src/shared.ts", longFile("shared") + longFile("owned") + "export const bob = 1\n")
      await repo.commitAll({
        message: "shared bob",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        dateIso: "2024-04-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.siloed[0]?.file).toBe(join(repo.root, "src/big.ts"))
      expect(output.siloed[0]?.loc).toBeGreaterThan(output.siloed[1]?.loc ?? 0)
      expect(Shared02BusFactor.score(output)).toBeLessThan(1)

      const diagnostics = Shared02BusFactor.diagnose(output)
      expect(diagnostics[0]?.message).toContain("src/big.ts")
      expect(diagnostics[0]?.message).toContain("LOC")
      expect(diagnostics[0]?.data?.loc).toBe(output.siloed[0]?.loc)
    } finally {
      await repo.cleanup()
    }
  })

  test("ownership concentration stays moderate instead of collapsing default score", async () => {
    const repo = await createGitTestRepo("taste-codec-shared-02-moderate-")
    try {
      await repo.write("src/alice.ts", longFile("alice") + longFile("owned"))
      await repo.commitAll({
        message: "alice owns file",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        dateIso: "2024-01-01T00:00:00Z",
      })

      await repo.write("src/bob.ts", longFile("bob") + longFile("owned"))
      await repo.commitAll({
        message: "bob owns file",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        dateIso: "2024-02-01T00:00:00Z",
      })

      const output = await Effect.runPromise(
        Shared02BusFactor.compute(Shared02BusFactor.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.succeed(SignalContextTag, {
              gitSha: repo.revParse("HEAD"),
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ) as Effect.Effect<any, any, never>,
      )

      expect(output.repoAuthors).toEqual(["Alice", "Bob"])
      expect(output.siloed).toHaveLength(2)
      expect(Shared02BusFactor.score(output)).toBeGreaterThanOrEqual(0.65)
      expect(Shared02BusFactor.score(output)).toBeLessThan(1)
      expect(Shared02BusFactor.diagnose(output)[0]?.severity).toBe("info")
    } finally {
      await repo.cleanup()
    }
  })
})
