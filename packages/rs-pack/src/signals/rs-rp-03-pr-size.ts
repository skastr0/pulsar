import {
  SignalContextTag,
  type SignalContext,
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import { RustProjectTag, type RustProject } from "../project.js"
import { resolveManifestForFile } from "../rust-analysis-modules.js"
import { normalizePath } from "./shared-globs.js"

const RsRp03Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type RsRp03Config = typeof RsRp03Config.Type

interface CrossCrateEdge {
  readonly file: string
  readonly fromCrate: string
  readonly toCrate: string
}

interface RsRp03Output {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly filesChanged: ReadonlyArray<string>
  readonly cratesTouched: ReadonlyArray<string>
  readonly newCrossCrateEdges: ReadonlyArray<CrossCrateEdge>
  readonly diffMode: "git-working-tree" | "git-commit-range" | "changed-hunks-fallback" | "missing"
  readonly diagnosticLimit: number
  readonly scoreMode: "bounded-pr-size-and-cross-crate-edge-pressure"
  readonly scoreDenominator: "changed-rust-lines-and-cross-crate-edges"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_RP_03_SCORE_MODE = "bounded-pr-size-and-cross-crate-edge-pressure" as const
const RS_RP_03_SCORE_DENOMINATOR = "changed-rust-lines-and-cross-crate-edges" as const

const RsRp03FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsRp03: Signal<RsRp03Config, RsRp03Output, RustProjectTag | SignalContextTag> = {
  id: "RS-RP-03-pr-size",
  title: "PR size",
  aliases: ["RS-RP-03"],
  tier: 1,
  category: "review-pain",
  kind: "structural",
  cacheVersion: "git-diff-pr-size-git-context-aliases-rust-hunks-v3",
  cacheDependencies: ["git-revision-context"],
  configSchema: RsRp03Config,
  factorDefinitions: RsRp03FactorDefinitions,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsRp03Config(config)
      const project = yield* RustProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsRp03Output> => {
          const git = simpleGit(context.worktreePath)
          const isRepo = await git.checkIsRepo()
          if (!isRepo) {
            return fromChangedHunks(project, context, normalizedConfig)
          }

          const workingNumstat = await git.raw(["diff", "--numstat", "--no-renames", "--", "*.rs"])
          if (workingNumstat.trim().length > 0) {
            const diff = await git.raw(["diff", "--unified=0", "--no-renames", "--", "*.rs"])
            return parseGitDiff(
              project,
              context.worktreePath,
              workingNumstat,
              diff,
              "git-working-tree",
              normalizedConfig,
            )
          }
          if (hasRustChangedHunks(context)) {
            return fromChangedHunks(project, context, normalizedConfig)
          }

          const range = context.gitSha === "HEAD" ? "HEAD^!" : `${context.gitSha}^!`
          try {
            const rangeNumstat = await git.raw(["diff", "--numstat", "--no-renames", range, "--", "*.rs"])
            const diff = await git.raw(["diff", "--unified=0", "--no-renames", range, "--", "*.rs"])
            const output = parseGitDiff(
              project,
              context.worktreePath,
              rangeNumstat,
              diff,
              "git-commit-range",
              normalizedConfig,
            )
            return output.filesChanged.length === 0 && context.changedHunks.length > 0
              ? fromChangedHunks(project, context, normalizedConfig)
              : output
          } catch {
            return fromChangedHunks(project, context, normalizedConfig)
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-RP-03-pr-size", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const changedLines = out.linesAdded + out.linesDeleted
    const edgePenalty = out.newCrossCrateEdges.length * 0.15
    const sizePenalty = Math.min(0.6, changedLines / 1000)
    return Math.max(0, 1 - sizePenalty - edgePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.diffMode === "missing") {
      return [{
        severity: "warn" as const,
        message: "RS-RP-03 could not inspect git diff state",
        data: {
          diffMode: out.diffMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return ([
      {
        severity: out.newCrossCrateEdges.length > 0 ? ("warn" as const) : ("info" as const),
        message: `PR surface: +${out.linesAdded} / -${out.linesDeleted} across ${out.filesChanged.length} files`,
        data: {
          linesAdded: out.linesAdded,
          linesDeleted: out.linesDeleted,
          filesChanged: out.filesChanged,
          cratesTouched: out.cratesTouched,
          newCrossCrateEdges: out.newCrossCrateEdges,
          diffMode: out.diffMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      },
      ...out.newCrossCrateEdges.map((edge) => ({
        severity: "warn" as const,
        message: `New cross-crate Rust import from ${edge.fromCrate} to ${edge.toCrate}`,
        location: { file: edge.file },
        data: {
          ...edge,
          diffMode: out.diffMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      })),
    ] satisfies ReadonlyArray<Diagnostic>).slice(0, out.diagnosticLimit)
  },
  outputMetadata: (out) => {
    if (out.diffMode === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.filesChanged.length === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsRp03FactorLedger(),
}

type NormalizedRsRp03Config = RsRp03Config

const normalizeRsRp03Config = (config: RsRp03Config): NormalizedRsRp03Config => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsRp03FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-RP-03-pr-size",
    RsRp03FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const parseGitDiff = (
  project: RustProject,
  worktreePath: string,
  numstat: string,
  diff: string,
  diffMode: RsRp03Output["diffMode"],
  config: NormalizedRsRp03Config,
): RsRp03Output => {
  const filesChanged: Array<string> = []
  let linesAdded = 0
  let linesDeleted = 0
  for (const line of numstat.split("\n")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim())
    if (match === null) continue
    linesAdded += match[1] === "-" ? 0 : Number(match[1])
    linesDeleted += match[2] === "-" ? 0 : Number(match[2])
    filesChanged.push(join(worktreePath, match[3]!))
  }
  const uniqueFiles = [...new Set(filesChanged.map((file) => normalizePath(file)))].sort()
  return {
    linesAdded,
    linesDeleted,
    filesChanged: uniqueFiles,
    cratesTouched: touchedCrates(project, uniqueFiles),
    newCrossCrateEdges: parseCrossCrateEdges(project, uniqueFiles, diff),
    diffMode,
    diagnosticLimit: config.top_n_diagnostics,
    scoreMode: RS_RP_03_SCORE_MODE,
    scoreDenominator: RS_RP_03_SCORE_DENOMINATOR,
  }
}

const parseCrossCrateEdges = (
  project: RustProject,
  changedFiles: ReadonlyArray<string>,
  diff: string,
): ReadonlyArray<CrossCrateEdge> => {
  const workspaceCrates = new Set(
    project.manifests
      .map((manifest) => manifest.packageName)
      .filter((name): name is string => name !== undefined),
  )
  const crateIndex = buildCrateImportIndex(project)
  const fileToCrate = new Map<string, string>()
  const fileToManifestPath = new Map<string, string>()
  for (const file of changedFiles) {
    const manifest = resolveManifestForFile(file, project.manifests)
    if (manifest?.packageName !== undefined) {
      fileToCrate.set(normalizePath(file), manifest.packageName)
      fileToManifestPath.set(normalizePath(file), manifest.manifestPath)
    }
  }

  const edges: Array<CrossCrateEdge> = []
  let currentFile: string | undefined
  for (const line of diff.split("\n")) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line)
    if (fileMatch !== null) {
      currentFile = normalizePath(join(project.worktreePath, fileMatch[1]!))
      continue
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue
    const useMatch = /^\+(?:pub\s+)?use\s+([A-Za-z_][A-Za-z0-9_]*)::/.exec(line.trim())
    if (useMatch === null || currentFile === undefined) continue
    const toCrate = useMatch[1]!
    const fromCrate = fileToCrate.get(currentFile)
    const fromManifestPath = fileToManifestPath.get(currentFile)
    const resolvedToCrate =
      (fromManifestPath === undefined
        ? undefined
        : crateIndex.dependencyAliasesByManifestPath.get(fromManifestPath)?.get(toCrate)) ??
      crateIndex.byIdentifier.get(toCrate)
    if (
      fromCrate === undefined ||
      resolvedToCrate === undefined ||
      !workspaceCrates.has(resolvedToCrate) ||
      resolvedToCrate === fromCrate
    ) {
      continue
    }
    edges.push({ file: currentFile, fromCrate, toCrate: resolvedToCrate })
  }
  return edges.filter(
    (edge, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.file === edge.file &&
          candidate.fromCrate === edge.fromCrate &&
          candidate.toCrate === edge.toCrate,
      ) === index,
  ).sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.fromCrate.localeCompare(right.fromCrate) ||
    left.toCrate.localeCompare(right.toCrate),
  )
}

const buildCrateImportIndex = (
  project: RustProject,
): {
  readonly byIdentifier: ReadonlyMap<string, string>
  readonly dependencyAliasesByManifestPath: ReadonlyMap<string, ReadonlyMap<string, string>>
} => {
  const byIdentifier = new Map<string, string>()
  const manifestByPackageName = new Map<string, (typeof project.manifests)[number]>()
  const dependencyAliasesByManifestPath = new Map<string, Map<string, string>>()

  for (const manifest of project.manifests) {
    if (manifest.packageName === undefined) continue
    manifestByPackageName.set(manifest.packageName, manifest)
    byIdentifier.set(manifest.packageName, manifest.packageName)
    byIdentifier.set(rustCrateIdentifier(manifest.packageName), manifest.packageName)
    byIdentifier.set(manifest.name, manifest.packageName)
  }

  for (const manifest of project.manifests) {
    if (manifest.packageName === undefined) continue
    const aliases = dependencyAliasesByManifestPath.get(manifest.manifestPath) ?? new Map<string, string>()
    for (const dependency of manifest.dependencies ?? []) {
      const target = manifestByPackageName.get(dependency.packageName)
      if (target?.packageName === undefined) continue
      aliases.set(dependency.alias, target.packageName)
      aliases.set(rustCrateIdentifier(dependency.alias), target.packageName)
    }
    dependencyAliasesByManifestPath.set(manifest.manifestPath, aliases)
  }

  return { byIdentifier, dependencyAliasesByManifestPath }
}

const rustCrateIdentifier = (name: string): string => name.replaceAll("-", "_")

const hasRustChangedHunks = (context: SignalContext): boolean =>
  context.changedHunks.some((hunk) => isRustChangedHunkPath(hunk.file))

const isRustChangedHunkPath = (file: string): boolean => normalizePath(file).endsWith(".rs")

const touchedCrates = (
  project: RustProject,
  filesChanged: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  project.manifests
    .filter(
      (manifest) =>
        manifest.packageName !== undefined &&
        filesChanged.some((file) => normalizePath(file).startsWith(`${normalizePath(manifest.path)}/`)),
    )
    .map((manifest) => manifest.packageName!)
    .sort()

const fromChangedHunks = async (
  project: RustProject,
  context: SignalContext,
  config: NormalizedRsRp03Config,
): Promise<RsRp03Output> => {
  if (context.changedHunks.length === 0) {
    return {
      linesAdded: 0,
      linesDeleted: 0,
      filesChanged: [],
      cratesTouched: [],
      newCrossCrateEdges: [],
      diffMode: "missing",
      diagnosticLimit: config.top_n_diagnostics,
      scoreMode: RS_RP_03_SCORE_MODE,
      scoreDenominator: RS_RP_03_SCORE_DENOMINATOR,
    }
  }
  const rustHunks = context.changedHunks.filter((hunk) => isRustChangedHunkPath(hunk.file))
  const filesChanged: Array<string> = [
    ...new Set(rustHunks.map((hunk) => normalizePath(join(context.worktreePath, hunk.file)))),
  ].sort()
  return {
    linesAdded: rustHunks.reduce((sum, hunk) => sum + hunk.newLines, 0),
    linesDeleted: rustHunks.reduce((sum, hunk) => sum + hunk.oldLines, 0),
    filesChanged,
    cratesTouched: touchedCrates(project, filesChanged),
    newCrossCrateEdges: await parseChangedHunkCrossCrateEdges(project, rustHunks, context.worktreePath),
    diffMode: "changed-hunks-fallback",
    diagnosticLimit: config.top_n_diagnostics,
    scoreMode: RS_RP_03_SCORE_MODE,
    scoreDenominator: RS_RP_03_SCORE_DENOMINATOR,
  }
}

const parseChangedHunkCrossCrateEdges = async (
  project: RustProject,
  hunks: SignalContext["changedHunks"],
  worktreePath: string,
): Promise<ReadonlyArray<CrossCrateEdge>> => {
  const changedFiles: Array<string> = [
    ...new Set(hunks.map((hunk) => normalizePath(join(worktreePath, hunk.file)))),
  ].sort()
  const diff = await changedHunksToAddedLineDiff(worktreePath, hunks)
  return parseCrossCrateEdges(project, changedFiles, diff)
}

const changedHunksToAddedLineDiff = async (
  worktreePath: string,
  hunks: SignalContext["changedHunks"],
): Promise<string> => {
  const hunksByFile = new Map<string, Array<(typeof hunks)[number]>>()
  for (const hunk of hunks) {
    const file = normalizePath(join(worktreePath, hunk.file))
    const existing = hunksByFile.get(file) ?? []
    existing.push(hunk)
    hunksByFile.set(file, existing)
  }

  const sections = await Promise.all(
    [...hunksByFile.entries()].map(async ([file, fileHunks]) => {
      try {
        const content = await readFile(file, "utf8")
        const lines = content.split("\n")
        const relative = normalizePath(file).startsWith(`${normalizePath(worktreePath)}/`)
          ? normalizePath(file).slice(normalizePath(worktreePath).length + 1)
          : normalizePath(file)
        return [
          `+++ b/${relative}`,
          ...fileHunks.flatMap((hunk) =>
            lines
              .slice(Math.max(0, hunk.newStart - 1), Math.max(0, hunk.newStart - 1) + hunk.newLines)
              .filter((line) => line.length > 0)
              .map((line) => `+${line}`),
          ),
        ].join("\n")
      } catch {
        return ""
      }
    }),
  )
  return sections.filter((section) => section.length > 0).join("\n")
}
