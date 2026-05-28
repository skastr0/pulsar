import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { parseDocument } from "yaml"

export const MACHINE_FEEDBACK_CLASSES = [
  "build",
  "typecheck",
  "test",
  "static_analysis",
  "coverage",
] as const
export type MachineFeedbackClass = typeof MACHINE_FEEDBACK_CLASSES[number]

export type FactSourceState =
  | "present"
  | "zero"
  | "absent"
  | "unknown"
  | "not_configured"
  | "not_applicable"

export interface MachineFeedbackEvidence {
  readonly kind: "package-script" | "github-workflow" | "parse-error"
  readonly path: string
  readonly command?: string
  readonly detail?: string
}

export interface MachineFeedbackClassFact {
  readonly class: MachineFeedbackClass
  readonly state: FactSourceState
  readonly localCommands: ReadonlyArray<string>
  readonly ciReachable: boolean
  readonly evidence: ReadonlyArray<MachineFeedbackEvidence>
}

export interface MachineFeedbackFacts {
  readonly state: FactSourceState
  readonly classes: ReadonlyArray<MachineFeedbackClassFact>
  readonly configuredClassCount: number
  readonly ciReachableClassCount: number
  readonly missingClassCount: number
  readonly unknownClassCount: number
  readonly sourceFingerprint: string
}

interface PackageScripts {
  readonly path: string
  readonly scripts: ReadonlyMap<string, string>
}

export const collectMachineFeedbackFacts = async (
  repoRoot: string,
  requiredClasses: ReadonlyArray<MachineFeedbackClass>,
): Promise<MachineFeedbackFacts> => {
  const packageScripts = await readRootPackageScripts(repoRoot)
  const workflowRuns = await readGithubWorkflowRuns(repoRoot)
  const classFacts = makeMutableClassFacts()
  markUnknownFeedbackEvidence(classFacts, [...packageScripts.errors, ...workflowRuns.errors])
  addPackageScriptFeedbackEvidence(classFacts, packageScripts.value)
  addWorkflowFeedbackEvidence(classFacts, workflowRuns.value, packageScripts.value?.scripts)
  const classes = finalizeMachineFeedbackClasses(classFacts)
  return summarizeMachineFeedbackFacts(repoRoot, requiredClasses, packageScripts, workflowRuns, classes)
}

const makeMutableClassFacts = (): Map<MachineFeedbackClass, MutableClassFact> =>
  new Map(
    MACHINE_FEEDBACK_CLASSES.map((feedbackClass) => [
      feedbackClass,
      {
        class: feedbackClass,
        localCommands: [],
        ciReachable: false,
        evidence: [],
        unknown: false,
      },
    ]),
  )

const markUnknownFeedbackEvidence = (
  classFacts: Map<MachineFeedbackClass, MutableClassFact>,
  evidence: ReadonlyArray<MachineFeedbackEvidence>,
): void => {
  for (const parsed of evidence) {
    for (const fact of classFacts.values()) {
      fact.evidence.push(parsed)
      fact.unknown = true
    }
  }
}

const addPackageScriptFeedbackEvidence = (
  classFacts: Map<MachineFeedbackClass, MutableClassFact>,
  packageScripts: PackageScripts | undefined,
): void => {
  if (packageScripts === undefined) return
  for (const [scriptName, classes] of classifyScripts(packageScripts.scripts)) {
    for (const feedbackClass of classes) {
      const fact = classFacts.get(feedbackClass)!
      fact.localCommands.push(scriptName)
      fact.evidence.push({
        kind: "package-script",
        path: packageScripts.path,
        command: `npm run ${scriptName}`,
      })
    }
  }
}

const addWorkflowFeedbackEvidence = (
  classFacts: Map<MachineFeedbackClass, MutableClassFact>,
  workflows: ReadonlyArray<{ readonly path: string; readonly command: string }>,
  scripts: ReadonlyMap<string, string> | undefined,
): void => {
  for (const workflow of workflows) {
    for (const feedbackClass of classifyCommand(workflow.command, scripts)) {
      const fact = classFacts.get(feedbackClass)!
      fact.ciReachable = true
      fact.evidence.push({
        kind: "github-workflow",
        path: workflow.path,
        command: workflow.command,
      })
    }
  }
}

