import { relative } from "node:path"
import type { ChangedHunk } from "@skastr0/pulsar-core/signal"
import { Node, type Node as TsMorphNode, type SourceFile } from "ts-morph"
import { isExcluded } from "./shared-globs.js"

export const TRUST_SIGNAL_EXCLUDE_GLOBS = [
  "**/*.d.ts",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.pulsar/**",
  "**/vendor/**",
  "**/gen/**",
  "**/generated/**",
  "**/_generated/**",
  "**/*.gen.ts",
  "**/*.gen.tsx",
  "**/*.generated.ts",
  "**/*.generated.tsx",
] as const

export const TEST_FILE_GLOBS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
] as const

export const PRODUCTION_EXCLUDE_GLOBS = [
  ...TRUST_SIGNAL_EXCLUDE_GLOBS,
  ...TEST_FILE_GLOBS,
] as const

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export const normalizeDiagnosticLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(100, Math.floor(value)))
}

export const isAnalyzableSourceFile = (
  sourceFile: SourceFile,
  excludeGlobs: ReadonlyArray<string>,
): boolean => {
  const file = sourceFile.getFilePath()
  return !isExcluded(file, excludeGlobs)
}

export const locationOf = (node: TsMorphNode): SourceLocation => {
  const sourceFile = node.getSourceFile()
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
  return { file: sourceFile.getFilePath(), line, column }
}

export const isStringLiteralLike = (node: TsMorphNode | undefined): boolean =>
  node !== undefined &&
  (Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isNumericLiteral(node) ||
    node.getKindName() === "TrueKeyword" ||
    node.getKindName() === "FalseKeyword")

export const stringLiteralValue = (node: TsMorphNode | undefined): string | undefined => {
  if (node === undefined) return undefined
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText()
  }
  return undefined
}

export const expressionName = (node: TsMorphNode | undefined): string => {
  if (node === undefined) return ""
  return node.getText().replace(/\s+/g, " ").trim()
}

export const callName = (node: TsMorphNode | undefined): string => {
  const text = expressionName(node)
  return text.replace(/\?./g, ".")
}

export const changedHunkCovers = (
  worktreePath: string,
  location: SourceLocation,
  changedHunks: ReadonlyArray<ChangedHunk>,
): boolean => {
  if (changedHunks.length === 0) return false
  const relativeFile = relative(worktreePath, location.file).replace(/\\/g, "/")
  return changedHunks.some((hunk) =>
    hunk.file === relativeFile &&
    lineInHunk(location.line, hunk)
  )
}

export const sourceFileChanged = (
  worktreePath: string,
  sourceFile: SourceFile,
  changedHunks: ReadonlyArray<ChangedHunk>,
): boolean => {
  if (changedHunks.length === 0) return false
  const relativeFile = relative(worktreePath, sourceFile.getFilePath()).replace(/\\/g, "/")
  return changedHunks.some((hunk) => hunk.file === relativeFile)
}

const lineInHunk = (line: number, hunk: ChangedHunk): boolean => {
  if (hunk.newLines === 0) return line === hunk.newStart
  return line >= hunk.newStart && line < hunk.newStart + hunk.newLines
}

export const shannonEntropy = (value: string): number => {
  if (value.length === 0) return 0
  const counts = new Map<string, number>()
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
  }
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length
    return sum - probability * Math.log2(probability)
  }, 0)
}

export const normalizeIdentifier = (value: string): string =>
  value.replace(/[^A-Za-z0-9]+/g, "").toLowerCase()
