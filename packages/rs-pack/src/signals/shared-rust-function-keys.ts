import type { RustProject } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"

export interface RustFunctionKeyInput {
  readonly file: string
  readonly modulePath: string
  readonly name: string
  readonly line: number
}

export const collectActiveRustFunctionKeys = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> => {
  const keys = new Set<string>()
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      keys.add(rustFunctionKey({
        file,
        modulePath,
        name,
        line: node.startPosition.row + 1,
      }))
    })
  }
  return keys
}

export const rustFunctionKey = (fn: RustFunctionKeyInput): string =>
  `${fn.file}:${fn.line}:${fn.modulePath}::${fn.name}`
