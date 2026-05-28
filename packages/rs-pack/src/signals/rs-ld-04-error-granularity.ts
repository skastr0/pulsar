import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
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
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"
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

const RS_LD_04_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
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
  cacheVersion: "error-granularity-config-applicability-diagnostics-cfg-test-result-aliases-v12",
  configSchema: RsLd04Config,
  factorDefinitions: RS_LD_04_FACTOR_DEFINITIONS,
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
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: out.totalBoundaryResults,
    }),
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
  makeDefaultSignalFactorLedger("RS-LD-04-error-granularity", RS_LD_04_FACTOR_DEFINITIONS)

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
  const scopes = new Map<string, MutableResultAliasScope>()
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
    if (ancestors.some((ancestor) => ancestor.type === "function_item" || ancestor.type === "block")) return
    const moduleAliases = scopeForModule(modulePathForAncestors(scope, ancestors).modulePath)
    if (node.type === "use_declaration") {
      for (const [name, target] of importAliasesFromUseDeclaration(node.text)) {
        moduleAliases.importAliases.set(name, target)
      }
    }
    if (node.type === "type_item") {
      const match = /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\b[\s\S]*?=\s*([^;]+)\s*;?/.exec(node.text)
      if (match !== null) moduleAliases.typeAliases.set(match[1]!, match[2]!.trim())
    }
  })
  resolveRelativeImportAliases(scopes, `${scope.crateName}::crate`)
  return scopes
}

interface MutableResultAliasScope {
  readonly importAliases: Map<string, string>
  readonly typeAliases: Map<string, string>
}

const resolveRelativeImportAliases = (
  scopes: ReadonlyMap<string, MutableResultAliasScope>,
  crateRootModulePath: string,
): void => {
  for (const [modulePath, aliases] of scopes) {
    for (const [name, target] of aliases.importAliases) {
      aliases.importAliases.set(
        name,
        resolveRelativeImportTarget(modulePath, target, scopes, crateRootModulePath),
      )
    }
  }
}

const resolveRelativeImportTarget = (
  modulePath: string,
  target: string,
  scopes: ReadonlyMap<string, MutableResultAliasScope>,
  crateRootModulePath: string,
  seenTargets: ReadonlySet<string> = new Set(),
): string => {
  if (seenTargets.has(`${modulePath}:${target}`)) return target
  const targetSegments = target.split("::")
  const firstSegment = targetSegments[0]
  if (firstSegment !== "self" && firstSegment !== "super" && firstSegment !== "crate") return target
  const importedName = targetSegments.at(-1)
  if (importedName === undefined) return target
  const targetModulePath = modulePathForRelativeImport(modulePath, targetSegments.slice(0, -1), crateRootModulePath)
  const targetScope = scopes.get(targetModulePath)
  const aliasTarget = targetScope?.importAliases.get(importedName)
  if (aliasTarget !== undefined) {
    return resolveRelativeImportTarget(
      targetModulePath,
      aliasTarget,
      scopes,
      crateRootModulePath,
      new Set([...seenTargets, `${modulePath}:${target}`]),
    )
  }
  const typeAliasTarget = targetScope?.typeAliases.get(importedName)
  return typeAliasTarget === undefined
    ? target
    : resolveAliasTargetInModule(
      targetModulePath,
      typeAliasTarget,
      scopes,
      crateRootModulePath,
      new Set([...seenTargets, `${modulePath}:${target}`]),
    )
}

const resolveAliasTargetInModule = (
  modulePath: string,
  target: string,
  scopes: ReadonlyMap<string, MutableResultAliasScope>,
  crateRootModulePath: string,
  seenTargets: ReadonlySet<string>,
): string => {
  if (seenTargets.has(`${modulePath}:${target}`)) return target
  const trimmed = target.trim()
  if (/^(?:self|super|crate)::/.test(trimmed)) {
    return resolveRelativeImportTarget(modulePath, trimmed, scopes, crateRootModulePath, seenTargets)
  }
  const aliasName = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed)?.[1]
  if (aliasName === undefined) return trimmed
  const aliases = scopes.get(modulePath)
  const importTarget = aliases?.importAliases.get(aliasName)
  if (importTarget !== undefined) {
    return resolveRelativeImportTarget(
      modulePath,
      importTarget,
      scopes,
      crateRootModulePath,
      new Set([...seenTargets, `${modulePath}:${target}`]),
    )
  }
  const typeAliasTarget = aliases?.typeAliases.get(aliasName)
  if (typeAliasTarget !== undefined) {
    return resolveAliasTargetInModule(
      modulePath,
      typeAliasTarget,
      scopes,
      crateRootModulePath,
      new Set([...seenTargets, `${modulePath}:${target}`]),
    )
  }
  return trimmed
}

