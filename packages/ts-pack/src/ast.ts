import {
  SyntaxKind,
  type FunctionDeclaration,
  type MethodDeclaration,
  type ModifierLike,
  type Node,
  type SourceFile,
} from "./tsgo-api.js"

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export const walkDescendants = (root: Node, visit: (node: Node) => void | "skip"): void => {
  const walk = (node: Node): void => {
    const decision = visit(node)
    if (decision === "skip") return
    node.forEachChild(walk)
  }
  root.forEachChild(walk)
}

export const ancestors = (node: Node): ReadonlyArray<Node> => {
  const result: Array<Node> = []
  let current: Node | undefined = node.parent
  while (current !== undefined && current !== node) {
    result.push(current)
    if (current.kind === SyntaxKind.SourceFile) break
    current = current.parent
  }
  return result
}

export function firstAncestor<T extends Node>(
  node: Node,
  predicate: (candidate: Node) => candidate is T,
): T | undefined
export function firstAncestor(
  node: Node,
  predicate: (candidate: Node) => boolean,
): Node | undefined
export function firstAncestor(
  node: Node,
  predicate: (candidate: Node) => boolean,
): Node | undefined {
  return ancestors(node).find(predicate)
}

export const textOf = (node: Node, sourceFile?: SourceFile): string =>
  node.getText(sourceFile ?? node.getSourceFile())

export const locationOf = (node: Node, filePath: string): SourceLocation => {
  const sourceFile = node.getSourceFile()
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { file: filePath, line: line + 1, column: character + 1 }
}

export const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  ((node as { readonly modifiers?: ReadonlyArray<ModifierLike> }).modifiers ?? []).some(
    (modifier) => modifier.kind === kind,
  )

export const hasExportModifier = (node: Node): boolean =>
  hasModifier(node, SyntaxKind.ExportKeyword)

export const hasDefaultModifier = (node: Node): boolean =>
  hasModifier(node, SyntaxKind.DefaultKeyword)

export const functionNameOf = (
  node: FunctionDeclaration | MethodDeclaration,
): string => {
  const name = node.name
  if (name === undefined) return "<anonymous>"
  return textOf(name)
}

export const collectLeadingComments = (sourceFile: SourceFile, node: Node): ReadonlyArray<string> => {
  const comments: Array<string> = []
  forEachLeadingComment(sourceFile.text, node.getFullStart(), (text) => {
    comments.push(text)
  })
  return comments
}

const forEachLeadingComment = (
  text: string,
  pos: number,
  visit: (comment: string) => void,
): void => {
  let index = pos
  while (index > 0 && /[\s]/.test(text[index - 1] ?? "")) index -= 1
  const regionStart = Math.max(0, text.lastIndexOf("\n", index - 1) + 1)
  const region = text.slice(regionStart, pos)
  const matches = region.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)
  if (matches === null) return
  for (const match of matches) visit(match)
}
