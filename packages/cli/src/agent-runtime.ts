import { resolve } from "node:path"
import { Effect } from "effect"
import { hashCalibrationValue, makeResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import { computeObserverConfigHash } from "@skastr0/pulsar-core/scoring"
import { fingerprintProjectModuleManifest } from "@skastr0/pulsar-project-module-sdk"
import {
  AgentCommandError,
  type AgentPolicyOptions,
  type AgentPreparedPolicy,
  type AgentStaticPolicy,
} from "./agent-contract.js"
import { agentInputFingerprint, agentReferencePolicyFingerprint } from "./agent-identity.js"
import { CLI_BUILD_INFO } from "./index.js"
import { loadProjectModuleCalibrationContext } from "./runtime-calibration.js"
import { makePulsarRuntime, readHeadSha, type observeWorktree } from "./runtime.js"

export const prepareAgentPolicy = (
  policy: AgentStaticPolicy,
  options: AgentPolicyOptions,
): Effect.Effect<AgentPreparedPolicy, unknown, never> => Effect.gen(function* () {
  // An absent static manifest is a snapshot, not permission to read it again.
  // Runtime Next detection still runs against this explicitly supplied manifest.
  const manifest = policy.manifest ?? { schema: "pulsar/project-modules/v1" as const, modules: [] }
  const executableRefs = manifest.modules.filter((ref) => ref.enabled && ref.kind !== "builtin")
  if (executableRefs.length > 0 && options.trustProjectCode !== true) {
    return yield* Effect.fail(new AgentCommandError(
      "PROJECT_CODE_TRUST_REQUIRED",
      "Enabled project modules execute trusted code in this process; they are not sandboxed.",
      executableRefs.map((ref) => ({ path: `modules.${ref.id}`, message: JSON.stringify(ref) })),
      ["Review the selected module sources, then retry with --trust-project-code, or disable those refs."],
    ))
  }
  const dependencyRoot = resolve(options.moduleDependencyRoot ?? policy.moduleDependencyRoot ?? policy.repoRoot)
  const loaded = yield* loadProjectModuleCalibrationContext(policy.repoRoot, { manifest, dependencyRoot })
  const calibrationContext = loaded ?? makeResolvedCalibrationContext({
    repoFacts: { repoRoot: policy.repoRoot, fingerprint: "agent-empty-v1", detectedTechnologies: [], sourceExtensions: [] },
  })
  // Detection paths/confidence are input evidence. Only effective activation and
  // declared processor/rule identities belong to the assessment policy identity.
  const modules = calibrationContext.activeModules
  const processors = calibrationContext.processors.map(({ process: _process, ...descriptor }) => descriptor)
  const calibrationPolicyFingerprint = hashCalibrationValue({
    manifest: fingerprintProjectModuleManifest(manifest), modules, processors,
  })
  const referencePolicyFingerprint = yield* agentReferencePolicyFingerprint(policy.repoRoot)
  const tool = { version: CLI_BUILD_INFO.version, commit: CLI_BUILD_INFO.commit, dirty: CLI_BUILD_INFO.dirty }
  const fingerprint = hashCalibrationValue({
    schema: "pulsar/agent-policy/v1",
    tool,
    assessmentScope: "whole-repo",
    vector: policy.vector ?? null,
    observer: computeObserverConfigHash(policy.registry, policy.vector, calibrationPolicyFingerprint, referencePolicyFingerprint),
  })
  return {
    fingerprint,
    calibrationContext,
    explanation: {
      fingerprint,
      assessmentScope: "whole-repo",
      selectedManifest: manifest,
      modules,
      processors,
      trust: { required: executableRefs.length > 0, granted: options.trustProjectCode === true, execution: "in-process; not sandboxed" },
      dependencySource: { root: dependencyRoot, selection: dependencyRoot === resolve(policy.repoRoot) ? "repository" : "explicit" },
      policyIdentity: { tool, calibrationPolicyFingerprint, referencePolicyFingerprint },
      inputEvidence: { repoFacts: calibrationContext.repoFacts, calibrationFingerprint: calibrationContext.fingerprint },
      identityLimitations: [
        "Owned module source and statically discoverable helper imports use content identities and repo/package-relative paths.",
        "External dependency implementation bytes and arbitrary trusted code reads (environment, network, computed imports) are not captured; use pinned dependencies and deterministic processors.",
        "Processor rule identities are declared fingerprints; individual applied decisions are reported by the assessment.",
        "Input identity covers git-visible tracked/untracked file bytes, excluding disposable tool state; unsupported directories/submodules and unreadable files fail rather than being silently omitted.",
      ],
    },
  }
})

export const runAgentAssessment = (
  policy: AgentStaticPolicy,
  prepared: AgentPreparedPolicy,
): Effect.Effect<{
  observation: Effect.Success<ReturnType<typeof observeWorktree>>
  inputFingerprint: string
}, unknown, never> => Effect.scoped(Effect.gen(function* () {
  const inputFingerprint = yield* agentInputFingerprint(policy.repoRoot)
  const gitSha = yield* readHeadSha(policy.repoRoot)
  const { registry, engine, timeSeries, calibrationContext } = yield* makePulsarRuntime(policy.repoRoot, policy.vector, {
    calibrationContext: prepared.calibrationContext,
    tsProject: { productionOnly: true },
  })
  // Legacy observation implicitly scopes some detectors to dirty hunks. Agent
  // assessment is whole-repository even when unrelated files are dirty.
  const result = yield* engine.observeWorktree(policy.repoRoot, gitSha, {
    changedHunks: [], assessmentScope: "whole-repo",
  })
  const observation = { repoRoot: policy.repoRoot, gitSha, registry, result, timeSeries, calibrationContext }
  if (inputFingerprint !== (yield* agentInputFingerprint(policy.repoRoot))) {
    return yield* Effect.fail(new AgentCommandError(
      "INPUT_CHANGED_DURING_ASSESSMENT", "Worktree inputs changed during assessment.", [], ["Retry against a stable worktree."],
    ))
  }
  return { observation, inputFingerprint }
}))
