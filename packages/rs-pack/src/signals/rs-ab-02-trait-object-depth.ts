import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
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

const RsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_chain_depth: Schema.Number,
  min_function_evidence: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsAb02Config = typeof RsAb02Config.Type

type TraitOrigin = "local" | "external"

interface TraitObjectChainEntry {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly returnType: string
  readonly chainDepth: number
  readonly calleeNames: ReadonlyArray<string>
  readonly dynTraits: ReadonlyArray<string>
  readonly traitOrigin: TraitOrigin
}

interface CalledFunctionRef {
  readonly displayName: string
  readonly segments: ReadonlyArray<string>
  readonly resolution: "unqualified" | "scoped-path" | "self-method"
}

interface RsAb02Output {
  readonly functions: ReadonlyArray<TraitObjectChainEntry>
  readonly overThreshold: ReadonlyArray<TraitObjectChainEntry>
  readonly warnGrade: ReadonlyArray<TraitObjectChainEntry>
  readonly inventory: ReadonlyArray<TraitObjectChainEntry>
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly maxChainDepth: number
  readonly minFunctionEvidence: number
  readonly evidenceFactor: number
  readonly diagnosticLimit: number
  readonly analysisMode: "local-dyn-return-call-graph"
}

const DEFAULT_MAX_CHAIN_DEPTH = 1
const DEFAULT_MIN_FUNCTION_EVIDENCE = 5
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RS_AB_02_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_chain_depth",
    title: "Config max chain depth",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_CHAIN_DEPTH,
  },
  {
    path: "config.min_function_evidence",
    title: "Config min function evidence",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MIN_FUNCTION_EVIDENCE,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAb02: Signal<RsAb02Config, RsAb02Output, RustProjectTag> = {
  id: "RS-AB-02-trait-object-depth",
  title: "Trait object depth",
  aliases: ["RS-AB-02"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "trait-object-depth-config-applicability-diagnostics-scoped-calls-cfg-test-gating-cycles-external-inventory-evidence-floor-v5",
  configSchema: RsAb02Config,
  factorDefinitions: RS_AB_02_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_chain_depth: DEFAULT_MAX_CHAIN_DEPTH,
    min_function_evidence: DEFAULT_MIN_FUNCTION_EVIDENCE,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAb02Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb02Output> => {
          const dynFns = new Map<
            string,
            {
              file: string
              module: string
              ownerPath: string
              name: string
              line: number
              returnType: string
              calleeRefs: ReadonlyArray<CalledFunctionRef>
            }
          >()
          const fnKeysByName = new Map<string, Array<string>>()
          const workspaceTraitNames = new Set<string>()
          const workspaceCrateNames = collectWorkspaceCrateNames(project.manifests)

          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )

          for (const file of analyzedSourceFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated) return
              if (node.type === "trait_item") {
                const traitName = firstNamedChild(node, "type_identifier")?.text
                if (traitName !== undefined) workspaceTraitNames.add(traitName)
                return
              }
              if (node.type !== "function_item") return
              const name = firstNamedChild(node, "identifier")?.text
              const returnType = detectReturnType(node)
              if (name === undefined || returnType === undefined || !returnType.includes("dyn ")) return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              const ownerPath = ownerPathForFunction(modulePath, ancestors)
              const key = `${ownerPath}::${name}`
              dynFns.set(key, {
                file,
                module: modulePath,
                ownerPath,
                name,
                line: node.startPosition.row + 1,
                returnType,
                calleeRefs: collectCalledFunctionRefs(node),
              })
              const bucket = fnKeysByName.get(name) ?? []
              bucket.push(key)
              fnKeysByName.set(name, bucket)
            })
          }

          const memo = new Map<string, number>()
          const entries = [...dynFns.entries()]
            .map(([key, fn]) => {
              const dynTraits = extractDynTraitRefs(fn.returnType)
              return {
                file: fn.file,
                module: fn.module,
                name: fn.name,
                line: fn.line,
                returnType: fn.returnType,
                chainDepth: measureChainDepth(key, dynFns, fnKeysByName, memo, new Set()),
                calleeNames: fn.calleeRefs.map((ref) => ref.displayName),
                dynTraits,
                traitOrigin: classifyTraitOrigin(dynTraits, workspaceTraitNames, workspaceCrateNames),
              }
            })
            .sort((left, right) => right.chainDepth - left.chainDepth || left.file.localeCompare(right.file))

          const maxChainDepth = normalizedConfig.max_chain_depth
          const overThreshold = entries.filter((entry) => entry.chainDepth > maxChainDepth)
          // A repository cannot change an upstream API's trait-object type:
          // a single passthrough layer (threshold + 1) wrapping an external
          // trait is inventory-grade evidence, not warn-grade pressure.
          const inventory = overThreshold.filter(
            (entry) => entry.traitOrigin === "external" && entry.chainDepth <= maxChainDepth + 1,
          )
          const warnGrade = overThreshold.filter(
            (entry) => !(entry.traitOrigin === "external" && entry.chainDepth <= maxChainDepth + 1),
          )

          return {
            functions: entries,
            overThreshold,
            warnGrade,
            inventory,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            maxChainDepth,
            minFunctionEvidence: normalizedConfig.min_function_evidence,
            evidenceFactor: entries.length === 0
              ? 1
              : Math.min(1, entries.length / normalizedConfig.min_function_evidence),
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "local-dyn-return-call-graph",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-02-trait-object-depth", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    // score = 1 - (warnGradeCount / functionCount) * evidenceFactor
    // Inventory entries (external-trait passthrough at threshold + 1) carry
    // zero penalty; the evidence factor scales pressure down when the
    // dyn-returning function population is below the evidence floor.
    if (out.functions.length === 0) return 1
    return Math.max(0, 1 - (out.warnGrade.length / out.functions.length) * out.evidenceFactor)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-AB-02 found no Rust source files for trait-object depth analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          functionCount: out.functions.length,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    const warnDiagnostics = out.warnGrade.map((entry) => ({
      severity: "warn" as const,
      message: `Trait-object chain depth ${entry.chainDepth} in ${entry.name}`,
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        name: entry.name,
        returnType: entry.returnType,
        calleeNames: entry.calleeNames,
        dynTraits: entry.dynTraits,
        traitOrigin: entry.traitOrigin,
        chainDepth: entry.chainDepth,
        maxChainDepth: out.maxChainDepth,
        scoreBearing: true,
        functionCount: out.functions.length,
        warnGradeCount: out.warnGrade.length,
        evidenceFactor: out.evidenceFactor,
        analysisMode: out.analysisMode,
      },
    }))
    const inventoryDiagnostics = out.inventory.map((entry) => ({
      severity: "info" as const,
      message:
        `Trait-object chain depth ${entry.chainDepth} in ${entry.name} passes through ` +
        `external trait ${entry.dynTraits.join(" + ") || "<unknown>"} (inventory, not score-bearing)`,
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        name: entry.name,
        returnType: entry.returnType,
        calleeNames: entry.calleeNames,
        dynTraits: entry.dynTraits,
        traitOrigin: entry.traitOrigin,
        chainDepth: entry.chainDepth,
        maxChainDepth: out.maxChainDepth,
        scoreBearing: false,
        analysisMode: out.analysisMode,
      },
    }))
    const limited: Array<Diagnostic> = [...warnDiagnostics, ...inventoryDiagnostics]
      .slice(0, out.diagnosticLimit)
    // The evidence-floor explanation must survive the top_n cut: it explains
    // why pressure was reduced, which matters most exactly when finding
    // diagnostics fill the limit.
    if (
      out.diagnosticLimit > 0 &&
      out.warnGrade.length > 0 &&
      out.functions.length < out.minFunctionEvidence
    ) {
      limited.push({
        severity: "info" as const,
        message:
          `Trait-object chains are measured from only ${out.functions.length} dyn-returning ` +
          `function(s), below the ${out.minFunctionEvidence}-function evidence floor; ` +
          `chain-depth pressure is scaled by ${out.evidenceFactor}`,
        data: {
          functionCount: out.functions.length,
          minFunctionEvidence: out.minFunctionEvidence,
          evidenceFactor: out.evidenceFactor,
          warnGradeCount: out.warnGrade.length,
        },
      })
    }
    return limited
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: out.functions.length,
    }),
  factorLedger: () => makeRsAb02FactorLedger(),
}

