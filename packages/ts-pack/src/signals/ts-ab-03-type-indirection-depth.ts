import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import {
  Node,
  type ClassDeclaration,
  type EnumDeclaration,
  type ExpressionWithTypeArguments,
  type InterfaceDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeNode,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  STANDARD_UTILITY_TYPE_ALIASES,
  declarationKey,
  resolveReferenceLikeName,
} from "./shared-type-analysis.js"

export const TsAb03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_depth: Schema.Number,
  max_traversal_steps: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsAb03Config = typeof TsAb03Config.Type

export interface TypeIndirectionEntry {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly depth: number
  readonly exported: boolean
  readonly chain: ReadonlyArray<string>
  readonly cycle: boolean
  readonly truncated: boolean
}

export interface TsAb03Output {
  readonly declarations: ReadonlyArray<TypeIndirectionEntry>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly repoDistribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<TypeIndirectionEntry>
  readonly maxDepth: number
  readonly traversalCap: number
  readonly diagnosticLimit: number
}

type DepthResult = {
  depth: number
  chain: ReadonlyArray<string>
  cycle: boolean
  truncated: boolean
}

type WalkContext = {
  readonly remainingSteps: number
  readonly aliasStack: ReadonlySet<string>
  readonly localAliases: ReadonlyMap<string, TypeAliasDeclaration>
  readonly aliasDepthCache: Map<string, DepthResult>
}

type TrackedDeclaration = TypeAliasDeclaration | InterfaceDeclaration | ClassDeclaration | EnumDeclaration

export const TsAb03: Signal<TsAb03Config, TsAb03Output, TsProjectTag> = {
  id: "TS-AB-03-type-indirection-depth",
  title: "Type indirection depth",
  aliases: ["TS-AB-03"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    max_depth: 4,
    max_traversal_steps: 16,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb03Output => {
          const declarations: Array<TypeIndirectionEntry> = []
          const byFile = new Map<string, Array<number>>()

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            const localAliases = buildLocalAliasMap(sourceFile)
            const aliasDepthCache = new Map<string, DepthResult>()
            for (const declaration of collectTrackedDeclarations(sourceFile)) {
              const result = measureDeclaration(declaration, {
                remainingSteps: config.max_traversal_steps,
                aliasStack: new Set<string>(),
                localAliases,
                aliasDepthCache,
              })
              declarations.push({
                file,
                name: declaration.getName() ?? "<anonymous>",
                line: declaration.getStartLineNumber(),
                depth: result.depth,
                exported: isExportedDeclaration(declaration),
                chain: result.chain,
                cycle: result.cycle,
                truncated: result.truncated,
              })
              const bucket = byFile.get(file) ?? []
              bucket.push(result.depth)
              byFile.set(file, bucket)
            }
          }

          declarations.sort(compareIndirectionEntries)

          const byFileSummary = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFile) {
            byFileSummary.set(file, summarize(values))
          }

          return {
            declarations,
            byFile: byFileSummary,
            repoDistribution: summarize(declarations.map((entry) => entry.depth)),
            overThreshold: declarations.filter((entry) => entry.depth > config.max_depth),
            maxDepth: config.max_depth,
            traversalCap: config.max_traversal_steps,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-03-type-indirection-depth",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.declarations.length === 0) return 1
    const ratio = out.overThreshold.length / out.declarations.length
    return Math.max(0, 1 - ratio)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: typeIndirectionSeverity(entry, out.maxDepth),
      message:
        `Type indirection \`${entry.name}\` resolves through ${entry.depth} layers: ` +
        entry.chain.join(" → "),
      location: { file: entry.file, line: entry.line },
      data: {
        ...entry,
        maxDepth: out.maxDepth,
        traversalCap: out.traversalCap,
      },
    })),
}

