import { MutableBitSet, popcount32 } from "./bitset.js"

interface ReachabilityOptions {
  readonly probabilisticThresholdNodes?: number
  readonly bloomBitCount?: number
  readonly bloomHashCount?: number
}

type ReachabilityMode = "bitset" | "bloom"

interface ReachabilityResult {
  readonly mode: ReachabilityMode
  readonly counts: ReadonlyArray<number>
}

interface ReachabilitySet {
  readonly add: (index: number) => void
  readonly merge: (other: ReachabilitySet) => void
  readonly count: () => number
}

const DEFAULT_PROBABILISTIC_THRESHOLD = 10_000
const DEFAULT_BLOOM_BITS = 8_192
const DEFAULT_BLOOM_HASHES = 3

export const computeReachabilityCounts = (
  dag: ReadonlyMap<number, ReadonlySet<number>>,
  componentModules: ReadonlyArray<ReadonlyArray<number>>,
  totalNodes: number,
  options: ReachabilityOptions = {},
): ReachabilityResult => {
  const mode: ReachabilityMode =
    totalNodes >= (options.probabilisticThresholdNodes ?? DEFAULT_PROBABILISTIC_THRESHOLD)
      ? "bloom"
      : "bitset"
  const reachability = Array.from({ length: componentModules.length }, () =>
    createReachabilitySet(mode, totalNodes, options),
  )
  const order = topologicalOrder(dag, componentModules.length)

  for (let index = order.length - 1; index >= 0; index -= 1) {
    const componentIndex = order[index]!
    const current = reachability[componentIndex]!
    for (const child of dag.get(componentIndex) ?? []) {
      for (const moduleIndex of componentModules[child] ?? []) {
        current.add(moduleIndex)
      }
      current.merge(reachability[child]!)
    }
  }

  return {
    mode,
    counts: reachability.map((set) => set.count()),
  }
}

const createReachabilitySet = (
  mode: ReachabilityMode,
  totalNodes: number,
  options: ReachabilityOptions,
): ReachabilitySet =>
  mode === "bitset"
    ? new BitSetReachability(totalNodes)
    : new BloomReachability(
        totalNodes,
        options.bloomBitCount ?? DEFAULT_BLOOM_BITS,
        options.bloomHashCount ?? DEFAULT_BLOOM_HASHES,
      )

class BitSetReachability implements ReachabilitySet {
  private readonly bitset: MutableBitSet

  constructor(totalNodes: number) {
    this.bitset = new MutableBitSet(totalNodes)
  }

  add(index: number): void {
    this.bitset.set(index)
  }

  merge(other: ReachabilitySet): void {
    if (!(other instanceof BitSetReachability)) {
      throw new Error("Cannot merge different reachability set implementations")
    }
    this.bitset.or(other.bitset)
  }

  count(): number {
    return this.bitset.count()
  }
}

class BloomReachability implements ReachabilitySet {
  private readonly words: Uint32Array
  private setBitCount = 0

  constructor(
    private readonly totalNodes: number,
    private readonly bitCount: number,
    private readonly hashCount: number,
  ) {
    this.words = new Uint32Array(Math.ceil(bitCount / 32))
  }

  add(index: number): void {
    for (let seed = 0; seed < this.hashCount; seed += 1) {
      this.setBit(hashIndex(index, seed) % this.bitCount)
    }
  }

  merge(other: ReachabilitySet): void {
    if (!(other instanceof BloomReachability)) {
      throw new Error("Cannot merge different reachability set implementations")
    }

    for (let index = 0; index < this.words.length; index += 1) {
      const before = this.words[index] ?? 0
      const next = before | (other.words[index] ?? 0)
      if (next === before) continue
      this.words[index] = next
      this.setBitCount += popcount32(next & ~before)
    }
  }

  count(): number {
    if (this.setBitCount === 0) return 0
    if (this.setBitCount >= this.bitCount) return this.totalNodes

    const emptyFraction = 1 - this.setBitCount / this.bitCount
    if (emptyFraction <= 0) return this.totalNodes

    const estimate = -((this.bitCount / this.hashCount) * Math.log(emptyFraction))
    return Math.max(0, Math.min(this.totalNodes, Math.round(estimate)))
  }

  private setBit(bitIndex: number): void {
    const wordIndex = bitIndex >>> 5
    const bit = bitIndex & 31
    const mask = 1 << bit
    if (((this.words[wordIndex] ?? 0) & mask) !== 0) return
    this.words[wordIndex] = (this.words[wordIndex] ?? 0) | mask
    this.setBitCount += 1
  }
}

const topologicalOrder = (
  dag: ReadonlyMap<number, ReadonlySet<number>>,
  size: number,
): ReadonlyArray<number> => {
  const indegree = new Array<number>(size).fill(0)
  for (const targets of dag.values()) {
    for (const target of targets) {
      indegree[target] = (indegree[target] ?? 0) + 1
    }
  }

  const queue: Array<number> = []
  for (let index = 0; index < indegree.length; index += 1) {
    if (indegree[index] === 0) {
      queue.push(index)
    }
  }

  const order: Array<number> = []
  let cursor = 0
  while (cursor < queue.length) {
    const node = queue[cursor]!
    cursor += 1
    order.push(node)
    for (const target of dag.get(node) ?? []) {
      indegree[target] = (indegree[target] ?? 0) - 1
      if (indegree[target] === 0) {
        queue.push(target)
      }
    }
  }

  return order.length === size ? order : [...Array(size).keys()]
}

const hashIndex = (value: number, seed: number): number => {
  let hash = value ^ (0x9e3779b1 * (seed + 1))
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}