const finalizeMachineFeedbackClasses = (
  classFacts: Map<MachineFeedbackClass, MutableClassFact>,
): ReadonlyArray<MachineFeedbackClassFact> =>
  MACHINE_FEEDBACK_CLASSES.map((feedbackClass) => finalizeClassFact(classFacts.get(feedbackClass)!))

const summarizeMachineFeedbackFacts = (
  repoRoot: string,
  requiredClasses: ReadonlyArray<MachineFeedbackClass>,
  packageScripts: Awaited<ReturnType<typeof readRootPackageScripts>>,
  workflowRuns: Awaited<ReturnType<typeof readGithubWorkflowRuns>>,
  classes: ReadonlyArray<MachineFeedbackClassFact>,
): MachineFeedbackFacts => {
  const configuredClassCount = classes.filter((fact) => fact.state === "present").length
  const ciReachableClassCount = classes.filter((fact) => fact.ciReachable).length
  const required = new Set(requiredClasses)
  const missingClassCount = classes.filter(
    (fact) => required.has(fact.class) && fact.state === "absent",
  ).length
  const unknownClassCount = classes.filter(
    (fact) => required.has(fact.class) && fact.state === "unknown",
  ).length
  return {
    state:
      classes.some((fact) => fact.state === "unknown")
        ? "unknown"
        : configuredClassCount > 0
          ? "present"
          : "absent",
    classes,
    configuredClassCount,
    ciReachableClassCount,
    missingClassCount,
    unknownClassCount,
    sourceFingerprint: fingerprintMachineFeedback(repoRoot, packageScripts, workflowRuns),
  }
}

interface MutableClassFact {
  readonly class: MachineFeedbackClass
  readonly localCommands: Array<string>
  ciReachable: boolean
  readonly evidence: Array<MachineFeedbackEvidence>
  unknown: boolean
}

const finalizeClassFact = (fact: MutableClassFact): MachineFeedbackClassFact => ({
  class: fact.class,
  state:
    fact.unknown
      ? "unknown"
      : fact.localCommands.length > 0 || fact.ciReachable
        ? "present"
        : "absent",
  localCommands: [...new Set(fact.localCommands)].sort(),
  ciReachable: fact.ciReachable,
  evidence: fact.evidence,
})

const readRootPackageScripts = async (
  repoRoot: string,
): Promise<{
  readonly value?: PackageScripts
  readonly errors: ReadonlyArray<MachineFeedbackEvidence>
}> => {
  const packageJsonPath = join(repoRoot, "package.json")
  if (!existsSync(packageJsonPath)) return { errors: [] }
  try {
    const raw = await readFile(packageJsonPath, "utf8")
    const parsed = JSON.parse(raw) as { readonly scripts?: Record<string, unknown> }
    const scripts = new Map(
      Object.entries(parsed.scripts ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    return { value: { path: packageJsonPath, scripts }, errors: [] }
  } catch (cause) {
    return {
      errors: [{
        kind: "parse-error",
        path: packageJsonPath,
        detail: `Failed to parse package.json: ${String(cause)}`,
      }],
    }
  }
}

const readGithubWorkflowRuns = async (
  repoRoot: string,
): Promise<{
  readonly value: ReadonlyArray<{ readonly path: string; readonly command: string }>
  readonly errors: ReadonlyArray<MachineFeedbackEvidence>
}> => {
  const workflowDir = join(repoRoot, ".github", "workflows")
  if (!existsSync(workflowDir)) return { value: [], errors: [] }
  const entries = (await readdir(workflowDir, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const runs: Array<{ readonly path: string; readonly command: string }> = []
  const errors: Array<MachineFeedbackEvidence> = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(ya?ml)$/u.test(entry.name)) continue
    const path = join(workflowDir, entry.name)
    try {
      const raw = await readFile(path, "utf8")
      const parsed = extractWorkflowRunCommands(path, raw)
      runs.push(...parsed.commands)
      errors.push(...parsed.errors)
    } catch (cause) {
      errors.push({
        kind: "parse-error",
        path,
        detail: `Failed to read workflow: ${String(cause)}`,
      })
    }
  }
  return {
    value: runs.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.command.localeCompare(right.command),
    ),
    errors: errors.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        (left.detail ?? "").localeCompare(right.detail ?? ""),
    ),
  }
}

