import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
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
import { isExcluded } from "./shared-globs.js"

export const RsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_chain_depth: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type RsAb02Config = typeof RsAb02Config.Type

export interface TraitObjectChainEntry {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly returnType: string
  readonly chainDepth: number
  readonly calleeNames: ReadonlyArray<string>
}

export interface RsAb02Output {
  readonly functions: ReadonlyArray<TraitObjectChainEntry>
  readonly overThreshold: ReadonlyArray<TraitObjectChainEntry>
  readonly analysisMode: "local-dyn-return-call-graph"
}

export const RsAb02: Signal<RsAb02Config, RsAb02Output, RustProjectTag> = {
  id: "RS-AB-02",
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: RsAb02Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_chain_depth: 1,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb02Output> => {
          const dynFns = new Map<
            string,
            {
              file: string
              module: string
              name: string
              line: number
              returnType: string
              calleeNames: ReadonlyArray<string>
            }
          >()
          const fnKeysByName = new Map<string, Array<string>>()

          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || node.type !== "function_item") return
              const name = firstNamedChild(node, "identifier")?.text
              const returnType = detectReturnType(node)
              if (name === undefined || returnType === undefined || !returnType.includes("dyn ")) return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              const key = `${modulePath}::${name}`
              dynFns.set(key, {
                file,
                module: modulePath,
                name,
                line: node.startPosition.row + 1,
                returnType,
                calleeNames: collectCalledFunctionNames(node),
              })
              const bucket = fnKeysByName.get(name) ?? []
              bucket.push(key)
              fnKeysByName.set(name, bucket)
            })
          }

          const memo = new Map<string, number>()
          const entries = [...dynFns.entries()]
            .map(([key, fn]) => ({
              file: fn.file,
              module: fn.module,
              name: fn.name,
              line: fn.line,
              returnType: fn.returnType,
              chainDepth: measureChainDepth(key, dynFns, fnKeysByName, memo, new Set()),
              calleeNames: fn.calleeNames,
            }))
            .sort((left, right) => right.chainDepth - left.chainDepth || left.file.localeCompare(right.file))

          return {
            functions: entries,
            overThreshold: entries.filter((entry) => entry.chainDepth > config.max_chain_depth),
            analysisMode: "local-dyn-return-call-graph",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.functions.length === 0) return 1
    return Math.max(0, 1 - out.overThreshold.length / out.functions.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, 10).map((entry) => ({
      severity: "warn" as const,
      message: `Trait-object chain depth ${entry.chainDepth} in ${entry.name}`,
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        name: entry.name,
        returnType: entry.returnType,
        calleeNames: entry.calleeNames,
        analysisMode: out.analysisMode,
      },
    })),
}

const detectReturnType = (node: ReturnType<typeof namedChildrenOf>[number]): string | undefined => {
  const children = namedChildrenOf(node)
  const parametersIndex = children.findIndex((child) => child.type === "parameters")
  if (parametersIndex === -1) return undefined
  return children
    .slice(parametersIndex + 1)
    .find((child) => child.type !== "where_clause" && child.type !== "block")?.text
}

const collectCalledFunctionNames = (node: ReturnType<typeof namedChildrenOf>[number]): ReadonlyArray<string> => {
  const names = new Set<string>()
  const walk = (current: ReturnType<typeof namedChildrenOf>[number]): void => {
    if (current.type === "call_expression") {
      const callee = namedChildrenOf(current)[0]
      const name = callee === undefined ? undefined : callName(callee)
      if (name !== undefined) names.add(name)
    }
    for (const child of namedChildrenOf(current)) {
      walk(child)
    }
  }
  walk(node)
  return [...names]
}

const callName = (node: ReturnType<typeof namedChildrenOf>[number]): string | undefined => {
  switch (node.type) {
    case "identifier":
      return node.text
    case "scoped_identifier":
      return node.text.split("::").at(-1)
    default:
      return undefined
  }
}

const measureChainDepth = (
  key: string,
  dynFns: ReadonlyMap<string, { readonly calleeNames: ReadonlyArray<string>; readonly module: string }>,
  fnKeysByName: ReadonlyMap<string, ReadonlyArray<string>>,
  memo: Map<string, number>,
  active: Set<string>,
): number => {
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  if (active.has(key)) return 1
  active.add(key)
  const current = dynFns.get(key)
  if (current === undefined) return 1

  let maxDepth = 1
  for (const calleeName of current.calleeNames) {
    const sameModuleKey = `${current.module}::${calleeName}`
    const candidateKeys = dynFns.has(sameModuleKey)
      ? [sameModuleKey]
      : (fnKeysByName.get(calleeName) ?? []).length === 1
        ? [fnKeysByName.get(calleeName)![0]!]
        : []
    for (const candidateKey of candidateKeys) {
      maxDepth = Math.max(
        maxDepth,
        1 + measureChainDepth(candidateKey, dynFns, fnKeysByName, memo, active),
      )
    }
  }

  active.delete(key)
  memo.set(key, maxDepth)
  return maxDepth
}
