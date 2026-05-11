import { readFile } from "node:fs/promises"
import {
  Language,
  Node,
  Parser,
  type Point,
  type Tree,
} from "web-tree-sitter"
import treeSitterWasmPath from "web-tree-sitter/tree-sitter.wasm" with { type: "file" }
import treeSitterRustWasmPath from "tree-sitter-rust/tree-sitter-rust.wasm" with { type: "file" }

/**
 * The file name stays `syn-walker` from the original ticket sketch, but the
 * implementation deliberately uses tree-sitter Rust. That's the smallest
 * reversible AST choice that keeps TypeScript-side parsing toolchain-free.
 */

export class RustSyntaxParserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RustSyntaxParserError"
  }
}

export type RustPoint = Point
export type RustSyntaxNode = Node
export type RustSyntaxTree = Tree

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

const loadRustLanguage = async (): Promise<Language> => {
  if (rustLanguagePromise === undefined) {
    rustLanguagePromise = (async () => {
      await Parser.init({
        locateFile: (scriptName: string) => {
          if (scriptName === "tree-sitter.wasm") {
            return treeSitterWasmPath
          }
          return scriptName
        },
      })
      return Language.load(treeSitterRustWasmPath)
    })()
  }

  return rustLanguagePromise
}
