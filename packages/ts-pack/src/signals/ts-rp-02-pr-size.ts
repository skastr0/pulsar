import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import { TsProjectTag, TsPackageInfoTag } from "../ts-project.js"
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
  cacheVersion: "diff-applicability-v1",
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
          const git = simpleGit(context.worktreePath)
          const isRepo = await git.checkIsRepo()
          if (!isRepo) {
            return fromChangedHunks(project, packages, context, config)
          }

          const workingNumstat = await git.raw([
            "diff",
            "--numstat",
            "--no-renames",
            "--",
            ...TS_DIFF_PATHSPECS,
          ])
          if (workingNumstat.trim().length > 0) {
            const diff = await git.raw([
              "diff",
              "--unified=0",
              "--no-renames",
              "--",
              ...TS_DIFF_PATHSPECS,
            ])
            return parseGitDiff(project, packages, context.worktreePath, workingNumstat, diff, "git-working-tree", config)
          }

          const branchRange = await resolveBranchDiffRange(git)
          if (branchRange !== undefined) {
            const branchNumstat = await git.raw([
              "diff",
              "--numstat",
              "--no-renames",
              branchRange,
              "--",
              ...TS_DIFF_PATHSPECS,
            ])
            if (branchNumstat.trim().length > 0) {
              const diff = await git.raw([
                "diff",
                "--unified=0",
                "--no-renames",
                branchRange,
                "--",
                ...TS_DIFF_PATHSPECS,
              ])
              return parseGitDiff(project, packages, context.worktreePath, branchNumstat, diff, "git-branch-range", config)
            }
          }

          const range = context.gitSha === "HEAD" ? "HEAD^!" : `${context.gitSha}^!`
          try {
            const rangeNumstat = await git.raw([
              "diff",
              "--numstat",
              "--no-renames",
              range,
              "--",
              ...TS_DIFF_PATHSPECS,
            ])
            if (rangeNumstat.trim().length === 0 && context.changedHunks.length > 0) {
              return fromChangedHunks(project, packages, context, config)
            }
            const diff = await git.raw([
              "diff",
              "--unified=0",
              "--no-renames",
              range,
              "--",
              ...TS_DIFF_PATHSPECS,
            ])
            return parseGitDiff(project, packages, context.worktreePath, rangeNumstat, diff, "git-commit-range", config)
          } catch {
            return fromChangedHunks(project, packages, context, config)
          }
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

const resolveBranchDiffRange = async (
  git: ReturnType<typeof simpleGit>,
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
