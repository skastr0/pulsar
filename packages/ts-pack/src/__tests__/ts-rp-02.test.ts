import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { Effect, Layer, Schema } from "effect"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import {
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { createTempRepo } from "./test-repo.js"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsRp02, type ImportEdge, type TsRp02Output } from "../signals/ts-rp-02-pr-size.js"
import { TsProjectLayer } from "../ts-project.js"
import type { TempRepo } from "./test-repo.js"

const git = (repoRoot: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2025-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2025-01-01T00:00:00Z",
    },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const writePackage = async (
  repo: TempRepo,
  slug: string,
  name: string,
): Promise<void> => {
  await repo.writeJson(`packages/${slug}/package.json`, {
    name,
    version: "0.0.0",
    private: true,
    types: "./src/index.ts",
    exports: {
      ".": "./src/index.ts",
    },
  })
  await repo.writeJson(`packages/${slug}/tsconfig.json`, {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  })
}

const computeWithContext = async (
  repo: TempRepo,
  config: typeof TsRp02.defaultConfig,
  context: {
    readonly gitSha?: string
    readonly changedHunks: ReadonlyArray<{
      readonly file: string
      readonly oldStart: number
      readonly oldLines: number
      readonly newStart: number
      readonly newLines: number
    }>
  },
): Promise<TsRp02Output> =>
  Effect.runPromise(
    TsRp02.compute(
      config,
      new Map(),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          TsProjectLayer(repo.root),
          Layer.succeed(SignalContextTag, {
            gitSha: context.gitSha ?? "TEST",
            worktreePath: repo.root,
            changedHunks: context.changedHunks,
          }),
        ),
      ),
    ),
  )

const run = async (
  repo: TempRepo,
  config = TsRp02.defaultConfig,
  changedHunks: ReadonlyArray<{
    readonly file: string
    readonly oldStart: number
    readonly oldLines: number
    readonly newStart: number
    readonly newLines: number
  }> = [],
): Promise<TsRp02Output> =>
  computeWithContext(repo, config, {
    changedHunks,
  })

const makeEdge = (overrides: Partial<ImportEdge> = {}): ImportEdge => ({
  file: "/repo/src/feature.ts",
  line: 1,
  fromPackage: "@repo/app",
  toPackage: "@repo/core",
  isCrossBoundary: false,
  fromBoundary: undefined,
  toBoundary: undefined,
  ...overrides,
})

const scoreOutput = (overrides: Partial<TsRp02Output> = {}): TsRp02Output => ({
  linesAdded: 0,
  linesDeleted: 0,
  filesChanged: [],
  fileStats: [],
  packagesTouched: [],
  newCrossPackageEdges: [],
  newCrossBoundaryEdges: [],
  diffMode: "changed-hunks-fallback",
  dependencyDeltaMode: "unavailable",
  sizeCategory: "small",
  sizePenalty: 0,
  diagnosticLimit: 10,
  ...overrides,
})

const relativeFiles = (repoRoot: string, files: ReadonlyArray<string>): ReadonlyArray<string> =>
  files.map((file) => file.replace(repoRoot, ""))

const normalizedOutput = (repoRoot: string, out: TsRp02Output): unknown => ({
  ...out,
  filesChanged: relativeFiles(repoRoot, out.filesChanged),
  fileStats: out.fileStats.map((stat) => ({
    ...stat,
    file: stat.file.replace(repoRoot, ""),
  })),
  newCrossPackageEdges: out.newCrossPackageEdges.map((edge) => ({
    ...edge,
    file: edge.file.replace(repoRoot, ""),
  })),
  newCrossBoundaryEdges: out.newCrossBoundaryEdges.map((edge) => ({
    ...edge,
    file: edge.file.replace(repoRoot, ""),
  })),
  factorLedger: undefined,
})

const normalizedDiagnostics = (repoRoot: string, out: TsRp02Output) =>
  TsRp02.diagnose(out).map((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message.replaceAll(repoRoot, "$ROOT"),
    location: diagnostic.location === undefined
      ? undefined
      : {
          ...diagnostic.location,
          file: diagnostic.location.file.replace(repoRoot, ""),
        },
    data: normalizeRootInValue(repoRoot, diagnostic.data),
  }))

const normalizeRootInValue = (repoRoot: string, value: unknown): unknown =>
  value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value).replaceAll(repoRoot, "$ROOT"))

