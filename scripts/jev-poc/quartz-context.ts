import { readFileSync, realpathSync } from "node:fs"
import { relative, resolve } from "node:path"
import { Effect } from "effect"
import { openQuartzWorkspace } from "@skastr0/quartz-engine"
import { walkDescendants } from "../../packages/ts-pack/src/ast.ts"
import { TsAnalysisLayer, TsAnalysisTag, type TsFileContext } from "../../packages/ts-pack/src/ts-analysis.ts"
import { SyntaxKind, isIdentifier, isPropertyAccessExpression, isVariableDeclaration, type Node } from "../../packages/ts-pack/src/tsgo-api.ts"
import { functionStartLine, getFunctionLikeEntriesForSourceFile, getFunctionName } from "../../packages/ts-pack/src/signals/shared-function-index.ts"
import { sha256 } from "../jev-spike/model.ts"
import type { SourcePointer } from "../../packages/cli/src/semantic-discovery.ts"
import { SemanticError } from "./policy.ts"

export interface ContextDeclaration {
  readonly id: string
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly name: string
  readonly kind: string
  readonly source: string
  readonly fileSha256: string
}
export interface ContextEdge {
  readonly from: string
  readonly to: string
  readonly kind: "reference" | "dependency"
  readonly file: string
  readonly line: number
}
export interface QuartzContext {
  readonly version: "quartz-context-spike-v1"
  readonly inventory: ReadonlyArray<{ readonly file: string; readonly functions: number }>
  readonly roots: ReadonlyArray<string>
  readonly declarations: ReadonlyArray<ContextDeclaration>
  readonly edges: ReadonlyArray<ContextEdge>
  readonly externalContracts: ReadonlyArray<{ readonly name: string; readonly source: string }>
  readonly limitations: ReadonlyArray<string>
  readonly complete: boolean
  readonly scope: string
}

/** Exported separately so budget behavior can be checked without compiler or provider calls. */
export function boundContext(context: QuartzContext, maxBytes: number): QuartzContext {
  if (Buffer.byteLength(JSON.stringify(context)) <= maxBytes) return context
  // Never present half a contract as a complete declaration, or silently drop graph edges.
  return { ...context, declarations: [], edges: [], externalContracts: [], complete: false,
    limitations: [...context.limitations, `packet_exceeds_byte_budget:${maxBytes}`] }
}

