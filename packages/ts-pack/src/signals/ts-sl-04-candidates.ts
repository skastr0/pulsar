import { Node, SyntaxKind, type Project } from "ts-morph"
import {
  getFunctionBody,
  getFunctionLikeIndex,
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { classifyStub } from "./ts-sl-04-classify.js"
import type { TsSl04Config } from "./ts-sl-04-config.js"
import { isIntentionalNoop } from "./ts-sl-04-intentional-noops.js"
import type { StubKind } from "./ts-sl-04-factors.js"

export interface StubCandidate {
  readonly path: string
  readonly name: string
  readonly line: number
  readonly nodeKind: string
  readonly bodyText: string
  readonly functionText: string
  readonly parentKind: string
  readonly parentText: string
  readonly ancestorKinds: ReadonlyArray<string>
  readonly isTestPath: boolean
  readonly builtinIntentionalNoop: boolean
  readonly stubKind: { readonly kind: StubKind; readonly message: string } | undefined
}

export interface StubCandidateCollection {
  readonly candidates: ReadonlyArray<StubCandidate>
  readonly totalFunctions: number
}

export interface ChangedHunk {
  readonly file: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
}

interface HunkLineRange {
  readonly start: number
  readonly end: number
}

export const collectStubCandidates = (
  project: Project,
  context: {
    readonly worktreePath: string
    readonly changedHunks: ReadonlyArray<ChangedHunk>
  },
  config: TsSl04Config,
): StubCandidateCollection => {
  const candidates: Array<StubCandidate> = []
  let totalFunctions = 0
  const hunkIndex = buildChangedHunkIndex(context.worktreePath, context.changedHunks)

  for (const { path, fn } of getFunctionLikeIndex(project)) {
    if (isExcluded(path, config.exclude_globs)) continue

    const isTestPath = matchesAnyGlob(path, config.test_globs)
    if (isTestPath && !config.include_test_stubs) continue

    if (!lineRangeOverlapsHunkIndex(path, fn, context.worktreePath, hunkIndex)) {
      continue
    }

    if (isAbstractMethod(fn)) {
      continue
    }

    totalFunctions++

    const candidate = stubCandidateForFunction(path, fn, isTestPath)
    if (candidate !== undefined) {
      candidates.push(candidate)
    }
  }

  return { candidates, totalFunctions }
}

const stubCandidateForFunction = (
  path: string,
  fn: FnLike,
  isTestPath: boolean,
): StubCandidate | undefined => {
  const bodyText = getFunctionBody(fn)
  if (bodyText === undefined) return undefined

  const builtinIntentionalNoop = isIntentionalNoop(path, fn, bodyText)
  const stubKind = builtinIntentionalNoop ? undefined : classifyStub(fn, bodyText)
  if (!builtinIntentionalNoop && stubKind === undefined) return undefined

  return {
    path,
    name: getFunctionName(fn),
    line: fn.getStartLineNumber(),
    nodeKind: syntaxKindName(fn.getKind()),
    bodyText,
    functionText: fn.getText(),
    parentKind: syntaxKindName(fn.getParent().getKind()),
    parentText: fn.getParent().getText(),
    ancestorKinds: fn
      .getAncestors()
      .slice(-8)
      .map((ancestor) => syntaxKindName(ancestor.getKind())),
    isTestPath,
    builtinIntentionalNoop,
    stubKind,
  }
}

const isAbstractMethod = (fn: FnLike): boolean =>
  Node.isMethodDeclaration(fn) && fn.isAbstract()

const syntaxKindName = (kind: SyntaxKind): string => SyntaxKind[kind] ?? String(kind)

const buildChangedHunkIndex = (
  worktreePath: string,
  hunks: ReadonlyArray<ChangedHunk>,
): ReadonlyMap<string, ReadonlyArray<HunkLineRange>> | undefined => {
  if (hunks.length === 0) return undefined
  const byFile = new Map<string, Array<HunkLineRange>>()

  for (const hunk of hunks) {
    const absoluteFile = absoluteHunkFilePath(worktreePath, hunk.file)
    const ranges = byFile.get(absoluteFile) ?? []
    ranges.push({
      start: hunk.newStart,
      end: hunk.newStart + hunk.newLines,
    })
    byFile.set(absoluteFile, ranges)
  }

  return byFile
}

const lineRangeOverlapsHunkIndex = (
  filePath: string,
  fn: FnLike,
  worktreePath: string,
  hunkIndex: ReadonlyMap<string, ReadonlyArray<HunkLineRange>> | undefined,
): boolean => {
  if (hunkIndex === undefined) return true
  const absoluteFile = absoluteHunkFilePath(worktreePath, filePath)
  const ranges = hunkIndex.get(absoluteFile)
  if (ranges === undefined) return false

  const startLine = fn.getStartLineNumber()
  const endLine = fn.getEndLineNumber()
  for (const range of ranges) {
    if (startLine < range.end && endLine >= range.start) {
      return true
    }
  }

  return false
}

const absoluteHunkFilePath = (worktreePath: string, filePath: string): string =>
  filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`
