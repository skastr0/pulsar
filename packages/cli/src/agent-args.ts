import { AgentCommandError, type AgentPolicyOptions } from "./agent-contract.js"

export type AgentOperation = "catalog" | "config" | "score"

export interface AgentArguments extends AgentPolicyOptions {
  readonly operation: AgentOperation
  readonly signalId?: string
  readonly slotId?: string
  readonly expectPolicy?: string
  readonly full: boolean
  readonly limit: number
  readonly help: boolean
}

const policyValues = ["--vector", "--modules", "--module-dependency-root"] as const
const valueFlags = new Set([...policyValues, "--signal", "--slot", "--expect-policy", "--limit"])
const switchFlags = new Set(["--trust-project-code", "--full", "--help", "-h"])

const invalid = (message: string): never => {
  throw new AgentCommandError("INVALID_ARGUMENT", message, [], ["pulsar agent --help"])
}

export const parseAgentArguments = (args: ReadonlyArray<string>): AgentArguments => {
  const first = args[0]
  const help = args.length === 0 || args.includes("--help") || args.includes("-h")
  const operation = first === undefined || first === "--help" || first === "-h" ? "catalog" : first
  if (operation !== "catalog" && operation !== "config" && operation !== "score") {
    return invalid(`Unknown agent operation: ${operation}`)
  }

  const values = new Map<string, string>()
  const switches = new Set<string>()
  const positional: string[] = []
  const rest = first?.startsWith("-") === true ? args : args.slice(1)
  let literal = false
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!
    if (literal) {
      positional.push(arg)
    } else if (arg === "--") {
      literal = true
    } else if (valueFlags.has(arg)) {
      if (values.has(arg)) return invalid(`Repeated option: ${arg}`)
      const value = rest[++index]
      if (value === undefined || value.startsWith("-") || value.length === 0) {
        return invalid(`${arg} requires a value`)
      }
      values.set(arg, value)
    } else if (switchFlags.has(arg)) {
      if (switches.has(arg)) return invalid(`Repeated option: ${arg}`)
      switches.add(arg)
    } else if (arg.startsWith("-")) {
      return invalid(`Unsupported option: ${arg}; use separate flag and value arguments`)
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 1) return invalid("Specify at most one repository path")

  const allowedValues = new Set<string>(operation === "catalog"
    ? ["--signal", "--slot"]
    : operation === "config"
      ? policyValues
      : [...policyValues, "--signal", "--expect-policy", "--limit"])
  const allowedSwitches = new Set(["--help", "-h", ...(operation === "catalog" ? [] : ["--trust-project-code"]), ...(operation === "score" ? ["--full"] : [])])
  for (const flag of values.keys()) {
    if (!allowedValues.has(flag)) return invalid(`${operation} does not accept ${flag}`)
  }
  for (const flag of switches) {
    if (!allowedSwitches.has(flag)) return invalid(`${operation} does not accept ${flag}`)
  }
  if (values.has("--signal") && values.has("--slot")) {
    return invalid("Choose either --signal or --slot")
  }
  const rawLimit = values.get("--limit")
  const limit = rawLimit === undefined ? 10 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return invalid("--limit must be an integer from 1 through 100")
  }
  if (switches.has("--full") && rawLimit !== undefined) {
    return invalid("--full and --limit are mutually exclusive")
  }
  return {
    operation,
    repoPath: positional[0] ?? ".",
    full: switches.has("--full"),
    limit,
    help,
    ...(values.has("--vector") ? { vectorPath: values.get("--vector")! } : {}),
    ...(values.has("--modules") ? { modulesPath: values.get("--modules")! } : {}),
    ...(values.has("--module-dependency-root") ? { moduleDependencyRoot: values.get("--module-dependency-root")! } : {}),
    ...(values.has("--signal") ? { signalId: values.get("--signal")! } : {}),
    ...(values.has("--slot") ? { slotId: values.get("--slot")! } : {}),
    ...(values.has("--expect-policy") ? { expectPolicy: values.get("--expect-policy")! } : {}),
    ...(switches.has("--trust-project-code") ? { trustProjectCode: true } : {}),
  }
}

/** Shell-free replay arguments preserve preview policy and execution permissions. */
export const agentDetailArgv = (options: AgentArguments, signalId?: string): ReadonlyArray<string> => [
  "pulsar", "agent", "score",
  ...(options.vectorPath === undefined ? [] : ["--vector", options.vectorPath]),
  ...(options.modulesPath === undefined ? [] : ["--modules", options.modulesPath]),
  ...(options.moduleDependencyRoot === undefined ? [] : ["--module-dependency-root", options.moduleDependencyRoot]),
  ...(options.trustProjectCode === true ? ["--trust-project-code"] : []),
  ...(options.expectPolicy === undefined ? [] : ["--expect-policy", options.expectPolicy]),
  ...(signalId === undefined ? [] : ["--signal", signalId]),
  "--full", "--", options.repoPath,
]

export const agentHelp = (operation?: AgentOperation): string => {
  const common = "[repo] [--vector <path>] [--modules <path>] [--module-dependency-root <path>] [--trust-project-code]"
  const commands = {
    catalog: "pulsar agent catalog [repo] [--signal <id> | --slot <id>]\nDiscover installed signals, actual configuration schemas, weights and typed processors. Does not execute project code.",
    config: `pulsar agent config ${common}\nValidate and explain repository policy. Candidate files preview policy without adopting it. Does not score or write policy.`,
    score: `pulsar agent score ${common} [--expect-policy <fingerprint>] [--signal <id>] [--full | --limit <1..100>]\nAssess the whole repository under its policy. --signal filters detail, never the verdict. Default: up to ten findings; --full retrieves available evidence.`,
  }
  return [
    "Pulsar agent-first POC — signals, programmable calibration and repository-owned weights",
    operation === undefined ? Object.values(commands).join("\n\n") : commands[operation],
    "One JSON document on stdout; logs on stderr. No --json flag needed.",
    "Exit codes: 0 complete, 1 operation/config/trust error, 2 proven hard-gate violations, 3 incomplete evidence without a proven block.",
    "Readiness colors are not additional hard gates. Not-applicable evidence is not failure; missing/failed evidence is not healthy.",
    "Project modules execute with this process's permissions. --trust-project-code is explicit permission, not a sandbox.",
    "Paths passed as flags are cwd-relative. Manifest module paths remain repo-relative. Inspection may write disposable caches, never policy or baselines.",
    "Start: catalog → author vector/modules with your editor → config → score → repair → score --expect-policy <fingerprint>.",
    "No persona, ratchet, bisect, quiz or baseline is required. This opt-in POC does not change the legacy CLI contract.",
    "",
  ].join("\n\n")
}
