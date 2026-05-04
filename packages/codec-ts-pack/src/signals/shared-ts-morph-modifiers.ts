import { type Node, SyntaxKind } from "ts-morph"

type ModifierLike = {
  readonly getKind: () => SyntaxKind
}

export const hasExportModifier = (node: Node): boolean =>
  hasModifier(node, SyntaxKind.ExportKeyword)

export const hasDefaultModifier = (node: Node): boolean =>
  hasModifier(node, SyntaxKind.DefaultKeyword)

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  (node as { getModifiers?: () => ReadonlyArray<ModifierLike> })
    .getModifiers?.()
    .some((modifier) => modifier.getKind() === kind) ?? false
