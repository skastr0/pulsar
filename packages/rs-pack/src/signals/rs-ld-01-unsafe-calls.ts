import { type RustProject } from "../project.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import type { RustFunctionFact } from "../rust-analysis-types.js"
import {
  firstNamedChild,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { type CalleeRef, type FunctionCallFacts, functionKey } from "./rs-ld-01-unsafe-model.js"

export const collectFunctionCallFacts = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlyArray<FunctionCallFacts>> => {
  const facts: Array<FunctionCallFacts> = []
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      facts.push({
        key: functionKey(modulePath, name),
        module: modulePath,
        name,
        callees: collectCalledFunctionRefs(node),
      })
    })
  }
  return facts
}

export const unsafePropagatingFunctionKeys = (
  functions: ReadonlyArray<RustFunctionFact>,
  callFacts: ReadonlyArray<FunctionCallFacts>,
): ReadonlySet<string> => {
  const knownKeys = new Set(callFacts.map((fn) => fn.key))
  const keysByName = new Map<string, Array<string>>()
  for (const fn of callFacts) {
    keysByName.set(fn.name, [...(keysByName.get(fn.name) ?? []), fn.key])
  }

  const propagating = new Set(
    functions
      .filter((fn) => fn.isUnsafeFn || fn.unsafeBlockCount > 0)
      .map((fn) => functionKey(fn.modulePath, fn.name))
      .filter((key) => knownKeys.has(key)),
  )

  let changed = true
  while (changed) {
    changed = false
    for (const fn of callFacts) {
      if (propagating.has(fn.key)) continue
      const callees = fn.callees.flatMap((callee) =>
        resolveCalleeKeys(fn.module, callee, knownKeys, keysByName),
      )
      if (callees.some((key) => propagating.has(key))) {
        propagating.add(fn.key)
        changed = true
      }
    }
  }
  return propagating
}

const resolveCalleeKeys = (
  callerModule: string,
  callee: CalleeRef,
  knownKeys: ReadonlySet<string>,
  keysByName: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  const qualifiedKey = resolveQualifiedCalleeKey(callerModule, callee.pathSegments)
  if (qualifiedKey !== undefined) {
    return knownKeys.has(qualifiedKey) ? [qualifiedKey] : []
  }
  const localKey = functionKey(callerModule, callee.name)
  if (knownKeys.has(localKey)) return [localKey]
  const candidates = keysByName.get(callee.name) ?? []
  return candidates.length === 1 ? candidates : []
}

const resolveQualifiedCalleeKey = (
  callerModule: string,
  pathSegments: ReadonlyArray<string>,
): string | undefined => {
  if (pathSegments.length <= 1) return undefined
  const moduleSegments = callerModule.split("::")
  const crateRoot = moduleSegments.slice(0, 2)
  let base = [...moduleSegments]
  let index = 0

  if (pathSegments[0] === "crate") {
    base = crateRoot
    index = 1
  } else if (pathSegments[0] === "self") {
    index = 1
  } else {
    while (pathSegments[index] === "super") {
      if (base.length > crateRoot.length) base = base.slice(0, -1)
      index += 1
    }
  }

  const calleeName = pathSegments[pathSegments.length - 1]
  const relativeModuleSegments = pathSegments.slice(index, -1)
  if (calleeName === undefined) return undefined
  return [...base, ...relativeModuleSegments, calleeName].join("::")
}

const collectCalledFunctionRefs = (node: RustSyntaxNode): ReadonlyArray<CalleeRef> => {
  const refs = new Map<string, CalleeRef>()
  const walk = (current: RustSyntaxNode): void => {
    if (current.type === "call_expression") {
      const callee = namedChildrenOf(current)[0]
      const ref = calleeRef(callee)
      if (ref !== undefined) refs.set(ref.pathSegments.join("::"), ref)
    }
    for (const child of namedChildrenOf(current)) walk(child)
  }
  walk(node)
  return [...refs.values()].sort((left, right) =>
    left.pathSegments.join("::").localeCompare(right.pathSegments.join("::")),
  )
}

const calleeRef = (node: RustSyntaxNode | undefined): CalleeRef | undefined => {
  if (node === undefined) return undefined
  if (node.type === "identifier") return { name: node.text, pathSegments: [node.text] }
  if (node.type === "generic_function") return calleeRef(namedChildrenOf(node)[0])
  if (node.type === "scoped_identifier") {
    const pathSegments = scopedIdentifierSegments(node)
    const name = pathSegments[pathSegments.length - 1]
    return name === undefined ? undefined : { name, pathSegments }
  }
  return undefined
}

const scopedIdentifierSegments = (node: RustSyntaxNode): ReadonlyArray<string> =>
  namedChildrenOf(node).flatMap((child) => {
    if (child.type === "identifier" || child.type === "super" || child.type === "crate" || child.type === "self") {
      return [child.text]
    }
    if (child.type === "scoped_identifier") return scopedIdentifierSegments(child)
    return []
  })

