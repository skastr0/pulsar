import { relative } from "node:path"
import type { SourceFile } from "ts-morph"
import { getFunctionBody, getFunctionLikeEntriesForSourceFile, type TsFunctionLike as FnLike } from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { analyzeStructuralSource } from "./ts-sl-01-structural.js"
import { hashExactSource, normalizeExactSource } from "./ts-sl-01-hash.js"
import { buildHunkMap, lineRangeOverlapsHunkRanges } from "./ts-sl-01-hunks.js"
import { DEFAULT_SCORE_BUDGET_MIN_TOKENS, type CloneCandidate, type CloneCandidateCollection, type CloneSourceFileCollection, type StructuralAnalysisCache, type TsSl01Config, type TsSl01Context } from "./ts-sl-01-model.js"

export const collectCloneCandidates = (
  sourceFiles: ReadonlyArray<SourceFile>,
  context: TsSl01Context,
  config: TsSl01Config,
): CloneCandidateCollection => {
  const useChangedHunkScope =
    context.assessmentScope === "changed-only" && context.changedHunks.length > 0
  const hunkMap = useChangedHunkScope
    ? buildHunkMap(context.worktreePath, context.changedHunks)
    : undefined
  const structuralAnalysisCache: StructuralAnalysisCache = new Map()
  const collection = emptyCloneSourceFileCollection()

  for (const sourceFile of sourceFiles) {
    mergeCloneSourceFileCollection(
      collection,
      collectSourceFileCloneCandidates(sourceFile, context, config, hunkMap, structuralAnalysisCache),
    )
  }

  return {
    ...collection,
    scopeMode: useChangedHunkScope ? "changed-hunks" : "whole-tree",
  }
}

const collectSourceFileCloneCandidates = (
  sourceFile: SourceFile,
  context: TsSl01Context,
  config: TsSl01Config,
  hunkMap: ReturnType<typeof buildHunkMap>,
  structuralAnalysisCache: StructuralAnalysisCache,
): CloneSourceFileCollection => {
  if (shouldSkipSourceFile(sourceFile, context.worktreePath, config)) {
    return emptyCloneSourceFileCollection()
  }

  const path = sourceFile.getFilePath()
  const collection = emptyCloneSourceFileCollection()
  for (const entry of getFunctionLikeEntriesForSourceFile(sourceFile)) {
    const candidate = cloneCandidateForFunction(entry.fn, entry.path, path, hunkMap, structuralAnalysisCache)
    if (candidate === undefined) continue
    recordCloneCandidate(collection, candidate, config)
  }
  return collection
}

const shouldSkipSourceFile = (
  sourceFile: SourceFile,
  worktreePath: string,
  config: TsSl01Config,
): boolean => {
  if (sourceFile.isDeclarationFile()) return true
  const path = sourceFile.getFilePath()
  const relativePath = relative(worktreePath, path).replace(/\\/g, "/")
  return (
    matchesSourcePath(path, relativePath, config.exclude_globs) ||
    isGeneratedSourceFileHeader(sourceFile.compilerNode.text.slice(0, 2048)) ||
    matchesSourcePath(path, relativePath, config.test_globs)
  )
}

const cloneCandidateForFunction = (
  fn: FnLike,
  functionPath: string,
  sourceFilePath: string,
  hunkMap: ReturnType<typeof buildHunkMap>,
  structuralAnalysisCache: StructuralAnalysisCache,
): CloneCandidate | undefined => {
  const body = getFunctionBody(fn)
  if (body === undefined) return undefined
  const exactKey = normalizeExactSource(body)
  const exactHash = hashExactSource(body)
  const cacheKey = exactKey
  const structuralAnalysis =
    structuralAnalysisCache.get(cacheKey) ??
    analyzeStructuralBody(body, structuralAnalysisCache, cacheKey)
  const startLine = fn.getStartLineNumber()
  const endLine = fn.getEndLineNumber()
  return {
    fn,
    path: functionPath,
    body,
    startLine,
    endLine,
    exactKey,
    exactHash,
    structuralHash: structuralAnalysis.structuralHash,
    changed:
      hunkMap === undefined ||
      lineRangeOverlapsHunkRanges(startLine, endLine, hunkMap.get(sourceFilePath) ?? []),
    tokenCount: structuralAnalysis.tokenCount,
  }
}

const analyzeStructuralBody = (
  body: string,
  cache: Map<string, { readonly tokenCount: number; readonly structuralHash: string }>,
  cacheKey: string,
): { readonly tokenCount: number; readonly structuralHash: string } => {
  const analysis = analyzeStructuralSource(body)
  cache.set(cacheKey, analysis)
  return analysis
}

const matchesSourcePath = (
  absolutePath: string,
  relativePath: string,
  globs: ReadonlyArray<string>,
): boolean => isExcluded(absolutePath, globs) || matchesAnyGlob(relativePath, globs)

const isGeneratedSourceFileHeader = (header: string): boolean => {
  return (
    /\bcode generated\b[\s\S]{0,160}\bdo not edit\b/i.test(header) ||
    /\bauto-generated\b[\s\S]{0,160}\bdo not edit\b/i.test(header) ||
    /\bfile generated from\b[\s\S]{0,160}\bopenapi spec\b/i.test(header) ||
    /@generated\b/i.test(header)
  )
}

const emptyCloneSourceFileCollection = (): {
  functions: Array<CloneCandidate>
  scoreBudgetFunctions: number
  totalFunctionsAnalyzed: number
} => ({
  functions: [],
  scoreBudgetFunctions: 0,
  totalFunctionsAnalyzed: 0,
})

const recordCloneCandidate = (
  collection: ReturnType<typeof emptyCloneSourceFileCollection>,
  candidate: CloneCandidate,
  config: TsSl01Config,
): void => {
  if (candidate.changed && candidate.tokenCount >= DEFAULT_SCORE_BUDGET_MIN_TOKENS) {
    collection.scoreBudgetFunctions += 1
  }
  if (candidate.tokenCount < config.min_tokens) return
  if (candidate.changed) collection.totalFunctionsAnalyzed += 1
  collection.functions.push(candidate)
}

const mergeCloneSourceFileCollection = (
  target: ReturnType<typeof emptyCloneSourceFileCollection>,
  source: CloneSourceFileCollection,
): void => {
  target.functions.push(...source.functions)
  target.scoreBudgetFunctions += source.scoreBudgetFunctions
  target.totalFunctionsAnalyzed += source.totalFunctionsAnalyzed
}
