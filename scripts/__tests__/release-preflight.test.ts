import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReleaseIdentity,
  runReleasePreflight,
  type ReleaseIdentity,
} from "../release-preflight.ts"

const matchingIdentity = (): ReleaseIdentity => ({
  releaseTag: "v1.2.3",
  rootVersion: "1.2.3",
  headCommit: "a".repeat(40),
  tagCommit: "a".repeat(40),
  workspaces: [
    {
      path: "packages/example/package.json",
      name: "@skastr0/example",
      version: "1.2.3",
    },
  ],
})

const git = async (cwd: string, args: ReadonlyArray<string>): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
    },
  })
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
}

const createReleaseRepo = async (options?: {
  readonly workspaceVersion?: string
  readonly commitAfterTag?: boolean
}): Promise<string> => {
  const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-release-preflight-"))
  await mkdir(join(repoRoot, "packages", "example"), { recursive: true })
  await writeFile(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ version: "1.2.3", workspaces: ["packages/*"] }, null, 2)}\n`,
  )
  await writeFile(
    join(repoRoot, "packages", "example", "package.json"),
    `${JSON.stringify(
      {
        name: "@skastr0/example",
        version: options?.workspaceVersion ?? "1.2.3",
      },
      null,
      2,
    )}\n`,
  )
  await git(repoRoot, ["init", "-q", "-b", "main"])
  await git(repoRoot, ["config", "user.email", "pulsar@example.test"])
  await git(repoRoot, ["config", "user.name", "Pulsar Fixture"])
  await git(repoRoot, ["add", "."])
  await git(repoRoot, ["commit", "-qm", "fixture"])
  await git(repoRoot, ["tag", "v1.2.3"])
  if (options?.commitAfterTag === true) {
    await writeFile(join(repoRoot, "README.md"), "new commit\n")
    await git(repoRoot, ["add", "README.md"])
    await git(repoRoot, ["commit", "-qm", "move head"])
  }
  return repoRoot
}

describe("release identity contract", () => {
  test.each(["1.2.3", "v1.2", "v1.2.3-beta.1", "v01.2.3"])(
    "rejects non-vX.Y.Z tag %s",
    (releaseTag) => {
      expect(() => assertReleaseIdentity({ ...matchingIdentity(), releaseTag })).toThrow(
        "must match vX.Y.Z exactly",
      )
    },
  )

  test("rejects a tag version that differs from the root", () => {
    expect(() =>
      assertReleaseIdentity({ ...matchingIdentity(), releaseTag: "v1.2.4" }),
    ).toThrow("does not match root version 1.2.3")
  })

  test("rejects a tag that does not resolve to checked-out HEAD", () => {
    expect(() =>
      assertReleaseIdentity({ ...matchingIdentity(), tagCommit: "b".repeat(40) }),
    ).toThrow("not checked-out HEAD")
  })

  test("rejects workspace version drift", () => {
    expect(() =>
      assertReleaseIdentity({
        ...matchingIdentity(),
        workspaces: [
          {
            path: "packages/example/package.json",
            name: "@skastr0/example",
            version: "1.2.2",
          },
        ],
      }),
    ).toThrow("Workspace version drift from 1.2.3")
  })
})

describe("release preflight repository inspection", () => {
  test("resolves an existing release tag to the checked-out commit", async () => {
    const repoRoot = await createReleaseRepo()
    try {
      const result = await runReleasePreflight(repoRoot, "v1.2.3")
      expect(result).toMatchObject({
        releaseTag: "v1.2.3",
        version: "1.2.3",
        workspaceCount: 1,
      })
      expect(result.commit).toHaveLength(40)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("rejects when the existing release tag no longer resolves to HEAD", async () => {
    const repoRoot = await createReleaseRepo({ commitAfterTag: true })
    try {
      await expect(runReleasePreflight(repoRoot, "v1.2.3")).rejects.toThrow(
        "not checked-out HEAD",
      )
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("rejects workspace manifest version drift discovered from root workspaces", async () => {
    const repoRoot = await createReleaseRepo({ workspaceVersion: "1.2.2" })
    try {
      await expect(runReleasePreflight(repoRoot, "v1.2.3")).rejects.toThrow(
        "Workspace version drift from 1.2.3",
      )
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
