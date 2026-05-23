import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { type RustProject, RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsLd04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd04Config = typeof RsLd04Config.Type

interface BoundaryErrorSurface {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly errorType: string
  readonly classification: "granular" | "collapsed"
}

interface RsLd04Output {
  readonly boundaryFunctions: ReadonlyArray<BoundaryErrorSurface>
  readonly granularCount: number
  readonly collapsedCount: number
  readonly totalBoundaryResults: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "granular-result-boundary-share"
  readonly scoreDenominator: "public-result-boundary-functions"
  readonly granularBoundaryShare: number
  readonly collapsedBoundaryShare: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_04_SCORE_MODE = "granular-result-boundary-share" as const
const RS_LD_04_SCORE_DENOMINATOR = "public-result-boundary-functions" as const

const RsLd04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd04: Signal<RsLd04Config, RsLd04Output, RustProjectTag> = {
  id: "RS-LD-04-error-granularity",
  title: "Error granularity",
  aliases: ["RS-LD-04"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "error-granularity-config-applicability-diagnostics-cfg-test-result-aliases-v7",
  configSchema: RsLd04Config,
  factorDefinitions: RsLd04FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd04Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd04Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const analyzedSourceFileSet = new Set(analyzedSourceFiles)
          const activeFunctionKeys = await collectActiveFunctionKeys(project, analyzedSourceFiles)
          const resolvedResultErrorTypes = await collectResolvedResultErrorTypes(project, analyzedSourceFiles)
          const boundaryFunctions = facts.functions
            .filter((fn) =>
              analyzedSourceFileSet.has(fn.file) &&
              activeFunctionKeys.has(boundaryFunctionKey(fn))
            )
            .filter((fn) => fn.visibility.kind !== "private")
            .flatMap((fn) => {
              const errorType = resolvedResultErrorTypes.get(boundaryFunctionKey(fn)) ?? fn.resultErrorType
              if (errorType === undefined) return []
              return [{
                file: fn.file,
                module: fn.modulePath,
                name: fn.name,
                line: fn.line,
                errorType,
                classification: classifyErrorType(errorType) as "granular" | "collapsed",
              }]
            })
            .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
          const granularCount = boundaryFunctions.filter((fn) => fn.classification === "granular").length
          const collapsedCount = boundaryFunctions.filter((fn) => fn.classification === "collapsed").length

          return {
            granularCount,
            collapsedCount,
            totalBoundaryResults: boundaryFunctions.length,
            boundaryFunctions,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_LD_04_SCORE_MODE,
            scoreDenominator: RS_LD_04_SCORE_DENOMINATOR,
            granularBoundaryShare: ratio(granularCount, boundaryFunctions.length),
            collapsedBoundaryShare: ratio(collapsedCount, boundaryFunctions.length),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-04-error-granularity", message: String(cause), cause }),
      })
    }),
  score: (out) => out.totalBoundaryResults === 0 ? 1 : out.granularBoundaryShare,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-04 found no Rust source files for error granularity analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalBoundaryResults: out.totalBoundaryResults,
          granularCount: out.granularCount,
          collapsedCount: out.collapsedCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.boundaryFunctions
      .filter((fn) => fn.classification === "collapsed")
      .slice(0, out.diagnosticLimit)
      .map((fn) => ({
        severity: "warn" as const,
        message: `Boundary function ${fn.name} returns collapsed error type ${fn.errorType}`,
        location: { file: fn.file, line: fn.line },
        data: {
          ...fn,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.totalBoundaryResults === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd04FactorLedger(),
}

type NormalizedRsLd04Config = RsLd04Config

const normalizeRsLd04Config = (config: RsLd04Config): NormalizedRsLd04Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd04FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-04-error-granularity",
    RsLd04FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const collectActiveFunctionKeys = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> => {
  const keys = new Set<string>()
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      keys.add(boundaryFunctionKey({
        file,
        modulePath,
        name,
        line: node.startPosition.row + 1,
      }))
    })
  }
  return keys
}

const boundaryFunctionKey = (fn: {
  readonly file: string
  readonly modulePath: string
  readonly name: string
  readonly line: number
}): string => `${fn.file}:${fn.line}:${fn.modulePath}::${fn.name}`

interface ResultAliasScope {
  readonly importAliases: ReadonlyMap<string, string>
  readonly typeAliases: ReadonlyMap<string, string>
}

const collectResolvedResultErrorTypes = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> => {
  const resultErrorTypes = new Map<string, string>()
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    const aliasesByModule = collectResultAliasScopes(scope, tree.rootNode)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const returnTypeText = returnTypeTextOfFunction(node)
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      const aliases = aliasesForModule(modulePath, aliasesByModule)
      const errorType = resultErrorTypeFromReturnText(returnTypeText, aliases)
      if (errorType === undefined) return
      resultErrorTypes.set(boundaryFunctionKey({
        file,
        modulePath,
        name,
        line: node.startPosition.row + 1,
      }), errorType)
    })
  }
  return resultErrorTypes
}

