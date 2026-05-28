import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalContext, SignalFactorLedger } from "@skastr0/pulsar-core/signal"
import type { CalibrationDecision } from "@skastr0/pulsar-core/calibration"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import type { Project } from "ts-morph"
import { TsProjectTag, TsPackageInfoTag } from "../ts-project.js"
import type { PackageInfo } from "../discovery.js"
import { formatLargestFiles } from "./ts-rp-02-diagnostics.js"
import { fromChangedHunks, parseGitDiff, TS_DIFF_PATHSPECS } from "./ts-rp-02-diff.js"
import { applyPrSizePolicy } from "./ts-rp-02-policy.js"

const BoundaryRuleSchema = Schema.Struct({
  name: Schema.String,
  globs: Schema.Array(Schema.String),
})

const TsRp02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  boundary_rules: Schema.Array(BoundaryRuleSchema),
  top_n_diagnostics: Schema.Number,
  small_pr_budget: Schema.Number,
  medium_pr_budget: Schema.Number,
  large_pr_budget: Schema.Number,
})
export type TsRp02Config = typeof TsRp02Config.Type

export const DEFAULT_TS_RP_02_DIAGNOSTIC_LIMIT = 10

const DEFAULT_TS_RP_02_CONFIG: TsRp02Config = {
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
  boundary_rules: [],
  top_n_diagnostics: DEFAULT_TS_RP_02_DIAGNOSTIC_LIMIT,
  small_pr_budget: 100,
  medium_pr_budget: 300,
  large_pr_budget: 500,
}

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
  readonly dependencyDeltaMode: "measured" | "unavailable"
  readonly sizeCategory: "small" | "medium" | "large" | "oversized"
  readonly sizePenalty: number
  readonly diagnosticLimit: number
  readonly visible?: boolean
  readonly severity?: "info" | "warn" | "block"
  readonly factorPathPrefix?: string
  readonly calibrationDecisions?: ReadonlyArray<CalibrationDecision>
  readonly factorLedger?: SignalFactorLedger
}