const modulePathForRelativeImport = (
  modulePath: string,
  importSegments: ReadonlyArray<string>,
  crateRootModulePath: string,
): string => {
  let moduleSegments = modulePath.split("::")
  for (const segment of importSegments) {
    if (segment === "self") continue
    if (segment === "crate") {
      moduleSegments = crateRootModulePath.split("::")
      continue
    }
    if (segment === "super") {
      moduleSegments = moduleSegments.slice(0, Math.max(1, moduleSegments.length - 1))
      continue
    }
    moduleSegments = [...moduleSegments, segment]
  }
  return moduleSegments.join("::")
}

const importAliasesFromUseDeclaration = (text: string): ReadonlyArray<readonly [string, string]> => {
  const match = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([\s\S]*?)\s*;?\s*$/.exec(text)
  if (match === null) return []
  return importAliasesFromUseTree(match[1]!)
}

const importAliasesFromUseTree = (
  text: string,
  prefix = "",
): ReadonlyArray<readonly [string, string]> => {
  const trimmed = text.trim()
  const grouped = splitUseTreeGroup(trimmed)
  if (grouped !== undefined) {
    const groupedPrefix = joinUsePath(prefix, grouped.prefix)
    return splitTopLevelCommas(grouped.body).flatMap((item) => importAliasesFromUseTree(item, groupedPrefix))
  }

  const renamed = /^([A-Za-z_][A-Za-z0-9_:]*|self|super|crate)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/.exec(trimmed)
  if (renamed === null) return []
  const importedPath = joinUsePath(prefix, renamed[1]!)
  const importedName = importedPath.split("::").at(-1)
  if (importedName === undefined || importedName === "self" || importedName === "*") return []
  return [[renamed[2] ?? importedName, importedPath]]
}

const splitUseTreeGroup = (text: string): { readonly prefix: string, readonly body: string } | undefined => {
  for (let index = 0; index < text.length - 2; index += 1) {
    if (text[index] !== ":" || text[index + 1] !== ":" || text[index + 2] !== "{") continue
    const prefix = text.slice(0, index).trim()
    const bodyStart = index + 3
    let depth = 1
    for (let cursor = bodyStart; cursor < text.length; cursor += 1) {
      const char = text[cursor]
      if (char === "{") depth += 1
      if (char === "}") depth -= 1
      if (depth === 0 && text.slice(cursor + 1).trim() === "") {
        return { prefix, body: text.slice(bodyStart, cursor) }
      }
    }
  }
  return undefined
}

const joinUsePath = (prefix: string, path: string): string =>
  prefix.length === 0 ? path : `${prefix}::${path}`

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

  const genericReturn = /^((?:(?:[A-Za-z_][A-Za-z0-9_]*|self|super|crate)::)*[A-Za-z_][A-Za-z0-9_]*)<([\s\S]+)>$/.exec(trimmed)
  if (genericReturn !== null) {
    const outerType = resolveImportedTypeName(genericReturn[1]!, aliases.importAliases)
    const outerTypeNormalized = outerType.replace(/\s+/g, "")
    const genericArguments = splitTopLevelCommas(genericReturn[2] ?? "")
    if (outerTypeNormalized === "anyhow::Result") {
      const explicitErrorType = genericArguments[1]?.trim()
      return explicitErrorType === undefined ? "anyhow::Error" : resolveErrorAlias(explicitErrorType, aliases, seenAliases)
    }
    if (outerTypeNormalized === "eyre::Result") {
      const explicitErrorType = genericArguments[1]?.trim()
      return explicitErrorType === undefined ? "eyre::Report" : resolveErrorAlias(explicitErrorType, aliases, seenAliases)
    }
    if (/(^|::)Result$/.test(outerType)) {
      const errorType = genericArguments[1]?.trim()
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
