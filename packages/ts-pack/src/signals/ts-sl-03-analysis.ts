import { SignalContextTag, parseBypasses } from "@skastr0/pulsar-core/signal"
import { relative } from "node:path"
import type { Project, SourceFile } from "ts-morph"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  contextualSuppressionJustification,
  extractSuppression,
  inheritedRecentJustification,
  suppressionKey,
} from "./ts-sl-03-justifications.js"
import type { Suppression, TsSl03Config, TsSl03Output } from "./ts-sl-03-suppressions.js"

export const computeSuppressions = (
  project: Project,
  context: typeof SignalContextTag.Service,
  config: TsSl03Config,
): TsSl03Output => {
  const sourceFiles = selectSourceFiles(project, context.worktreePath, config)
  const suppressions = sourceFiles.flatMap((sourceFile) =>
    collectFileSuppressions(sourceFile, context),
  )
  return buildSuppressionOutput(suppressions, sourceFiles.length, config, context)
}

const selectSourceFiles = (
  project: Project,
  worktreePath: string,
  config: TsSl03Config,
): ReadonlyArray<SourceFile> =>
  project.getSourceFiles().filter((sourceFile) => {
    const path = sourceFile.getFilePath()
    const relativePath = relative(worktreePath, path).replace(/\\/g, "/")
    return (
      !matchesSourcePath(path, relativePath, config.exclude_globs) &&
      !matchesSourcePath(path, relativePath, config.test_globs)
    )
  })

const collectFileSuppressions = (
  sourceFile: SourceFile,
  context: typeof SignalContextTag.Service,
): ReadonlyArray<Suppression> => {
  const path = sourceFile.getFilePath()
  const sourceText = sourceFile.getFullText()
  const bypasses = parseBypasses(sourceText)
  const recentJustifications = new Map<string, { readonly line: number; readonly text: string }>()
  const suppressions: Array<Suppression> = []
  const lines = sourceText.split("\n")

  for (let index = 0; index < lines.length; index++) {
    const suppression = suppressionAtLine(lines, index, path, context, recentJustifications, bypasses)
    if (suppression !== undefined) suppressions.push(suppression)
  }
  return suppressions
}

const suppressionAtLine = (
  lines: ReadonlyArray<string>,
  index: number,
  path: string,
  context: typeof SignalContextTag.Service,
  recentJustifications: Map<string, { readonly line: number; readonly text: string }>,
  bypasses: ReturnType<typeof parseBypasses>,
): Suppression | undefined => {
  const line = lines[index]!
  const lineNum = index + 1
  const parsed = extractSuppression(line)
  if (parsed === undefined) return undefined
  if (isBanTsCommentBridge(parsed, lines[index + 1])) return undefined
  if (!lineOverlapsHunks(path, lineNum, context.worktreePath, context.changedHunks)) {
    return undefined
  }

  const attachedBypass = bypasses.find((bypass) => Math.abs(bypass.line - lineNum) <= 1)
  const contextualJustification =
    contextualSuppressionJustification(lines, index, parsed) ??
    inheritedRecentJustification(recentJustifications, parsed, lineNum)
  const justification = suppressionJustification(parsed, attachedBypass, contextualJustification)
  const justificationSource = suppressionJustificationSource(parsed, attachedBypass, contextualJustification)

  if (justification === "active") {
    recentJustifications.set(suppressionKey(parsed), {
      line: lineNum,
      text:
        parsed.inlineJustification ??
        contextualJustification ??
        attachedBypass?.reason ??
        "active suppression justification",
    })
  }

  return {
    file: path,
    line: lineNum,
    kind: parsed.kind,
    rule: parsed.rule,
    justification,
    justificationSource,
    bypassTicket: attachedBypass?.ticket,
  }
}

const suppressionJustification = (
  suppression: { readonly inlineJustification: string | undefined },
  attachedBypass: ReturnType<typeof parseBypasses>[number] | undefined,
  contextualJustification: string | undefined,
): Suppression["justification"] =>
  attachedBypass?.status ??
  (suppression.inlineJustification !== undefined || contextualJustification !== undefined
    ? "active"
    : "missing")

const suppressionJustificationSource = (
  suppression: { readonly inlineJustification: string | undefined },
  attachedBypass: ReturnType<typeof parseBypasses>[number] | undefined,
  contextualJustification: string | undefined,
): Suppression["justificationSource"] =>
  attachedBypass !== undefined
    ? "bypass"
    : suppression.inlineJustification !== undefined
      ? "inline"
      : contextualJustification !== undefined
        ? "contextual"
        : undefined

const buildSuppressionOutput = (
  suppressions: ReadonlyArray<Suppression>,
  analyzedFileCount: number,
  config: TsSl03Config,
  context: typeof SignalContextTag.Service,
): TsSl03Output => ({
  suppressions: suppressions.slice().sort(compareSuppressions),
  unjustifiedCount: suppressions.filter((s) => s.justification === "missing" || s.justification === "expired").length,
  expiredCount: suppressions.filter((s) => s.justification === "expired").length,
  missingJustificationCount: suppressions.filter((s) => s.justification === "missing").length,
  diagnosticLimit: config.top_n_diagnostics,
  scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
  analyzedFileCount,
})

const compareSuppressions = (a: Suppression, b: Suppression): number =>
  suppressionPriority(a) - suppressionPriority(b) ||
  a.file.localeCompare(b.file) ||
  a.line - b.line

const matchesSourcePath = (
  absolutePath: string,
  relativePath: string,
  globs: ReadonlyArray<string>,
): boolean => isExcluded(absolutePath, globs) || matchesAnyGlob(relativePath, globs)

const isBanTsCommentBridge = (
  suppression: { readonly kind: Suppression["kind"]; readonly rule: string | undefined },
  nextLine: string | undefined,
): boolean =>
  suppression.kind === "eslint-disable" &&
  suppression.rule === "@typescript-eslint/ban-ts-comment" &&
  nextLine !== undefined &&
  /@ts-(?:ignore|expect-error)\b/.test(nextLine)

const suppressionPriority = (suppression: Suppression): number => {
  if (suppression.justification === "missing") return 0
  if (suppression.justification === "expired") return 1
  return 2
}


const lineOverlapsHunks = (
  filePath: string,
  line: number,
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): boolean => {
  if (hunks.length === 0) return true
  const absoluteFile = filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`

  for (const hunk of hunks) {
    const hunkFileAbsolute = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    if (hunkFileAbsolute !== absoluteFile) continue

    const hunkStart = hunk.newStart
    const hunkEnd = hunk.newStart + hunk.newLines

    if (line >= hunkStart && line < hunkEnd) {
      return true
    }
  }

  return false
}

