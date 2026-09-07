import { CALIBRATION_SLOT_IDS, type CalibrationSlotId } from "@skastr0/pulsar-core/calibration"
import { isActive } from "@skastr0/pulsar-core/vector"
import { Effect, Schema } from "effect"
import { AgentCommandError, type AgentCatalogOptions } from "./agent-contract.js"
import { agentFactorCapability, loadAgentPolicy } from "./agent-policy.js"
import { buildPulsarRegistry } from "./runtime-registry.js"
import { resolveRepoRoot } from "./runtime-git.js"

/** Runtime call sites, not a claim that every declared slot has a consumer. */
const consumers: Partial<Record<CalibrationSlotId, string>> = {
  "taxonomy.file-classifier": "packages/core/src/file-taxonomy.ts",
  "typescript.noop-classifier": "packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts",
  "typescript.clone-group-policy": "packages/ts-pack/src/signals/ts-sl-01-duplication.ts",
  "typescript.size-policy": "packages/ts-pack/src/signals/ts-ld-02-thresholds.ts",
  "typescript.nesting-policy": "packages/ts-pack/src/signals/ts-ld-03-nesting-depth.ts",
  "typescript.callback-context-namer": "packages/ts-pack/src/signals/ts-ld-01-calibration.ts",
  "typescript.export-reachability": "packages/ts-pack/src/signals/ts-ab-02-unused-exports-reachability.ts",
  "typescript.unfinished-implementation-policy": "packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts",
  "typescript.unsafe-type-policy": "packages/ts-pack/src/signals/ts-ld-07-analysis.ts",
  "typescript.type-coupling-policy": "packages/ts-pack/src/signals/ts-de-01-type-level-coupling.ts",
  "typescript.dependency-version-policy": "packages/ts-pack/src/signals/ts-de-05-duplicate-versions.ts",
  "typescript.pr-size-policy": "packages/ts-pack/src/signals/ts-rp-02-policy.ts",
  "shared.bus-factor-policy": "packages/core/src/shared-02-bus-factor.ts",
  "shared.churn-rate-policy": "packages/core/src/shared-03-churn-rate.ts",
}

export const agentSlotExample = (slot: CalibrationSlotId): string => slot === "typescript.size-policy" ? `import { Effect } from "effect"
import { defineProcessor, defineProjectModule, tuneTypeScriptSize } from "@skastr0/pulsar-project-module-sdk"

export default defineProjectModule({
  id: "repo.policy", version: "1.0.0", scope: "repository",
  processors: [defineProcessor({
    id: "adapter-file-size", slot: "typescript.size-policy", role: "factor-policy", fingerprint: "adapter-file-size-v1",
    process: (current, _context, runtime) => Effect.succeed(
      current.value.kind === "file" && current.value.file.replaceAll("\\\\", "/").includes("/adapters/")
        ? tuneTypeScriptSize(current, runtime, {
            maxLoc: 600, reason: "Repository-owned adapter file size allowance",
            ruleId: "repo.adapter-file-size", evidence: [{ kind: "path", value: current.value.file }],
          })
        : current
    ),
  })],
})
` : `import { Effect } from "effect"
import { defineProcessor, defineProjectModule, appendProjectModuleDecision } from "@skastr0/pulsar-project-module-sdk"

export default defineProjectModule({
  id: "repo.policy", version: "1.0.0", scope: "repository",
  processors: [defineProcessor({
    id: "repo-rule", slot: ${JSON.stringify(slot)}, role: "enricher", fingerprint: "repo-rule-v1",
    process: (current, _context, runtime) => Effect.succeed(
      appendProjectModuleDecision(current, runtime, {
        action: "reviewed", confidence: "high", reason: "Repository policy inspected this typed input",
        ruleId: "repo.reviewed", evidence: [],
      })
    ),
  })],
})
`

