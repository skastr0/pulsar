import { join } from "node:path"
import {
  SignalContextTag,
  type SignalContext,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import { RustProjectTag, type RustProject } from "../project.js"
import { normalizePath } from "./shared-globs.js"

export const RsRp03Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type RsRp03Config = typeof RsRp03Config.Type

export interface CrossCrateEdge {
  readonly file: string
  readonly fromCrate: string
  readonly toCrate: string
}

export interface RsRp03Output {
  readonly linesAdded: number
  readonly linesDeleted: number
  readonly filesChanged: ReadonlyArray<string>
  readonly cratesTouched: ReadonlyArray<string>
  readonly newCrossCrateEdges: ReadonlyArray<CrossCrateEdge>
  readonly diffMode: "git-working-tree" | "git-commit-range" | "changed-hunks-fallback" | "missing"
}

export const RsRp03: Signal<RsRp03Config, RsRp03Output, RustProjectTag | SignalContextTag> = {
  id: "RS-RP-03-pr-size",
  title: "PR size",
  aliases: ["RS-RP-03"],
  tier: 1,
  category: "review-pain",
  kind: "structural",
  configSchema: RsRp03Config,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsRp03Output> => {
          const git = simpleGit(context.worktreePath)
          const isRepo = await git.checkIsRepo()
          if (!isRepo) {
            return fromChangedHunks(project, context)
          }

          const workingNumstat = await git.raw(["diff", "--numstat", "--no-renames", "--", "*.rs"])
          if (workingNumstat.trim().length > 0) {
            const diff = await git.raw(["diff", "--unified=0", "--no-renames", "--", "*.rs"])
            return parseGitDiff(project, context.worktreePath, workingNumstat, diff, "git-working-tree")
          }

          const range = context.gitSha === "HEAD" ? "HEAD^!" : `${context.gitSha}^!`
          try {
            const rangeNumstat = await git.raw(["diff", "--numstat", "--no-renames", range, "--", "*.rs"])
            const diff = await git.raw(["diff", "--unified=0", "--no-renames", range, "--", "*.rs"])
            return parseGitDiff(project, context.worktreePath, rangeNumstat, diff, "git-commit-range")
          } catch {
            return fromChangedHunks(project, context)
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
      return [{ severity: "warn", message: "RS-RP-03 could not inspect git diff state" }]
    }
    return [
      {
        severity: out.newCrossCrateEdges.length > 0 ? ("warn" as const) : ("info" as const),
        message: `PR surface: +${out.linesAdded} / -${out.linesDeleted} across ${out.filesChanged.length} files`,
        data: {
          cratesTouched: out.cratesTouched,
          newCrossCrateEdges: out.newCrossCrateEdges,
          diffMode: out.diffMode,
        },
      },
    ]
  },
}

const parseGitDiff = (
  project: RustProject,
  worktreePath: string,
  numstat: string,
  diff: string,
  diffMode: RsRp03Output["diffMode"],
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
  const fileToCrate = new Map<string, string>()
  for (const file of changedFiles) {
    const manifest = project.manifests
      .slice()
      .sort(
        (left, right) => normalizePath(right.path).length - normalizePath(left.path).length,
      )
      .find((candidate) => normalizePath(file).startsWith(`${normalizePath(candidate.path)}/`))
    if (manifest?.packageName !== undefined) {
      fileToCrate.set(normalizePath(file), manifest.packageName)
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
    if (fromCrate === undefined || !workspaceCrates.has(toCrate) || toCrate === fromCrate) continue
    edges.push({ file: currentFile, fromCrate, toCrate })
  }
  return edges.filter(
    (edge, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.file === edge.file &&
          candidate.fromCrate === edge.fromCrate &&
          candidate.toCrate === edge.toCrate,
      ) === index,
  )
}

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

const fromChangedHunks = (
  project: RustProject,
  context: SignalContext,
): RsRp03Output => {
  if (context.changedHunks.length === 0) {
    return {
      linesAdded: 0,
      linesDeleted: 0,
      filesChanged: [],
      cratesTouched: [],
      newCrossCrateEdges: [],
      diffMode: "missing",
    }
  }
  const filesChanged: Array<string> = [
    ...new Set(
      context.changedHunks.map((hunk) => normalizePath(join(context.worktreePath, hunk.file))),
    ),
  ]
  return {
    linesAdded: context.changedHunks.reduce((sum, hunk) => sum + hunk.newLines, 0),
    linesDeleted: context.changedHunks.reduce((sum, hunk) => sum + hunk.oldLines, 0),
    filesChanged,
    cratesTouched: touchedCrates(project, filesChanged),
    newCrossCrateEdges: [],
    diffMode: "changed-hunks-fallback",
  }
}
