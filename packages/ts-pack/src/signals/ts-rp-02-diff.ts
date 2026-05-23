import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { SignalContext } from "@skastr0/pulsar-core/signal"
import { matchesAnyGlob } from "./shared-globs.js"
import { normalizePackageSpecifier, packageForFile, type BoundaryRule } from "./shared-workspace.js"
import type { ChangedFileStat, ImportEdge, TsRp02Config, TsRp02Output } from "./ts-rp-02-pr-size.js"

export const TS_DIFF_PATHSPECS = [
  ":(glob)*.ts",
  ":(glob)*.tsx",
  ":(glob)*.mts",
  ":(glob)*.cts",
  ":(glob)*.d.mts",
  ":(glob)*.d.cts",
  ":(glob)**/*.ts",
  ":(glob)**/*.tsx",
  ":(glob)**/*.mts",
  ":(glob)**/*.cts",
  ":(glob)**/*.d.mts",
  ":(glob)**/*.d.cts",
]

export const parseGitDiff = (
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
    const file = resolveSourcePath(worktreePath, match[3]!)
    if (matchesSourcePath(file, worktreePath, config.exclude_globs)) continue
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
    config.boundary_rules,
  )

  const totalLines = linesAdded + linesDeleted
  let sizeCategory: TsRp02Output["sizeCategory"]
  sizeCategory = classifySizeCategory(totalLines, config)
  const sizePenalty = prSizePenalty(totalLines, config)

  return {
    linesAdded,
    linesDeleted,
    filesChanged: uniqueFiles,
    fileStats,
    packagesTouched,
    newCrossPackageEdges: crossPackageEdges,
    newCrossBoundaryEdges: crossBoundaryEdges,
    diffMode,
    dependencyDeltaMode: "measured",
    sizeCategory,
    sizePenalty,
    diagnosticLimit: config.top_n_diagnostics,
  }
}