type NormalizedRsAb02Config = RsAb02Config

const normalizeRsAb02Config = (config: RsAb02Config): NormalizedRsAb02Config => ({
  exclude_globs: config.exclude_globs,
  max_chain_depth: Number.isFinite(config.max_chain_depth)
    ? Math.max(0, Math.floor(config.max_chain_depth))
    : DEFAULT_MAX_CHAIN_DEPTH,
  min_function_evidence: Number.isFinite(config.min_function_evidence)
    ? Math.max(1, Math.floor(config.min_function_evidence))
    : DEFAULT_MIN_FUNCTION_EVIDENCE,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const collectWorkspaceCrateNames = (
  manifests: ReadonlyArray<{ readonly name: string; readonly packageName: string | undefined }>,
): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const manifest of manifests) {
    for (const name of [manifest.name, manifest.packageName]) {
      if (name === undefined || name.length === 0) continue
      names.add(name)
      names.add(name.replace(/-/g, "_"))
    }
  }
  return names
}

const DYN_TRAIT_REF_PATTERN =
  /(?:^|[^A-Za-z0-9_])dyn\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_]*)*)/g

const extractDynTraitRefs = (returnType: string): ReadonlyArray<string> => {
  const refs = new Set<string>()
  for (const match of returnType.matchAll(DYN_TRAIT_REF_PATTERN)) {
    const path = match[1]?.replace(/\s+/g, "")
    if (path !== undefined && path.length > 0) refs.add(path)
  }
  return [...refs]
}

