export interface CondensedGraph {
  readonly components: ReadonlyArray<ReadonlyArray<string>>
  readonly nodeToComponent: ReadonlyMap<string, number>
  readonly dag: ReadonlyMap<number, ReadonlySet<number>>
  readonly reverseDag: ReadonlyMap<number, ReadonlySet<number>>
}

export const tarjanSccs = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyArray<ReadonlyArray<string>> => {
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
      callStack.push({
        node,
        iter: (graph.get(node) ?? new Set<string>()).values(),
      })
    }

    enter(root)

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!
      const next = frame.iter.next()
      if (next.done === true) {
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          const component: Array<string> = []
          while (true) {
            const popped = stack.pop()!
            onStack.delete(popped)
            component.push(popped)
            if (popped === frame.node) break
          }
          component.sort((left, right) => left.localeCompare(right))
          sccs.push(component)
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

  return sccs.sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length
    }
    return (left[0] ?? "").localeCompare(right[0] ?? "")
  })
}

export const condenseGraph = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  components: ReadonlyArray<ReadonlyArray<string>>,
): CondensedGraph => {
  const nodeToComponent = new Map<string, number>()
  components.forEach((component, index) => {
    component.forEach((node) => nodeToComponent.set(node, index))
  })

  const dag = new Map<number, Set<number>>()
  const reverseDag = new Map<number, Set<number>>()
  components.forEach((_, index) => {
    dag.set(index, new Set())
    reverseDag.set(index, new Set())
  })

  for (const [from, targets] of graph) {
    const fromComponent = nodeToComponent.get(from)
    if (fromComponent === undefined) continue
    for (const to of targets) {
      const toComponent = nodeToComponent.get(to)
      if (toComponent === undefined || toComponent === fromComponent) continue
      dag.get(fromComponent)?.add(toComponent)
      reverseDag.get(toComponent)?.add(fromComponent)
    }
  }

  return {
    components,
    nodeToComponent,
    dag,
    reverseDag,
  }
}
