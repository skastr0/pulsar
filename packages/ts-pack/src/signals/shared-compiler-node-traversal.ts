import { ts } from "ts-morph"

export const forEachCompilerNode = (root: ts.Node, visit: (node: ts.Node) => void): void => {
  const walk = (node: ts.Node): void => {
    visit(node)
    ts.forEachChild(node, walk)
  }
  walk(root)
}
