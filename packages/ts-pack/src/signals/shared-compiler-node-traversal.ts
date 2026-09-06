import type { Node } from "../tsgo-api.js"

export const forEachCompilerNode = (root: Node, visit: (node: Node) => void): void => {
  const walk = (node: Node): void => {
    visit(node)
    node.forEachChild(walk)
  }
  walk(root)
}
