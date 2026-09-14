import { describe, expect, test } from "bun:test"
import {
  collectGitStdout,
  forEachGitLine,
  GitSubprocessLimitExceeded,
} from "../shared-git.js"
import { listAddedLinesByFileInMatureWindow } from "../shared-history-lines.js"
import { execGit, listTrackedFiles, readFileAtCommit } from "../shared-history-git.js"
import { createGitTestRepo } from "./git-test-repo.js"

describe("bounded git subprocess IO", () => {
  test("streams the same lines collectGitStdout.split would produce", async () => {
    const repo = await createGitTestRepo("pulsar-shared-git-split-")
    try {
      await repo.write("src/a.ts", "export const a = 1\n")
      await repo.commitAll({
        message: "introduce",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.write("src/a.ts", "export const a = 2\nexport const b = 3\n")
      await repo.commitAll({
        message: "edit",
        dateIso: "2024-01-02T00:00:00Z",
      })

      const args = ["log", "--format=__commit__%x00%H%x00%cI", "--name-only", "--", "src/a.ts"]
      const raw = await collectGitStdout(repo.root, args)
      const streamed: Array<string> = []
      await forEachGitLine(repo.root, args, (line) => {
        streamed.push(line)
      })

      expect(streamed).toEqual(raw.split("\n"))
    } finally {
      await repo.cleanup()
    }
  })

  test("fails closed when stdout exceeds the caller ceiling", async () => {
    const repo = await createGitTestRepo("pulsar-shared-git-limit-")
    try {
      await repo.write("src/big.ts", `${"x".repeat(1024)}\n`)
      await repo.commitAll({
        message: "big file",
        dateIso: "2024-01-01T00:00:00Z",
      })

      let thrown: unknown
      try {
        await collectGitStdout(repo.root, ["show", "HEAD:src/big.ts"], { maxBytes: 64 })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(GitSubprocessLimitExceeded)
      expect(thrown).toMatchObject({ maxBytes: 64 })
    } finally {
      await repo.cleanup()
    }
  })

  test("execGit still returns small stdout and missing-path shows", async () => {
    const repo = await createGitTestRepo("pulsar-shared-git-small-")
    try {
      await repo.write("src/ok.ts", "export const ok = true\n")
      const sha = await repo.commitAll({
        message: "ok",
        dateIso: "2024-01-01T00:00:00Z",
      })

      expect((await execGit(repo.root, ["rev-parse", "HEAD"])).trim()).toBe(sha)
      expect(await readFileAtCommit(repo.root, sha, "src/ok.ts")).toBe("export const ok = true\n")
      expect(await readFileAtCommit(repo.root, sha, "src/missing.ts")).toBeUndefined()
      expect(
        await listTrackedFiles(repo.root, {
          includeExtensions: [".ts"],
          excludeGlobs: [],
        }),
      ).toEqual(["src/ok.ts"])
    } finally {
      await repo.cleanup()
    }
  })

  test("streamed mature added-line parse remaps rename targets", async () => {
    const repo = await createGitTestRepo("pulsar-shared-git-mature-")
    try {
      await repo.write("src/original.ts", "export const keep = 1\nexport const drop = 2\n")
      await repo.commitAll({
        message: "introduce",
        dateIso: "2024-01-01T00:00:00Z",
      })
      await repo.rename("src/original.ts", "src/renamed.ts", {
        message: "rename",
        dateIso: "2024-01-10T00:00:00Z",
      })
      await repo.write("src/renamed.ts", "export const keep = 1\n")
      await repo.commitAll({
        message: "drop line",
        dateIso: "2024-01-20T00:00:00Z",
      })

      const added = await listAddedLinesByFileInMatureWindow(
        repo.root,
        "2024-01-01T00:00:00.000Z",
        "2024-01-15T00:00:00.000Z",
        "2024-01-20T00:00:00.000Z",
        { includeExtensions: [".ts"], excludeGlobs: [] },
      )

      expect([...added.keys()]).toEqual(["src/renamed.ts"])
      expect(added.get("src/renamed.ts")).toEqual(["export const keep = 1", "export const drop = 2"])
    } finally {
      await repo.cleanup()
    }
  })
})