export const buildAgentCatalog = Effect.fn("buildAgentCatalog")(function*(options: AgentCatalogOptions): Effect.fn.Return<Readonly<Record<string, unknown>>, unknown> {
  if (options.signalId !== undefined && options.slotId !== undefined) return yield* Effect.fail(new AgentCommandError(
    "INVALID_ARGUMENT", "--signal and --slot are mutually exclusive", [{ path: "filters", message: "Choose one detail filter" }], ["Run catalog without filters to list both."]))
  const repoRoot = yield* resolveRepoRoot(options.repoPath).pipe(Effect.mapError((e) =>
    new AgentCommandError("INVALID_ARGUMENT", e.message, [{ path: "repoPath", message: e.message }], ["Choose an existing Git worktree."])))
  const installed = yield* buildPulsarRegistry()
  const detected = yield* buildPulsarRegistry(repoRoot)
  // Discovery remains useful while repairing an invalid policy. Never execute its modules.
  const policy = yield* Effect.result(loadAgentPolicy({ repoPath: repoRoot }))
  const vector = policy._tag === "Success" ? policy.success.vector : undefined
  const slots = CALIBRATION_SLOT_IDS.map((id) => ({ id, consumer: consumers[id] ?? null,
    runtimeSupported: consumers[id] !== undefined, detailCommand: `pulsar agent catalog --slot ${id}` }))
  if (options.slotId !== undefined) {
    const slot = slots.find((s) => s.id === options.slotId)
    if (slot === undefined) return yield* Effect.fail(new AgentCommandError("INVALID_ARGUMENT", `Unknown slot ${options.slotId}`, [{ path: "slot", message: "Not an installed slot" }], ["Run pulsar agent catalog to list slots."]))
    return {
      repoRoot, slot, contract: {
        import: "@skastr0/pulsar-project-module-sdk",
        definition: `ProjectModuleProcessorDefinition<${JSON.stringify(slot.id)}>`,
        input: `CalibrationSlotOutput<${JSON.stringify(slot.id)}>`,
        valueTypeSource: "packages/core/src/calibration-slot-values.ts:CalibrationSlotValues",
        output: `Effect<CalibrationSlotOutput<${JSON.stringify(slot.id)}>, CalibrationProcessorError>`,
        attribution: "Preserve current.decisions; appendProjectModuleDecision records module/processor/rule provenance. Bump fingerprint when behavior changes.",
      },
      example: slot.runtimeSupported ? agentSlotExample(slot.id) : null,
      examplePurpose: slot.id === "typescript.size-policy" ? "Repository-scoped adapter-file maxLoc override, consumed by TS-LD-02 threshold evaluation; not a generic default recommendation." : "Executable, typed attribution-only starting point. Modify current.value using this slot's specific fields to implement repo policy; no generic any-signal hook exists.",
      manifest: { schema: "pulsar/project-modules/v1", modules: [{ id: "repo.policy", kind: "repo-local", path: ".pulsar/modules/repo-policy.ts" }] },
      trust: "Catalog and static validation read data only. Runtime loading requires explicit project-code trust; inspect module source before approval.",
      limitations: slot.runtimeSupported ? [] : ["Declared authoring slot has no installed runtime consumer; registering a processor does not change scores."],
    }
  }
  const summaries = installed.sorted.map((signal) => ({
    id: signal.id, title: signal.title ?? signal.id, aliases: signal.aliases ?? [], category: signal.category,
    tier: signal.tier, kind: signal.kind, enforcement: signal.enforcement, evidenceClass: signal.evidenceClass,
    detected: detected.has(signal.id), selected: policy._tag === "Failure" ? null : detected.has(signal.id) && isActive(signal, vector),
    detailCommand: `pulsar agent catalog --signal ${signal.id}`,
    prerequisites: { inputs: signal.inputs, cacheDependencies: signal.cacheDependencies ?? [] },
    execution: { declaredCommandMetadata: null, note: "Signal definitions do not declare shell-command/trust metadata. Tier alone is not an execution permission. Catalog executes no signal or project code." },
  }))
  if (options.signalId !== undefined) {
    const signal = installed.byId.get(options.signalId)
    if (signal === undefined) return yield* Effect.fail(new AgentCommandError("UNKNOWN_SIGNAL", `Unknown signal ${options.signalId}`, [{ path: "signal", message: "Not installed" }], ["Run pulsar agent catalog to list canonical IDs and aliases."]))
    const configSchema = yield* Effect.try({ try: () => Schema.toJsonSchemaDocument(signal.configSchema), catch: (e) => new AgentCommandError("INVALID_CONFIG", `Cannot export ${signal.id} schema: ${String(e)}`) })
    return {
      ...summaries.find((s) => s.id === signal.id), repoRoot, configSchema, defaults: signal.defaultConfig,
      schemaLimitations: "JSON Schema preserves definitions and representable constraints; arbitrary Effect refinements may not be expressible. Static validation with the actual configSchema remains authoritative.",
      configDirections: signal.configDirections ?? {},
      weights: { minimum: 0, maximum: 2, default: 1, zeroIsInactive: false, zeroDisablesGates: false },
      precedence: ["signal defaults", "signal_overrides.<id>.config", "signal_overrides.<id>.factors.config.*"],
      activation: "Pack detection selects registry; active defaults true and is independent of weight. An override for an installed undetected signal does not activate its pack.",
      factors: (signal.factorDefinitions ?? []).map((f) => ({ ...f, ...agentFactorCapability(signal, f) })),
      knownLimitations: signal.knownFailureModes ?? [],
      policyError: policy._tag === "Failure" ? String(policy.failure) : null,
      next: "Tune .pulsar/vector.json for this repository, validate, then observe. Use executable typed modules for contextual policy rather than changing generic detector defaults.",
    }
  }
  return {
    repoRoot, signals: summaries, slots, installedCount: summaries.length,
    policyError: policy._tag === "Failure" ? String(policy.failure) : null,
    discovery: "All installed signals, including undetected packs. No signal computation or project module execution.",
    next: ["Inspect a signal's schema/defaults and a supported slot's typed contract.", "Tune repo-owned .pulsar/vector.json or .pulsar/project-modules.json; organization vector is fallback only.", "Validate static policy before trusting executable modules and observing."],
  }
})
