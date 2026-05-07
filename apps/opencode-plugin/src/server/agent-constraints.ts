import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { relative, resolve } from "node:path"
import { Effect } from "effect"
import {
  CATEGORIES,
  createTimeSeriesServices,
  evaluateBackpressure,
  projectObserverForAgent,
  type BackpressureOutput,
  type PulsarVector,
  type TimeSeriesEntry,
} from "@skastr0/pulsar-core"

export interface AgentConstraintDecision {
  readonly allowed: boolean
  readonly message?: string
  readonly backpressure: BackpressureOutput
}

interface ConstraintContext {
  readonly latestEntry: TimeSeriesEntry | undefined
  readonly backpressure: BackpressureOutput
  readonly agentView: ReturnType<typeof projectObserverForAgent>
}

const MUTATING_TOOLS = new Set(["write", "edit", "apply_patch", "morph-mcp_edit_file"])
const STRUCTURAL_FILE_PATTERNS = [
  /^package\.json$/,
  /^tsconfig(?:\.[^.]+)?\.json$/,
  /^Cargo\.toml$/,
  /^ARCHITECTURE\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^plugin\//,
  /^\.opencode\/policy\.toml$/,
]

export const evaluateAgentConstraints = async (input: {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly worktree: string
  readonly vector: PulsarVector | undefined
}): Promise<AgentConstraintDecision> => {
  const context = await loadConstraintContext(input.worktree, input.vector)
  if (!MUTATING_TOOLS.has(input.tool)) {
    return { allowed: true, backpressure: context.backpressure }
  }

  const change = await classifyChange(input.tool, input.args, input.worktree)
  if (context.backpressure.overall !== "red" || !change.structural) {
    return { allowed: true, backpressure: context.backpressure }
  }

  return {
    allowed: false,
    backpressure: context.backpressure,
    message: [
      "Pulsar backpressure is red, so structural changes are blocked.",
      `Attempted structural change: ${change.reasons.join("; ") || "new structure detected"}.`,
      "Stay within existing files and patterns, or ask a human to approve the structural change.",
    ].join(" "),
  }
}

export const renderAgentConstraintSystemPrompt = async (input: {
  readonly worktree: string
  readonly vector: PulsarVector | undefined
}): Promise<string | undefined> => {
  const context = await loadConstraintContext(input.worktree, input.vector)
  const lines: Array<string> = [
    '<pulsar-agent-constraints schema="pulsar/agent-constraints/v1">',
    `backpressure: ${context.backpressure.overall}`,
    "guidance:",
    ...guidanceForLevel(context.backpressure.overall).map((line) => `- ${line}`),
    ...context.agentView.reminders.map((line) => `- ${line}`),
  ]

  const diagnosticLines = CATEGORIES.flatMap((category) => {
    const diagnostics = context.agentView.categories[category].diagnostics.slice(0, 3)
    if (diagnostics.length === 0) return []
    return [
      `${category}:`,
      ...diagnostics.map((diagnostic) => `  - ${diagnostic}`),
    ]
  })

  if (diagnosticLines.length > 0) {
    lines.push("diagnostics:", ...diagnosticLines)
  }

  lines.push("</pulsar-agent-constraints>")
  return lines.join("\n")
}

const loadConstraintContext = async (
  worktree: string,
  vector: PulsarVector | undefined,
): Promise<ConstraintContext> => {
  const services = createTimeSeriesServices(worktree)
  const entries = await Effect.runPromise(services.reader.entries())
  const backpressure = evaluateBackpressure(entries, vector)
  const latestEntry = entries.at(-1)
  const agentView = projectObserverForAgent(latestEntry, backpressure.goodhart)
  return { latestEntry, backpressure, agentView }
}

const classifyChange = async (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): Promise<{ readonly structural: boolean; readonly reasons: ReadonlyArray<string> }> => {
  if (tool === "apply_patch") {
    return classifyPatchChange(args.patchText, worktree)
  }

  const filePath = extractFilePath(args, worktree)
  if (filePath === undefined) {
    return { structural: false, reasons: [] }
  }

  const relativePath = normalizeRelativePath(filePath, worktree)
  const reasons: Array<string> = []
  if (!(await fileExists(filePath))) {
    reasons.push(`creates ${relativePath}`)
  }
  if (isStructuralFile(relativePath)) {
    reasons.push(`touches structural file ${relativePath}`)
  }

  return { structural: reasons.length > 0, reasons }
}

const classifyPatchChange = async (
  patchText: unknown,
  worktree: string,
): Promise<{ readonly structural: boolean; readonly reasons: ReadonlyArray<string> }> => {
  if (typeof patchText !== "string") {
    return { structural: false, reasons: [] }
  }

  const reasons: Array<string> = []
  for (const line of patchText.split("\n")) {
    if (line.startsWith("*** Add File: ")) {
      const relativePath = normalizeRelativePath(line.slice("*** Add File: ".length).trim(), worktree)
      reasons.push(`adds ${relativePath}`)
    }
    if (line.startsWith("*** Delete File: ")) {
      const relativePath = normalizeRelativePath(line.slice("*** Delete File: ".length).trim(), worktree)
      reasons.push(`deletes ${relativePath}`)
    }
    if (line.startsWith("*** Update File: ")) {
      const relativePath = normalizeRelativePath(line.slice("*** Update File: ".length).trim(), worktree)
      if (isStructuralFile(relativePath)) {
        reasons.push(`touches structural file ${relativePath}`)
      }
    }
  }

  return { structural: reasons.length > 0, reasons }
}

const extractFilePath = (
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): string | undefined => {
  const value =
    typeof args.filePath === "string"
      ? args.filePath
      : typeof args.path === "string"
        ? args.path
        : undefined
  if (value === undefined) return undefined
  return resolve(worktree, value)
}

const normalizeRelativePath = (pathValue: string, worktree: string): string =>
  relative(worktree, resolve(worktree, pathValue)).replace(/^\.\.\//, "")

const isStructuralFile = (relativePath: string): boolean =>
  STRUCTURAL_FILE_PATTERNS.some((pattern) => pattern.test(relativePath))

const fileExists = async (pathValue: string): Promise<boolean> => {
  try {
    await access(pathValue, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const guidanceForLevel = (
  level: BackpressureOutput["overall"],
): ReadonlyArray<string> => {
  if (level === "green") {
    return [
      "Full autonomy is available, but prefer existing terms when they already fit.",
    ]
  }
  if (level === "yellow") {
    return [
      "Reuse existing domain terms and patterns wherever possible.",
      "Any new structure needs an explicit justification in the surrounding explanation.",
    ]
  }
  return [
    "Stay within existing files and patterns.",
    "Do not create new files or structural manifests without human approval.",
  ]
}
