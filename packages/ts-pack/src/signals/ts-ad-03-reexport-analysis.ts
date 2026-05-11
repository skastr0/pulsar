import { basename } from "node:path"
import { Node, type SourceFile } from "ts-morph"
import { createModuleResolver } from "../graph/module-graph.js"

export interface ReExportAnalysis {
  readonly isBarrel: boolean
  readonly barrelRatio: number
  readonly maxChainDepth: number
  readonly directReExports: number
}

interface ReExportAnalysisConfig {
  readonly barrel_ratio_threshold: number
  readonly index_reexport_threshold: number
}

export const buildReExportAnalysis = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: ReExportAnalysisConfig,
): {
  readonly reExportTargets: ReadonlyMap<string, ReadonlyArray<string>>
  readonly analysisByFile: Map<string, ReExportAnalysis>
} => {
  const fileSet: ReadonlySet<string> = new Set(
    sourceFiles.map((sourceFile): string => sourceFile.getFilePath()),
  )
  const resolver = createModuleResolver(sourceFiles, [])
  const reExportTargets = new Map<string, ReadonlyArray<string>>()
  const analysisByFile = new Map<string, ReExportAnalysis>()

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    const targets = collectReExportTargets(sourceFile, fileSet, resolver)
    reExportTargets.set(file, targets)
    analysisByFile.set(file, analyzeReExportFile(sourceFile, targets, config))
  }

  return { reExportTargets, analysisByFile }
}

const collectReExportTargets = (
  sourceFile: SourceFile,
  fileSet: ReadonlySet<string>,
  resolver: ReturnType<typeof createModuleResolver>,
): ReadonlyArray<string> => {
  const file = sourceFile.getFilePath()
  return uniqueSorted(
    sourceFile.getExportDeclarations().reduce<Array<string>>((acc, declaration) => {
      const value = resolver.resolve(file, declaration)
      if (value !== undefined && fileSet.has(value)) {
        acc.push(value)
      }
      return acc
    }, []),
  )
}

const analyzeReExportFile = (
  sourceFile: SourceFile,
  targets: ReadonlyArray<string>,
  config: ReExportAnalysisConfig,
): ReExportAnalysis => {
  const file = sourceFile.getFilePath()
  const directReExports = targets.length
  const totalExports = directReExports + countLocalExportSurfaces(sourceFile)
  const barrelRatio = totalExports === 0 ? Number(directReExports > 0) : directReExports / totalExports
  const isBarrel =
    barrelRatio >= config.barrel_ratio_threshold ||
    (basename(file) === "index.ts" && directReExports >= config.index_reexport_threshold)

  return {
    isBarrel,
    barrelRatio,
    maxChainDepth: 0,
    directReExports,
  }
}

const countLocalExportSurfaces = (sourceFile: SourceFile): number => {
  let count = 0

  for (const statement of sourceFile.getStatements()) {
    if (Node.isExportDeclaration(statement)) {
      if (statement.getModuleSpecifierValue() !== undefined) continue
      count += Math.max(1, statement.getNamedExports().length)
      continue
    }

    if (Node.isExportAssignment(statement)) {
      count += 1
      continue
    }

    if (Node.isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue
      count += Math.max(1, statement.getDeclarations().length)
      continue
    }

    if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement) ||
      Node.isEnumDeclaration(statement) ||
      Node.isModuleDeclaration(statement)
    ) {
      if (hasExportModifier(statement)) count += 1
    }
  }

  return count
}

const hasExportModifier = (
  node:
    | import("ts-morph").VariableStatement
    | import("ts-morph").FunctionDeclaration
    | import("ts-morph").ClassDeclaration
    | import("ts-morph").InterfaceDeclaration
    | import("ts-morph").TypeAliasDeclaration
    | import("ts-morph").EnumDeclaration
    | import("ts-morph").ModuleDeclaration,
): boolean => node.getModifiers().some((modifier) => modifier.getText() === "export")

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))