const collectResultAliasScopes = (
  scope: ReturnType<typeof resolveRustFileScope>,
  root: Parameters<typeof walkAttributedNodes>[0],
): ReadonlyMap<string, ResultAliasScope> => {
  const scopes = new Map<string, {
    readonly importAliases: Map<string, string>
    readonly typeAliases: Map<string, string>
  }>()
  const scopeForModule = (modulePath: string): {
    readonly importAliases: Map<string, string>
    readonly typeAliases: Map<string, string>
  } => {
    const existing = scopes.get(modulePath)
    if (existing !== undefined) return existing
    const created = { importAliases: new Map<string, string>(), typeAliases: new Map<string, string>() }
    scopes.set(modulePath, created)
    return created
  }
  walkAttributedNodes(root, ({ node, ancestors, testGated }) => {
    if (testGated) return
    const moduleAliases = scopeForModule(modulePathForAncestors(scope, ancestors).modulePath)
    if (node.type === "use_declaration") {
      const renamedImport = /\buse\s+([A-Za-z_][A-Za-z0-9_:]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/.exec(node.text)
      if (renamedImport !== null) {
        moduleAliases.importAliases.set(renamedImport[2]!, renamedImport[1]!)
        return
      }
      const plainImport = /\buse\s+((?:[A-Za-z_][A-Za-z0-9_]*::)+)([A-Za-z_][A-Za-z0-9_]*)\s*;/.exec(node.text)
      if (plainImport !== null) {
        moduleAliases.importAliases.set(plainImport[2]!, `${plainImport[1]!}${plainImport[2]!}`)
      }
    }
    if (node.type === "type_item") {
      const match = /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\b[\s\S]*?=\s*([^;]+)\s*;?/.exec(node.text)
      if (match !== null) moduleAliases.typeAliases.set(match[1]!, match[2]!.trim())
    }
  })
  return scopes
}

const aliasesForModule = (
  modulePath: string,
  aliasesByModule: ReadonlyMap<string, ResultAliasScope>,
): ResultAliasScope => {
  return aliasesByModule.get(modulePath) ?? {
    importAliases: new Map<string, string>(),
    typeAliases: new Map<string, string>(),
  }
}

const returnTypeTextOfFunction = (node: Parameters<typeof firstNamedChild>[0]): string | undefined => {
  const children = namedChildrenOf(node)
  const parametersIndex = children.findIndex((child) => child.type === "parameters")
  if (parametersIndex === -1) return undefined
  return children.slice(parametersIndex + 1).find(
    (child) => child.type !== "where_clause" && child.type !== "block",
  )?.text
}

const resultErrorTypeFromReturnText = (
  returnTypeText: string | undefined,
  aliases: ResultAliasScope,
  seenAliases: ReadonlySet<string> = new Set(),
): string | undefined => {
  if (returnTypeText === undefined) return undefined
  const trimmed = returnTypeText.trim()
  const normalized = trimmed.replace(/\s+/g, "")
  if (/^anyhow::Result(?:<.*>)?$/.test(normalized)) return "anyhow::Error"
  if (/^eyre::Result(?:<.*>)?$/.test(normalized)) return "eyre::Report"

  const genericReturn = /^((?:(?:[A-Za-z_][A-Za-z0-9_]*|self|super|crate)::)*[A-Za-z_][A-Za-z0-9_]*)<([\s\S]+)>$/.exec(trimmed)
  if (genericReturn !== null) {
    const outerType = resolveImportedTypeName(genericReturn[1]!, aliases.importAliases)
    const outerTypeNormalized = outerType.replace(/\s+/g, "")
    if (outerTypeNormalized === "anyhow::Result") return "anyhow::Error"
    if (outerTypeNormalized === "eyre::Result") return "eyre::Report"
    if (/(^|::)Result$/.test(outerType)) {
      const errorType = splitTopLevelCommas(genericReturn[2] ?? "")[1]?.trim()
      return errorType === undefined ? undefined : resolveErrorAlias(errorType, aliases, seenAliases)
    }
  }

  const aliasCall = /^([A-Za-z_][A-Za-z0-9_]*)(?:<[\s\S]*>)?$/.exec(trimmed)
  if (aliasCall === null) return undefined
  const aliasName = aliasCall[1]!
  if (seenAliases.has(aliasName)) return undefined
  const aliasedType = aliases.typeAliases.get(aliasName)
  if (aliasedType === undefined) return undefined
  return resultErrorTypeFromReturnText(aliasedType, aliases, new Set([...seenAliases, aliasName]))
}

const resolveErrorAlias = (
  errorType: string,
  aliases: ResultAliasScope,
  seenAliases: ReadonlySet<string>,
): string => {
  const trimmed = errorType.trim()
  const importedType = aliases.importAliases.get(trimmed)
  if (importedType !== undefined) return importedType

  const aliasName = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed)?.[1]
  if (aliasName === undefined || seenAliases.has(aliasName)) return trimmed
  const aliasedType = aliases.typeAliases.get(aliasName)
  if (aliasedType === undefined) return trimmed

  const nextSeenAliases = new Set([...seenAliases, aliasName])
  return resultErrorTypeFromReturnText(aliasedType, aliases, nextSeenAliases) ??
    resolveErrorAlias(aliasedType, aliases, nextSeenAliases)
}

const resolveImportedTypeName = (
  typeName: string,
  importAliases: ReadonlyMap<string, string>,
): string => /^[A-Za-z_][A-Za-z0-9_]*$/.test(typeName) ? importAliases.get(typeName) ?? typeName : typeName

const splitTopLevelCommas = (text: string): ReadonlyArray<string> => {
  const parts: Array<string> = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === "<" || char === "(" || char === "[" || char === "{") depth += 1
    if (char === ">" || char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1)
    if (char === "," && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

const classifyErrorType = (errorType: string): "granular" | "collapsed" => {
  const normalized = errorType.replace(/\s+/g, "")
  if (
    normalized === "anyhow::Error" ||
    normalized === "eyre::Report" ||
    normalized === "eyre::Error" ||
    normalized === "String" ||
    normalized === "&str" ||
    normalized === "&'staticstr" ||
    /^impl.*Error/.test(normalized) ||
    /Box<dyn.*Error.*>/.test(normalized) ||
    /dyn.*Error/.test(normalized)
  ) {
    return "collapsed"
  }
  return "granular"
}
