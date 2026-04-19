import {
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type CargoMetadataPackage,
  workspacePackages,
} from "../cargo-metadata.js"
import { RustProjectTag } from "../project.js"

export const RsAd03Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type RsAd03Config = typeof RsAd03Config.Type

interface CrateEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly optional: boolean
  readonly featureDriven: boolean
}

export interface CrateCycle {
  readonly crates: ReadonlyArray<string>
  readonly edges: ReadonlyArray<CrateEdge>
  readonly architecturalSpan: string
  readonly featureInduced: boolean
  readonly manifestPaths: ReadonlyArray<string>
}

export interface RsAd03Output {
  readonly cycles: ReadonlyArray<CrateCycle>
  readonly cycleCount: number
  readonly largestCycleSize: number
  readonly metadataStatus: "loaded" | "missing"
}

export const RsAd03: Signal<RsAd03Config, RsAd03Output, RustProjectTag> = {
  id: "RS-AD-03",
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  configSchema: RsAd03Config,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.try({
        try: (): RsAd03Output => {
          const metadata = project.cargoMetadata
          if (metadata === undefined) {
            return {
              cycles: [],
              cycleCount: 0,
              largestCycleSize: 0,
              metadataStatus: "missing",
            }
          }

          const packages = workspacePackages(metadata)
          const packageByName = new Map(packages.map((pkg) => [pkg.name, pkg] as const))
          const graph = new Map<string, Array<CrateEdge>>()

          for (const pkg of packages) {
            const edges: Array<CrateEdge> = []
            for (const dep of pkg.dependencies) {
              const target = packageByName.get(dep.name)
              if (target === undefined) continue
              edges.push({
                from: pkg.name,
                to: target.name,
                kind: dep.kind ?? "normal",
                optional: dep.optional,
                featureDriven: dep.optional || dep.features.length > 0,
              })
            }
            graph.set(pkg.name, edges)
          }

          const sccs = tarjan(graph)
          const cycles = sccs
            .filter((scc) => scc.length > 1 || hasSelfLoop(scc[0], graph))
            .map((scc) => toCycle(scc, graph, packageByName))
            .sort((a, b) => b.crates.length - a.crates.length || a.architecturalSpan.localeCompare(b.architecturalSpan))

          return {
            cycles,
            cycleCount: cycles.length,
            largestCycleSize: cycles.reduce((max, cycle) => Math.max(max, cycle.crates.length), 0),
            metadataStatus: "loaded",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AD-03", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.cycleCount === 0) return 1
    const countPenalty = Math.min(1, out.cycleCount * 0.15)
    const sizePenalty = Math.min(0.5, Math.max(0, out.largestCycleSize - 2) * 0.1)
    return Math.max(0, 1 - countPenalty - sizePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.metadataStatus === "missing") {
      return [{ severity: "warn", message: "RS-AD-03 could not load cargo metadata for this repo" }]
    }
    return out.cycles.slice(0, 10).map((cycle) => ({
      severity: "block" as const,
      message: `Circular crate dependency (${cycle.crates.length} crates): ${cycle.architecturalSpan}`,
      location: { file: cycle.manifestPaths[0] ?? "Cargo.toml" },
      data: {
        hash: computeDiagnosticHash(cycle.architecturalSpan),
        crates: [...cycle.crates],
        edges: cycle.edges.map((edge) => ({ ...edge })),
        architecturalSpan: cycle.architecturalSpan,
        featureInduced: cycle.featureInduced,
        manifestPaths: [...cycle.manifestPaths],
      },
    }))
  },
}

const hasSelfLoop = (
  node: string | undefined,
  graph: ReadonlyMap<string, ReadonlyArray<CrateEdge>>,
): boolean => (node === undefined ? false : (graph.get(node) ?? []).some((edge) => edge.to === node))

const toCycle = (
  scc: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlyArray<CrateEdge>>,
  packageByName: ReadonlyMap<string, CargoMetadataPackage>,
): CrateCycle => {
  const cycleSet = new Set(scc)
  const edges = scc.flatMap((from) =>
    (graph.get(from) ?? []).filter((edge) => cycleSet.has(edge.to)),
  )
  const ordered = [...scc].sort()
  const architecturalSpan = `${ordered.join("→")}→${ordered[0] ?? ""}`
  return {
    crates: ordered,
    edges,
    architecturalSpan,
    featureInduced: edges.some(
      (edge) => edge.featureDriven || edge.optional || edge.kind !== "normal",
    ),
    manifestPaths: ordered.flatMap((crate) => {
      const manifestPath = packageByName.get(crate)?.manifestPath
      return manifestPath === undefined ? [] : [manifestPath]
    }),
  }
}

const tarjan = (
  graph: ReadonlyMap<string, ReadonlyArray<CrateEdge>>,
): Array<Array<string>> => {
  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const sccs: Array<Array<string>> = []

  const visit = (start: string): void => {
    type Frame = { readonly node: string; readonly neighbors: ReadonlyArray<string>; cursor: number }
    const frames: Array<Frame> = []

    const enter = (node: string): void => {
      indices.set(node, index)
      lowlinks.set(node, index)
      index += 1
      stack.push(node)
      onStack.add(node)
      frames.push({
        node,
        neighbors: (graph.get(node) ?? []).map((edge) => edge.to),
        cursor: 0,
      })
    }

    enter(start)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      if (frame.cursor >= frame.neighbors.length) {
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          const scc: Array<string> = []
          while (true) {
            const value = stack.pop()
            if (value === undefined) break
            onStack.delete(value)
            scc.push(value)
            if (value === frame.node) break
          }
          sccs.push(scc)
        }
        frames.pop()
        if (frames.length > 0) {
          const parent = frames[frames.length - 1]!
          lowlinks.set(
            parent.node,
            Math.min(lowlinks.get(parent.node) ?? 0, lowlinks.get(frame.node) ?? 0),
          )
        }
        continue
      }

      const neighbor = frame.neighbors[frame.cursor]!
      frame.cursor += 1
      if (!indices.has(neighbor)) {
        enter(neighbor)
      } else if (onStack.has(neighbor)) {
        lowlinks.set(
          frame.node,
          Math.min(lowlinks.get(frame.node) ?? 0, indices.get(neighbor) ?? 0),
        )
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node)
  }
  return sccs
}
