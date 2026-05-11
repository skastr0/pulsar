import {
  Node,
  type ClassDeclaration,
  type FunctionDeclaration,
  type SourceFile,
  type Statement,
  type VariableStatement,
} from "ts-morph"
import { createModuleResolver, type ModuleResolver } from "../graph/module-graph.js"
import { hasDefaultModifier, hasExportModifier } from "./shared-ts-morph-modifiers.js"

export interface FileSurface {
  readonly total: number
  readonly weightedTotal: number
  readonly byKind: Readonly<Record<string, number>>
  readonly sourceFileCount: number
  readonly topSources: ReadonlyArray<{ readonly file: string; readonly count: number }>
}

interface PublicExportSurfaces {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly totalPublicExports: number
  readonly largestSurface:
    | { readonly file: string; readonly total: number }
    | undefined
}

export const collectPublicExportSurfaces = (
  publicSourceFiles: ReadonlyArray<SourceFile>,
  allSourceFiles: ReadonlyArray<SourceFile>,
): PublicExportSurfaces => {
  const sourceFileByPath = new Map(
    allSourceFiles.map((sourceFile) => [sourceFile.getFilePath(), sourceFile] as const),
  )
  const resolver = createModuleResolver(allSourceFiles, [])
  const exportIndex = new ExportSurfaceIndex(sourceFileByPath, resolver)

  const byFile = new Map<string, FileSurface>()
  let totalPublicExports = 0
  let largest: { file: string; total: number } | undefined

  for (const sf of publicSourceFiles) {
    const surface = countExports(sf, exportIndex)
    byFile.set(sf.getFilePath(), surface)
    totalPublicExports += surface.total
    if (largest === undefined || surface.total > largest.total) {
      largest = { file: sf.getFilePath(), total: surface.total }
    }
  }

  return {
    byFile,
    totalPublicExports,
    largestSurface: largest,
  }
}

type ExportSymbolInfo = {
  readonly publicName: string
  readonly kind: string
  readonly sourceFile: string
}

class ExportSurfaceIndex {
  private readonly cache = new Map<string, ReadonlyMap<string, ExportSymbolInfo>>()

  constructor(
    private readonly sourceFileByPath: ReadonlyMap<string, SourceFile>,
    private readonly resolver: ModuleResolver,
  ) {}

  exportsFor(sourceFile: SourceFile): ReadonlyMap<string, ExportSymbolInfo> {
    const path = sourceFile.getFilePath()
    const cached = this.cache.get(path)
    if (cached !== undefined) return cached

    const pending = new Map<string, ExportSymbolInfo>()
    this.cache.set(path, pending)
    this.collectInto(sourceFile, pending)
    return pending
  }

  private collectInto(sourceFile: SourceFile, exports: Map<string, ExportSymbolInfo>): void {
    const sourcePath = sourceFile.getFilePath()
    const importedSymbols = this.importedSymbolsFor(sourceFile)

    for (const statement of sourceFile.getStatements()) {
      if (this.collectDeclarationExport(statement, sourcePath, exports)) continue

      if (Node.isExportDeclaration(statement)) {
        this.collectExportDeclaration(statement, sourceFile, exports, importedSymbols)
        continue
      }
    }
  }