describe("TS-RP-02 PR size and dependency delta", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-rp-02-")
    git(repo.root, ["init", "-q", "-b", "main"])
    git(repo.root, ["config", "user.email", "test@example.com"])
    git(repo.root, ["config", "user.name", "Test"])
    git(repo.root, ["config", "commit.gpgsign", "false"])
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Initial commit"])
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("declares identity, pack registration, config schema, and factor ledger", async () => {
    await repo.write("src/value.ts", "export const value = 1\n")

    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-RP-02"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("TS-RP-02")
    const decoded = Schema.decodeUnknownSync(TsRp02.configSchema)(TsRp02.defaultConfig)
    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      changedHunks: [
        { file: "src/value.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 1 },
      ],
    })
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsRp02).toMatchObject({
      id: "TS-RP-02-pr-size",
      title: "PR size",
      aliases: ["TS-RP-02"],
      tier: 1,
      category: "review-pain",
      kind: "structural",
      cacheVersion: "branch-range-factor-policy-diagnostic-limit-package-import-edges-untracked-upstream-aligned-v1",
      inputs: [],
    })
    expect(decoded).toEqual(TsRp02.defaultConfig)
    expect(registered?.id).toBe(TsRp02.id)
    expect(registered?.cacheVersion).toContain(TsRp02.cacheVersion)
    expect(registry.byId.get("TS-RP-02")?.id).toBe(TsRp02.id)
    expect(factorLedger?.signalId).toBe(TsRp02.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        value: TsRp02.defaultConfig.exclude_globs,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.test_globs",
        value: TsRp02.defaultConfig.test_globs,
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.boundary_rules",
        value: [],
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "pr_size.penalty_weight",
        value: 0,
        source: "computed",
        scoreRole: "penalty",
      }),
    )
  }, 120_000)

  test("computes basic PR metrics via changed hunks fallback", async () => {
    const out = await run(repo, TsRp02.defaultConfig, [
      { file: "file1.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 3 },
    ])

    expect(out.diffMode).toBe("changed-hunks-fallback")
    expect(out.dependencyDeltaMode).toBe("unavailable")
    expect(relativeFiles(repo.root, out.filesChanged)).toEqual(["/file1.ts"])
    expect(out.fileStats).toEqual([
      {
        file: `${repo.root}/file1.ts`,
        linesAdded: 3,
        linesDeleted: 0,
        totalLines: 3,
      },
    ])
    expect(out.linesAdded).toBe(3)
    expect(out.linesDeleted).toBe(0)
    expect(out.sizeCategory).toBe("small")
    expect(out.sizePenalty).toBe(0)
    expect(out.diagnosticLimit).toBe(10)
  }, 120_000)

  test("detects only newly added cross-package imports", async () => {
    await repo.writeJson("packages/a/package.json", {
      name: "@repo/a",
      private: true,
    })
    await repo.write(
      "packages/a/src/index.ts",
      `
export function helper(): string { return "a"; }
`,
    )
    await repo.writeJson("packages/b/package.json", {
      name: "@repo/b",
      private: true,
    })
    await repo.write(
      "packages/b/src/legacy.ts",
      `
export function legacy(): string { return "legacy"; }
`,
    )

    await repo.write(
      "packages/b/src/index.ts",
      `
import { legacy } from "./legacy";
import { helper } from "../../a/src/index";
export function useHelper(): string { return helper(); }
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add package import fixture"])

    await repo.write(
      "packages/b/src/index.ts",
      `
import { helper } from "../../a/src/index";
import { legacy } from "./legacy";
export function useHelper(): string { return helper() + legacy(); }
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Reorder package imports"])

    const reorder = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })
    expect(reorder.newCrossPackageEdges).toEqual([])

    await repo.write(
      "packages/a/src/extra.ts",
      `
export function extra(): string { return "extra"; }
`,
    )
    await repo.write(
      "packages/b/src/index.ts",
      `
import { helper } from "../../a/src/index";
import { extra } from "../../a/src/extra";
import { legacy } from "./legacy";
export function useHelper(): string { return helper() + extra() + legacy(); }
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add new cross package import"])

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })

    expect(out.diffMode).toBe("git-commit-range")
    expect(out.dependencyDeltaMode).toBe("measured")
    expect(out.packagesTouched).toEqual(["@repo/a", "@repo/b"])
    expect(out.newCrossPackageEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/b/src/index.ts`,
        line: 3,
        fromPackage: "@repo/b",
        toPackage: "@repo/a",
        isCrossBoundary: false,
      }),
    ])
    expect(TsRp02.score(out)).toBeLessThan(1)
    expect(TsRp02.diagnose(out)).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        message: "New cross-package import: @repo/b → @repo/a",
        location: { file: `${repo.root}/packages/b/src/index.ts`, line: 3 },
      }),
    )
  }, 120_000)

  test("added import edges are tied to the added declaration line", async () => {
    await repo.writeJson("packages/a/package.json", {
      name: "@repo/a",
      private: true,
    })
    await repo.writeJson("packages/b/package.json", {
      name: "@repo/b",
      private: true,
    })
    await repo.write(
      "packages/a/src/api.ts",
      [
        "export interface Token { value: string }",
        "export function helper(): string { return 'helper' }",
        "export function helper2(): string { return 'helper2' }",
        "",
      ].join("\n"),
    )
    await repo.write(
      "packages/b/src/index.ts",
      [
        "import { helper } from '../../a/src/api'",
        "export const value = helper()",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add same-specifier base import"])

    await repo.write(
      "packages/b/src/index.ts",
      [
        "import { helper } from '../../a/src/api'",
        "import type { Token } from '../../a/src/api'",
        "const token: Token = { value: helper() }",
        "export const value = token.value",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add same-specifier type import"])

    const sameSpecifier = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })
    expect(sameSpecifier.newCrossPackageEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/b/src/index.ts`,
        line: 2,
        fromPackage: "@repo/b",
        toPackage: "@repo/a",
      }),
    ])

    await repo.write(
      "packages/b/src/index.ts",
      [
        "import { helper } from '../../a/src/api'",
        "import type { Token } from '../../a/src/api'",
        "import {",
        "  helper2,",
        "} from '../../a/src/api'",
        "const token: Token = { value: helper() + helper2() }",
        "export const value = token.value",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add multiline import"])

    const multiline = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })
    expect(multiline.newCrossPackageEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/b/src/index.ts`,
        line: 3,
        fromPackage: "@repo/b",
        toPackage: "@repo/a",
      }),
    ])
  }, 120_000)

  test("added dependency edges include workspace package names and local aliases", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@repo/app": ["packages/app/src/index.ts"],
          "@repo/core": ["packages/core/src/index.ts"],
          "@/*": ["packages/app/src/*"],
        },
      },
      include: ["**/*.ts"],
    })
    await writePackage(repo, "app", "@repo/app")
    await writePackage(repo, "core", "@repo/core")
    await repo.write("packages/core/src/index.ts", "export const core = 1\n")
    await repo.write("packages/app/src/local.ts", "export const local = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      [
        "export const app = 1",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add internal import base"])

    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { core } from '@repo/core'",
        "export const app = core",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add workspace package import"])

    const workspaceImport = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })
    expect(workspaceImport.newCrossPackageEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/app/src/index.ts`,
        line: 1,
        fromPackage: "@repo/app",
        toPackage: "@repo/core",
      }),
    ])

    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { core } from '@repo/core'",
        "import { local } from '@/local'",
        "export const app = core + local",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add local alias import"])

    const aliasImport = await computeWithContext(
      repo,
      {
        ...TsRp02.defaultConfig,
        boundary_rules: [
          { name: "entry", globs: ["packages/app/src/index.ts"] },
          { name: "local", globs: ["packages/app/src/local.ts"] },
        ],
      },
      {
        gitSha: "HEAD",
        changedHunks: [],
      },
    )
    expect(aliasImport.newCrossPackageEdges).toEqual([])
    expect(aliasImport.newCrossBoundaryEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/app/src/index.ts`,
        line: 2,
        fromPackage: "@repo/app",
        toPackage: "@repo/app",
        fromBoundary: "entry",
        toBoundary: "local",
        isCrossBoundary: true,
      }),
    ])
  }, 120_000)

  test("external package imports resolved under node_modules are not workspace package edges", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["packages/*/src/**/*.ts"],
    })
    await writePackage(repo, "app", "@repo/app")
    await repo.writeJson("node_modules/effect/package.json", {
      name: "effect",
      version: "0.0.0",
      types: "./index.d.ts",
    })
    await repo.write(
      "node_modules/effect/index.d.ts",
      "export declare const Effect: { succeed(value: number): number }\n",
    )
    await repo.write(
      "packages/app/src/index.ts",
      [
        "export const app = 1",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add app without external import"])

    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { Effect } from 'effect'",
        "export const app = Effect.succeed(1)",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add external import"])

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })

    expect(out.newCrossPackageEdges).toEqual([])
    expect(TsRp02.diagnose(out)).not.toContainEqual(
      expect.objectContaining({
        message: "New cross-package import: @repo/app → temp-workspace",
      }),
    )
  }, 120_000)

  test("package-local tsconfig aliases resolve even when they are not in the seed tsconfig", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["packages/*/src/**/*.ts"],
    })
    await writePackage(repo, "app", "@repo/app")
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
      include: ["src/**/*.ts"],
    })
    await repo.write("packages/app/src/local.ts", "export const local = 1\n")
    await repo.write("packages/app/src/index.ts", "export const app = 1\n")
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add non-seed alias fixture"])

    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { local } from '@/local'",
        "export const app = local",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add non-seed alias import"])

    const out = await computeWithContext(
      repo,
      {
        ...TsRp02.defaultConfig,
        boundary_rules: [
          { name: "entry", globs: ["packages/app/src/index.ts"] },
          { name: "local", globs: ["packages/app/src/local.ts"] },
        ],
      },
      {
        gitSha: "HEAD",
        changedHunks: [],
      },
    )

    expect(out.newCrossPackageEdges).toEqual([])
    expect(out.newCrossBoundaryEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/app/src/index.ts`,
        line: 1,
        fromPackage: "@repo/app",
        toPackage: "@repo/app",
        fromBoundary: "entry",
        toBoundary: "local",
        isCrossBoundary: true,
      }),
    ])
  }, 120_000)

  test("bare workspace package-name imports record package edges without tsconfig paths", async () => {
    await writePackage(repo, "app", "@repo/app")
    await writePackage(repo, "core", "@repo/core")
    await repo.write("packages/core/src/index.ts", "export const core = 1\n")
    await repo.write("packages/app/src/index.ts", "export const app = 1\n")
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add bare package-name fixture"])

    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { core } from '@repo/core'",
        "export const app = core",
        "",
      ].join("\n"),
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add bare package-name import"])

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })

    expect(out.newCrossPackageEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/app/src/index.ts`,
        line: 1,
        fromPackage: "@repo/app",
        toPackage: "@repo/core",
        fromBoundary: undefined,
        toBoundary: undefined,
        isCrossBoundary: false,
      }),
    ])
    expect(TsRp02.score(out)).toBeLessThan(1)
  }, 120_000)

  test("size category respects budgets", async () => {
    const config = {
      ...TsRp02.defaultConfig,
      small_pr_budget: 50,
      medium_pr_budget: 100,
      large_pr_budget: 200,
    }

    const out = await run(repo, config, [
      { file: "test.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 40 },
    ])

    expect(out.sizeCategory).toBe("small")
    expect(out.sizePenalty).toBe(0)
    expect(TsRp02.score(out)).toBe(1)
  }, 120_000)

  test("score decreases with larger changes", async () => {
    const small = await run(repo, TsRp02.defaultConfig, [
      { file: "small.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 80 },
    ])
    const medium = await run(repo, TsRp02.defaultConfig, [
      { file: "medium.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 200 },
    ])
    const large = await run(repo, TsRp02.defaultConfig, [
      { file: "large.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 500 },
    ])
    const oversized = await run(repo, TsRp02.defaultConfig, [
      { file: "oversized.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 900 },
    ])

    expect(small.sizeCategory).toBe("small")
    expect(medium.sizeCategory).toBe("medium")
    expect(large.sizeCategory).toBe("large")
    expect(oversized.sizeCategory).toBe("oversized")
    expect(TsRp02.score(small)).toBe(1)
    expect(TsRp02.score(medium)).toBe(0.9)
    expect(TsRp02.score(large)).toBe(0.6)
    expect(TsRp02.score(oversized)).toBe(0.4)
    expect(TsRp02.score(small)).toBeGreaterThan(TsRp02.score(medium))
    expect(TsRp02.score(medium)).toBeGreaterThan(TsRp02.score(large))
    expect(TsRp02.score(large)).toBeGreaterThan(TsRp02.score(oversized))
  }, 120_000)

  test("project modules can tune active consolidation PR size pressure with factor provenance", async () => {
    const calibration = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [
        defineCalibrationProcessor({
          id: "active-consolidation-sprint",
          moduleId: "repo-policy",
          moduleVersion: "0.0.0",
          slot: "typescript.pr-size-policy",
          role: "factor-policy",
          priority: 10,
          fingerprint: "active-consolidation-sprint-v1",
          process: (current) =>
            Effect.succeed(
              current.value.sizeCategory === "oversized"
                ? {
                    value: {
                      ...current.value,
                      severity: "info" as const,
                      penaltyWeight: 0,
                    },
                    decisions: [{
                      moduleId: "repo-policy",
                      processorId: "active-consolidation-sprint",
                      slot: "typescript.pr-size-policy",
                      action: "tune-pr-size-pressure",
                      confidence: "high",
                      reason: "Active consolidation sprint is intentional process pressure",
                      ruleId: "repo.active-consolidation-sprint.v1",
                      factorPaths: [
                        `${current.value.factorPathPrefix}.severity`,
                        `${current.value.factorPathPrefix}.penalty_weight`,
                      ],
                      before: current.value,
                      after: {
                        ...current.value,
                        severity: "info" as const,
                        penaltyWeight: 0,
                      },
                      evidence: [{ kind: "repo-policy", value: "active consolidation sprint" }],
                    }],
                  }
                : current,
            ),
        }),
      ],
    })

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibration),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "large.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 1_200 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.sizeCategory).toBe("oversized")
    expect(out.sizePenalty).toBe(0)
    expect(out.severity).toBe("info")
    expect(TsRp02.score(out)).toBe(1)
    expect(TsRp02.diagnose(out)[0]?.severity).toBe("info")
    expect(out.calibrationDecisions?.[0]?.ruleId).toBe("repo.active-consolidation-sprint.v1")
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "pr_size.penalty_weight",
        value: 0,
        source: "module",
        attribution: expect.objectContaining({
          moduleId: "repo-policy",
          processorId: "active-consolidation-sprint",
          ruleId: "repo.active-consolidation-sprint.v1",
        }),
      }),
    )
  }, 120_000)

  test("non-finite module policy output cannot poison scores or factor paths", async () => {
    const calibration = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [
        defineCalibrationProcessor({
          id: "invalid-policy",
          moduleId: "repo-policy",
          moduleVersion: "0.0.0",
          slot: "typescript.pr-size-policy",
          role: "factor-policy",
          priority: 10,
          fingerprint: "invalid-policy-v1",
          process: (current) =>
            Effect.succeed({
              value: {
                ...current.value,
                severity: "loud" as never,
                penaltyWeight: Number.NaN,
                factorPathPrefix: "Invalid Path" as never,
              },
              decisions: [],
            }),
        }),
      ],
    })

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibration),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "large.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 500 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.sizePenalty).toBe(0.4)
    expect(out.severity).toBe("warn")
    expect(out.factorPathPrefix).toBe("pr_size")
    expect(Number.isFinite(TsRp02.score(out))).toBe(true)
    expect(TsRp02.score(out)).toBe(0.6)
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "pr_size.penalty_weight",
        value: 0.4,
      }),
    )
  }, 120_000)

  test("diff-aware fallback when hunks provided", async () => {
    const out = await run(repo, TsRp02.defaultConfig, [
      { file: "test.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 10 },
    ])

    expect(out.diffMode).toBe("changed-hunks-fallback")
    expect(out.dependencyDeltaMode).toBe("unavailable")
    expect(out.linesAdded).toBe(10)
  }, 120_000)

  test("worktree diff includes untracked TypeScript files alongside tracked changes", async () => {
    await repo.write("src/tracked.ts", "export const tracked = 1\n")
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add tracked source"])

    await repo.write("src/tracked.ts", "export const tracked = 2\n")
    await repo.write("src/untracked.ts", "export const untracked = 1\n")

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [
        { file: "src/tracked.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
        { file: "src/untracked.ts", oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 },
      ],
    })

    expect(out.diffMode).toBe("git-working-tree")
    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/tracked.ts",
      "/src/untracked.ts",
    ])
    expect(out.linesAdded).toBe(2)
    expect(out.linesDeleted).toBe(1)
  }, 120_000)

  test("missing and empty diff evidence expose applicability explicitly", async () => {
    const nonGitRepo = await createTempRepo("ts-rp-02-nongit-")
    try {
      const missing = await computeWithContext(nonGitRepo, TsRp02.defaultConfig, {
        changedHunks: [],
      })
      expect(missing.diffMode).toBe("missing")
      expect(missing.dependencyDeltaMode).toBe("unavailable")
      expect(TsRp02.outputMetadata?.(missing)).toEqual({ applicability: "insufficient_evidence" })
      expect(TsRp02.score(missing)).toBe(1)
      expect(TsRp02.diagnose(missing)).toEqual([
        { severity: "warn", message: "TS-RP-02 could not inspect git diff state" },
      ])
    } finally {
      await nonGitRepo.cleanup()
    }

    const clean = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })
    expect(clean.diffMode).toBe("git-commit-range")
    expect(clean.dependencyDeltaMode).toBe("measured")
    expect(clean.filesChanged).toEqual([])
    expect(TsRp02.outputMetadata?.(clean)).toEqual({ applicability: "not_applicable" })
    expect(TsRp02.score(clean)).toBe(1)
  }, 120_000)

  test("changed hunk fallback normalizes dot-relative and absolute paths and sorts files", async () => {
    const first = `${repo.root}/src/a.ts`

    const out = await run(repo, TsRp02.defaultConfig, [
      { file: "src/b.ts", oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 },
      { file: `./src/a.ts`, oldStart: 1, oldLines: 0, newStart: 1, newLines: 5 },
      { file: first, oldStart: 8, oldLines: 1, newStart: 8, newLines: 2 },
    ])

    expect(relativeFiles(repo.root, out.filesChanged)).toEqual(["/src/a.ts", "/src/b.ts"])
    expect(out.fileStats.map((stat) => ({
      file: stat.file.replace(repo.root, ""),
      linesAdded: stat.linesAdded,
      linesDeleted: stat.linesDeleted,
      totalLines: stat.totalLines,
    }))).toEqual([
      { file: "/src/a.ts", linesAdded: 7, linesDeleted: 1, totalLines: 8 },
      { file: "/src/b.ts", linesAdded: 3, linesDeleted: 2, totalLines: 5 },
    ])
  }, 120_000)

  test("reads committed TypeScript range diff with git pathspecs", async () => {
    await repo.write(
      "src/range.ts",
      `
export function before(): string {
  return "before"
}
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add range file"])

    await repo.write(
      "src/range.ts",
      `
export function after(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return "missing"
  }
  return normalized
}
`,
    )
    await repo.write(
      "src/range.tsx",
      `
export function View(): unknown {
  return null
}
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Change TypeScript range"])

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ),
      ),
    )

    expect(out.diffMode).toBe("git-commit-range")
    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/range.ts",
      "/src/range.tsx",
    ])
    expect(out.linesAdded).toBeGreaterThan(0)
    expect(out.linesDeleted).toBeGreaterThan(0)
  }, 120_000)

  test("uses the upstream branch range instead of only the last commit", async () => {
    git(repo.root, ["checkout", "-q", "-b", "feature"])
    git(repo.root, ["branch", "--set-upstream-to", "main"])

    await repo.write(
      "src/first.ts",
      `
export const first = 1
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add first file"])

    await repo.write(
      "src/second.ts",
      `
export const second = 2
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add second file"])

    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [],
            }),
          ),
        ),
      ),
    )

    expect(out.diffMode).toBe("git-branch-range")
    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/first.ts",
      "/src/second.ts",
    ])
  }, 120_000)

  test("aligned upstream branch does not rescore the latest commit as PR surface", async () => {
    await repo.write(
      "src/aligned.ts",
      `
export const aligned = true
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add aligned file"])
    git(repo.root, ["branch", "origin/main"])
    git(repo.root, ["branch", "--set-upstream-to", "origin/main", "main"])

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })

    expect(out.diffMode).toBe("git-branch-range")
    expect(out.filesChanged).toEqual([])
    expect(TsRp02.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    expect(TsRp02.score(out)).toBe(1)
    expect(TsRp02.diagnose(out)).toEqual([])
  }, 120_000)

  test("diagnostics include PR summary", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "HEAD",
              worktreePath: repo.root,
              changedHunks: [
                { file: "file.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 5 },
              ],
            }),
          ),
        ),
      ),
    )

    const diagnostics = TsRp02.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.message).toContain("PR surface")
  }, 120_000)

  test("large PR surfaces emit warning diagnostics", async () => {
    const diagnostics = TsRp02.diagnose(scoreOutput({
      linesAdded: 260,
      linesDeleted: 120,
      filesChanged: ["src/large.ts"],
      fileStats: [
        {
          file: "src/large.ts",
          linesAdded: 260,
          linesDeleted: 120,
          totalLines: 380,
        },
      ],
      packagesTouched: [],
      newCrossPackageEdges: [],
      newCrossBoundaryEdges: [],
      diffMode: "changed-hunks-fallback",
      sizeCategory: "large",
      sizePenalty: 0.28,
    }))

    expect(diagnostics[0]?.severity).toBe("warn")
  })

  test("diagnostics include exact payload order and honor caps", () => {
    const out = scoreOutput({
      linesAdded: 360,
      linesDeleted: 40,
      filesChanged: ["src/large.ts", "src/other.ts"],
      fileStats: [
        {
          file: "src/large.ts",
          linesAdded: 300,
          linesDeleted: 30,
          totalLines: 330,
        },
        {
          file: "src/other.ts",
          linesAdded: 60,
          linesDeleted: 10,
          totalLines: 70,
        },
      ],
      packagesTouched: ["@repo/app", "@repo/core"],
      newCrossBoundaryEdges: [
        makeEdge({
          file: "src/large.ts",
          line: 2,
          fromBoundary: "app",
          toBoundary: "core",
          isCrossBoundary: true,
        }),
      ],
      newCrossPackageEdges: [
        makeEdge({
          file: "src/large.ts",
          line: 2,
          fromBoundary: "app",
          toBoundary: "core",
          isCrossBoundary: true,
        }),
        makeEdge({
          file: "src/other.ts",
          line: 4,
          fromPackage: "@repo/app",
          toPackage: "@repo/data",
        }),
      ],
      sizeCategory: "large",
      sizePenalty: 0.3,
      diagnosticLimit: 2.8,
    })

    const diagnostics = TsRp02.diagnose(out)
    expect(diagnostics).toEqual([
      {
        severity: "warn",
        message:
          "PR surface: +360 / -40 across 2 files (large); largest files: src/large.ts (+300/-30), src/other.ts (+60/-10)",
        data: {
          linesAdded: 360,
          linesDeleted: 40,
          filesChanged: ["src/large.ts", "src/other.ts"],
          largestFiles: [
            { file: "src/large.ts", linesAdded: 300, linesDeleted: 30, totalLines: 330 },
            { file: "src/other.ts", linesAdded: 60, linesDeleted: 10, totalLines: 70 },
          ],
          packagesTouched: ["@repo/app", "@repo/core"],
          sizeCategory: "large",
          diffMode: "changed-hunks-fallback",
          dependencyDeltaMode: "unavailable",
          sizePenalty: 0.3,
          policyDecisions: [],
        },
        fixHints: [
          {
            kind: "reduce-or-route-pr-surface",
            title: "Shrink or route the change surface",
            summary:
              "Split independent concerns, move generated files out of the review path, or add explicit review routing for the largest changed areas.",
            confidence: "medium",
            autoApplicable: false,
            data: {
              sizeCategory: "large",
              largestFiles: [
                {
                  file: "src/large.ts",
                  linesAdded: 300,
                  linesDeleted: 30,
                  totalLines: 330,
                },
                {
                  file: "src/other.ts",
                  linesAdded: 60,
                  linesDeleted: 10,
                  totalLines: 70,
                },
              ],
            },
          },
        ],
      },
      {
        severity: "warn",
        message: "New cross-boundary import: app → core",
        location: { file: "src/large.ts", line: 2 },
        data: {
          fromPackage: "@repo/app",
          toPackage: "@repo/core",
          fromBoundary: "app",
          toBoundary: "core",
        },
        fixHints: [
          {
            kind: "review-new-boundary-edge",
            title: "Justify the new boundary edge",
            summary:
              "Route this import through an existing boundary, add an explicit boundary rule, or split the PR so dependency movement is reviewed separately.",
            confidence: "high",
            autoApplicable: false,
            data: {
              fromBoundary: "app",
              toBoundary: "core",
            },
          },
        ],
      },
    ])
    expect(TsRp02.diagnose({ ...out, diagnosticLimit: -1 })).toEqual([])
    expect(TsRp02.diagnose({ ...out, diagnosticLimit: Number.NaN })).toEqual([])
  })

  test("PR summary includes largest changed files", async () => {
    const out = await Effect.runPromise(
      TsRp02.compute(
        TsRp02.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "small.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 },
                { file: "large.ts", oldStart: 1, oldLines: 10, newStart: 1, newLines: 80 },
                { file: "medium.ts", oldStart: 1, oldLines: 5, newStart: 1, newLines: 20 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.fileStats.map((stat) => stat.file.replace(repo.root, ""))).toEqual([
      "/large.ts",
      "/medium.ts",
      "/small.ts",
    ])
    expect(out.fileStats[0]).toMatchObject({
      linesAdded: 80,
      linesDeleted: 10,
      totalLines: 90,
    })

    const diagnostic = TsRp02.diagnose(out)[0]
    expect(diagnostic?.message).toContain("largest files")
    expect(diagnostic?.message).toContain("large.ts (+80/-10)")
    expect(diagnostic?.message).toContain("medium.ts (+20/-5)")
    const largestFiles = (diagnostic?.data as { largestFiles?: ReadonlyArray<unknown> } | undefined)?.largestFiles
    expect(largestFiles?.[0]).toMatchObject({
      file: `${repo.root}/large.ts`,
      linesAdded: 80,
      linesDeleted: 10,
      totalLines: 90,
    })
  }, 120_000)

  test("generated changed files do not dominate PR surface", async () => {
    const out = await run(repo, TsRp02.defaultConfig, [
      {
        file: "src/routeTree.gen.ts",
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 900,
      },
      { file: "src/feature.ts", oldStart: 1, oldLines: 3, newStart: 1, newLines: 20 },
    ])

    expect(out.filesChanged.map((file) => file.replace(repo.root, ""))).toEqual([
      "/src/feature.ts",
    ])
    expect(out.linesAdded).toBe(20)
    expect(out.linesDeleted).toBe(3)
    expect(TsRp02.diagnose(out)[0]?.message).not.toContain("routeTree.gen.ts")
  }, 120_000)

  test("non-TypeScript changed hunks are not applicable in fallback mode", async () => {
    const out = await run(repo, TsRp02.defaultConfig, [
      { file: "README.md", oldStart: 1, oldLines: 0, newStart: 1, newLines: 1_000 },
    ])

    expect(out.diffMode).toBe("changed-hunks-fallback")
    expect(out.dependencyDeltaMode).toBe("unavailable")
    expect(out.filesChanged).toEqual([])
    expect(out.linesAdded).toBe(0)
    expect(out.linesDeleted).toBe(0)
    expect(TsRp02.outputMetadata?.(out)).toEqual({ applicability: "not_applicable" })
    expect(TsRp02.score(out)).toBe(1)
  }, 120_000)

  test("changed hunk fallback counts standard TypeScript ESM and CJS extensions", async () => {
    const out = await run(repo, TsRp02.defaultConfig, [
      { file: "src/module.mts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 3 },
      { file: "src/common.cts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 },
      { file: "src/types.d.mts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 1 },
      { file: "src/types.d.cts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 1 },
    ])

    expect(relativeFiles(repo.root, out.filesChanged)).toEqual([
      "/src/common.cts",
      "/src/module.mts",
      "/src/types.d.cts",
      "/src/types.d.mts",
    ])
    expect(out.linesAdded).toBe(7)
    expect(out.linesDeleted).toBe(1)
    expect(out.diffMode).toBe("changed-hunks-fallback")
  }, 120_000)

  test("git range pathspecs include standard TypeScript ESM and CJS extensions", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
      include: ["src/**/*"],
    })
    await repo.write("src/module.mts", "export const moduleValue = 1\n")
    await repo.write("src/common.cts", "export const commonValue = 1\n")
    await repo.write("src/types.d.mts", "export interface ModuleValue { value: number }\n")
    await repo.write("src/types.d.cts", "export interface CommonValue { value: number }\n")
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add TS module extensions"])

    const out = await computeWithContext(repo, TsRp02.defaultConfig, {
      gitSha: "HEAD",
      changedHunks: [],
    })

    expect(relativeFiles(repo.root, out.filesChanged)).toEqual([
      "/src/common.cts",
      "/src/module.mts",
      "/src/types.d.cts",
      "/src/types.d.mts",
    ])
    expect(out.linesAdded).toBe(4)
    expect(out.linesDeleted).toBe(0)
    expect(out.diffMode).toBe("git-commit-range")
  }, 120_000)

  test("custom dot-relative exclude globs apply to changed hunk evidence", async () => {
    const out = await run(
      repo,
      {
        ...TsRp02.defaultConfig,
        exclude_globs: [...TsRp02.defaultConfig.exclude_globs, "./src/ignored.ts"],
      },
      [
        { file: "src/ignored.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 500 },
        { file: "src/kept.ts", oldStart: 1, oldLines: 2, newStart: 1, newLines: 8 },
      ],
    )

    expect(relativeFiles(repo.root, out.filesChanged)).toEqual(["/src/kept.ts"])
    expect(out.linesAdded).toBe(8)
    expect(out.linesDeleted).toBe(2)
  }, 120_000)

  test("boundary rules classify added import edges", async () => {
    await repo.writeJson("packages/app/package.json", {
      name: "@repo/app",
      private: true,
    })
    await repo.writeJson("packages/core/package.json", {
      name: "@repo/core",
      private: true,
    })
    await repo.write("packages/core/src/index.ts", "export const core = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      `
export const app = 1
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add boundary packages"])

    await repo.write(
      "packages/app/src/index.ts",
      `
import { core } from "../../core/src/index";
export const app = core
`,
    )
    git(repo.root, ["add", "."])
    git(repo.root, ["commit", "-q", "-m", "Add boundary import"])

    const out = await computeWithContext(
      repo,
      {
        ...TsRp02.defaultConfig,
        boundary_rules: [
          { name: "app", globs: ["packages/app/**"] },
          { name: "core", globs: ["packages/core/**"] },
        ],
      },
      {
        gitSha: "HEAD",
        changedHunks: [],
      },
    )

    expect(out.newCrossBoundaryEdges).toEqual([
      expect.objectContaining({
        file: `${repo.root}/packages/app/src/index.ts`,
        line: 2,
        fromPackage: "@repo/app",
        toPackage: "@repo/core",
        fromBoundary: "app",
        toBoundary: "core",
        isCrossBoundary: true,
      }),
    ])
    expect(TsRp02.score(out)).toBe(0.7)
    expect(TsRp02.diagnose(out)).toContainEqual(
      expect.objectContaining({
        message: "New cross-boundary import: app → core",
      }),
    )
  }, 120_000)

  test("deterministic output is stable across equivalent repos", async () => {
    await repo.write("src/a.ts", "export const a = 1\n")
    await repo.write("src/b.ts", "export const b = 1\n")
    const changedHunks = [
      { file: "src/b.ts", oldStart: 1, oldLines: 0, newStart: 1, newLines: 2 },
      { file: "src/a.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 3 },
    ]
    const first = await run(repo, TsRp02.defaultConfig, changedHunks)
    const second = await run(repo, TsRp02.defaultConfig, changedHunks)
    expect(normalizedOutput(repo.root, second)).toEqual(normalizedOutput(repo.root, first))
    expect(normalizedDiagnostics(repo.root, second)).toEqual(normalizedDiagnostics(repo.root, first))

    const other = await createTempRepo("ts-rp-02-equivalent-")
    try {
      git(other.root, ["init", "-q", "-b", "main"])
      git(other.root, ["config", "user.email", "test@example.com"])
      git(other.root, ["config", "user.name", "Test"])
      git(other.root, ["config", "commit.gpgsign", "false"])
      git(other.root, ["add", "."])
      git(other.root, ["commit", "-q", "-m", "Initial commit"])
      await other.write("src/a.ts", "export const a = 1\n")
      await other.write("src/b.ts", "export const b = 1\n")
      const equivalent = await run(other, TsRp02.defaultConfig, changedHunks)
      expect(normalizedOutput(other.root, equivalent)).toEqual(normalizedOutput(repo.root, first))
      expect(normalizedDiagnostics(other.root, equivalent)).toEqual(normalizedDiagnostics(repo.root, first))
    } finally {
      await other.cleanup()
    }
  }, 120_000)
})
