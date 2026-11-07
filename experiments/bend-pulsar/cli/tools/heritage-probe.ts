// Verifies one cause of difference vs old Pulsar: old `localIdentifierUsageByName` treats the whole
// `class X extends <expr>` clause (an ExpressionWithTypeArguments, which `isTypeNode` accepts) as a
// type position, so imports used only inside a heritage expression look type-only.
// This probe recomputes usage with heritage *expressions* treated as value positions and prints,
// per file, the import specifiers whose old verdict (type-only) flips to value.
// Usage: bun heritage-probe.ts <repo> <file-suffix>...
// The 0.3.0 oracle was deleted from main (#717). Check it out at tag v0.3.0 beside this repo:
//   git worktree add ../pulsar-legacy v0.3.0 && (cd ../pulsar-legacy && bun install && bun run build)
import { Effect, Layer, Context } from "effect"
import { makeTsAnalysisSession, TsAnalysisTag } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/ts-analysis.js"
import { localIdentifierUsageByName, valueImportBindingNames } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/signals/shared-module-usage.js"
import { isImportDeclaration, isIdentifier, isTypeNode, SyntaxKind } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/tsgo-api.js"
import { walkDescendants } from "/Users/guilhermecastro/Projects/pulsar-legacy/packages/ts-pack/dist/ast.js"

const repo = process.argv[2]!
const targets = process.argv.slice(3)

// Same walk as old, except an ExpressionWithTypeArguments' `expression` is not a type position.
const modifiedUsage = (sf: any, names: ReadonlySet<string>) => {
  const usage = new Map<string, string>()
  const visit = (node: any, inType: boolean): void => {
    if (isImportDeclaration(node)) return
    const isEwta = node.kind === SyntaxKind.ExpressionWithTypeArguments
    const next = inType || (isTypeNode(node) && !isEwta)
    if (isIdentifier(node)) {
      const name = node.text
      if (!names.has(name)) return
      if (!next) { usage.set(name, "value"); return }
      if (usage.get(name) !== "value") usage.set(name, "type-only")
      return
    }
    node.forEachChild((c: any) => visit(c, next))
  }
  visit(sf, false)
  return usage
}

const program = Effect.scoped(Effect.gen(function* () {
  const session = yield* makeTsAnalysisSession(repo, { productionOnly: true })
  const ctx = yield* Layer.build(session.observationLayer())
  const analysis = Context.get(ctx, TsAnalysisTag)
  const sfs = yield* analysis.mapFiles(async (c) => c.sourceFile)
  for (const t of targets) {
    const sf = sfs.find((s: any) => s.fileName.endsWith("/" + t))
    if (!sf) { console.log(t, "NOT IN OLD NODE SET"); continue }
    const decls: any[] = []
    walkDescendants(sf, (n: any) => { if (isImportDeclaration(n)) decls.push(n) })
    const names = valueImportBindingNames(decls)
    const oldU = localIdentifierUsageByName(sf, names)
    const newU = modifiedUsage(sf, names)
    const flipped = [...names].filter((n) => oldU.get(n) === "type-only" && newU.get(n) === "value")
    const stillDiff = [...names].filter((n) => oldU.get(n) !== newU.get(n) && !flipped.includes(n))
    console.log(t, "flipped:", flipped.join(","), stillDiff.length ? "OTHER-DIFF: " + stillDiff.join(",") : "")
  }
}))
Effect.runPromise(program).then(() => process.exit(0), (e) => { console.error("FAIL", e); process.exit(1) })
