import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  loadProjectModuleCalibrationContext,
  makePulsarRuntime,
  withDetachedWorktreeAtRef,
} from "../runtime.js"

const writeRepoFile = async (repoPath: string, relPath: string, content: string): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

describe("pulsar runtime project modules", () => {
  test("returns no calibration context when no project module manifest exists", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))
      expect(context).toBeUndefined()
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("loads repo-local project module manifest into calibration context", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/local.mjs",
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
        ".pulsar/project-modules.json",
        JSON.stringify(
          {
            modules: [
              {
                id: "repo.local-module",
                kind: "repo-local",
                path: ".pulsar/modules/local.mjs",
              },
              {
                id: "disabled",
                kind: "repo-local",
                path: ".pulsar/modules/missing.mjs",
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

  test("repo-local project module source changes update calibration fingerprints", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      const writeModule = (marker: string) =>
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

      await writeModule("first")
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

      const first = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))
      await writeModule("second")
      const second = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))

      expect(first?.fingerprint).not.toBe(second?.fingerprint)
      expect(first?.activeModules[0]?.sourceFingerprint).not.toBe(
        second?.activeModules[0]?.sourceFingerprint,
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("commit observation resolves project module calibration from each target worktree", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
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
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      )
      await writeRepoFile(repoPath, "src/index.ts", "export const ready = true\n")
      sh("git", ["add", "."], repoPath)
      sh("git", ["commit", "-q", "-m", "initial"], repoPath)

      const writeModule = (marker: string) =>
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

      await writeModule("first")
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
      sh("git", ["commit", "-q", "-m", "add first project module"], repoPath)
      const firstSha = sh("git", ["rev-parse", "HEAD"], repoPath)

      await writeModule("second")
      sh("git", ["add", ".pulsar/modules/local.mjs"], repoPath)
      sh("git", ["commit", "-q", "-m", "update project module source"], repoPath)
      const secondSha = sh("git", ["rev-parse", "HEAD"], repoPath)

      const firstDetachedContext = await Effect.runPromise(
        withDetachedWorktreeAtRef(repoPath, firstSha, ({ worktreePath }) =>
          loadProjectModuleCalibrationContext(worktreePath),
        ),
      )
      const secondContext = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))
      expect(firstDetachedContext?.fingerprint).not.toBe(secondContext?.fingerprint)

      const { engine } = await Effect.runPromise(makePulsarRuntime(repoPath))
      const first = await Effect.runPromise(engine.observeCommit(repoPath, firstSha))
      const second = await Effect.runPromise(engine.observeCommit(repoPath, secondSha))

      expect(first.calibration?.fingerprint).toBeDefined()
      expect(second.calibration?.fingerprint).toBeDefined()
      expect(first.calibration?.fingerprint).not.toBe(second.calibration?.fingerprint)
      expect(first.calibration?.active_modules[0]?.source_fingerprint).not.toBe(
        second.calibration?.active_modules[0]?.source_fingerprint,
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