const collectTrackedDeclarations = (
  sourceFile: SourceFile,
): ReadonlyArray<TrackedDeclaration> => {
  const results: Array<TrackedDeclaration> = []

  results.push(...sourceFile.getTypeAliases())
  results.push(...sourceFile.getInterfaces().filter(hasExportModifier))
  results.push(...sourceFile.getClasses().filter(hasExportModifier))
  results.push(...sourceFile.getEnums().filter(hasExportModifier))

  return results
}

const buildLocalAliasMap = (sourceFile: SourceFile): ReadonlyMap<string, TypeAliasDeclaration> => {
  const aliases = new Map<string, TypeAliasDeclaration>()
  for (const declaration of sourceFile.getTypeAliases()) {
    aliases.set(declaration.getName(), declaration)
  }
  return aliases
}

const hasExportModifier = (node: Node): boolean => {
  const candidate = node as { getModifiers?: () => ReadonlyArray<{ getKindName: () => string }> }
  return candidate.getModifiers?.().some((modifier) => modifier.getKindName() === "ExportKeyword") ?? false
}

const isExportedDeclaration = (node: TrackedDeclaration): boolean =>
  !Node.isTypeAliasDeclaration(node) || hasExportModifier(node)

const typeIndirectionSeverity = (
  entry: TypeIndirectionEntry,
  maxDepth: number,
): "warn" | "info" =>
  entry.exported || entry.depth >= maxDepth + 2 ? "warn" : "info"

const measureDeclaration = (
  declaration: TrackedDeclaration,
  context: WalkContext,
): DepthResult => {
  if (Node.isTypeAliasDeclaration(declaration)) {
    return measureAliasDeclaration(declaration, context)
  }

  if (Node.isInterfaceDeclaration(declaration) || Node.isClassDeclaration(declaration)) {
    const heritageResults = declaration
      .getHeritageClauses()
      .flatMap((clause) => clause.getTypeNodes())
      .map((typeNode) => measureHeritageType(typeNode, stepContext(context)))
    return deepestResult(heritageResults)
  }

  return zeroDepth()
}

const measureAliasDeclaration = (
  declaration: TypeAliasDeclaration,
  context: WalkContext,
): DepthResult => {
  if (context.remainingSteps <= 0) {
    return truncatedDepth()
  }

  const aliasId = declarationKey(declaration)
  if (context.aliasStack.has(aliasId)) {
    return {
      depth: 1,
      chain: [`${declaration.getName()} (cycle)`],
      cycle: true,
      truncated: false,
    }
  }
  const cached = context.aliasDepthCache.get(aliasId)
  if (cached !== undefined) return cached

  const nextStack = new Set(context.aliasStack)
  nextStack.add(aliasId)
  const inner = measureTypeNode(declaration.getTypeNodeOrThrow(), {
    remainingSteps: context.remainingSteps - 1,
    aliasStack: nextStack,
    localAliases: context.localAliases,
    aliasDepthCache: context.aliasDepthCache,
  })
  const result = {
    depth: 1 + inner.depth,
    chain: [declaration.getName(), ...inner.chain],
    cycle: inner.cycle,
    truncated: inner.truncated,
  }
  context.aliasDepthCache.set(aliasId, result)
  return result
}

const measureHeritageType = (
  typeNode: ExpressionWithTypeArguments,
  context: WalkContext,
): DepthResult => {
  const declaration = context.localAliases.get(typeNode.getExpression().getText())
  if (declaration !== undefined) {
    return measureAliasDeclaration(declaration, context)
  }
  return deepestResult(
    typeNode.getTypeArguments().map((typeArg: TypeNode) => measureTypeNode(typeArg, stepContext(context))),
  )
}

