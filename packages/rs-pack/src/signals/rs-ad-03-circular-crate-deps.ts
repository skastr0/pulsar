import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import { Effect, Schema } from "effect"
import {
  type CargoMetadataPackage,
  workspacePackages,
} from "../cargo-metadata.js"
import { RustProjectTag } from "../project.js"

const RsAd03Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type RsAd03Config = typeof RsAd03Config.Type

interface CrateEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly optional: boolean
  readonly featureDriven: boolean
}

interface CrateCycle {
  readonly crates: ReadonlyArray<string>
  readonly edges: ReadonlyArray<CrateEdge>
  readonly architecturalSpan: string
  readonly featureInduced: boolean
  readonly manifestPaths: ReadonlyArray<string>
}

interface RsAd03Output {
  readonly cycles: ReadonlyArray<CrateCycle>
  readonly cycleCount: number
  readonly largestCycleSize: number
  readonly metadataStatus: "loaded" | "missing"
  readonly packageCount: number
  readonly diagnosticLimit: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RS_AD_03_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAd03: Signal<RsAd03Config, RsAd03Output, RustProjectTag> = {
  id: "RS-AD-03-circular-crate-dependencies",
  title: "Circular crate dependencies",
  aliases: ["RS-AD-03"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "cargo-metadata-cycles-config-v1",
  configSchema: RsAd03Config,
  factorDefinitions: RS_AD_03_FACTOR_DEFINITIONS,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAd03Config(config)
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
              packageCount: 0,
              diagnosticLimit: normalizedConfig.top_n_diagnostics,
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
            packageCount: packages.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AD-03-circular-crate-dependencies", message: String(cause), cause }),
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
      return [{
        severity: "warn" as const,
        message: "RS-AD-03 could not load cargo metadata for this repo",
        data: {
          metadataStatus: out.metadataStatus,
          packageCount: out.packageCount,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.cycles.slice(0, out.diagnosticLimit).map((cycle) => ({
      severity: "block" as const,
      message: `Circular crate dependency (${cycle.crates.length} crates): ${cycle.architecturalSpan}`,
      location: { file: cycle.manifestPaths[0] ?? "Cargo.toml" },
      data: {
        hash: hashCycle(cycle),
        crates: [...cycle.crates],
        edges: cycle.edges.map((edge) => ({ ...edge })),
        architecturalSpan: cycle.architecturalSpan,
        featureInduced: cycle.featureInduced,
        manifestPaths: [...cycle.manifestPaths],
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.metadataStatus === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    return out.packageCount === 0 ? { applicability: "not_applicable" as const } : undefined
  },
  factorLedger: () => makeRsAd03FactorLedger(),
}

type NormalizedRsAd03Config = RsAd03Config

const normalizeRsAd03Config = (config: RsAd03Config): NormalizedRsAd03Config => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAd03FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AD-03-circular-crate-dependencies", RS_AD_03_FACTOR_DEFINITIONS)

const hashCycle = (cycle: CrateCycle): string =>
  computeDiagnosticHash(
    [
      cycle.architecturalSpan,
      ...sortCycleEdges(cycle.edges).map((edge) =>
        `${edge.from}:${edge.to}:${edge.kind}:${edge.optional}:${edge.featureDriven}`,
      ),
    ].join("|"),
  )

const compareCycleEdges = (a: CrateEdge, b: CrateEdge): number =>
  a.from.localeCompare(b.from) ||
  a.to.localeCompare(b.to) ||
  a.kind.localeCompare(b.kind) ||
  Number(a.optional) - Number(b.optional) ||
  Number(a.featureDriven) - Number(b.featureDriven)

const sortCycleEdges = (edges: ReadonlyArray<CrateEdge>): ReadonlyArray<CrateEdge> =>
  [...edges].sort(compareCycleEdges)

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
  const edges = sortCycleEdges(
    scc.flatMap((from) =>
      (graph.get(from) ?? []).filter((edge) => cycleSet.has(edge.to)),
    ),
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
  type Frame = { readonly node: string; readonly neighbors: ReadonlyArray<string>; cursor: number }

  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const sccs: Array<Array<string>> = []

  const visit = (start: string): void => {
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

    const popComponent = (root: string): Array<string> => {
      const scc: Array<string> = []
      while (true) {
        const value = stack.pop()
        if (value === undefined) break
        onStack.delete(value)
        scc.push(value)
        if (value === root) break
      }
      return scc
    }

    const propagateLowlinkToParent = (frame: Frame): void => {
      const parent = frames[frames.length - 1]
      if (parent === undefined) return
      lowlinks.set(
        parent.node,
        Math.min(lowlinks.get(parent.node) ?? 0, lowlinks.get(frame.node) ?? 0),
      )
    }

    const finishFrame = (frame: Frame): void => {
      if (lowlinks.get(frame.node) === indices.get(frame.node)) {
        sccs.push(popComponent(frame.node))
      }
      frames.pop()
      propagateLowlinkToParent(frame)
    }

    const visitNeighbor = (frame: Frame): void => {
      const neighbor = frame.neighbors[frame.cursor]!
      frame.cursor += 1
      if (!indices.has(neighbor)) {
        enter(neighbor)
        return
      }
      if (!onStack.has(neighbor)) return
      lowlinks.set(
        frame.node,
        Math.min(lowlinks.get(frame.node) ?? 0, indices.get(neighbor) ?? 0),
      )
    }

    enter(start)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      if (frame.cursor >= frame.neighbors.length) {
        finishFrame(frame)
        continue
      }
      visitNeighbor(frame)
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node)
  }
  return sccs
}
