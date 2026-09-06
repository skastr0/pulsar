import { basename } from "node:path"
import { sortedUniqueFilePaths } from "@skastr0/pulsar-core/signal"
import { hasExportModifier, walkDescendants } from "../ast.js"
import { createModuleResolver } from "../graph/module-graph.js"
import type { PackageInfo } from "../discovery.js"
import {
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isInterfaceDeclaration,
  isModuleDeclaration,
  isNamedExports,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  type SourceFile,
} from "../tsgo-api.js"

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
  packages: ReadonlyArray<PackageInfo>,
  config: ReExportAnalysisConfig,
): {
  readonly reExportTargets: ReadonlyMap<string, ReadonlyArray<string>>
  readonly analysisByFile: Map<string, ReExportAnalysis>
} => {
  const fileSet: ReadonlySet<string> = new Set(
    sourceFiles.map((sourceFile): string => sourceFile.fileName),
  )
  const resolver = createModuleResolver(sourceFiles, packages)
  const reExportTargets = new Map<string, ReadonlyArray<string>>()
  const analysisByFile = new Map<string, ReExportAnalysis>()

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.fileName
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
  const file = sourceFile.fileName
  return sortedUniqueFilePaths(
    (() => {
      const acc: Array<string> = []
      walkDescendants(sourceFile, (declaration) => {
        if (!isExportDeclaration(declaration)) return
        const value = resolver.resolve(file, declaration)
        if (value !== undefined && fileSet.has(value)) acc.push(value)
      })
      return acc
    })(),
  )
}

const analyzeReExportFile = (
  sourceFile: SourceFile,
  targets: ReadonlyArray<string>,
  config: ReExportAnalysisConfig,
): ReExportAnalysis => {
  const file = sourceFile.fileName
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

  for (const statement of sourceFile.statements) {
    if (isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined) continue
      const named = statement.exportClause !== undefined && isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.length
        : 0
      count += Math.max(1, named)
      continue
    }

    if (isExportAssignment(statement)) {
      count += 1
      continue
    }

    if (isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue
      count += Math.max(1, statement.declarationList.declarations.length)
      continue
    }

    if (
      isFunctionDeclaration(statement) ||
      isClassDeclaration(statement) ||
      isInterfaceDeclaration(statement) ||
      isTypeAliasDeclaration(statement) ||
      isEnumDeclaration(statement) ||
      isModuleDeclaration(statement)
    ) {
      if (hasExportModifier(statement)) count += 1
    }
  }

  return count
}
