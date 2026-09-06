import {
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"
import { functionName } from "./ts-ld-02-function-names.js"
import type {
  CollectedSizes,
  FunctionSizeCandidate,
  TsLd02Config,
} from "./ts-ld-02-model.js"
import type { Node, SourceFile } from "../tsgo-api.js"

export const emptyCollectedSizes = (): CollectedSizes => ({
  perFileFunctionLocs: new Map(),
  fileLocs: [],
  allFunctionLocs: [],
  allFunctions: [],
  allFiles: [],
})

export const mergeCollectedSizes = (
  collected: CollectedSizes,
  next: CollectedSizes,
): CollectedSizes => {
  for (const [file, values] of next.perFileFunctionLocs) {
    collected.perFileFunctionLocs.set(file, values)
  }
  collected.fileLocs.push(...next.fileLocs)
  collected.allFunctionLocs.push(...next.allFunctionLocs)
  collected.allFunctions.push(...next.allFunctions)
  collected.allFiles.push(...next.allFiles)
  return collected
}

export const collectSourceFileSizesIfIncluded = (
  sourceFile: SourceFile,
  config: TsLd02Config,
): CollectedSizes => {
  const collected = emptyCollectedSizes()
  if (isExcluded(sourceFile.fileName, config.exclude_globs)) return collected
  collectSourceFileSizes(sourceFile, {
    perFileFunctionLocs: collected.perFileFunctionLocs,
    fileLocs: collected.fileLocs,
    allFunctionLocs: collected.allFunctionLocs,
    allFunctions: collected.allFunctions,
    allFiles: collected.allFiles,
  })
  return collected
}

const collectSourceFileSizes = (
  sourceFile: SourceFile,
  collected: {
    readonly perFileFunctionLocs: Map<string, Array<number>>
    readonly fileLocs: Array<number>
    readonly allFunctionLocs: Array<number>
    readonly allFunctions: Array<FunctionSizeCandidate>
    readonly allFiles: Array<{ file: string; loc: number }>
  },
): void => {
  const path = sourceFile.fileName
  const locCounter = buildEffectiveLineCounter(sourceFile.text)
  collected.fileLocs.push(locCounter.total)
  collected.allFiles.push({ file: path, loc: locCounter.total })

  const bucket: Array<number> = []
  for (const fn of collectFunctionSizes(sourceFile, locCounter)) {
    bucket.push(fn.loc)
    collected.allFunctionLocs.push(fn.loc)
    collected.allFunctions.push(fn)
  }
  collected.perFileFunctionLocs.set(path, bucket)
}

/**
 * Effective LOC = non-blank, non-comment lines.
 *
 * We work on raw text rather than AST nodes so the same rule applies
 * uniformly to function bodies and whole-file counts. A lightweight
 * state machine handles `//`, `/* ... *\/`, and template/string
 * boundaries that might contain comment markers.
 */
interface EffectiveLineCounter {
  readonly total: number
  readonly countInclusive: (startLine: number, endLine: number) => number
}

const buildEffectiveLineCounter = (text: string): EffectiveLineCounter => {
  const prefixCounts: Array<number> = [0]
  let inBlockComment = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const countsAsCode = countLineAsCode(line, {
      inBlockComment,
      setBlockComment: (value) => {
        inBlockComment = value
      },
    })
    const previous = prefixCounts[prefixCounts.length - 1] ?? 0
    prefixCounts.push(previous + (countsAsCode ? 1 : 0))
  }

  return {
    total: prefixCounts[prefixCounts.length - 1] ?? 0,
    countInclusive: (startLine, endLine) => {
      const start = Math.max(0, startLine)
      const end = Math.min(prefixCounts.length - 2, endLine)
      if (end < start) return 0
      return (prefixCounts[end + 1] ?? 0) - (prefixCounts[start] ?? 0)
    },
  }
}

const countLineAsCode = (
  line: string,
  state: {
    readonly inBlockComment: boolean
    readonly setBlockComment: (value: boolean) => void
  },
): boolean => {
  if (state.inBlockComment) return countAfterBlockCommentClose(line, state)
  if (line === "" || line.startsWith("//")) return false
  if (!line.startsWith("/*")) return true

  const close = line.indexOf("*/", 2)
  if (close === -1) {
    state.setBlockComment(true)
    return false
  }
  const after = line.slice(close + 2).trim()
  return after.length > 0 && !after.startsWith("//")
}

const countAfterBlockCommentClose = (
  line: string,
  state: { readonly setBlockComment: (value: boolean) => void },
): boolean => {
  const close = line.indexOf("*/")
  if (close === -1) return false
  state.setBlockComment(false)
  const after = line.slice(close + 2).trim()
  if (after.length === 0 || after.startsWith("//")) return false
  if (!after.startsWith("/*")) return true

  const close2 = after.indexOf("*/", 2)
  if (close2 !== -1) return true
  state.setBlockComment(true)
  return false
}

const collectFunctionSizes = (
  sourceFile: SourceFile,
  locCounter: EffectiveLineCounter,
): ReadonlyArray<FunctionSizeCandidate> => {
  const file = sourceFile.fileName
  const functions: Array<FunctionSizeCandidate> = []

  const visit = (node: Node): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(sourceFile)
      const nameInfo = functionName(node)
      functions.push({
        file,
        name: nameInfo.name,
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        loc: functionLoc(node, sourceFile, locCounter),
        ...(nameInfo.callbackContext !== undefined
          ? { callbackContext: nameInfo.callbackContext }
          : {}),
      })
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return functions
}

const functionLoc = (
  fn: CompilerFunctionLike,
  sourceFile: SourceFile,
  locCounter: EffectiveLineCounter,
): number => {
  const body = getFunctionBodyNode(fn)
  if (body === undefined) return 0
  const startLine = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile)).line
  const endLine = sourceFile.getLineAndCharacterOfPosition(body.getEnd()).line
  const nestedLoc = collectNestedFunctionBodyLineIntervals(body, sourceFile)
    .map(([nestedStart, nestedEnd]) => locCounter.countInclusive(nestedStart, nestedEnd))
    .reduce((sum, loc) => sum + loc, 0)
  return Math.max(0, locCounter.countInclusive(startLine, endLine) - nestedLoc)
}

const getFunctionBodyNode = (fn: CompilerFunctionLike): Node | undefined =>
  "body" in fn ? fn.body : undefined

const collectNestedFunctionBodyLineIntervals = (
  body: Node,
  sourceFile: SourceFile,
): ReadonlyArray<readonly [number, number]> => {
  const intervals: Array<readonly [number, number]> = []

  const visit = (node: Node): void => {
    if (isCompilerFunctionLike(node)) {
      const nestedBody = getFunctionBodyNode(node)
      if (nestedBody !== undefined) {
        intervals.push([
          sourceFile.getLineAndCharacterOfPosition(nestedBody.getStart(sourceFile)).line,
          sourceFile.getLineAndCharacterOfPosition(nestedBody.getEnd()).line,
        ])
      }
      return
    }
    node.forEachChild(visit)
  }

  body.forEachChild(visit)
  return mergeLineIntervals(intervals)
}

const mergeLineIntervals = (
  intervals: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<readonly [number, number]> => {
  const sorted = [...intervals].sort(
    ([leftStart, leftEnd], [rightStart, rightEnd]) =>
      leftStart - rightStart || leftEnd - rightEnd,
  )
  const merged: Array<readonly [number, number]> = []
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1]
    if (previous === undefined || start > previous[1] + 1) {
      merged.push([start, end])
      continue
    }
    merged[merged.length - 1] = [previous[0], Math.max(previous[1], end)]
  }
  return merged
}
