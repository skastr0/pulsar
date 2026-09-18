import { Effect } from "effect"
import { format } from "node:util"
import { buildAgentCatalog } from "./agent-catalog.js"
import { loadAgentPolicy } from "./agent-policy.js"
import { prepareAgentPolicy, runAgentAssessment } from "./agent-runtime.js"
import { agentHelp, parseAgentArguments, type AgentArguments } from "./agent-args.js"
import { AGENT_SCHEMA, AgentCommandError } from "./agent-contract.js"
import { agentPolicySummary, buildAgentScoreReport } from "./agent-report.js"
import { runCliEffect } from "./cli-effect-runtime.js"
import { writeJsonToStdout, writeStdout } from "./cli-output.js"
import { CLI_BUILD_INFO } from "./index.js"
import { buildPulsarRegistry } from "./runtime-registry.js"
import { DEFAULT_OWNERSHIP_DISCOVER_LIMITS, proposeOwnershipInventory } from "./ownership-discovery.js"
import { prepareOwnershipJudgment, ownershipJudgmentPreview, executeOwnershipJudgment } from "./agent-judge.js"
import { jevClientLayerFromEnv } from "./jev/index.js"

const runAgentOperation = (options: AgentArguments) => Effect.gen(function* () {
  if (options.operation === "catalog") {
    const result = yield* buildAgentCatalog({
      repoPath: options.repoPath,
      ...(options.signalId === undefined ? {} : { signalId: options.signalId }),
      ...(options.slotId === undefined ? {} : { slotId: options.slotId }),
    })
    return { result, exitCode: 0 }
  }

  const allSignals = yield* buildPulsarRegistry()
  const signalId = options.signalId === undefined ? undefined : allSignals.canonicalIdOf(options.signalId)
  if (options.signalId !== undefined && signalId === undefined) {
    return yield* Effect.fail(new AgentCommandError("UNKNOWN_SIGNAL", `Unknown installed signal: ${options.signalId}`, [], ["pulsar agent catalog"]))
  }
  const policy = yield* loadAgentPolicy(options)
  const prepared = yield* prepareAgentPolicy(policy, options)
  if (options.expectPolicy !== undefined && options.expectPolicy !== prepared.fingerprint) {
    return yield* Effect.fail(new AgentCommandError(
      "POLICY_MISMATCH",
      "The assessment policy changed; this run cannot verify a repair under the expected policy.",
      [{ path: "policy.fingerprint", message: `Expected ${options.expectPolicy}; resolved ${prepared.fingerprint}` }],
      ["Inspect the policy change with pulsar agent config. Restore the prior policy or explicitly accept the changed interpretation before comparing assessments."],
    ))
  }
  if (options.operation === "config") {
    return {
      result: {
        tool: CLI_BUILD_INFO,
        repository: { root: policy.repoRoot },
        policy: agentPolicySummary(policy, prepared),
        configuration: policy.explanation,
        calibration: prepared.explanation,
        writes_policy: false,
        next: "Run pulsar agent score with the same policy options; use --expect-policy to pin this interpretation.",
      },
      exitCode: 0,
    }
  }
  if (options.operation === "judge") {
    const plan = yield* prepareOwnershipJudgment(policy.repoRoot)
    if (options.dryRun) {
      return { result: { ...ownershipJudgmentPreview(plan), dry_run: true }, exitCode: 0 }
    }
    const result = yield* executeOwnershipJudgment(plan).pipe(Effect.provide(jevClientLayerFromEnv))
    return { result, exitCode: result.applicability === "insufficient_evidence" ? 3 : 0 }
  }
  const run = yield* runAgentAssessment(policy, prepared)
  if (options.operation === "discover") {
    const proposal = yield* Effect.try({
      try: () => proposeOwnershipInventory({
        repoRoot: policy.repoRoot,
        signalResults: [...run.observation.result.signalResults.values()],
        limits: {
          ...DEFAULT_OWNERSHIP_DISCOVER_LIMITS,
          ...(options.include === undefined ? {} : { include: [options.include] }),
          ...(options.exclude === undefined ? {} : { exclude: [options.exclude] }),
        },
      }),
      catch: () => new AgentCommandError("DISCOVERY_FAILED", "Could not construct ownership inventory from detector evidence."),
    })
    return {
      result: { ...proposal, repository: { root: policy.repoRoot }, policy: agentPolicySummary(policy, prepared) },
      exitCode: proposal.coverage.complete ? 0 : 3,
    }
  }
  return buildAgentScoreReport({
    options: { ...options, ...(signalId === undefined ? {} : { signalId }) },
    policy,
    prepared,
    output: run.observation.result,
    gitSha: run.observation.gitSha,
    inputFingerprint: run.inputFingerprint,
  })
})

const errorResponse = (operation: string, cause: unknown) => {
  const error = cause instanceof AgentCommandError
    ? cause
    : new AgentCommandError(
        "OPERATION_FAILED",
        cause instanceof Error ? cause.message : String(cause),
        [],
        ["Check the repository, configuration and module prerequisites with pulsar agent config --help."],
      )
  return {
    schema: AGENT_SCHEMA,
    operation,
    status: "error" as const,
    error: { code: error.code, message: error.message, issues: error.issues, recovery: error.recovery },
  }
}

/** Process-boundary adapter: trusted cooperative modules log to stderr. */
export const runAgentCli = async (args: ReadonlyArray<string>): Promise<number> => {
  const original = { log: console.log, info: console.info, debug: console.debug }
  const stderr = (...values: unknown[]): void => { process.stderr.write(`${format(...values)}\n`) }
  console.log = stderr
  console.info = stderr
  console.debug = stderr
  try {
    const options = parseAgentArguments(args)
    if (options.help) {
      await writeStdout(agentHelp(args[0] === undefined || args[0].startsWith("-") ? undefined : options.operation))
      return 0
    }
    const completed = await runCliEffect(Effect.result(runAgentOperation(options)))
    if (completed._tag === "Failure") {
      await writeJsonToStdout(errorResponse(options.operation, completed.failure))
      return 1
    }
    await writeJsonToStdout({
      schema: AGENT_SCHEMA,
      operation: options.operation,
      status: "completed",
      result: completed.success.result,
    })
    return completed.success.exitCode
  } catch (cause) {
    await writeJsonToStdout(errorResponse(args[0] ?? "catalog", cause))
    return 1
  } finally {
    console.log = original.log
    console.info = original.info
    console.debug = original.debug
  }
}
