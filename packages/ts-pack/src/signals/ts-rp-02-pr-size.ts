import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalContext } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import type { Project } from "ts-morph"
import { TsProjectTag, TsPackageInfoTag } from "../ts-project.js"
import type { PackageInfo } from "../discovery.js"
import { formatLargestFiles } from "./ts-rp-02-diagnostics.js"
import { fromChangedHunks, parseGitDiff, TS_DIFF_PATHSPECS } from "./ts-rp-02-diff.js"

const TsRp02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  small_pr_budget: Schema.Number,
  medium_pr_budget: Schema.Number,
  large_pr_budget: Schema.Number,
})
export type TsRp02Config = typeof TsRp02Config.Type

export interface ImportEdge {
  readonly file: string
  readonly line: number
  readonly fromPackage: string | undefined
  readonly toPackage: string | undefined
  readonly isCrossBoundary: boolean | undefined
  readonly fromBoundary: string | undefined
  readonly toBoundary: string | undefined
}

export interface ChangedFileStat {
  readonly file: string
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly totalLines: number
}

export interface TsRp02Output {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly filesChanged: ReadonlyArray<string>
  readonly fileStats: ReadonlyArray<ChangedFileStat>
  readonly packagesTouched: ReadonlyArray<string>
  readonly newCrossPackageEdges: ReadonlyArray<ImportEdge>
  readonly newCrossBoundaryEdges: ReadonlyArray<ImportEdge>
  readonly diffMode: "git-working-tree" | "git-branch-range" | "git-commit-range" | "changed-hunks-fallback" | "missing"
  readonly sizeCategory: "small" | "medium" | "large" | "oversized"
  readonly sizePenalty: number
}

export const TsRp02: Signal<TsRp02Config, TsRp02Output, TsProjectTag | TsPackageInfoTag | SignalContextTag> = {
  id: "TS-RP-02-pr-size",
  title: "PR size",
  aliases: ["TS-RP-02"],
  tier: 1,
  category: "review-pain",
  kind: "structural",
  cacheVersion: "branch-range-v1",
  cacheDependencies: ["git-revision-context"],
  configSchema: TsRp02Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
    ],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    top_n_diagnostics: 10,
    small_pr_budget: 100,
    medium_pr_budget: 300,
    large_pr_budget: 500,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<TsRp02Output> => {
          return await computeGitPrSizeOutput(project, packages, context, config)
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-RP-02-pr-size", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const edgePenalty = out.newCrossBoundaryEdges.length * 0.2 + out.newCrossPackageEdges.length * 0.1
    return Math.max(0, 1 - out.sizePenalty - edgePenalty)
  },
  outputMetadata: (out) => {
    if (out.diffMode === "missing") return { applicability: "insufficient_evidence" as const }
    return out.filesChanged.length === 0
      ? { applicability: "not_applicable" as const }
      : undefined
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.diffMode === "missing") {
      return [{ severity: "warn", message: "TS-RP-02 could not inspect git diff state" }]
    }

    const diagnostics: Array<Diagnostic> = []

    diagnostics.push({
      severity:
        out.sizeCategory === "large" || out.sizeCategory === "oversized"
          ? ("warn" as const)
          : ("info" as const),
      message:
        `PR surface: +${out.linesAdded} / -${out.linesDeleted} across ${out.filesChanged.length} files ` +
        `(${out.sizeCategory})${formatLargestFiles(out.fileStats)}`,
      data: {
        linesAdded: out.linesAdded,
        linesDeleted: out.linesDeleted,
        filesChanged: out.filesChanged,
        largestFiles: out.fileStats.slice(0, 10),
        packagesTouched: out.packagesTouched,
        sizeCategory: out.sizeCategory,
        diffMode: out.diffMode,
      },
    })

    for (const edge of out.newCrossBoundaryEdges.slice(0, 10)) {
      diagnostics.push({
        severity: "warn" as const,
        message: `New cross-boundary import: ${edge.fromBoundary ?? "unmapped"} → ${edge.toBoundary ?? "unmapped"}`,
        location: { file: edge.file, line: edge.line },
        data: {
          fromPackage: edge.fromPackage,
          toPackage: edge.toPackage,
          fromBoundary: edge.fromBoundary,
          toBoundary: edge.toBoundary,
        },
      })
    }

    return diagnostics
  },
}

type GitClient = ReturnType<typeof simpleGit>

const computeGitPrSizeOutput = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsRp02Config,
): Promise<TsRp02Output> => {
  const git = simpleGit(context.worktreePath)
  if (!(await git.checkIsRepo())) {
    return fromChangedHunks(project, packages, context, config)
  }

  const workingTree = await parseDiffRange(project, packages, context, config, git, undefined, "git-working-tree")
  if (workingTree !== undefined && workingTree.filesChanged.length > 0) return workingTree

  const branchRange = await resolveBranchDiffRange(git)
  const branch = branchRange === undefined
    ? undefined
    : await parseDiffRange(project, packages, context, config, git, branchRange, "git-branch-range")
  if (branch !== undefined && branch.filesChanged.length > 0) return branch

  return await computeCommitRangeOutput(project, packages, context, config, git)
}

const computeCommitRangeOutput = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsRp02Config,
  git: GitClient,
): Promise<TsRp02Output> => {
  const range = context.gitSha === "HEAD" ? "HEAD^!" : `${context.gitSha}^!`
  try {
    const output = await parseDiffRange(project, packages, context, config, git, range, "git-commit-range")
    if (output.filesChanged.length === 0 && context.changedHunks.length > 0) {
      return fromChangedHunks(project, packages, context, config)
    }
    return output
  } catch {
    return fromChangedHunks(project, packages, context, config)
  }
}

const parseDiffRange = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsRp02Config,
  git: GitClient,
  range: string | undefined,
  diffMode: TsRp02Output["diffMode"],
): Promise<TsRp02Output> => {
  const rangeArg = range === undefined ? [] : [range]
  const numstat = await git.raw(["diff", "--numstat", "--no-renames", ...rangeArg, "--", ...TS_DIFF_PATHSPECS])
  const diff = await git.raw(["diff", "--unified=0", "--no-renames", ...rangeArg, "--", ...TS_DIFF_PATHSPECS])
  return parseGitDiff(project, packages, context.worktreePath, numstat, diff, diffMode, config)
}

const resolveBranchDiffRange = async (
  git: GitClient,
): Promise<string | undefined> => {
  try {
    const upstream = (await git.raw([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ])).trim()
    if (upstream.length === 0) return undefined

    const [head, mergeBase] = await Promise.all([
      git.raw(["rev-parse", "HEAD"]),
      git.raw(["merge-base", "HEAD", upstream]),
    ])
    const headSha = head.trim()
    const mergeBaseSha = mergeBase.trim()
    if (headSha.length === 0 || mergeBaseSha.length === 0 || headSha === mergeBaseSha) {
      return undefined
    }
    return `${mergeBaseSha}..HEAD`
  } catch {
    return undefined
  }
}
