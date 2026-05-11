import type { RustSyntaxNode } from "./syn-walker.js"
import type {
  RustFactCollections,
  RustFunctionFact,
  RustMatchFact,
  RustNodeFactContext,
} from "./rust-analysis-types.js"
import { toModulePath } from "./rust-analysis-modules.js"
import {
  allNamedChildren,
  firstNamedChild,
  itemName,
  parseVisibility,
  walkAny,
  walkNode,
} from "./rust-analysis-syntax.js"

const BRANCHING_NODE_TYPES = new Set([
  "if_expression",
  "for_expression",
  "while_expression",
  "loop_expression",
])

export const recordRustFunctionFact = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
  addIdentifier: (
    identifiers: Array<RustFactCollections["identifiers"][number]>,
    fact: Omit<RustFactCollections["identifiers"][number], "tokens">,
  ) => void,
): void => {
  if (node.type !== "function_item") return
  const name = itemName(node) ?? "<anonymous>"
  collections.functions.push(rustFunctionFactFromNode(node, context, name))
  recordFunctionParameterIdentifiers(node, context, collections, addIdentifier)
  recordFunctionMatchFacts(node, context, name, collections)
}

const rustFunctionFactFromNode = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  name: string,
): RustFunctionFact => {
  const returnType = returnTypeOfFunction(node)
  return {
    ...context,
    name,
    line: node.startPosition.row + 1,
    visibility: parseVisibility(node),
    isUnsafeFn: (firstNamedChild(node, "function_modifiers")?.text ?? "").includes("unsafe"),
    unsafeBlockCount: countUnsafeBlocks(node),
    rawPointerParamCount: countRawPointerParams(node),
    rawPointerReturn: walkAny(returnType ?? node, (current) => current.type === "pointer_type"),
    lifetimeParamCount: allNamedChildren(
      firstNamedChild(node, "type_parameters") ?? node,
      "lifetime_parameter",
    ).length,
    lifetimeBoundCount: lifetimeBoundCountOfFunction(node),
    lifetimeInputCount: lifetimeCountInNode(firstNamedChild(node, "parameters")),
    lifetimeOutputCount: lifetimeCountInNode(returnType),
    lifetimeConstraintCount: lifetimeCountInNode(firstNamedChild(node, "where_clause")),
    returnTypeText: returnType?.text,
    resultErrorType: resultErrorType(returnType),
    complexity: cyclomaticComplexity(node),
  }
}

const returnTypeOfFunction = (node: RustSyntaxNode): RustSyntaxNode | undefined => {
  const namedChildren = node.namedChildren.filter((child): child is RustSyntaxNode => child !== null)
  const parametersIndex = namedChildren.findIndex((child) => child.type === "parameters")
  if (parametersIndex === -1) return undefined
  return namedChildren.slice(parametersIndex + 1).find(
    (child) => child.type !== "where_clause" && child.type !== "block",
  )
}

const lifetimeCountInNode = (node: RustSyntaxNode | undefined): number => {
  if (node === undefined) return 0
  let count = 0
  walkNode(node, (current) => {
    if (current.type === "lifetime") count += 1
  })
  return count
}

const resultErrorType = (returnType: RustSyntaxNode | undefined): string | undefined => {
  if (returnType?.type !== "generic_type") return undefined
  const target = returnType.namedChildren.find((child): child is RustSyntaxNode => child !== null)?.text ?? ""
  if (!target.endsWith("Result")) return undefined
  const typeArguments = firstNamedChild(returnType, "type_arguments")
  const args = typeArguments === undefined
    ? []
    : typeArguments.namedChildren.filter((child): child is RustSyntaxNode => child !== null)
  return args[1]?.text
}

const countUnsafeBlocks = (node: RustSyntaxNode): number => {
  let count = 0
  walkNode(node, (current) => {
    if (current.type === "unsafe_block") count += 1
  })
  return count
}

const countRawPointerParams = (node: RustSyntaxNode): number =>
  allNamedChildren(firstNamedChild(node, "parameters") ?? node, "parameter").filter((parameter) =>
    walkAny(parameter, (current) => current.type === "pointer_type"),
  ).length

const cyclomaticComplexity = (node: RustSyntaxNode): number => {
  let complexity = 1
  walkNode(node, (current) => {
    if (current.id === node.id) return
    if (BRANCHING_NODE_TYPES.has(current.type)) {
      complexity += 1
      return
    }
    if (current.type === "match_arm") {
      complexity += 1
      return
    }
    if (current.type === "binary_expression" && /&&|\|\|/.test(current.text)) {
      complexity += 1
    }
  })
  return complexity
}

const matchFactFromNode = (
  node: RustSyntaxNode,
  crateName: string,
  file: string,
  relativeModulePath: string,
  functionName: string,
): RustMatchFact => {
  const arms = allNamedChildren(firstNamedChild(node, "match_block") ?? node, "match_arm")
  const catchAllArmCount = arms.filter((arm) => {
    const pattern = firstNamedChild(arm, "match_pattern")
    if (pattern === undefined) return false
    const text = pattern.text.trim()
    return text === "_" || text.startsWith("_ if")
  }).length
  return {
    crateName,
    file,
    line: node.startPosition.row + 1,
    relativeModulePath,
    modulePath: toModulePath(crateName, relativeModulePath),
    functionName,
    armCount: arms.length,
    catchAllArmCount,
    hasCatchAll: catchAllArmCount > 0,
  }
}

const lifetimeBoundCountOfFunction = (node: RustSyntaxNode): number =>
  allNamedChildren(firstNamedChild(node, "type_parameters") ?? node, "lifetime_parameter")
    .map((lifetime) => lifetimeCountInNode(firstNamedChild(lifetime, "trait_bounds")))
    .reduce((sum, count) => sum + count, 0) +
  lifetimeCountInNode(firstNamedChild(node, "where_clause"))

const recordFunctionParameterIdentifiers = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  collections: RustFactCollections,
  addIdentifier: Parameters<typeof recordRustFunctionFact>[3],
): void => {
  for (const parameterName of collectParameterIdentifiers(node)) {
    addIdentifier(collections.identifiers, {
      ...context,
      line: node.startPosition.row + 1,
      kind: "parameter",
      name: parameterName,
    })
  }
}

const recordFunctionMatchFacts = (
  node: RustSyntaxNode,
  context: RustNodeFactContext,
  functionName: string,
  collections: RustFactCollections,
): void => {
  walkNode(node, (current) => {
    if (current.type !== "match_expression") return
    collections.matches.push(
      matchFactFromNode(
        current,
        context.crateName,
        context.file,
        context.relativeModulePath,
        functionName,
      ),
    )
  })
}

const collectParameterIdentifiers = (node: RustSyntaxNode): Array<string> =>
  allNamedChildren(firstNamedChild(node, "parameters") ?? node, "parameter")
    .map((parameter) => firstNamedChild(parameter, "identifier")?.text)
    .filter((name): name is string => name !== undefined)
