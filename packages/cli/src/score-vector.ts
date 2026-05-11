import {
  type Category,
  type PulsarVector,
  type Registry,
} from "@skastr0/pulsar-core"

export const narrowVectorToCategory = (
  registry: Registry,
  vector: PulsarVector | undefined,
  category: Category,
  fallbackDomain: string,
): PulsarVector => {
  const activeSignalIds = collectCategorySignalClosure(registry, category, vector, fallbackDomain)
  const signal_overrides: Record<string, PulsarVector["signal_overrides"][string]> = {
    ...(vector?.signal_overrides ?? {}),
  }

  for (const signal of registry.sorted) {
    if (activeSignalIds.has(signal.id)) continue
    signal_overrides[signal.id] = {
      ...(signal_overrides[signal.id] ?? {}),
      active: false,
    }
  }

  return {
    id: vector?.id ?? `category-${category}`,
    domain: vector?.domain ?? fallbackDomain,
    ...(vector?.description !== undefined ? { description: vector.description } : {}),
    signal_overrides,
    ...(vector?.review_routing !== undefined ? { review_routing: vector.review_routing } : {}),
    ...(vector?.observer !== undefined ? { observer: vector.observer } : {}),
    ...(vector?.backpressure !== undefined ? { backpressure: vector.backpressure } : {}),
    ...(vector?.provenance !== undefined ? { provenance: vector.provenance } : {}),
    ...(vector?.modes !== undefined ? { modes: vector.modes } : {}),
  }
}

export const narrowVectorToDomain = (
  registry: Registry,
  vector: PulsarVector | undefined,
  fallbackDomain: string,
): PulsarVector => {
  const domain = vector?.domain ?? fallbackDomain
  const signal_overrides: Record<string, PulsarVector["signal_overrides"][string]> = {
    ...(vector?.signal_overrides ?? {}),
  }

  for (const signal of registry.sorted) {
    if (signalMatchesDomain(signal.id, domain)) continue
    signal_overrides[signal.id] = {
      ...(signal_overrides[signal.id] ?? {}),
      active: false,
    }
  }

  return {
    id: vector?.id ?? "all-defaults",
    domain,
    ...(vector?.description !== undefined ? { description: vector.description } : {}),
    signal_overrides,
    ...(vector?.review_routing !== undefined ? { review_routing: vector.review_routing } : {}),
    ...(vector?.observer !== undefined ? { observer: vector.observer } : {}),
    ...(vector?.backpressure !== undefined ? { backpressure: vector.backpressure } : {}),
    ...(vector?.provenance !== undefined ? { provenance: vector.provenance } : {}),
    ...(vector?.modes !== undefined ? { modes: vector.modes } : {}),
  }
}

export const inferFallbackDomain = (registry: Registry): "typescript" | "rust" | "polyglot" => {
  const hasTypeScript = registry.sorted.some((signal) => signal.id.startsWith("TS-"))
  const hasRust = registry.sorted.some((signal) => signal.id.startsWith("RS-"))
  if (hasTypeScript && hasRust) return "polyglot"
  if (hasRust) return "rust"
  return "typescript"
}

const collectCategorySignalClosure = (
  registry: Registry,
  category: Category,
  vector: PulsarVector | undefined,
  fallbackDomain: string,
): ReadonlySet<string> => {
  const activeSignalIds = new Set<string>()
  const domain = vector?.domain ?? fallbackDomain

  const visit = (signalId: string): void => {
    if (activeSignalIds.has(signalId)) return
    const signal = registry.byId.get(signalId)
    if (signal === undefined) return
    if (!signalMatchesDomain(signal.id, domain)) return
    activeSignalIds.add(signalId)
    for (const input of signal.inputs) {
      visit(input.id)
    }
  }

  for (const signal of registry.sorted) {
    if (!signalMatchesDomain(signal.id, domain)) continue
    if (signal.category === category) {
      visit(signal.id)
    }
  }

  return activeSignalIds
}

const signalMatchesDomain = (signalId: string, domain: string | undefined): boolean => {
  if (domain === "typescript" && signalId.startsWith("RS-")) return false
  if (domain === "rust" && signalId.startsWith("TS-")) return false
  return true
}