  private collectDeclarationExport(
    statement: Statement,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): boolean {
    if (Node.isFunctionDeclaration(statement)) {
      this.collectNamedOrDefaultExport(statement, "function", sourcePath, exports)
      return true
    }
    if (Node.isClassDeclaration(statement)) {
      this.collectNamedOrDefaultExport(statement, "class", sourcePath, exports)
      return true
    }
    if (Node.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "interface", sourcePath, exports)
      return true
    }
    if (Node.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "type", sourcePath, exports)
      return true
    }
    if (Node.isEnumDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "enum", sourcePath, exports)
      return true
    }
    if (Node.isModuleDeclaration(statement) && hasExportModifier(statement)) {
      this.collectNamedExport(statement.getName(), "namespace", sourcePath, exports)
      return true
    }
    if (Node.isVariableStatement(statement) && hasExportModifier(statement)) {
      this.collectVariableExports(statement, sourcePath, exports)
      return true
    }
    if (Node.isExportAssignment(statement)) {
      this.collectExportAssignment(statement, sourcePath, exports)
      return true
    }
    return false
  }

  private collectNamedOrDefaultExport(
    statement: FunctionDeclaration | ClassDeclaration,
    kind: string,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    if (hasDefaultModifier(statement)) {
      exports.set("default", { publicName: "default", kind: "default", sourceFile: sourcePath })
      return
    }
    if (!hasExportModifier(statement)) return
    this.collectNamedExport(statement.getName(), kind, sourcePath, exports)
  }

  private collectNamedExport(
    name: string | undefined,
    kind: string,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    if (name !== undefined) {
      exports.set(name, { publicName: name, kind, sourceFile: sourcePath })
    }
  }

  private collectVariableExports(
    statement: VariableStatement,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    const kind = declarationKind(statement)
    for (const declaration of statement.getDeclarations()) {
      const name = declaration.getName()
      exports.set(name, { publicName: name, kind, sourceFile: sourcePath })
    }
  }

  private collectExportAssignment(
    statement: import("ts-morph").ExportAssignment,
    sourcePath: string,
    exports: Map<string, ExportSymbolInfo>,
  ): void {
    const kind = statement.isExportEquals() ? "export-equals" : "default"
    const publicName = statement.isExportEquals() ? "export=" : "default"
    exports.set(publicName, { publicName, kind, sourceFile: sourcePath })
  }

  private collectExportDeclaration(
    declaration: import("ts-morph").ExportDeclaration,
    sourceFile: SourceFile,
    exports: Map<string, ExportSymbolInfo>,
    importedSymbols: ReadonlyMap<string, ExportSymbolInfo>,
  ): void {
    const sourcePath = sourceFile.getFilePath()
    const targetPath = this.resolver.resolve(sourcePath, declaration)
    const targetFile = targetPath === undefined ? undefined : this.sourceFileByPath.get(targetPath)
    const targetExports = targetFile === undefined ? new Map<string, ExportSymbolInfo>() : this.exportsFor(targetFile)
    const namedExports = declaration.getNamedExports()
    const namespaceExport = declaration.getNamespaceExport()

    if (namespaceExport !== undefined) {
      const publicName = namespaceExport.getName()
      exports.set(publicName, {
        publicName,
        kind: "namespace",
        sourceFile: targetPath ?? sourcePath,
      })
      return
    }

    if (namedExports.length > 0) {
      for (const specifier of namedExports) {
        const exportedName = specifier.getAliasNode()?.getText() ?? specifier.getName()
        const importedName = specifier.getName()
        if (targetFile === undefined) {
          const imported = importedSymbols.get(importedName)
          exports.set(exportedName, {
            publicName: exportedName,
            kind: declaration.isTypeOnly() ? "type" : (imported?.kind ?? "re-export"),
            sourceFile: imported?.sourceFile ?? sourcePath,
          })
          continue
        }
        const target = targetExports.get(importedName)
        exports.set(exportedName, {
          publicName: exportedName,
          kind: target?.kind ?? "re-export",
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }
      return
    }

    if (targetFile !== undefined) {
      for (const [name, target] of targetExports) {
        if (name === "default") continue
        exports.set(name, target)
      }
    }
  }

  private importedSymbolsFor(sourceFile: SourceFile): ReadonlyMap<string, ExportSymbolInfo> {
    const sourcePath = sourceFile.getFilePath()
    const imported = new Map<string, ExportSymbolInfo>()

    for (const declaration of sourceFile.getImportDeclarations()) {
      const targetPath = this.resolver.resolve(sourcePath, declaration)
      const targetFile = targetPath === undefined ? undefined : this.sourceFileByPath.get(targetPath)
      const targetExports = targetFile === undefined ? new Map<string, ExportSymbolInfo>() : this.exportsFor(targetFile)
      const declarationTypeOnly = declaration.isTypeOnly() || declaration.getImportClause()?.isTypeOnly() === true

      const defaultImport = declaration.getDefaultImport()
      if (defaultImport !== undefined) {
        const target = targetExports.get("default")
        imported.set(defaultImport.getText(), {
          publicName: defaultImport.getText(),
          kind: declarationTypeOnly ? "type" : (target?.kind ?? "default"),
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }

      const namespaceImport = declaration.getNamespaceImport()
      if (namespaceImport !== undefined) {
        imported.set(namespaceImport.getText(), {
          publicName: namespaceImport.getText(),
          kind: declarationTypeOnly ? "type" : "namespace",
          sourceFile: targetPath ?? sourcePath,
        })
      }

      for (const specifier of declaration.getNamedImports()) {
        const publicName = specifier.getAliasNode()?.getText() ?? specifier.getName()
        const importedName = specifier.getName()
        const target = targetExports.get(importedName)
        const typeOnly = declarationTypeOnly || specifier.isTypeOnly()
        imported.set(publicName, {
          publicName,
          kind: typeOnly ? "type" : (target?.kind ?? "re-export"),
          sourceFile: target?.sourceFile ?? targetPath ?? sourcePath,
        })
      }
    }

    return imported
  }
}

const countExports = (sf: SourceFile, exportIndex: ExportSurfaceIndex): FileSurface => {
  const byKind: Record<string, number> = {}
  const sourceCounts = new Map<string, number>()
  const bump = (kind: string): void => {
    byKind[kind] = (byKind[kind] ?? 0) + 1
  }

  for (const symbol of exportIndex.exportsFor(sf).values()) {
    bump(symbol.kind)
    if (symbol.sourceFile === sf.getFilePath()) continue
    sourceCounts.set(symbol.sourceFile, (sourceCounts.get(symbol.sourceFile) ?? 0) + 1)
  }

  const total = Object.values(byKind).reduce((acc, n) => acc + n, 0)
  const weightedTotal = Object.entries(byKind).reduce(
    (acc, [kind, count]) => acc + exportKindWeight(kind) * count,
    0,
  )
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([file, count]) => ({ file, count }))

  return {
    total,
    weightedTotal,
    byKind,
    sourceFileCount: sourceCounts.size,
    topSources,
  }
}

export const exportKindWeight = (kind: string): number =>
  kind === "type" || kind === "interface" ? 0.25 : 1

const declarationKind = (statement: VariableStatement): string => {
  const kind = statement.getDeclarationKind()
  if (kind === "let") return "let"
  if (kind === "var") return "var"
  return "const"
}
