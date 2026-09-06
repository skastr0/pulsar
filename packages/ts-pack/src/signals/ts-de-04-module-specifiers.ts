import { textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isVariableDeclaration,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "../tsgo-api.js"
import {
  isTypeOnlyModuleDeclaration,
  localIdentifierUsageByName,
  valueImportBindingNames,
} from "./shared-module-usage.js"
import { isBuiltinModuleName, normalizePackageSpecifier } from "./shared-workspace.js"
import { isDocusaurusApp, isSvelteKitApp } from "./ts-de-04-package-classification.js"
import type { ManifestPackageInfo, ModuleSpecifierUsage } from "./ts-de-04-model.js"

export const externalModuleSpecifiers = (
  sourceFile: SourceFile,
): ReadonlyArray<ModuleSpecifierUsage> => {
  const specifiers = new Map<string, ModuleSpecifierUsage>()
  const importDeclarations = declarationsOf(sourceFile, isImportDeclaration)
  const exportDeclarations = declarationsOf(sourceFile, isExportDeclaration)
  let identifierUsage: ReadonlyMap<string, "type-only" | "value"> | undefined
  const getIdentifierUsage = (): ReadonlyMap<string, "type-only" | "value"> => {
    identifierUsage ??= localIdentifierUsageByName(
      sourceFile,
      valueImportBindingNames(importDeclarations),
    )
    return identifierUsage
  }

  for (const declaration of [...importDeclarations, ...exportDeclarations]) {
    const moduleSpecifier = moduleSpecifierOf(declaration)
    if (moduleSpecifier !== undefined) {
      mergeModuleSpecifierUsage(specifiers, {
        specifier: moduleSpecifier,
        typeOnly: isTypeOnlyModuleDeclaration(declaration, getIdentifierUsage),
        dynamic: false,
      })
    }
  }

  if (hasRuntimeLoaderSyntax(sourceFile)) {
    const requireLikeNames = requireLikeIdentifiers(sourceFile)
    walkDescendants(sourceFile, (node) => {
      if (!isCallExpression(node)) return
      const firstArg = node.arguments[0]
      if (firstArg === undefined || !(isStringLiteral(firstArg) || isNoSubstitutionTemplateLiteral(firstArg))) return
      const expressionText = textOf(node.expression)
      if (isExternalLoaderCall(requireLikeNames, expressionText) || node.expression.kind === SyntaxKind.ImportKeyword) {
        mergeModuleSpecifierUsage(specifiers, {
          specifier: firstArg.text,
          typeOnly: false,
          dynamic: expressionText === "import" || node.expression.kind === SyntaxKind.ImportKeyword,
        })
      }
    })
  }

  return [...specifiers.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier),
  )
}

export const recordedDependencyNameForModuleUsage = (
  moduleUsage: ModuleSpecifierUsage,
  owningPackage: ManifestPackageInfo,
  workspaceNames: ReadonlySet<string>,
): string | undefined => {
  const moduleSpecifier = moduleUsage.specifier
  const packageName = normalizePackageSpecifier(moduleSpecifier)
  if (packageName === undefined || isBuiltinModuleName(packageName)) return undefined
  if (isGeneratedVirtualModuleSpecifier(moduleSpecifier)) return undefined
  if (isFrameworkVirtualModuleSpecifier(moduleSpecifier, owningPackage)) return undefined
  return isWorkspaceSelfOrFacadeImport(packageName, owningPackage.manifest.name, workspaceNames)
    ? undefined
    : packageName
}

const declarationsOf = <T extends ImportDeclaration | ExportDeclaration>(
  sourceFile: SourceFile,
  predicate: (node: ImportDeclaration | ExportDeclaration) => node is T,
): ReadonlyArray<T> => {
  const declarations: Array<T> = []
  walkDescendants(sourceFile, (node) => {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      if (predicate(node as ImportDeclaration | ExportDeclaration)) {
        declarations.push(node as T)
      }
    }
  })
  return declarations
}

const moduleSpecifierOf = (declaration: ImportDeclaration | ExportDeclaration): string | undefined => {
  const specifier = declaration.moduleSpecifier
  if (specifier === undefined) return undefined
  if (isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier)) return specifier.text
  return undefined
}

const mergeModuleSpecifierUsage = (
  specifiers: Map<string, ModuleSpecifierUsage>,
  usage: ModuleSpecifierUsage,
): void => {
  const existing = specifiers.get(usage.specifier)
  specifiers.set(usage.specifier, {
    specifier: usage.specifier,
    typeOnly: existing === undefined ? usage.typeOnly : existing.typeOnly && usage.typeOnly,
    dynamic: existing === undefined ? usage.dynamic : existing.dynamic && usage.dynamic,
  })
}

const hasRuntimeLoaderSyntax = (sourceFile: SourceFile): boolean =>
  /\b(?:require|createRequire)\b|import\s*\(/.test(sourceFile.text)

const isExternalLoaderCall = (
  requireLikeNames: ReadonlySet<string>,
  expressionText: string,
): boolean => {
  if (expressionText === "import") return true
  if (requireLikeNames.has(expressionText)) return true

  const [receiver, property] = splitPropertyAccess(expressionText)
  return property === "resolve" && requireLikeNames.has(receiver)
}

const requireLikeIdentifiers = (sourceFile: SourceFile): ReadonlySet<string> => {
  const names = new Set<string>(["require"])

  walkDescendants(sourceFile, (node) => {
    if (!isVariableDeclaration(node) || !isIdentifier(node.name) || node.initializer === undefined) return
    if (!isCallExpression(node.initializer)) return
    const callee = textOf(node.initializer.expression)
    if (callee === "createRequire" || callee.endsWith(".createRequire")) {
      names.add(node.name.text)
    }
  })

  return names
}

const splitPropertyAccess = (expressionText: string): readonly [string, string] => {
  const lastDot = expressionText.lastIndexOf(".")
  if (lastDot === -1) return [expressionText, ""]
  return [expressionText.slice(0, lastDot), expressionText.slice(lastDot + 1)]
}

const isGeneratedVirtualModuleSpecifier = (specifier: string): boolean =>
  /^[^./#][^:]*\.(?:gen|generated)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(specifier)

const isFrameworkVirtualModuleSpecifier = (
  specifier: string,
  owningPackage: ManifestPackageInfo,
): boolean => {
  if (isDocusaurusApp(owningPackage.manifest)) {
    return (
      specifier.startsWith("@theme/") ||
      specifier.startsWith("@site/") ||
      specifier.startsWith("@generated/") ||
      specifier === "@docusaurus/Link" ||
      specifier === "@docusaurus/useDocusaurusContext" ||
      specifier === "@docusaurus/theme-common" ||
      specifier.startsWith("@docusaurus/theme-common/")
    )
  }
  if (isSvelteKitApp(owningPackage.manifest)) {
    return (
      specifier.startsWith("$app/") ||
      specifier.startsWith("$env/") ||
      specifier === "$lib" ||
      specifier.startsWith("$lib/") ||
      specifier === "$service-worker"
    )
  }

  return false
}

const isWorkspaceSelfOrFacadeImport = (
  dependencyName: string,
  packageName: string | undefined,
  workspaceNames: ReadonlySet<string>,
): boolean => {
  if (packageName === undefined) return false
  if (dependencyName === packageName) return true
  return workspaceNames.has(dependencyName) && packageName.startsWith(`${dependencyName}/`)
}
