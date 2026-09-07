import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { PulsarVector, isActive, resolvedConfig, signalOverrideOf, weightOf } from "@skastr0/pulsar-core/vector"
import type { SignalFactorDefinition } from "@skastr0/pulsar-core/signal"
import type { Registry } from "@skastr0/pulsar-core/scoring"
import { decodeProjectModuleManifest } from "@skastr0/pulsar-project-module-sdk"
import { Effect, Schema, SchemaIssue } from "effect"
import { AgentCommandError, type AgentPolicyOptions, type AgentStaticPolicy } from "./agent-contract.js"
import { buildPulsarRegistry } from "./runtime-registry.js"
import { resolveRepoRoot } from "./runtime-git.js"
import type { DiscoveredPulsarVector } from "./vector-discovery.js"

const strict = { onExcessProperty: "error", errors: "all" } as const
type ResolvedSignal = Registry["sorted"][number]
const invalid = (path: string, message: string) => new AgentCommandError(
  "INVALID_CONFIG", `Invalid policy at ${path}: ${message}`, [{ path, message }],
  ["Inspect pulsar agent catalog --signal <id>, then correct the repository vector and validate again."],
)

const invalidSchema = (path: string, error: Schema.SchemaError) => new AgentCommandError(
  "INVALID_CONFIG", `Invalid policy at ${path}: ${error.message}`,
  SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => ({
    path: [path, ...(issue.path ?? []).map((part) => String(typeof part === "object" ? part.key : part))].join("."),
    message: issue.message,
  })),
  ["Inspect pulsar agent catalog --signal <id>, then correct the repository vector and validate again."],
)

export const decodeAgentValue = <A>(schema: Schema.Schema<A>, raw: unknown, path: string) => {
  // Installed signal schemas are synchronous JSON codecs; Signal erases that direction.
  const result = Schema.decodeUnknownResult(schema as Schema.Codec<A>, strict)(raw)
  return result._tag === "Failure"
    ? Effect.fail(invalidSchema(path, result.failure))
    : Effect.succeed(result.success)
}

const readJson = (path: string) => Effect.tryPromise({
  try: async (): Promise<unknown> => JSON.parse(await readFile(path, "utf8")),
  catch: (cause) => invalid(path, String(cause)),
})

/** Only these non-config factors are consumed as controls, not merely ledger entries.
 * Receipts: ts-sl-04-empty-implementations.ts applyVectorOverridesToStubPolicy / resolveCleanBudget.
 */
export const agentFactorCapability = (signal: ResolvedSignal, factor: SignalFactorDefinition) => {
  const config = factor.path.startsWith("config.")
  const stubControl = signal.aliases?.includes("TS-SL-04") === true &&
    (/^stub_kinds\.(throw-not-implemented|empty-body|todo-comment|mock-return)\.(confidence|penalty_weight|score_cap_participation|score_cap)$/.test(factor.path) ||
      /^budget\.expected_clean_(function_ratio|min_functions)$/.test(factor.path))
  return {
    tunable: config || stubControl,
    consumer: config ? "vector-resolution.resolvedConfig" : stubControl
      ? "ts-sl-04-empty-implementations.applyVectorOverridesToStubPolicy/resolveCleanBudget" : null,
    validation: config ? { configField: factor.path.slice(7) } : stubControl ? Schema.toJsonSchemaDocument(controlSchema(factor)) : null,
    limitation: config || stubControl ? null : "Evidence/ledger metadata is not an executable scoring override; use a typed calibration slot where supported.",
  }
}

const controlSchema = (factor: SignalFactorDefinition): Schema.Schema<unknown> => {
  if (factor.path.endsWith(".confidence")) return Schema.Literals(["high", "medium", "low"])
  if (factor.valueKind === "boolean") return Schema.Boolean
  if (factor.path.endsWith(".score_cap")) return Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  if (factor.path.startsWith("budget.")) return Schema.Finite.check(Schema.isGreaterThan(0))
  return Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
}

