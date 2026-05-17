import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import { TsLd01, TsSl04, TsProjectLayer } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"
import { loadProjectModuleCalibrationContext } from "../runtime-calibration.js"
import {
  makePulsarRuntime,
  withDetachedWorktreeAtRef,
} from "../runtime.js"

const testDir = dirname(fileURLToPath(import.meta.url))
const effectProjectModuleSource = pathToFileURL(
  join(testDir, "../../../project-module-effect/src/index.ts"),
).href

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

  test("project module calibration fingerprints are stable across checkout paths", async () => {
    const firstRepoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    const secondRepoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      const writeProjectModule = async (repoPath: string) => {
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
              ],
            },
            null,
            2,
          ),
        )
      }

      await writeProjectModule(firstRepoPath)
      await writeProjectModule(secondRepoPath)

      const first = await Effect.runPromise(loadProjectModuleCalibrationContext(firstRepoPath))
      const second = await Effect.runPromise(loadProjectModuleCalibrationContext(secondRepoPath))

      expect(first?.repoFacts.metadata?.manifestPath).toBe(".pulsar/project-modules.json")
      expect(second?.repoFacts.metadata?.manifestPath).toBe(".pulsar/project-modules.json")
      expect(first?.fingerprint).toBe(second?.fingerprint)
    } finally {
      await rm(firstRepoPath, { recursive: true, force: true })
      await rm(secondRepoPath, { recursive: true, force: true })
    }
  })

  test("repo-local project module dependencies resolve from the scored worktree", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        "package.json",
        JSON.stringify(
          {
            name: "repo-local-module-deps",
            private: true,
            dependencies: {
              "@acme/module-helper": "workspace:*",
            },
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/package.json",
        JSON.stringify(
          {
            name: "@acme/module-helper",
            version: "1.0.0",
            type: "module",
            exports: "./index.mjs",
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/index.mjs",
        "export const moduleId = 'repo.local-with-deps'\n",
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/local.mjs",
        [
          "import { moduleId } from '@acme/module-helper'",
          "export default {",
          "  id: moduleId,",
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
                id: "repo.local-with-deps",
                kind: "repo-local",
                path: ".pulsar/modules/local.mjs",
              },
            ],
          },
          null,
          2,
        ),
      )

      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))

      expect(context?.activeModules[0]?.id).toBe("repo.local-with-deps")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("repo-local project module devDependencies resolve from the scored worktree", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        "package.json",
        JSON.stringify(
          {
            name: "repo-local-module-dev-deps",
            private: true,
            devDependencies: {
              "@acme/module-helper": "workspace:*",
            },
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/package.json",
        JSON.stringify(
          {
            name: "@acme/module-helper",
            version: "1.0.0",
            type: "module",
            exports: "./index.mjs",
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/index.mjs",
        "export const moduleId = 'repo.local-with-dev-deps'\n",
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/local.mjs",
        [
          "import { moduleId } from '@acme/module-helper'",
          "export default {",
          "  id: moduleId,",
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
                id: "repo.local-with-dev-deps",
                kind: "repo-local",
                path: ".pulsar/modules/local.mjs",
              },
            ],
          },
          null,
          2,
        ),
      )

      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))

      expect(context?.activeModules[0]?.id).toBe("repo.local-with-dev-deps")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("repo-local project module can wrap a package with the same manifest id", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        "package.json",
        JSON.stringify(
          {
            name: "repo-local-module-same-id-deps",
            private: true,
            dependencies: {
              "@acme/module-helper": "workspace:*",
            },
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/package.json",
        JSON.stringify(
          {
            name: "@acme/module-helper",
            version: "1.0.0",
            type: "module",
            exports: "./index.mjs",
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/index.mjs",
        "export const moduleId = '@acme/module-helper'\n",
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/local.mjs",
        [
          "import { moduleId } from '@acme/module-helper'",
          "export default {",
          "  id: moduleId,",
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
                id: "@acme/module-helper",
                kind: "repo-local",
                path: ".pulsar/modules/local.mjs",
              },
            ],
          },
          null,
          2,
        ),
      )

      const context = await Effect.runPromise(loadProjectModuleCalibrationContext(repoPath))

      expect(context?.activeModules[0]?.id).toBe("@acme/module-helper")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("loads the Effect package module and calibrates TS signal callback names", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    try {
      await writeRepoFile(
        repoPath,
        "package.json",
        JSON.stringify({ name: "effect-callback-integration", private: true }, null, 2),
      )
      await writeRepoFile(
        repoPath,
        "tsconfig.json",
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "Bundler",
              strict: true,
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@skastr0/pulsar-project-module-effect/package.json",
        JSON.stringify(
          {
            name: "@skastr0/pulsar-project-module-effect",
            version: "0.0.0",
            type: "module",
            exports: "./index.mjs",
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@skastr0/pulsar-project-module-effect/index.mjs",
        [
          `export { default } from ${JSON.stringify(effectProjectModuleSource)}`,
          `export * from ${JSON.stringify(effectProjectModuleSource)}`,
        ].join("\n"),
      )
      await writeRepoFile(
        repoPath,
        ".pulsar/project-modules.json",
        JSON.stringify(
          {
            modules: [
              {
                id: "@skastr0/pulsar-project-module-effect",
                kind: "package",
                packageName: "@skastr0/pulsar-project-module-effect",
              },
            ],
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "src/effect.ts",
        `
declare const Effect: {
  fn: (label: string) => (body: unknown) => unknown
}

export const create = Effect.fn("Session.create")(function* (_input: unknown) {
  if (ready() && enabled()) return yield* run()
  return yield* fallback()
})

export function defaultEffect(EffectApi: { orElseSucceed: (fallback: () => void) => void }) {
  return EffectApi.orElseSucceed(() => {})
}
`,
      )

      const calibrationContext = await Effect.runPromise(
        loadProjectModuleCalibrationContext(repoPath),
      )
      expect(calibrationContext?.activeModules[0]?.id).toBe(
        "@skastr0/pulsar-project-module-effect",
      )

      const out = await Effect.runPromise(
        TsLd01.compute(TsLd01.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              TsProjectLayer(repoPath),
              Layer.succeed(CalibrationContextTag, calibrationContext!),
            ),
          ),
        ),
      )

      expect(out.functions.find((fn) => fn.name === "Session.create")?.complexity).toBe(3)
      expect(out.calibrationDecisions[0]).toMatchObject({
        moduleId: "@skastr0/pulsar-project-module-effect",
        processorId: "effect-callback-context-names",
        ruleId: "effect.callback-context-name.v1",
      })

      const pureTsNoops = await Effect.runPromise(
        TsSl04.compute(TsSl04.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              TsProjectLayer(repoPath),
              Layer.succeed(SignalContextTag, {
                gitSha: "TEST",
                worktreePath: repoPath,
                changedHunks: [],
              }),
            ),
          ),
        ),
      )
      expect(pureTsNoops.stubs).toHaveLength(1)
      expect(pureTsNoops.calibrationDecisions).toHaveLength(0)
      expect(TsSl04.score(pureTsNoops)).toBeLessThan(1)

      const effectCalibratedNoops = await Effect.runPromise(
        TsSl04.compute(TsSl04.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              TsProjectLayer(repoPath),
              Layer.succeed(SignalContextTag, {
                gitSha: "TEST",
                worktreePath: repoPath,
                changedHunks: [],
              }),
              Layer.succeed(CalibrationContextTag, calibrationContext!),
            ),
          ),
        ),
      )
      expect(effectCalibratedNoops.stubs).toHaveLength(0)
      expect(TsSl04.score(effectCalibratedNoops)).toBe(1)
      expect(effectCalibratedNoops.calibrationDecisions[0]).toMatchObject({
        moduleId: "@skastr0/pulsar-project-module-effect",
        processorId: "effect-or-else-succeed-noops",
        ruleId: "effect.orElseSucceed.fallback-noop.v1",
      })
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

  test("detached worktree project modules bundle repo-local dependencies from the scored repo", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-modules-"))
    const stateRoot = await mkdtemp(join(tmpdir(), "pulsar-runtime-project-module-state-"))
    const previousNodeEnv = process.env.NODE_ENV
    const previousPulsarStateHome = process.env.PULSAR_STATE_HOME
    try {
      sh("git", ["init", "-q", "-b", "main"], repoPath)
      sh("git", ["config", "user.email", "test@test.test"], repoPath)
      sh("git", ["config", "user.name", "test"], repoPath)
      sh("git", ["config", "commit.gpgsign", "false"], repoPath)
      await writeRepoFile(
        repoPath,
        "package.json",
        JSON.stringify(
          {
            name: "repo-local-module-detached-deps",
            private: true,
            dependencies: {
              "@acme/module-helper": "1.0.0",
            },
          },
          null,
          2,
        ),
      )
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
      await writeRepoFile(
        repoPath,
        ".pulsar/modules/local.ts",
        [
          "import { marker } from '@acme/module-helper'",
          "const bundled = import.meta.url.includes('/.pulsar-bundle/')",
          "export default {",
          "  id: 'repo.local-module',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  configHash: `${marker}:${bundled ? 'bundled' : 'unbundled'}`,",
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
                path: ".pulsar/modules/local.ts",
              },
            ],
          },
          null,
          2,
        ),
      )
      sh("git", ["add", "package.json", "tsconfig.json", "src", ".pulsar"], repoPath)
      sh("git", ["commit", "-q", "-m", "add project module"], repoPath)
      const sha = sh("git", ["rev-parse", "HEAD"], repoPath)

      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/package.json",
        JSON.stringify(
          {
            name: "@acme/module-helper",
            version: "1.0.0",
            type: "module",
            exports: "./index.mjs",
          },
          null,
          2,
        ),
      )
      await writeRepoFile(
        repoPath,
        "node_modules/@acme/module-helper/index.mjs",
        "export const marker = 'helper-loaded'\n",
      )

      process.env.NODE_ENV = "production"
      process.env.PULSAR_STATE_HOME = stateRoot
      const detachedContext = await Effect.runPromise(
        withDetachedWorktreeAtRef(repoPath, sha, ({ worktreePath }) => {
          expect(
            existsSync(join(worktreePath, "node_modules", "@acme", "module-helper")),
          ).toBe(false)
          return loadProjectModuleCalibrationContext(worktreePath, {
            dependencyRoot: repoPath,
          })
        }),
      )

      expect(detachedContext?.activeModules[0]?.configHash).toBe("helper-loaded:bundled")
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      if (previousPulsarStateHome === undefined) {
        delete process.env.PULSAR_STATE_HOME
      } else {
        process.env.PULSAR_STATE_HOME = previousPulsarStateHome
      }
      await rm(repoPath, { recursive: true, force: true })
      await rm(stateRoot, { recursive: true, force: true })
    }
  }, 120_000)
})