const extractWorkflowRunCommands = (
  path: string,
  content: string,
): {
  readonly commands: ReadonlyArray<{ readonly path: string; readonly command: string }>
  readonly errors: ReadonlyArray<MachineFeedbackEvidence>
} => {
  const document = parseDocument(content)
  if (document.errors.length > 0) {
    return {
      commands: [],
      errors: document.errors.map((error) => ({
        kind: "parse-error" as const,
        path,
        detail: `Failed to parse workflow YAML: ${error.message}`,
      })),
    }
  }

  const commands: Array<{ readonly path: string; readonly command: string }> = []
  collectRunCommands(document.toJS(), path, commands)
  return { commands, errors: [] }
}

const collectRunCommands = (
  value: unknown,
  path: string,
  commands: Array<{ readonly path: string; readonly command: string }>,
): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectRunCommands(item, path, commands)
    return
  }

  if (value === null || typeof value !== "object") return

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "run" && typeof item === "string" && item.trim().length > 0) {
      commands.push({ path, command: item.trim() })
      continue
    }
    collectRunCommands(item, path, commands)
  }
}

const classifyScripts = (
  scripts: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlySet<MachineFeedbackClass>> => {
  const result = new Map<string, ReadonlySet<MachineFeedbackClass>>()
  for (const [name, command] of scripts) {
    const classes = classifyCommand(`${name} ${command}`, scripts)
    if (classes.size > 0) result.set(name, classes)
  }
  return result
}

const classifyCommand = (
  command: string,
  scripts?: ReadonlyMap<string, string>,
  seen: ReadonlySet<string> = new Set(),
): ReadonlySet<MachineFeedbackClass> => {
  const normalized = command.toLowerCase()
  const classes = new Set<MachineFeedbackClass>()
  if (/\b(build|turbo run build|tsc -b)\b/u.test(normalized)) classes.add("build")
  if (/\b(typecheck|tsc --noemit|tsc -b)\b/u.test(normalized)) classes.add("typecheck")
  if (/\b(test|bun test|vitest|jest|cargo test)\b/u.test(normalized)) classes.add("test")
  if (/\b(lint|eslint|biome|static|dep:check|check)\b/u.test(normalized)) {
    classes.add("static_analysis")
  }
  if (/\b(coverage|lcov|nyc|c8)\b/u.test(normalized)) classes.add("coverage")

  for (const scriptName of referencedScripts(normalized)) {
    if (scripts === undefined || seen.has(scriptName)) continue
    const script = scripts.get(scriptName)
    if (script === undefined) continue
    const nextSeen = new Set(seen)
    nextSeen.add(scriptName)
    for (const feedbackClass of classifyCommand(`${scriptName} ${script}`, scripts, nextSeen)) {
      classes.add(feedbackClass)
    }
  }

  return classes
}

const referencedScripts = (command: string): ReadonlyArray<string> => {
  const scripts: Array<string> = []
  const regex = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([a-z0-9:_-]+)/gu
  for (const match of command.matchAll(regex)) {
    if (match[1] !== undefined) scripts.push(match[1])
  }
  return scripts
}

const fingerprintMachineFeedback = (
  repoRoot: string,
  packageScripts: Awaited<ReturnType<typeof readRootPackageScripts>>,
  workflowRuns: Awaited<ReturnType<typeof readGithubWorkflowRuns>>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        packageScripts:
          packageScripts.value === undefined
            ? undefined
            : [...packageScripts.value.scripts.entries()].sort(([left], [right]) =>
                left.localeCompare(right),
              ),
        packageErrors: packageScripts.errors.map((error) => normalizeEvidenceForFingerprint(repoRoot, error)),
        workflowRuns: workflowRuns.value.map((run) => ({
          ...run,
          path: stableRepoPath(repoRoot, run.path),
        })),
        workflowErrors: workflowRuns.errors.map((error) => normalizeEvidenceForFingerprint(repoRoot, error)),
      }),
    )
    .digest("hex")

const normalizeEvidenceForFingerprint = (
  repoRoot: string,
  evidence: MachineFeedbackEvidence,
): MachineFeedbackEvidence => ({
  ...evidence,
  path: stableRepoPath(repoRoot, evidence.path),
})

const stableRepoPath = (repoRoot: string, path: string): string => {
  const relativePath = relative(repoRoot, path).replaceAll("\\", "/")
  return relativePath.startsWith("..") ? path.replaceAll("\\", "/") : relativePath
}
