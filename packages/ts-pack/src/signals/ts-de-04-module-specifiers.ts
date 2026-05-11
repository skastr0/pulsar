import { Node, SyntaxKind, type SourceFile } from "ts-morph"
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
  const importDeclarations = sourceFile.getImportDeclarations()
  const exportDeclarations = sourceFile.getExportDeclarations()
  let identifierUsage: ReadonlyMap<string, "type-only" | "value"> | undefined
  const getIdentifierUsage = (): ReadonlyMap<string, "type-only" | "value"> => {
    identifierUsage ??= localIdentifierUsageByName(
      sourceFile,
      valueImportBindingNames(importDeclarations),
    )
    return identifierUsage
  }

  for (const declaration of [...importDeclarations, ...exportDeclarations]) {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
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
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const firstArg = call.getArguments()[0]
      if (!Node.isStringLiteral(firstArg)) continue
      if (isExternalLoaderCall(requireLikeNames, call.getExpression().getText())) {
        const specifier = firstArg.getLiteralText()
        mergeModuleSpecifierUsage(specifiers, {
          specifier,
          typeOnly: false,
          dynamic: call.getExpression().getText() === "import",
        })
      }
    }
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
  /\b(?:require|createRequire)\b|import\s*\(/.test(sourceFile.getFullText())

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

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName()
    const initializer = declaration.getInitializer()
    if (!Node.isCallExpression(initializer)) continue
    const callee = initializer.getExpression().getText()
    if (callee === "createRequire" || callee.endsWith(".createRequire")) {
      names.add(name)
    }
  }

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
