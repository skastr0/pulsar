interface CondensedGraph {
  readonly components: ReadonlyArray<ReadonlyArray<string>>
  readonly nodeToComponent: ReadonlyMap<string, number>
  readonly dag: ReadonlyMap<number, ReadonlySet<number>>
  readonly reverseDag: ReadonlyMap<number, ReadonlySet<number>>
}

export const tarjanSccs = (
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyArray<ReadonlyArray<string>> => {
  type Frame = { node: string; iter: Iterator<string> }

  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const sccs: Array<Array<string>> = []

  const enter = (callStack: Array<Frame>, node: string): void => {
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

  const updateLowlink = (node: string, candidate: number): void => {
    const current = lowlinks.get(node) ?? 0
    if (candidate < current) {
      lowlinks.set(node, candidate)
    }
  }

  const popComponent = (root: string): Array<string> => {
    const component: Array<string> = []
    while (true) {
      const popped = stack.pop()!
      onStack.delete(popped)
      component.push(popped)
      if (popped === root) break
    }
    return component.sort((left, right) => left.localeCompare(right))
  }

  const finishFrame = (callStack: Array<Frame>, frame: Frame): void => {
    if (lowlinks.get(frame.node) === indices.get(frame.node)) {
      sccs.push(popComponent(frame.node))
    }
    callStack.pop()
    const parent = callStack[callStack.length - 1]
    if (parent === undefined) return
    updateLowlink(parent.node, lowlinks.get(frame.node) ?? 0)
  }

  const visitNeighbor = (
    callStack: Array<Frame>,
    node: string,
    neighbor: string,
  ): void => {
    if (!indices.has(neighbor)) {
      enter(callStack, neighbor)
      return
    }
    if (!onStack.has(neighbor)) return
    updateLowlink(node, indices.get(neighbor) ?? 0)
  }

  const strongConnect = (root: string): void => {
    const callStack: Array<Frame> = []
    enter(callStack, root)

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!
      const next = frame.iter.next()
      if (next.done === true) {
        finishFrame(callStack, frame)
        continue
      }
      visitNeighbor(callStack, frame.node, next.value)
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
