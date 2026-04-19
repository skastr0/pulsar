import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import {
  Language,
  Node,
  Parser,
  type Point,
  type Tree,
} from "web-tree-sitter"

/**
 * The file name stays `syn-walker` from the original ticket sketch, but the
 * implementation deliberately uses tree-sitter Rust. That's the smallest
 * reversible AST choice that keeps TypeScript-side parsing toolchain-free.
 */

const require = createRequire(import.meta.url)
const TREE_SITTER_WASM_PATH = require.resolve("web-tree-sitter/tree-sitter.wasm")
const TREE_SITTER_RUST_WASM_PATH = require.resolve("tree-sitter-rust/tree-sitter-rust.wasm")

export class RustSyntaxParserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RustSyntaxParserError"
  }
}

export type RustPoint = Point
export type RustSyntaxNode = Node
export type RustSyntaxTree = Tree

export interface RustAstSummary {
  readonly rootType: string
  readonly nodeCounts: Readonly<Record<string, number>>
  readonly functionNames: ReadonlyArray<string>
  readonly unsafeBlockCount: number
}

let rustLanguagePromise: Promise<Language> | undefined

export const parseRustSource = async (source: string): Promise<RustSyntaxTree> => {
  const language = await loadRustLanguage()
  const parser = new Parser()
  parser.setLanguage(language)
  const tree = parser.parse(source)
  if (tree === null) {
    throw new RustSyntaxParserError("tree-sitter failed to parse the Rust source")
  }
  return tree
}

export const parseRustFile = async (filePath: string): Promise<RustSyntaxTree> => {
  const source = await readFile(filePath, "utf8")
  return parseRustSource(source)
}

export const walkRustTree = (
  tree: RustSyntaxTree,
  visit: (node: RustSyntaxNode, ancestors: ReadonlyArray<RustSyntaxNode>) => void,
): void => {
  const stack: Array<{
    readonly node: RustSyntaxNode
    readonly ancestors: ReadonlyArray<RustSyntaxNode>
  }> = [{ node: tree.rootNode, ancestors: [] }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    visit(current.node, current.ancestors)

    const nextAncestors = [...current.ancestors, current.node]
    const namedChildren = current.node.namedChildren.filter(
      (child): child is RustSyntaxNode => child !== null,
    )
    for (let index = namedChildren.length - 1; index >= 0; index -= 1) {
      stack.push({ node: namedChildren[index]!, ancestors: nextAncestors })
    }
  }
}

export const summarizeRustTree = (tree: RustSyntaxTree): RustAstSummary => {
  const nodeCounts = new Map<string, number>()
  const functionNames: Array<string> = []
  let unsafeBlockCount = 0

  walkRustTree(tree, (node) => {
    nodeCounts.set(node.type, (nodeCounts.get(node.type) ?? 0) + 1)
    if (node.type === "unsafe_block") unsafeBlockCount += 1
    if (node.type === "function_item") {
      const identifier = node.namedChildren.find(
        (child): child is RustSyntaxNode => child !== null && child.type === "identifier",
      )
      if (identifier !== undefined) {
        functionNames.push(identifier.text)
      }
    }
  })

  return {
    rootType: tree.rootNode.type,
    nodeCounts: Object.fromEntries(
      [...nodeCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    functionNames,
    unsafeBlockCount,
  }
}

export const summarizeRustSource = async (source: string): Promise<RustAstSummary> =>
  summarizeRustTree(await parseRustSource(source))

export const summarizeRustFile = async (filePath: string): Promise<RustAstSummary> =>
  summarizeRustTree(await parseRustFile(filePath))

const loadRustLanguage = async (): Promise<Language> => {
  if (rustLanguagePromise === undefined) {
    rustLanguagePromise = (async () => {
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName === "tree-sitter.wasm") {
            return TREE_SITTER_WASM_PATH
          }
          return scriptName
        },
      })
      return Language.load(TREE_SITTER_RUST_WASM_PATH)
    })()
  }

  return rustLanguagePromise
}
