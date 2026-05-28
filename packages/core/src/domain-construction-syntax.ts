import {
  maskAmbientBlocks,
  maskCommentsAndStrings,
  matchingBraceIndex,
  topLevelClassMemberText,
} from "./domain-construction-mask.js"

export interface DeclarationShape {
  readonly exportedDeclarationDetected: boolean
  readonly publicConstructorDetected: boolean
  readonly privateConstructorDetected: boolean
}

export const emptyDeclarationShape = (): DeclarationShape => ({
  exportedDeclarationDetected: false,
  publicConstructorDetected: false,
  privateConstructorDetected: false,
})

export type EvidenceSymbolMode = "runtime-value" | "exported-value"

export const analyzeDomainConstructDeclaration = (
  declarationContent: string | undefined,
  symbol: string,
): DeclarationShape => {
  if (declarationContent === undefined) return emptyDeclarationShape()
  return analyzeDeclarationShape(analyzeSourceSyntax(declarationContent), symbol)
}

const analyzeDeclarationShape = (
  syntax: SourceSyntax,
  symbol: string,
): DeclarationShape => {
  const exportedDeclarationDetected = hasExportedDeclaration(syntax, symbol)
  const classShape = exportedClassShape(syntax, symbol)
  const topLevelClassBody = classShape === undefined
    ? undefined
    : topLevelClassMemberText(classShape.body)
  const privateConstructorDetected =
    topLevelClassBody !== undefined &&
    /\b(?:private|protected)\s+constructor\s*\(/u.test(topLevelClassBody)
  return {
    exportedDeclarationDetected,
    publicConstructorDetected:
      classShape !== undefined && !classShape.isAbstract && !privateConstructorDetected,
    privateConstructorDetected,
  }
}

export interface SourceSyntax {
  readonly code: string
}

export const analyzeSourceSyntax = (content: string): SourceSyntax => ({
  code: maskAmbientBlocks(maskCommentsAndStrings(content)),
})

const hasExportedDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?(?:class|interface|type)\\s+${escaped}\\b`,
    "u",
  ).test(syntax.code)
}

export const matchesEvidenceSymbol = (
  syntax: SourceSyntax,
  symbol: string,
  mode: EvidenceSymbolMode,
): boolean =>
  mode === "exported-value"
    ? hasExportedValueDeclaration(syntax, symbol)
    : hasRuntimeValueDeclaration(syntax, symbol)

const hasRuntimeValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  const pattern = new RegExp(
    runtimeValueDeclarationPattern(escaped, "(?:export\\s+(?:default\\s+)?)?"),
    "gu",
  )
  for (const match of syntax.code.matchAll(pattern)) {
    if (!hasAmbientDeclarePrefix(syntax.code, match.index ?? 0)) return true
  }
  return false
}

const hasExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean =>
  hasDirectExportedValueDeclaration(syntax, symbol) ||
  hasNamedExportedValueDeclaration(syntax, symbol)

const hasDirectExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(
    runtimeValueDeclarationPattern(escaped, "export\\s+(?:default\\s+)?"),
    "u",
  ).test(syntax.code)
}

const runtimeValueDeclarationPattern = (
  escapedSymbol: string,
  exportPrefixPattern: string,
): string =>
  [
    `\\b(?!declare\\s)${exportPrefixPattern}(?!declare\\s)(?:`,
    `(?:const|let|var|class|enum)\\s+${escapedSymbol}\\b`,
    "|",
    `(?:async\\s+)?function\\s*\\*?\\s+${escapedSymbol}\\b`,
    ")",
  ].join("")

const hasAmbientDeclarePrefix = (content: string, matchIndex: number): boolean =>
  /\bdeclare$/u.test(content.slice(0, matchIndex).trimEnd())

const hasNamedExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const exportListPattern = /\bexport\s*\{([^}]*)\}/gu
  for (const match of syntax.code.matchAll(exportListPattern)) {
    const members = (match[1] ?? "").split(",")
    for (const member of members) {
      const parsed = parseExportMember(member)
      if (parsed === undefined) continue
      if (parsed.exported !== symbol && parsed.local !== symbol) continue
      if (hasRuntimeValueDeclaration(syntax, parsed.local)) return true
    }
  }
  return hasDefaultExportedLocalValue(syntax, symbol)
}

const parseExportMember = (
  member: string,
): { readonly local: string; readonly exported: string } | undefined => {
  const normalized = member.trim()
  if (/^type\s+/u.test(normalized)) return undefined
  const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(normalized)
  if (aliased !== null) return { local: aliased[1]!, exported: aliased[2]! }
  const direct = /^([A-Za-z_$][\w$]*)$/u.exec(normalized)
  if (direct !== null) return { local: direct[1]!, exported: direct[1]! }
  return undefined
}

const hasDefaultExportedLocalValue = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(`\\bexport\\s+default\\s+${escaped}\\b`, "u").test(syntax.code) &&
    hasRuntimeValueDeclaration(syntax, symbol)
}

interface ExportedClassShape {
  readonly body: string
  readonly isAbstract: boolean
}

const exportedClassShape = (
  syntax: SourceSyntax,
  symbol: string,
): ExportedClassShape | undefined => {
  const escaped = escapeRegExp(symbol)
  const pattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(abstract\\s+)?class\\s+${escaped}\\b`,
    "u",
  )
  const match = pattern.exec(syntax.code)
  if (match === null) return undefined
  const openBrace = findClassBodyOpenBrace(syntax.code, match.index + match[0].length)
  if (openBrace === undefined) return undefined
  const closeBrace = matchingBraceIndex(syntax.code, openBrace)
  const body = closeBrace === undefined
    ? syntax.code.slice(openBrace + 1)
    : syntax.code.slice(openBrace + 1, closeBrace)
  return { body, isAbstract: match[1] !== undefined }
}

const findClassBodyOpenBrace = (
  content: string,
  start: number,
): number | undefined => {
  let angleDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    if (char === "<") {
      angleDepth += 1
      continue
    }
    if (char === ">" && angleDepth > 0) {
      angleDepth -= 1
      continue
    }
    if (angleDepth === 0) {
      if (char === "(") {
        parenDepth += 1
        continue
      }
      if (char === ")" && parenDepth > 0) {
        parenDepth -= 1
        continue
      }
      if (char === "[") {
        bracketDepth += 1
        continue
      }
      if (char === "]" && bracketDepth > 0) {
        bracketDepth -= 1
        continue
      }
      if (char === "{" && parenDepth === 0 && bracketDepth === 0) return index
    }
    if (char === ";" && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      return undefined
    }
  }
  return undefined
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