const measureTypeNode = (node: TypeNode, context: WalkContext): DepthResult => {
  if (context.remainingSteps <= 0) return truncatedDepth()

  if (Node.isParenthesizedTypeNode(node)) {
    return measureTypeNode(node.getTypeNode(), stepContext(context))
  }
  if (Node.isTypeReference(node)) {
    return measureTypeReference(node, context)
  }
  if (Node.isMappedTypeNode(node)) {
    return layerResult(
        "<mapped>",
        [
          node.getTypeParameter().getConstraint(),
          node.getNameTypeNode(),
          node.getTypeNode(),
        ]
        .filter((child): child is TypeNode => child !== undefined)
        .map((child) => measureTypeNode(child, stepContext(context))),
    )
  }
  if (Node.isConditionalTypeNode(node)) {
    return layerResult(
      "<conditional>",
      [node.getCheckType(), node.getExtendsType(), node.getTrueType(), node.getFalseType()].map(
        (child) => measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (Node.isIndexedAccessTypeNode(node)) {
    return layerResult(
      "<indexed-access>",
      [node.getObjectTypeNode(), node.getIndexTypeNode()].map((child) =>
        measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (Node.isImportTypeNode(node)) {
    return layerResult(
      "<import-type>",
      node.getTypeArguments().map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
    )
  }
  if (Node.isTypeQuery(node)) {
    return layerResult(
      `<typeof ${node.getExprName().getText()}>`,
      node.getTypeArguments().map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
    )
  }

  return deepestResult(collectNestedTypeResults(node, stepContext(context)))
}

const measureTypeReference = (
  node: import("ts-morph").TypeReferenceNode,
  context: WalkContext,
): DepthResult => {
  const name = resolveReferenceLikeName(node)
  const aliasDeclaration = context.localAliases.get(name)
  if (aliasDeclaration !== undefined) {
    return measureAliasDeclaration(aliasDeclaration, stepContext(context))
  }

  const typeArgumentResults = node
    .getTypeArguments()
    .map((typeArg) => measureTypeNode(typeArg, stepContext(context)))

  if (STANDARD_UTILITY_TYPE_ALIASES.has(name)) {
    return layerResult(name, typeArgumentResults)
  }

  return deepestResult(typeArgumentResults)
}

const layerResult = (label: string, results: ReadonlyArray<DepthResult>): DepthResult => {
  const deepest = deepestResult(results)
  return {
    depth: 1 + deepest.depth,
    chain: [label, ...deepest.chain],
    cycle: deepest.cycle,
    truncated: deepest.truncated,
  }
}

const collectNestedTypeResults = (node: Node, context: WalkContext): ReadonlyArray<DepthResult> => {
  const results: Array<DepthResult> = []
  node.forEachChild((child) => {
    if (Node.isTypeNode(child)) {
      results.push(measureTypeNode(child, context))
      return
    }
    if (Node.isExpressionWithTypeArguments(child)) {
      results.push(measureHeritageType(child, context))
      return
    }
    results.push(...collectNestedTypeResults(child, context))
  })
  return results
}

const deepestResult = (results: ReadonlyArray<DepthResult>): DepthResult => {
  let best = zeroDepth()
  for (const result of results) {
    if (result.depth > best.depth) {
      best = result
      continue
    }
    if (result.depth === best.depth && result.chain.join("/") < best.chain.join("/")) {
      best = result
    }
  }
  return best
}

const zeroDepth = (): DepthResult => ({
  depth: 0,
  chain: [],
  cycle: false,
  truncated: false,
})

const truncatedDepth = (): DepthResult => ({
  depth: 0,
  chain: ["<truncated>"],
  cycle: false,
  truncated: true,
})

const stepContext = (context: WalkContext): WalkContext => ({
  remainingSteps: context.remainingSteps - 1,
  aliasStack: context.aliasStack,
  localAliases: context.localAliases,
  aliasDepthCache: context.aliasDepthCache,
})

const compareIndirectionEntries = (
  left: TypeIndirectionEntry,
  right: TypeIndirectionEntry,
): number => {
  if (right.depth !== left.depth) {
    return right.depth - left.depth
  }
  if (left.file !== right.file) {
    return left.file.localeCompare(right.file)
  }
  return left.line - right.line
}
