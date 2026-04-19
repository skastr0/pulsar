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
      })
      expect(output.siloed).toEqual([{ file: soloPath, author: "Alice" }])
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
})