export const loadAgentPolicy = Effect.fn("loadAgentPolicy")(function*(options: AgentPolicyOptions): Effect.fn.Return<AgentStaticPolicy, unknown> {
  const repoRoot = yield* resolveRepoRoot(options.repoPath).pipe(Effect.mapError((e) =>
    new AgentCommandError("INVALID_ARGUMENT", e.message, [{ path: "repoPath", message: e.message }], ["Choose an existing Git worktree."])))
  const fullRegistry = yield* buildPulsarRegistry()
  const registry = yield* buildPulsarRegistry(repoRoot)
  const repoVector = join(repoRoot, ".pulsar/vector.json")
  const orgVector = join(homedir(), ".config/pulsar/vector.json")
  const source = options.vectorPath !== undefined ? "explicit" : existsSync(repoVector) ? "worktree" : existsSync(orgVector) ? "organization" : "fallback"
  const path = source === "explicit" ? resolve(options.vectorPath!) : source === "worktree" ? repoVector : source === "organization" ? orgVector : undefined
  let vector = path === undefined ? undefined : yield* decodeAgentValue(PulsarVector, yield* readJson(path), path)
  if (vector !== undefined) {
    const overrides: Record<string, (typeof vector.signal_overrides)[string]> = {}
    for (const [id, override] of Object.entries(vector.signal_overrides)) {
      const signal = fullRegistry.byId.get(id)
      const at = `signal_overrides.${id}`
      if (signal === undefined) return yield* Effect.fail(new AgentCommandError("UNKNOWN_SIGNAL", `Unknown signal ${id}`, [{ path: at, message: "Not installed" }], ["Run pulsar agent catalog to list canonical IDs."]))
      if (Object.hasOwn(overrides, signal.id)) return yield* Effect.fail(invalid(at, `Competing canonical/alias overrides for ${signal.id}`))
      overrides[signal.id] = override
      if (override.weight !== undefined) yield* decodeAgentValue(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2 })), override.weight, `${at}.weight`)
      // Validate the config patch before factors can mask an invalid value.
      yield* decodeAgentValue(signal.configSchema, { ...signal.defaultConfig, ...override.config }, `${at}.config`)
      for (const [factorPath, value] of Object.entries(override.factors ?? {})) {
        const factor = signal.factorDefinitions?.find((f) => f.path === factorPath)
        if (factor === undefined || !agentFactorCapability(signal, factor).tunable) return yield* Effect.fail(invalid(`${at}.factors.${factorPath}`, "Unknown or evidence-only factor; this value does not control scoring"))
        if (!factorPath.startsWith("config.")) yield* decodeAgentValue(controlSchema(factor), value, `${at}.factors.${factorPath}`)
      }
    }
    vector = { ...vector, signal_overrides: overrides }
  }
  const sourceLabel = source === "explicit" ? `explicit --vector (${path})` : source === "worktree" ? "repo-local .pulsar/vector.json" : source === "organization" ? "organization fallback ~/.config/pulsar/vector.json" : "built-in defaults"
  const vectorSelection: DiscoveredPulsarVector = {
    vector, source, path, label: vector?.id ?? "all-defaults", sourceLabel,
    trustBoundary: source === "explicit" ? "explicit-path" : source === "worktree" ? "repo-local" : source === "organization" ? "organization-standard-fallback" : "built-in-defaults",
  }
  const signals = []
  for (const signal of fullRegistry.sorted) {
    const config = yield* decodeAgentValue(signal.configSchema, resolvedConfig(signal, signal.defaultConfig, vector), `signal_overrides.${signal.id}.config (merged)`)
    const override = signalOverrideOf(signal, vector)
    signals.push({
      id: signal.id, detected: registry.has(signal.id), selected: registry.has(signal.id) && isActive(signal, vector),
      active: isActive(signal, vector), weight: weightOf(signal, vector), config,
      sources: {
        active: override?.active === undefined ? "signal-default" : sourceLabel,
        weight: override?.weight === undefined ? "signal-default" : sourceLabel,
        config: Object.fromEntries(Object.keys(config).map((key) => [key,
          Object.hasOwn(override?.factors ?? {}, `config.${key}`) ? `${sourceLabel}:factors.config.${key}` :
            Object.hasOwn(override?.config ?? {}, key) ? `${sourceLabel}:config.${key}` : "signal-default"])),
      },
      factors: (signal.factorDefinitions ?? []).map((factor) => ({ ...factor, ...agentFactorCapability(signal, factor),
        value: override?.factors?.[factor.path] ?? (factor.path.startsWith("config.") ? config[factor.path.slice(7)] : factor.defaultValue) ?? null,
        source: Object.hasOwn(override?.factors ?? {}, factor.path) ? sourceLabel : factor.path.startsWith("config.") && Object.hasOwn(override?.config ?? {}, factor.path.slice(7)) ? sourceLabel : factor.path.startsWith("config.") || factor.defaultValue !== undefined ? "signal-default" : "unresolved-runtime-evidence",
      })),
    })
  }
  const defaultManifest = join(repoRoot, ".pulsar/project-modules.json")
  const manifestSource = options.modulesPath !== undefined ? resolve(options.modulesPath) : existsSync(defaultManifest) ? defaultManifest : undefined
  const manifest = manifestSource === undefined ? undefined : yield* decodeProjectModuleManifest(yield* readJson(manifestSource), strict).pipe(Effect.mapError((e) => invalidSchema(manifestSource, e)))
  const refs = new Set<string>()
  for (const [index, ref] of (manifest?.modules ?? []).entries()) {
    if (refs.has(ref.id)) return yield* Effect.fail(invalid(`modules[${index}].id`, `Duplicate module ref ${ref.id}`))
    refs.add(ref.id)
  }
  const moduleDependencyRoot = options.moduleDependencyRoot === undefined ? undefined : resolve(options.moduleDependencyRoot)
  return {
    repoRoot, registry, vector, vectorSelection, manifest, manifestSource, moduleDependencyRoot,
    explanation: {
      repoRoot, vectorSelection, signals,
      precedence: ["signal defaults", "signal_overrides.<id>.config", "signal_overrides.<id>.factors.config.*"],
      activation: "Pack detection selects the repo registry; active defaults true. An installed undetected override is valid but does not force pack activation.",
      weights: "Finite 0..2; default 1. Weight 0 is not inactive and does not disable diagnostic gates.",
      modules: { source: manifestSource ?? null, refs: manifest?.modules ?? [], repoLocalBase: repoRoot, dependencyRoot: moduleDependencyRoot ?? repoRoot, executed: false,
        resolvedRepoLocalPaths: (manifest?.modules ?? []).filter((ref) => ref.kind === "repo-local").map((ref) => ({ id: ref.id, path: resolve(repoRoot, ref.path) })),
      },
    },
  }
})
