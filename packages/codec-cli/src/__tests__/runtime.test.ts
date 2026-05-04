import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { loadProjectModuleCalibrationContext } from "../runtime.js"

const writeRepoFile = async (repoPath: string, relPath: string, content: string): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

describe("codec runtime project modules", () => {
  test("returns no calibration context when no project module manifest exists", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "taste-runtime-project-modules-"))
    try {
      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))
      expect(context).toBeUndefined()
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("loads repo-local project module manifest into calibration context", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "taste-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        ".taste-codec/modules/local.mjs",
        [
          "export default {",
          "  id: 'repo.local-module',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  processors: []",
          "}",
        ].join("\n"),
      )
      await writeRepoFile(
        repoPath,
        ".taste-codec/project-modules.json",
        JSON.stringify(
          {
            modules: [
              {
                id: "repo.local-module",
                kind: "repo-local",
                path: ".taste-codec/modules/local.mjs",
              },
              {
                id: "disabled",
                kind: "repo-local",
                path: ".taste-codec/modules/missing.mjs",
                enabled: false,
              },
            ],
          },
          null,
          2,
        ),
      )

      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))

      expect(context?.repoFacts.metadata?.activeModuleCount).toBe(1)
      expect(context?.activeModules.map((module) => module.id)).toEqual([
        "repo.local-module",
      ])
      expect(typeof context?.fingerprint).toBe("string")
      expect(context?.repoFacts.fingerprint.startsWith("project-modules:")).toBe(true)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })
})
