import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

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
  const classFacts = new Map<MachineFeedbackClass, MutableClassFact>()

  for (const feedbackClass of MACHINE_FEEDBACK_CLASSES) {
    classFacts.set(feedbackClass, {
      class: feedbackClass,
      localCommands: [],
      ciReachable: false,
      evidence: [],
      unknown: false,
    })
  }

  for (const parsed of [...packageScripts.errors, ...workflowRuns.errors]) {
    for (const feedbackClass of MACHINE_FEEDBACK_CLASSES) {
      classFacts.get(feedbackClass)?.evidence.push(parsed)
    }
    for (const requiredClass of requiredClasses) {
      const fact = classFacts.get(requiredClass)
      if (fact !== undefined) fact.unknown = true
    }
  }

  if (packageScripts.value !== undefined) {
    const classesByScript = classifyScripts(packageScripts.value.scripts)
    for (const [scriptName, classes] of classesByScript) {
      for (const feedbackClass of classes) {
        const fact = classFacts.get(feedbackClass)!
        fact.localCommands.push(scriptName)
        fact.evidence.push({
          kind: "package-script",
          path: packageScripts.value.path,
          command: `npm run ${scriptName}`,
        })
      }
    }
  }

  for (const workflow of workflowRuns.value) {
    const classes = classifyCommand(workflow.command, packageScripts.value?.scripts)
    for (const feedbackClass of classes) {
      const fact = classFacts.get(feedbackClass)!
      fact.ciReachable = true
      fact.evidence.push({
        kind: "github-workflow",
        path: workflow.path,
        command: workflow.command,
      })
    }
  }

  const classes = MACHINE_FEEDBACK_CLASSES.map((feedbackClass) =>
    finalizeClassFact(classFacts.get(feedbackClass)!),
  )
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
      unknownClassCount > 0
        ? "unknown"
        : configuredClassCount > 0
          ? "present"
          : "absent",
    classes,
    configuredClassCount,
    ciReachableClassCount,
    missingClassCount,
    unknownClassCount,
    sourceFingerprint: fingerprintMachineFeedback(packageScripts, workflowRuns),
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
      runs.push(...extractWorkflowRunCommands(path, raw))
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
): ReadonlyArray<{ readonly path: string; readonly command: string }> => {
  const commands: Array<{ readonly path: string; readonly command: string }> = []
  const lines = content.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const match = line.match(/^\s*-?\s*run:\s*(.+)$/u)
    if (match === null) continue
    const rawCommand = match[1]?.trim() ?? ""
    if (rawCommand === "|" || rawCommand === ">") {
      const block = collectWorkflowRunBlock(lines, index, leadingWhitespace(line))
      index = block.nextIndex - 1
      if (block.command.length > 0) commands.push({ path, command: block.command })
      continue
    }
    if (rawCommand.length === 0) continue
    commands.push({ path, command: rawCommand.replace(/^['"]|['"]$/g, "") })
  }
  return commands
}

const collectWorkflowRunBlock = (
  lines: ReadonlyArray<string>,
  startIndex: number,
  runIndent: number,
): { readonly command: string; readonly nextIndex: number } => {
  const blockLines: Array<string> = []
  let index = startIndex + 1
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (line.trim().length === 0) {
      blockLines.push("")
      continue
    }
    if (leadingWhitespace(line) <= runIndent) break
    blockLines.push(line.trim())
  }

  return {
    command: blockLines.join("\n").trim(),
    nextIndex: index,
  }
}

const leadingWhitespace = (line: string): number => line.match(/^\s*/u)?.[0].length ?? 0

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
        packageErrors: packageScripts.errors,
        workflowRuns: workflowRuns.value,
        workflowErrors: workflowRuns.errors,
      }),
    )
    .digest("hex")