const classifyTraitOrigin = (
  dynTraits: ReadonlyArray<string>,
  workspaceTraitNames: ReadonlySet<string>,
  workspaceCrateNames: ReadonlySet<string>,
): TraitOrigin => {
  // Unresolvable dyn references stay "local" so the prior warn behavior is
  // preserved; only positively-external trait objects are downgraded.
  if (dynTraits.length === 0) return "local"
  const isLocalRef = (path: string): boolean => {
    const segments = path.split("::")
    const head = segments[0]
    if (head === undefined) return false
    if (segments.length === 1) return workspaceTraitNames.has(head)
    if (head === "crate" || head === "self" || head === "super") return true
    return workspaceCrateNames.has(head)
  }
  return dynTraits.some(isLocalRef) ? "local" : "external"
}

const makeRsAb02FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AB-02-trait-object-depth", RS_AB_02_FACTOR_DEFINITIONS)

const detectReturnType = (node: ReturnType<typeof namedChildrenOf>[number]): string | undefined => {
  const children = namedChildrenOf(node)
  const parametersIndex = children.findIndex((child) => child.type === "parameters")
  if (parametersIndex === -1) return undefined
  return children
    .slice(parametersIndex + 1)
    .find((child) => child.type !== "where_clause" && child.type !== "block")?.text
}

const collectCalledFunctionRefs = (node: ReturnType<typeof namedChildrenOf>[number]): ReadonlyArray<CalledFunctionRef> => {
  const refs = new Map<string, CalledFunctionRef>()
  const walk = (current: ReturnType<typeof namedChildrenOf>[number]): void => {
    if (current.type === "call_expression") {
      const callee = namedChildrenOf(current)[0]
      const ref = callee === undefined ? undefined : callRef(callee)
      if (ref !== undefined) refs.set(ref.displayName, ref)
    }
    for (const child of namedChildrenOf(current)) {
      walk(child)
    }
  }
  walk(node)
  return [...refs.values()]
}

const callRef = (node: ReturnType<typeof namedChildrenOf>[number]): CalledFunctionRef | undefined => {
  switch (node.type) {
    case "identifier":
      return { displayName: node.text, segments: [node.text], resolution: "unqualified" }
    case "scoped_identifier": {
      const segments = node.text.split("::").filter((segment) => segment.length > 0)
      if (segments.length === 0) return undefined
      return { displayName: segments.join("::"), segments, resolution: "scoped-path" }
    }
    case "generic_function": {
      const callable = namedChildrenOf(node)[0]
      return callable === undefined ? undefined : callRef(callable)
    }
    case "field_expression": {
      const children = namedChildrenOf(node)
      const receiver = children[0]
      const method = children.find((child) => child.type === "field_identifier")
      if (receiver?.text !== "self" || method === undefined) return undefined
      return { displayName: `self.${method.text}`, segments: [method.text], resolution: "self-method" }
    }
    default:
      return undefined
  }
}

