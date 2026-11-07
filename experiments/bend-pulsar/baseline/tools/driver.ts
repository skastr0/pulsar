// Measurement driver (not part of Pulsar). Uses Pulsar's own exported functions.
// The 0.3.0 oracle was deleted from main (#717). Check it out at tag v0.3.0 beside this repo:
//   git worktree add ../pulsar-legacy v0.3.0 && (cd ../pulsar-legacy && bun install && bun run build)
import { writeFileSync } from "node:fs"
import { relative } from "node:path"
import { Effect, Layer, Scope, Context } from "effect"
import { makeTsAnalysisSession, TsAnalysisTag, TsPackageInfoTag } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/ts-analysis.js"
import { analyzeCircularDependencies } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/signals/ts-ad-02-cycle-graph.js"
import { buildModuleGraphFromFiles } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/graph/module-graph.js"
import { TsAd02 } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/signals/ts-ad-02-circular-deps.js"

const mode = process.argv[2]!
const repo = process.argv[3]!
const outPath = process.argv[4]
const t = () => performance.now()
const rss = () => Math.round(process.memoryUsage().rss / 1048576)

const program = Effect.scoped(Effect.gen(function* () {
  const t0 = t()
  const session = yield* makeTsAnalysisSession(repo, { productionOnly: true })
  const ctx = yield* Layer.build(session.observationLayer())
  const analysis = Context.get(ctx, TsAnalysisTag)
  const packages = Context.get(ctx, TsPackageInfoTag)
  const info: Record<string, unknown> = { mode, loadMs: Math.round(t() - t0), analysisFiles: analysis.files.length, packages: packages.length, selfRssMiB: rss() }
  if (mode === "load") return info
  const t1 = t()
  const sourceFiles = yield* analysis.mapFiles(async (c) => c.sourceFile)
  info.mapMs = Math.round(t() - t1); info.sourceFiles = sourceFiles.length; info.selfRssMiB = rss()
  if (mode === "map") return info
  const cfg = TsAd02.defaultConfig
  const t2 = t()
  const res = analyzeCircularDependencies(sourceFiles, cfg.exclude_globs, packages)
  info.analyzeMs = Math.round(t() - t2)
  const graph = buildModuleGraphFromFiles(sourceFiles.filter((s) => true), { excludeGlobs: cfg.exclude_globs, includeExportEdges: true, includeSelfEdges: true, packages })
  let edges = 0; let selfLoops = 0
  for (const [f, ts] of graph.dependencies) { edges += ts.size; if (ts.has(f)) selfLoops++ }
  info.graphNodes = graph.dependencies.size; info.graphEdges = edges; info.selfLoops = selfLoops
  info.cycleCount = res.cycleCount; info.largestCycle = res.largestCycleSize
  const rel = (p: string) => relative(repo, p)
  const lines = res.cycles.map((c) => c.modules.map(rel).sort().join(" ")).sort()
  const header = "# files=" + graph.dependencies.size + " cycles=" + lines.length
  if (outPath) writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : "") + header + "\n")
  info.selfRssMiB = rss()
  return info
}))
Effect.runPromise(program).then((i) => { console.log(JSON.stringify(i)); process.exit(0) }, (e) => { console.error("FAIL", e); process.exit(1) })
