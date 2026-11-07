// Fidelity oracle: prints old Pulsar 0.3.0's module-graph nodes and edges for a repo.
// Variant of baseline/tools/driver.ts. Usage: bun edges.ts <repo> <out-file>
// Output lines: `N <repo-relative path>` for every graph node, `E <src> <dst>` for every edge
// (self edges included), sorted. Uses Pulsar's own exported functions from packages/ts-pack/dist.
// The 0.3.0 oracle was deleted from main (#717). Check it out at tag v0.3.0 beside this repo:
//   git worktree add ../pulsar-legacy v0.3.0 && (cd ../pulsar-legacy && bun install && bun run build)
import { writeFileSync } from "node:fs"
import { relative } from "node:path"
import { Effect, Layer, Context } from "effect"
import { makeTsAnalysisSession, TsAnalysisTag, TsPackageInfoTag } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/ts-analysis.js"
import { buildModuleGraphFromFiles } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/graph/module-graph.js"
import { TsAd02 } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/signals/ts-ad-02-circular-deps.js"

const repo = process.argv[2]!
const outPath = process.argv[3]!

const program = Effect.scoped(Effect.gen(function* () {
  const session = yield* makeTsAnalysisSession(repo, { productionOnly: true })
  const ctx = yield* Layer.build(session.observationLayer())
  const analysis = Context.get(ctx, TsAnalysisTag)
  const packages = Context.get(ctx, TsPackageInfoTag)
  const sourceFiles = yield* analysis.mapFiles(async (c) => c.sourceFile)
  const cfg = TsAd02.defaultConfig
  const graph = buildModuleGraphFromFiles(sourceFiles, {
    excludeGlobs: cfg.exclude_globs, includeExportEdges: true, includeSelfEdges: true, packages,
  })
  const rel = (p: string) => relative(repo, p)
  const lines: string[] = []
  for (const [f, ts] of graph.dependencies) {
    lines.push("N " + rel(f))
    for (const t of ts) lines.push("E " + rel(f) + " " + rel(t))
  }
  lines.sort()
  writeFileSync(outPath, lines.join("\n") + "\n")
  return { nodes: graph.dependencies.size, lines: lines.length }
}))
Effect.runPromise(program).then((i) => { console.log(JSON.stringify(i)); process.exit(0) }, (e) => { console.error("FAIL", e); process.exit(1) })