const measureChainDepth = (
  key: string,
  dynFns: ReadonlyMap<string, {
    readonly calleeRefs: ReadonlyArray<CalledFunctionRef>
    readonly module: string
    readonly ownerPath: string
  }>,
  fnKeysByName: ReadonlyMap<string, ReadonlyArray<string>>,
  memo: Map<string, number>,
  active: Set<string>,
): number => {
  if (active.has(key)) return 0
  const shouldMemo = active.size === 0
  const cached = shouldMemo ? memo.get(key) : undefined
  if (cached !== undefined) return cached
  active.add(key)
  const current = dynFns.get(key)
  if (current === undefined) {
    active.delete(key)
    return 1
  }

  let maxDepth = 1
  for (const calleeRef of current.calleeRefs) {
    const candidateKeys = candidateFunctionKeys(calleeRef, current.module, current.ownerPath, dynFns, fnKeysByName)
    for (const candidateKey of candidateKeys) {
      maxDepth = Math.max(
        maxDepth,
        1 + measureChainDepth(candidateKey, dynFns, fnKeysByName, memo, active),
      )
    }
  }

  active.delete(key)
  if (shouldMemo) memo.set(key, maxDepth)
  return maxDepth
}

const candidateFunctionKeys = (
  calleeRef: CalledFunctionRef,
  currentModule: string,
  currentOwnerPath: string,
  dynFns: ReadonlyMap<string, unknown>,
  fnKeysByName: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  if (calleeRef.resolution === "self-method") {
    const methodName = calleeRef.segments[0]
    if (methodName === undefined) return []
    const sameOwnerKey = `${currentOwnerPath}::${methodName}`
    return dynFns.has(sameOwnerKey) ? [sameOwnerKey] : []
  }

  if (calleeRef.resolution === "scoped-path") {
    const scopedKey = resolveScopedFunctionKey(currentModule, calleeRef.segments)
    return scopedKey !== undefined && dynFns.has(scopedKey) ? [scopedKey] : []
  }

  const calleeName = calleeRef.segments[0]
  if (calleeName === undefined) return []
  const sameOwnerKey = `${currentOwnerPath}::${calleeName}`
  if (dynFns.has(sameOwnerKey)) return [sameOwnerKey]
  const sameModuleKey = `${currentModule}::${calleeName}`
  if (dynFns.has(sameModuleKey)) return [sameModuleKey]
  const sameNameKeys = fnKeysByName.get(calleeName) ?? []
  return sameNameKeys.length === 1 ? [sameNameKeys[0]!] : []
}

const resolveScopedFunctionKey = (
  currentModule: string,
  segments: ReadonlyArray<string>,
): string | undefined => {
  const currentSegments = currentModule.split("::")
  if (currentSegments.length < 2) return undefined
  let base = currentSegments
  let rest = [...segments]

  while (rest[0] === "super") {
    if (base.length > 2) base = base.slice(0, -1)
    rest = rest.slice(1)
  }

  if (rest[0] === "crate") {
    base = currentSegments.slice(0, 2)
    rest = rest.slice(1)
  } else if (rest[0] === "self") {
    rest = rest.slice(1)
  }

  if (rest.length === 0) return undefined
  return [...base, ...rest].join("::")
}

const ownerPathForFunction = (
  modulePath: string,
  ancestors: ReadonlyArray<ReturnType<typeof namedChildrenOf>[number]>,
): string => {
  const implAncestor = nearestAncestor(ancestors, "impl_item")
  if (implAncestor === undefined) return modulePath
  return `${modulePath}::${implOwnerName(implAncestor)}`
}

const nearestAncestor = (
  ancestors: ReadonlyArray<ReturnType<typeof namedChildrenOf>[number]>,
  type: string,
): ReturnType<typeof namedChildrenOf>[number] | undefined => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (ancestor?.type === type) return ancestor
  }
  return undefined
}

const implOwnerName = (node: ReturnType<typeof namedChildrenOf>[number]): string => {
  const parts = namedChildrenOf(node)
    .filter((child) =>
      child.type !== "type_parameters" &&
      child.type !== "where_clause" &&
      child.type !== "declaration_list"
    )
    .map((child) => child.text)
  return `impl ${parts.join(" for ") || "<unknown>"}`
}
