import { join } from "node:path"
import {
  SignalContextTag,
  type SignalContext,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import { TsProjectTag, TsPackageInfoTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { boundaryOfFile, packageForFile, type BoundaryRule } from "./shared-workspace.js"

export const TsRp02Config = Schema.Struct({
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
  readonly diffMode: "git-working-tree" | "git-commit-range" | "changed-hunks-fallback" | "missing"
  readonly sizeCategory: "small" | "medium" | "large" | "oversized"
}

export const TsRp02: Signal<TsRp02Config, TsRp02Output, TsProjectTag | TsPackageInfoTag | SignalContextTag> = {
  id: "TS-RP-02",
  tier: 1,
  category: "review-pain",
  kind: "structural",
  configSchema: TsRp02Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
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
          new SignalComputeError({ signalId: "TS-RP-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const changedLines = out.linesAdded + out.linesDeleted
    const edgePenalty = out.newCrossBoundaryEdges.length * 0.2 + out.newCrossPackageEdges.length * 0.1
    const sizePenalty = Math.min(0.6, changedLines / 1000)
    return Math.max(0, 1 - sizePenalty - edgePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.diffMode === "missing") {
      return [{ severity: "warn", message: "TS-RP-02 could not inspect git diff state" }]
    }

    const diagnostics: Array<Diagnostic> = []

    diagnostics.push({
      severity: out.sizeCategory === "oversized" ? ("warn" as const) : ("info" as const),
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

const parseGitDiff = (
  project: import("ts-morph").Project,
  packages: ReadonlyArray<import("../discovery.js").PackageInfo>,
  worktreePath: string,
  numstat: string,
  diff: string,
  diffMode: TsRp02Output["diffMode"],
  config: TsRp02Config,
): TsRp02Output => {
  const statsByFile = new Map<string, ChangedFileStat>()
  let linesAdded = 0
  let linesDeleted = 0

  for (const line of numstat.split("\n")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim())
    if (match === null) continue
    const file = join(worktreePath, match[3]!)
    if (isExcluded(file, config.exclude_globs)) continue
    const added = match[1] === "-" ? 0 : Number(match[1])
    const deleted = match[2] === "-" ? 0 : Number(match[2])
    linesAdded += added
    linesDeleted += deleted
    statsByFile.set(file, {
      file,
      linesAdded: added,
      linesDeleted: deleted,
      totalLines: added + deleted,
    })
  }

  const fileStats = sortFileStats([...statsByFile.values()])
  const uniqueFiles = fileStats.map((stat) => stat.file).sort()

  const packagesTouched = touchedPackages(packages, uniqueFiles)
  const { crossPackageEdges, crossBoundaryEdges } = parseImportEdges(
    project,
    packages,
    uniqueFiles,
    diff,
    worktreePath,
    [],
  )

  const totalLines = linesAdded + linesDeleted
  let sizeCategory: TsRp02Output["sizeCategory"]
  sizeCategory = classifySizeCategory(totalLines, config)

  return {
    linesAdded,
    linesDeleted,
    filesChanged: uniqueFiles,
    fileStats,
    packagesTouched,
    newCrossPackageEdges: crossPackageEdges,
    newCrossBoundaryEdges: crossBoundaryEdges,
    diffMode,
    sizeCategory,
  }
}

const TS_DIFF_PATHSPECS = [
  ":(glob)*.ts",
  ":(glob)*.tsx",
  ":(glob)**/*.ts",
  ":(glob)**/*.tsx",
]

const fromChangedHunks = (
  project: import("ts-morph").Project,
  packages: ReadonlyArray<import("../discovery.js").PackageInfo>,
  context: SignalContext,
  config: TsRp02Config,
): TsRp02Output => {
  if (context.changedHunks.length === 0) {
    return {
      linesAdded: 0,
      linesDeleted: 0,
      filesChanged: [],
      fileStats: [],
      packagesTouched: [],
      newCrossPackageEdges: [],
      newCrossBoundaryEdges: [],
      diffMode: "missing",
      sizeCategory: "small",
    }
  }

  const filesChanged: Array<string> = [
    ...new Set(context.changedHunks.map((hunk) => resolveChangedHunkPath(context.worktreePath, hunk.file))),
  ].filter((f) => !isExcluded(f, config.exclude_globs))
  const allowedFiles = new Set(filesChanged)
  const statsByFile = new Map<string, ChangedFileStat>()
  for (const hunk of context.changedHunks) {
    const file = resolveChangedHunkPath(context.worktreePath, hunk.file)
    if (!allowedFiles.has(file)) continue
    const existing = statsByFile.get(file) ?? {
      file,
      linesAdded: 0,
      linesDeleted: 0,
      totalLines: 0,
    }
    statsByFile.set(file, {
      file,
      linesAdded: existing.linesAdded + hunk.newLines,
      linesDeleted: existing.linesDeleted + hunk.oldLines,
      totalLines: existing.totalLines + hunk.newLines + hunk.oldLines,
    })
  }
  const fileStats = sortFileStats([...statsByFile.values()])

  const packagesTouched = touchedPackages(packages, filesChanged)
  const totalLines = fileStats.reduce((sum, stat) => sum + stat.totalLines, 0)
  const sizeCategory = classifySizeCategory(totalLines, config)

  return {
    linesAdded: fileStats.reduce((sum, stat) => sum + stat.linesAdded, 0),
    linesDeleted: fileStats.reduce((sum, stat) => sum + stat.linesDeleted, 0),
    filesChanged,
    fileStats,
    packagesTouched,
    newCrossPackageEdges: [],
    newCrossBoundaryEdges: [],
    diffMode: "changed-hunks-fallback",
    sizeCategory,
  }
}

const resolveChangedHunkPath = (worktreePath: string, file: string): string =>
  file.startsWith(worktreePath) ? file : join(worktreePath, file)

const classifySizeCategory = (
  totalLines: number,
  config: TsRp02Config,
): TsRp02Output["sizeCategory"] => {
  if (totalLines <= config.small_pr_budget) {
    return "small"
  }
  if (totalLines <= config.medium_pr_budget) {
    return "medium"
  }
  if (totalLines <= config.large_pr_budget) {
    return "large"
  }
  return "oversized"
}

const sortFileStats = (stats: ReadonlyArray<ChangedFileStat>): ReadonlyArray<ChangedFileStat> =>
  [...stats].sort(
    (left, right) =>
      right.totalLines - left.totalLines ||
      right.linesAdded - left.linesAdded ||
      right.linesDeleted - left.linesDeleted ||
      left.file.localeCompare(right.file),
  )

const formatLargestFiles = (
  fileStats: ReadonlyArray<ChangedFileStat>,
  maxExamples = 3,
): string => {
  const examples = fileStats.slice(0, maxExamples)
  if (examples.length === 0) return ""
  const remaining = Math.max(0, fileStats.length - examples.length)
  const suffix = remaining > 0 ? ` (+${remaining} more)` : ""
  return `; largest files: ${examples.map(formatFileStat).join(", ")}${suffix}`
}

const formatFileStat = (stat: ChangedFileStat): string =>
  `${stat.file} (+${stat.linesAdded}/-${stat.linesDeleted})`

const touchedPackages = (
  packages: ReadonlyArray<import("../discovery.js").PackageInfo>,
  filesChanged: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const touched = new Set<string>()
  for (const file of filesChanged) {
    const pkg = packageForFile(file, packages)
    if (pkg?.manifest?.name) {
      touched.add(pkg.manifest.name)
    }
  }
  return [...touched].sort()
}

const parseImportEdges = (
  project: import("ts-morph").Project,
  packages: ReadonlyArray<import("../discovery.js").PackageInfo>,
  changedFiles: ReadonlyArray<string>,
  diff: string,
  worktreePath: string,
  boundaryRules: ReadonlyArray<BoundaryRule>,
): { crossPackageEdges: ReadonlyArray<ImportEdge>; crossBoundaryEdges: ReadonlyArray<ImportEdge> } => {
  const crossPackageEdges: Array<ImportEdge> = []
  const crossBoundaryEdges: Array<ImportEdge> = []

  const fileSet = new Set(changedFiles)

  let currentFile: string | undefined
  for (const line of diff.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line)
    if (fileMatch !== null) {
      currentFile = join(worktreePath, fileMatch[1]!)
      continue
    }

    if (!line.startsWith("+") || line.startsWith("+++")) continue

    const importMatch = /^\+\s*import\s+.*\s+from\s+['"]([^'"]+)['"]/.exec(line)
    if (importMatch === null || currentFile === undefined) continue

    const moduleSpecifier = importMatch[1]!
    if (!moduleSpecifier.startsWith(".")) continue

    const sourceFile = project.getSourceFile(currentFile)
    if (sourceFile === undefined) continue

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const targetFile = importDecl.getModuleSpecifierSourceFile()?.getFilePath()
      if (targetFile === undefined) continue
      if (!fileSet.has(targetFile)) continue

      const fromPkg = packageForFile(currentFile, packages)
      const toPkg = packageForFile(targetFile, packages)

      const fromBoundary = boundaryOfFile(currentFile, boundaryRules)
      const toBoundary = boundaryOfFile(targetFile, boundaryRules)

      const edge: ImportEdge = {
        file: currentFile,
        line: importDecl.getStartLineNumber(),
        fromPackage: fromPkg?.manifest?.name,
        toPackage: toPkg?.manifest?.name,
        isCrossBoundary: fromBoundary !== undefined && toBoundary !== undefined && fromBoundary !== toBoundary,
        fromBoundary,
        toBoundary,
      }

      if (edge.fromPackage !== edge.toPackage) {
        crossPackageEdges.push(edge)
      }

      if (edge.isCrossBoundary) {
        crossBoundaryEdges.push(edge)
      }
    }
  }

  return {
    crossPackageEdges: dedupeEdges(crossPackageEdges),
    crossBoundaryEdges: dedupeEdges(crossBoundaryEdges),
  }
}

const dedupeEdges = (edges: ReadonlyArray<ImportEdge>): ReadonlyArray<ImportEdge> => {
  const seen = new Set<string>()
  const result: Array<ImportEdge> = []
  for (const edge of edges) {
    const key = `${edge.file}:${edge.line}:${edge.fromPackage}:${edge.toPackage}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result
}