/** A repo-wide function inventory and a compiler-resolved neighborhood, not a complete call graph. */
export const collectQuartzContext = Effect.fn("Semantic.quartzContext")(function* (
  repoRoot: string, members: ReadonlyArray<SourcePointer>, maxBytes = 256_000,
) {
  const root = realpathSync(repoRoot)
  const analysis = yield* TsAnalysisTag
  const configs = [...new Set(analysis.files.map(file => file.projectId))].sort()
  if (!configs.length || configs.some(config => config.startsWith("<"))) return yield* Effect.fail(new SemanticError({ operation: "Original TypeScript project configurations required" }))
  // The regular signal layer pins noLib/noResolve. Use it for membership only, never relationships.
  const workspace = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => openQuartzWorkspace(root, { tsconfigPath: configs[0]!, tsconfigPaths: configs.slice(1) }), catch: () => new SemanticError({ operation: "Open fully resolved Quartz workspace" }) }),
    workspace => Effect.promise(() => workspace.close()),
  )
  return yield* Effect.tryPromise({
    try: async () => {
      const contexts: TsFileContext[] = []
      for (const config of configs) {
        await workspace.withProject(async project => {
          for (const file of analysis.files.filter(file => file.projectId === config)) {
            const sourceFile = await project.program.getSourceFile(file.path)
            if (!sourceFile) throw new Error(`Source absent from original compiler project: ${file.relativePath}`)
            contexts.push({ file, sourceFile, project })
          }
        }, resolve(root, config))
      }
      const declarations = new Map<string, ContextDeclaration>()
      const edges = new Map<string, ContextEdge>()
      const external = new Map<string, { name: string; source: string }>()
      const limitations = new Set<string>()
      const roots: string[] = []
      const fnByContext = contexts.map(context => ({ context, entries: getFunctionLikeEntriesForSourceFile(context.sourceFile) }))
      const inventory = fnByContext.map(({ context, entries }) => ({ file: context.file.relativePath, functions: entries.length })).sort((a, b) => a.file.localeCompare(b.file))
      const work: Array<{ node: Node; context: TsFileContext; id: string }> = []
      const relativeFile = (node: Node) => relative(root, node.getSourceFile().fileName).replaceAll("\\", "/")
      const owner = (node: Node): Node => {
        let current = node
        const functions = getFunctionLikeEntriesForSourceFile(node.getSourceFile())
        while (current.parent && current.parent.kind !== SyntaxKind.SourceFile) {
          if (functions.some(e => e.fn === current)) return isVariableDeclaration(current.parent) ? current.parent : current
          current = current.parent
        }
        return current
      }
      const record = (node: Node, name: string): string | null => {
        const file = relativeFile(node)
        if (file.startsWith("../") || file.split("/").includes("node_modules")) {
          const text = node.getText()
          if (text.length > 4_000) limitations.add(`external_contract_too_large:${name}`)
          else external.set(`${name}:${text}`, { name, source: text })
          return null
        }
        const absolute = realpathSync(resolve(root, file))
        if (relative(root, absolute).startsWith("..") || /(?:^|\/)(?:\.env|secrets?)(?:[./]|$)/i.test(file)) throw new Error("Unsafe context path")
        const sf = node.getSourceFile()
        const id = `${file}:${node.getStart()}:${node.end}`
        declarations.set(id, {
          id, file, startLine: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(Math.max(node.getStart(), node.end - 1)).line + 1,
          name, kind: SyntaxKind[node.kind], source: node.getText(), fileSha256: sha256(readFileSync(absolute, "utf8")),
        })
        return id
      }
      const edge = (from: string, to: string, kind: ContextEdge["kind"], node: Node) => {
        const entry = { from, to, kind, file: relativeFile(node), line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 }
        edges.set(JSON.stringify(entry), entry)
      }
      for (const member of members) {
        if (sha256(readFileSync(resolve(root, member.file), "utf8")) !== member.fileSha256) throw new Error(`Source drift: ${member.file}`)
        const entry = fnByContext.find(e => e.context.file.relativePath === member.file)
        const matches = entry?.entries.filter(e => functionStartLine(e.fn) === member.startLine) ?? []
        if (!entry || matches.length !== 1) { limitations.add(`root_not_uniquely_resolved:${member.file}:${member.startLine}`); continue }
        const fn = matches[0]!.fn
        const node = isVariableDeclaration(fn.parent) ? fn.parent : fn
        const id = record(node, getFunctionName(fn))!
        roots.push(id)
        work.push({ node, context: entry.context, id })
        // Native language-service references, including alias uses, not text-name matching.
        const name = "name" in node ? node.name as Node | undefined : undefined
        if (!name) { limitations.add(`unnamed_reference_root:${id}`); continue }
        const groups = await entry.context.project.languageService.getReferencedSymbolsForNode(name, name.getStart())
        for (const handle of groups.flatMap(group => group.references)) {
          const reference = await handle.resolve()
          if (!reference) { limitations.add(`unresolved_reference:${id}`); continue }
          if (reference.getSourceFile().fileName === node.getSourceFile().fileName && reference.getStart() >= node.getStart() && reference.end <= node.end) continue
          const container = owner(reference)
          const callerId = record(container, `reference to ${getFunctionName(fn)}`)
          if (!callerId) { limitations.add(`external_reference:${id}`); continue }
          if (callerId === id) continue
          edge(callerId, id, "reference", reference)
          const context = contexts.find(c => c.file.relativePath === relativeFile(container))
          if (!context) { limitations.add(`reference_outside_inventory:${relativeFile(container)}`); continue }
          work.push({ node: container, context, id: callerId })
        }
      }
      const visited = new Set<string>()
      for (const item of work) {
        if (visited.has(item.id)) continue
        visited.add(item.id)
        const identifiers: Node[] = []
        walkDescendants(item.node, node => { if (isIdentifier(node)) identifiers.push(node) })
        const symbols = identifiers.length ? await item.context.project.checker.getSymbolAtLocation(identifiers) : []
        for (let i = 0; i < identifiers.length; i++) {
          const identifier = identifiers[i]!
          let symbol = symbols[i]
          // Missing property keys/labels are not proof of missing behavioral dependencies.
          if (!symbol) { limitations.add(`unresolved_identifier:${relativeFile(identifier)}:${identifier.getText()}`); continue }
          let targets = await Promise.all(symbol.declarations.map(d => d.resolve()))
          if (targets.some(d => d && [SyntaxKind.ImportSpecifier, SyntaxKind.ImportClause, SyntaxKind.NamespaceImport, SyntaxKind.ExportSpecifier].includes(d.kind))) {
            symbol = await item.context.project.checker.getAliasedSymbol(symbol)
            targets = await Promise.all(symbol.declarations.map(d => d.resolve()))
          }
          if (!targets.length) { limitations.add(`declaration_unavailable:${symbol.name}`); continue }
          for (const target of targets) {
            if (!target) { limitations.add(`declaration_unresolved:${symbol.name}`); continue }
            // External namespace members are resolved individually. Keep local receivers/data tables.
            const targetFile = relativeFile(target)
            if ((targetFile.startsWith("../") || targetFile.split("/").includes("node_modules")) && isPropertyAccessExpression(identifier.parent) && identifier.parent.expression === identifier) continue
            const sameFile = target.getSourceFile().fileName === item.node.getSourceFile().fileName
            if (sameFile && target.getStart() >= item.node.getStart() && target.end <= item.node.end) continue
            const targetId = record(target, symbol.name)
            if (targetId) edge(item.id, targetId, "dependency", identifier)
          }
        }
      }
      // A finite one-hop slice is not proof of transitive behavior. Keep it diagnostic-only.
      limitations.add("one_hop_dependencies_only; transitive behavior and dynamic dispatch are not established")
      return boundContext({ version: "quartz-context-spike-v1", inventory, roots,
        declarations: [...declarations.values()].sort((a, b) => a.id.localeCompare(b.id)),
        edges: [...edges.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        externalContracts: [...external.values()].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source)),
        limitations: [...limitations].sort(), complete: false,
        scope: "Quartz/tsgo production TypeScript inventory; native symbol references within the owning compiler project; candidate and enclosing reference bodies plus one-hop referenced declarations; external declaration contracts only. Not all runtime callers, tests, or transitive obligations.",
      }, maxBytes)
    },
    catch: cause => new SemanticError({ operation: `Build Quartz context: ${cause instanceof Error ? cause.message : "compiler failure"}` }),
  })
})

export const quartzContext = (root: string, members: ReadonlyArray<SourcePointer>, maxBytes?: number) =>
  collectQuartzContext(root, members, maxBytes).pipe(Effect.scoped, Effect.provide(TsAnalysisLayer(root, { productionOnly: true })))