export const fromChangedHunks = (
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
      dependencyDeltaMode: "unavailable",
      sizeCategory: "small",
      sizePenalty: 0,
      diagnosticLimit: config.top_n_diagnostics,
    }
  }

  const filesChanged: Array<string> = [
    ...new Set(context.changedHunks.map((hunk) => resolveChangedHunkPath(context.worktreePath, hunk.file))),
  ].filter((f) => isTypeScriptSourcePath(f) && !matchesSourcePath(f, context.worktreePath, config.exclude_globs))
    .sort((left, right) => left.localeCompare(right))
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
  const sizePenalty = prSizePenalty(totalLines, config)

  return {
    linesAdded: fileStats.reduce((sum, stat) => sum + stat.linesAdded, 0),
    linesDeleted: fileStats.reduce((sum, stat) => sum + stat.linesDeleted, 0),
    filesChanged,
    fileStats,
    packagesTouched,
    newCrossPackageEdges: [],
    newCrossBoundaryEdges: [],
    diffMode: "changed-hunks-fallback",
    dependencyDeltaMode: "unavailable",
    sizeCategory,
    sizePenalty,
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const resolveChangedHunkPath = (worktreePath: string, file: string): string =>
  resolveSourcePath(worktreePath, file)

const resolveSourcePath = (worktreePath: string, file: string): string =>
  isAbsolute(file) ? file : resolve(worktreePath, file)

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

const prSizePenalty = (changedLines: number, config: TsRp02Config): number => {
  if (changedLines <= config.small_pr_budget) return 0
  if (changedLines <= config.medium_pr_budget) {
    return scalePenalty(changedLines, config.small_pr_budget, config.medium_pr_budget, 0, 0.2)
  }
  if (changedLines <= config.large_pr_budget) {
    return scalePenalty(changedLines, config.medium_pr_budget, config.large_pr_budget, 0.2, 0.4)
  }
  return Math.min(0.6, 0.4 + (changedLines - config.large_pr_budget) / 1000)
}

const scalePenalty = (
  value: number,
  from: number,
  to: number,
  minPenalty: number,
  maxPenalty: number,
): number => {
  if (to <= from) return maxPenalty
  const ratio = (value - from) / (to - from)
  return minPenalty + ratio * (maxPenalty - minPenalty)
}

const sortFileStats = (stats: ReadonlyArray<ChangedFileStat>): ReadonlyArray<ChangedFileStat> =>
  [...stats].sort(
    (left, right) =>
      right.totalLines - left.totalLines ||
      right.linesAdded - left.linesAdded ||
      right.linesDeleted - left.linesDeleted ||
      left.file.localeCompare(right.file),
  )

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
  let currentNewLine: number | undefined
  for (const line of diff.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line)
    if (fileMatch !== null) {
      currentFile = resolveSourcePath(worktreePath, fileMatch[1]!)
      currentNewLine = undefined
      continue
    }

    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunkMatch !== null) {
      currentNewLine = Number(hunkMatch[1])
      continue
    }

    if (line.startsWith("-") && !line.startsWith("---")) continue
    if (line.startsWith(" ")) {
      currentNewLine = currentNewLine === undefined ? undefined : currentNewLine + 1
      continue
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue

    const addedLineNumber = currentNewLine
    currentNewLine = currentNewLine === undefined ? undefined : currentNewLine + 1

    const moduleSpecifier = addedModuleSpecifier(line)
    if (
      moduleSpecifier === undefined ||
      currentFile === undefined ||
      addedLineNumber === undefined ||
      !fileSet.has(currentFile)
    ) {
      continue
    }

    const sourceFile = project.getSourceFile(currentFile)
    if (sourceFile === undefined) continue

    const dependencyDeclarations = [
      ...sourceFile.getImportDeclarations(),
      ...sourceFile.getExportDeclarations(),
    ].filter((declaration) =>
      declaration.getModuleSpecifierValue() === moduleSpecifier &&
      declaration.getStartLineNumber() <= addedLineNumber &&
      declaration.getEndLineNumber() >= addedLineNumber
    )

    for (const declaration of dependencyDeclarations) {
      const fromPkg = packageForFile(currentFile, packages)
      const targetFile = declaration.getModuleSpecifierSourceFile()?.getFilePath() ??
        resolvePackageLocalAliasFile(project, moduleSpecifier, fromPkg)

      const toPkg = targetFile === undefined
        ? packageForModuleSpecifier(moduleSpecifier, packages)
        : packageForFile(targetFile, packages)
      if (toPkg === undefined && targetFile === undefined) continue

      const fromBoundary = boundaryOfSourceFile(currentFile, worktreePath, boundaryRules)
      const toBoundary = targetFile === undefined
        ? boundaryOfPackage(toPkg, worktreePath, boundaryRules)
        : boundaryOfSourceFile(targetFile, worktreePath, boundaryRules)

      const edge: ImportEdge = {
        file: currentFile,
        line: declaration.getStartLineNumber(),
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
    const key = `${edge.file}:${edge.line}:${edge.fromPackage}:${edge.toPackage}:${edge.fromBoundary}:${edge.toBoundary}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(edge)
  }
  return result.sort(compareImportEdges)
}

const addedModuleSpecifier = (line: string): string | undefined => {
  const staticImport = /^\+\s*import\s+(?:type\s+)?(?:.+?\s+from\s+)?['"]([^'"]+)['"]/.exec(line)
  if (staticImport !== null) return staticImport[1]
  const exportFrom = /^\+\s*export\s+(?:type\s+)?(?:.+?\s+from\s+)['"]([^'"]+)['"]/.exec(line)
  if (exportFrom !== null) return exportFrom[1]
  const multilineFrom = /^\+\s*}\s*from\s+['"]([^'"]+)['"]/.exec(line)
  return multilineFrom?.[1]
}

const boundaryOfSourceFile = (
  file: string,
  worktreePath: string,
  rules: ReadonlyArray<BoundaryRule>,
): string | undefined =>
  rules.find((rule) => matchesSourcePath(file, worktreePath, rule.globs))?.name

const boundaryOfPackage = (
  pkg: import("../discovery.js").PackageInfo | undefined,
  worktreePath: string,
  rules: ReadonlyArray<BoundaryRule>,
): string | undefined =>
  pkg === undefined ? undefined : boundaryOfSourceFile(pkg.path, worktreePath, rules)

const packageForModuleSpecifier = (
  moduleSpecifier: string,
  packages: ReadonlyArray<import("../discovery.js").PackageInfo>,
): import("../discovery.js").PackageInfo | undefined => {
  const packageName = normalizePackageSpecifier(moduleSpecifier)
  if (packageName === undefined) return undefined
  return packages.find((pkg) => pkg.manifest?.name === packageName)
}

const resolvePackageLocalAliasFile = (
  project: import("ts-morph").Project,
  moduleSpecifier: string,
  fromPkg: import("../discovery.js").PackageInfo | undefined,
): string | undefined => {
  if (fromPkg === undefined || moduleSpecifier.startsWith(".")) return undefined
  const paths = readTsconfigPaths(fromPkg.tsconfigPath)
  if (paths === undefined) return undefined

  for (const [aliasPattern, targetPatterns] of Object.entries(paths.paths)) {
    const captures = matchAliasPattern(aliasPattern, moduleSpecifier)
    if (captures === undefined) continue
    for (const targetPattern of targetPatterns) {
      const targetPath = applyAliasTargetPattern(targetPattern, captures)
      const resolved = resolveExistingTypeScriptPath(
        project,
        resolve(paths.baseDir, targetPath),
      )
      if (resolved !== undefined) return resolved
    }
  }
  return undefined
}

const readTsconfigPaths = (
  tsconfigPath: string,
): { readonly baseDir: string; readonly paths: Readonly<Record<string, ReadonlyArray<string>>> } | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      readonly compilerOptions?: {
        readonly baseUrl?: unknown
        readonly paths?: unknown
      }
    }
    const paths = parsed.compilerOptions?.paths
    if (paths === undefined || paths === null || typeof paths !== "object" || Array.isArray(paths)) {
      return undefined
    }
    const normalizedPaths = Object.fromEntries(
      Object.entries(paths).flatMap(([key, value]) =>
        typeof key === "string" &&
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string")
          ? [[key, value]]
          : [],
      ),
    )
    const baseUrl = parsed.compilerOptions?.baseUrl
    const baseDir = typeof baseUrl === "string"
      ? resolve(dirname(tsconfigPath), baseUrl)
      : dirname(tsconfigPath)
    return { baseDir, paths: normalizedPaths }
  } catch {
    return undefined
  }
}

const matchAliasPattern = (
  pattern: string,
  moduleSpecifier: string,
): ReadonlyArray<string> | undefined => {
  const starCount = pattern.split("*").length - 1
  if (starCount === 0) return pattern === moduleSpecifier ? [] : undefined
  const escapedParts = pattern.split("*").map(escapeRegExp)
  const regex = new RegExp(`^${escapedParts.join("(.+)")}$`)
  const match = regex.exec(moduleSpecifier)
  return match === null ? undefined : match.slice(1)
}

const applyAliasTargetPattern = (
  targetPattern: string,
  captures: ReadonlyArray<string>,
): string => {
  let captureIndex = 0
  return targetPattern.replaceAll("*", () => captures[captureIndex++] ?? "")
}

const resolveExistingTypeScriptPath = (
  project: import("ts-morph").Project,
  basePath: string,
): string | undefined => {
  for (const candidate of typeScriptResolutionCandidates(basePath)) {
    if (!existsSync(candidate)) continue
    project.addSourceFileAtPathIfExists(candidate)
    return candidate
  }
  return undefined
}

const typeScriptResolutionCandidates = (basePath: string): ReadonlyArray<string> => [
  basePath,
  `${basePath}.ts`,
  `${basePath}.tsx`,
  `${basePath}.mts`,
  `${basePath}.cts`,
  `${basePath}.d.ts`,
  `${basePath}.d.mts`,
  `${basePath}.d.cts`,
  join(basePath, "index.ts"),
  join(basePath, "index.tsx"),
  join(basePath, "index.mts"),
  join(basePath, "index.cts"),
  join(basePath, "index.d.ts"),
  join(basePath, "index.d.mts"),
  join(basePath, "index.d.cts"),
]

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const matchesSourcePath = (
  absoluteFile: string,
  worktreePath: string,
  globs: ReadonlyArray<string>,
): boolean => {
  const relativeFile = relative(worktreePath, absoluteFile).replaceAll("\\", "/")
  return matchesAnyGlob(absoluteFile, globs) ||
    matchesAnyGlob(relativeFile, globs) ||
    matchesAnyGlob(`./${relativeFile}`, globs)
}

const compareImportEdges = (left: ImportEdge, right: ImportEdge): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  (left.fromPackage ?? "").localeCompare(right.fromPackage ?? "") ||
  (left.toPackage ?? "").localeCompare(right.toPackage ?? "") ||
  (left.fromBoundary ?? "").localeCompare(right.fromBoundary ?? "") ||
  (left.toBoundary ?? "").localeCompare(right.toBoundary ?? "")

const isTypeScriptSourcePath = (file: string): boolean =>
  /\.(?:ts|tsx|mts|cts)$/.test(file) || /\.d\.(?:mts|cts)$/.test(file)