export const TsRp02: Signal<TsRp02Config, TsRp02Output, TsProjectTag | TsPackageInfoTag | SignalContextTag> = {
  id: "TS-RP-02-pr-size",
  title: "PR size",
  aliases: ["TS-RP-02"],
  tier: 1,
  category: "review-pain",
  kind: "structural",
  cacheVersion: "branch-range-factor-policy-diagnostic-limit-package-import-edges-v2",
  cacheDependencies: ["git-revision-context"],
  configSchema: TsRp02Config,
  defaultConfig: DEFAULT_TS_RP_02_CONFIG,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const normalizedConfig = normalizeTsRp02Config(config)
      const output = yield* Effect.tryPromise({
        try: async (): Promise<TsRp02Output> => {
          return await computeGitPrSizeOutput(project, packages, context, normalizedConfig)
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-RP-02-pr-size", message: String(cause), cause }),
      })
      return yield* applyPrSizePolicy(output, calibration).pipe(
        Effect.mapError(toSignalComputeError),
      )
    }),
  score: (out) => {
    const sizePenalty = out.visible === false ? 0 : normalizeNonNegativeFiniteNumber(out.sizePenalty, 0)
    const edgePenalty = out.newCrossBoundaryEdges.length * 0.2 + out.newCrossPackageEdges.length * 0.1
    return Math.max(0, 1 - sizePenalty - edgePenalty)
  },
  outputMetadata: (out) => {
    if (out.diffMode === "missing") return { applicability: "insufficient_evidence" as const }
    return out.filesChanged.length === 0
      ? { applicability: "not_applicable" as const }
      : undefined
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnosticLimit = normalizeTsRp02DiagnosticLimit(out.diagnosticLimit)
    if (diagnosticLimit <= 0) return []

    if (out.diffMode === "missing") {
      return [{ severity: "warn", message: "TS-RP-02 could not inspect git diff state" }]
    }

    const diagnostics: Array<Diagnostic> = []

    if (out.visible !== false) {
      diagnostics.push({
        severity:
          out.severity ??
          (out.sizeCategory === "large" || out.sizeCategory === "oversized"
            ? ("warn" as const)
            : ("info" as const)),
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
          dependencyDeltaMode: out.dependencyDeltaMode,
          sizePenalty: out.sizePenalty,
          policyDecisions: out.calibrationDecisions ?? [],
        },
        fixHints: [{
          kind: "reduce-or-route-pr-surface",
          title: "Shrink or route the change surface",
          summary:
            "Split independent concerns, move generated files out of the review path, or add explicit review routing for the largest changed areas.",
          confidence: "medium",
          autoApplicable: false,
          data: {
            sizeCategory: out.sizeCategory,
            largestFiles: out.fileStats.slice(0, 5),
          },
        }],
      })
    }

    for (const edge of out.newCrossBoundaryEdges) {
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
        fixHints: [{
          kind: "review-new-boundary-edge",
          title: "Justify the new boundary edge",
          summary:
            "Route this import through an existing boundary, add an explicit boundary rule, or split the PR so dependency movement is reviewed separately.",
          confidence: "high",
          autoApplicable: false,
          data: {
            fromBoundary: edge.fromBoundary,
            toBoundary: edge.toBoundary,
          },
        }],
      })
    }

    const crossBoundaryKeys = new Set(out.newCrossBoundaryEdges.map(edgeIdentity))
    for (const edge of out.newCrossPackageEdges.filter((edge) => !crossBoundaryKeys.has(edgeIdentity(edge)))) {
      diagnostics.push({
        severity: "warn" as const,
        message: `New cross-package import: ${edge.fromPackage ?? "unmapped"} → ${edge.toPackage ?? "unmapped"}`,
        location: { file: edge.file, line: edge.line },
        data: {
          fromPackage: edge.fromPackage,
          toPackage: edge.toPackage,
          fromBoundary: edge.fromBoundary,
          toBoundary: edge.toBoundary,
        },
        fixHints: [{
          kind: "review-new-package-edge",
          title: "Justify the new package dependency",
          summary:
            "Declare the dependency deliberately, route through an existing package API, or split the package-coupling change into a smaller review.",
          confidence: "high",
          autoApplicable: false,
          data: {
            fromPackage: edge.fromPackage,
            toPackage: edge.toPackage,
          },
        }],
      })
    }

    return diagnostics.slice(0, diagnosticLimit)
  },
  factorLedger: (out) => out.factorLedger,
}

export const normalizeTsRp02Config = (config: TsRp02Config): TsRp02Config => {
  const smallPrBudget = normalizePositiveFiniteNumber(
    config.small_pr_budget,
    DEFAULT_TS_RP_02_CONFIG.small_pr_budget,
  )
  const mediumPrBudget = Math.max(
    smallPrBudget,
    normalizePositiveFiniteNumber(
      config.medium_pr_budget,
      DEFAULT_TS_RP_02_CONFIG.medium_pr_budget,
    ),
  )
  const largePrBudget = Math.max(
    mediumPrBudget,
    normalizePositiveFiniteNumber(
      config.large_pr_budget,
      DEFAULT_TS_RP_02_CONFIG.large_pr_budget,
    ),
  )
  return {
    exclude_globs: stringArrayOrDefault(config.exclude_globs, DEFAULT_TS_RP_02_CONFIG.exclude_globs),
    test_globs: stringArrayOrDefault(config.test_globs, DEFAULT_TS_RP_02_CONFIG.test_globs),
    boundary_rules: Array.isArray(config.boundary_rules) ? config.boundary_rules : [],
    top_n_diagnostics: normalizeTsRp02DiagnosticLimit(config.top_n_diagnostics),
    small_pr_budget: smallPrBudget,
    medium_pr_budget: mediumPrBudget,
    large_pr_budget: largePrBudget,
  }
}

export const normalizeTsRp02DiagnosticLimit = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

export const normalizeNonNegativeFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback

const normalizePositiveFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const stringArrayOrDefault = (
  value: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback

const edgeIdentity = (edge: ImportEdge): string =>
  `${edge.file}:${edge.line}:${edge.fromPackage ?? ""}:${edge.toPackage ?? ""}:${edge.fromBoundary ?? ""}:${edge.toBoundary ?? ""}`

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

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "TS-RP-02-pr-size",
        message: String(cause),
        cause,
      })
