export const stronglyConnectedComponents = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): Array<Array<string>> => {
  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const sccs: Array<Array<string>> = []

  const strongConnect = (root: string): void => {
    type Frame = { node: string; iter: Iterator<string> }
    const callStack: Array<Frame> = []

    const enter = (node: string): void => {
      indices.set(node, index)
      lowlinks.set(node, index)
      index += 1
      stack.push(node)
      onStack.add(node)
      const neighbors = graph.get(node)
      callStack.push({
        node,
        iter: (neighbors ?? new Set<string>()).values(),
      })
    }

    enter(root)

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!
      const next = frame.iter.next()
      if (next.done === true) {
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          const scc: Array<string> = []
          while (true) {
            const w = stack.pop()!
            onStack.delete(w)
            scc.push(w)
            if (w === frame.node) break
          }
          sccs.push(scc)
        }
        callStack.pop()
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!
          const parentLow = lowlinks.get(parent.node) ?? 0
          const childLow = lowlinks.get(frame.node) ?? 0
          if (childLow < parentLow) {
            lowlinks.set(parent.node, childLow)
          }
        }
        continue
      }
      const neighbor = next.value
      if (!indices.has(neighbor)) {
        enter(neighbor)
      } else if (onStack.has(neighbor)) {
        const neighborIndex = indices.get(neighbor) ?? 0
        const currentLow = lowlinks.get(frame.node) ?? 0
        if (neighborIndex < currentLow) {
          lowlinks.set(frame.node, neighborIndex)
        }
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return sccs
}
