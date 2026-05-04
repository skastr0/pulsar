import type {
  RustAnalysis,
  RustItemFact,
  RustModuleFact,
  RustUseFact,
} from "../rust-analysis.js"

export interface ResolvedRustPath {
  readonly module: RustModuleFact | undefined
  readonly item: RustItemFact | undefined
  readonly key: string | undefined
}

export const resolveCrateRelativePath = (
  crateName: string,
  relativeSegments: ReadonlyArray<string>,
  facts: RustAnalysis,
): ResolvedRustPath | undefined => {
  const cleaned = relativeSegments.filter((segment) => segment.length > 0)
  const wildcardFree = cleaned.at(-1) === "*" ? cleaned.slice(0, -1) : cleaned

  if (wildcardFree.length === 0) {
    const rootKey = `${crateName}::crate`
    return {
      module: facts.modulesByPath.get(rootKey),
      item: undefined,
      key: rootKey,
    }
  }

  for (let moduleLength = wildcardFree.length; moduleLength >= 0; moduleLength -= 1) {
    const moduleParts = wildcardFree.slice(0, moduleLength)
    const moduleKey =
      moduleParts.length === 0
        ? `${crateName}::crate`
        : `${crateName}::crate::${moduleParts.join("::")}`
    const module = facts.modulesByPath.get(moduleKey)
    if (module === undefined) continue

    if (moduleLength === wildcardFree.length) {
      return { module, item: undefined, key: moduleKey }
    }

    const itemName = wildcardFree[moduleLength]
    if (itemName === undefined) {
      return { module, item: undefined, key: moduleKey }
    }

    const itemKey = `${moduleKey}::${itemName}`
    return {
      module,
      item: facts.itemsByModuleAndName.get(itemKey),
      key: itemKey,
    }
  }

  return undefined
}

export const toLocalRelativeSegments = (
  useFact: RustUseFact,
  rootNames: ReadonlySet<string>,
): ReadonlyArray<string> | undefined => {
  const [head, ...rest] = useFact.segments
  if (head === undefined) return undefined
  const current = useFact.relativeModulePath.split("::")
  switch (head) {
    case useFact.crateName:
    case "crate":
      return rest
    case "self":
      return [...current.slice(1), ...rest]
    case "super":
      return [...current.slice(1, -1), ...rest]
    default:
      return rootNames.has(head) ? useFact.segments : undefined
  }
}
