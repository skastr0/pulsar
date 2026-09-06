import type { Node, Project } from "./tsgo-api.js"

export const typeTexts = async (
  project: Project,
  nodes: ReadonlyArray<Node>,
): Promise<ReadonlyArray<string>> => {
  if (nodes.length === 0) return []
  const types = await project.checker.getTypeAtLocation(nodes)
  return Promise.all(
    types.map((type, index) => project.checker.typeToString(type, nodes[index])),
  )
}

export const declarationsAt = async (
  project: Project,
  nodes: ReadonlyArray<Node>,
): Promise<ReadonlyArray<ReadonlyArray<Node>>> => {
  if (nodes.length === 0) return []
  const symbols = await project.checker.getSymbolAtLocation(nodes)
  return Promise.all(
    symbols.map(async (symbol) => {
      if (symbol === undefined) return []
      const resolved = await Promise.all(symbol.declarations.map((handle) => handle.resolve(project)))
      return resolved.filter((node): node is Node => node !== undefined)
    }),
  )
}
