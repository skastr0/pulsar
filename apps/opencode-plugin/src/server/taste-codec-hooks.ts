import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"
import type { Hooks } from "@opencode-ai/plugin"
import {
  RoutingDetector,
  deriveAiAssistedModeProposal,
  derivePassiveVectorProposal,
  diffTimeIntegrationEnabled,
  generateReviewPlan,
  type ObserverOutput,
  type ReviewPlan,
  type RoutingDiff,
  type RoutingOutput,
  type SignalChange,
  type TasteVector,
} from "@taste-codec/core"
import { Effect } from "effect"
import {
  loadTasteVectorForWorktree,
  observeCurrentWorktree,
} from "./codec-observer"
import {
  appendTasteCodecAnnotation,
  createErrorAnnotation,
  createPendingAnnotation,
  createReadyAnnotation,
  type TasteCodecAnnotation,
} from "./review-surfacing"

type ToolAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0]
type ToolAfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1]

export interface TasteCodecAnalysis {
  readonly fingerprint: string
  readonly diff: RoutingDiff
  readonly observerOutput: ObserverOutput
  readonly routingOutput: RoutingOutput
  readonly reviewPlan: ReviewPlan
  readonly annotation: TasteCodecAnnotation
}

export type TasteCodecAnalyzer = (input: {
  readonly fingerprint: string
  readonly toolName: string
  readonly worktree: string
  readonly diff: RoutingDiff
  readonly vector: TasteVector | undefined
  readonly previous?: TasteCodecAnalysis
}) => Promise<TasteCodecAnalysis>

type SettledAnalysis =
  | { readonly status: "ready"; readonly analysis: TasteCodecAnalysis }
  | { readonly status: "error"; readonly message: string }

export interface TasteCodecState {
  readonly analyzer: TasteCodecAnalyzer
  readonly inlineWaitMs: number
  readonly inFlight: Map<string, Promise<SettledAnalysis>>
  readonly completed: Map<string, TasteCodecAnalysis>
  readonly lastCompletedBySession: Map<string, TasteCodecAnalysis>
  readonly lastSurfacedFingerprintBySession: Map<string, string>
}

const EDIT_TOOLS = new Set(["write", "edit", "apply_patch", "morph-mcp_edit_file"])

export const createTasteCodecState = (options?: {
  readonly analyzer?: TasteCodecAnalyzer
  readonly inlineWaitMs?: number
}): TasteCodecState => ({
  analyzer: options?.analyzer ?? defaultTasteCodecAnalyzer,
  inlineWaitMs: options?.inlineWaitMs ?? 75,
  inFlight: new Map(),
  completed: new Map(),
  lastCompletedBySession: new Map(),
  lastSurfacedFingerprintBySession: new Map(),
})

export const afterToolExecute = Effect.fn("TasteCodecHooks.afterToolExecute")(
  function* ({
    input,
    output,
    worktree,
    state,
  }: {
    readonly input: ToolAfterInput
    readonly output: ToolAfterOutput
    readonly worktree: string
    readonly state: TasteCodecState
  }) {
    if (!EDIT_TOOLS.has(input.tool)) return

    const args = recordFromUnknown(input.args)
    const diff = buildRoutingDiffFromToolArgs(input.tool, args, worktree)
    if (diff.changedFiles.length === 0) return

    const fingerprint = fingerprintOf({ tool: input.tool, diff })
    if (state.lastSurfacedFingerprintBySession.get(input.sessionID) === fingerprint) {
      return
    }

    const vectorExit = yield* Effect.either(
      Effect.tryPromise(() => loadTasteVectorForWorktree(worktree)),
    )
    if (vectorExit._tag === "Left") {
      appendTasteCodecAnnotation(
        output,
        createErrorAnnotation({
          changedFiles: diff.changedFiles,
          fingerprint,
          message: toMessage(vectorExit.left),
        }),
      )
      state.lastSurfacedFingerprintBySession.set(input.sessionID, fingerprint)
      return
    }

    const vector = vectorExit.right
    if (!diffTimeIntegrationEnabled(vector)) return

    const completed = state.completed.get(fingerprint)
    if (completed !== undefined) {
      appendTasteCodecAnnotation(output, completed.annotation)
      state.lastSurfacedFingerprintBySession.set(input.sessionID, fingerprint)
      return
    }

    const pending = ensureAnalysis(state, {
      fingerprint,
      toolName: input.tool,
      sessionID: input.sessionID,
      worktree,
      diff,
      vector,
      previous: state.lastCompletedBySession.get(input.sessionID),
    })
    const settled = yield* Effect.promise(() =>
      settleWithin(pending, state.inlineWaitMs),
    )

    if (settled?.status === "ready") {
      appendTasteCodecAnnotation(output, settled.analysis.annotation)
      state.lastSurfacedFingerprintBySession.set(input.sessionID, fingerprint)
      return
    }

    if (settled?.status === "error") {
      appendTasteCodecAnnotation(
        output,
        createErrorAnnotation({
          changedFiles: diff.changedFiles,
          fingerprint,
          message: settled.message,
        }),
      )
      state.lastSurfacedFingerprintBySession.set(input.sessionID, fingerprint)
      return
    }

    appendTasteCodecAnnotation(
      output,
      createPendingAnnotation({ changedFiles: diff.changedFiles, fingerprint }),
    )
  },
)

const ensureAnalysis = (
  state: TasteCodecState,
  input: {
    readonly fingerprint: string
    readonly toolName: string
    readonly sessionID: string
    readonly worktree: string
    readonly diff: RoutingDiff
    readonly vector: TasteVector | undefined
    readonly previous?: TasteCodecAnalysis
  },
): Promise<SettledAnalysis> => {
  const existing = state.inFlight.get(input.fingerprint)
  if (existing !== undefined) return existing

  const pending = state.analyzer({
    fingerprint: input.fingerprint,
    toolName: input.toolName,
    worktree: input.worktree,
    diff: input.diff,
    vector: input.vector,
    previous: input.previous,
  })
    .then((analysis) => {
      state.completed.set(input.fingerprint, analysis)
      state.lastCompletedBySession.set(input.sessionID, analysis)
      return readyResult(analysis)
    })
    .catch((error) => errorResult(toMessage(error)))
    .finally(() => {
      state.inFlight.delete(input.fingerprint)
    })

  state.inFlight.set(input.fingerprint, pending)
  return pending
}

const defaultTasteCodecAnalyzer: TasteCodecAnalyzer = async ({
  fingerprint,
  toolName,
  worktree,
  diff,
  vector,
  previous,
}) => {
  const { registry, sha, observerOutput } = await observeCurrentWorktree({
    worktree,
    vector,
  })

  const detector = await Effect.runPromise(RoutingDetector.load({ repoRoot: worktree }))

  const routedDiff: RoutingDiff = {
    ...diff,
    signalChanges: {
      ...diff.signalChanges,
      ...buildSignalChanges(previous?.observerOutput, observerOutput),
    },
  }
  const routingOutput = detector.detect(observerOutput, routedDiff)
  const reviewPlan = generateReviewPlan(observerOutput, routingOutput, vector, {
    sha,
  })
  const annotation = createReadyAnnotation({
    worktree,
    fingerprint,
    diff: routedDiff,
    observerOutput,
    reviewPlan,
    previousObserverOutput: previous?.observerOutput,
  })

  await persistPassiveElicitationArtifacts({
    worktree,
    fingerprint,
    toolName,
    diff: routedDiff,
    vector,
    previousObserverOutput: previous?.observerOutput,
    observerOutput,
  }).catch(() => undefined)

  return {
    fingerprint,
    diff: routedDiff,
    observerOutput,
    routingOutput,
    reviewPlan,
    annotation,
  }
}

const buildSignalChanges = (
  previous: ObserverOutput | undefined,
  current: ObserverOutput,
): Record<string, SignalChange> => {
  const changes: Record<string, SignalChange> = {}

  for (const [signalId, result] of current.signalResults.entries()) {
    const previousScore = previous?.signalResults.get(signalId)?.score
    const absoluteDelta =
      previousScore === undefined ? 0 : Math.abs(result.score - previousScore)
    const relativeDelta =
      previousScore === undefined || previousScore === 0
        ? undefined
        : absoluteDelta / Math.abs(previousScore)

    changes[signalId] = {
      ...(previousScore !== undefined ? { previousScore } : {}),
      currentScore: result.score,
      absoluteDelta,
      ...(relativeDelta !== undefined ? { relativeDelta } : {}),
      sourceLocations: result.diagnostics.flatMap((diagnostic) =>
        diagnostic.location === undefined ? [] : [diagnostic.location],
      ),
    }
  }

  return changes
}

const persistPassiveElicitationArtifacts = async (input: {
  readonly worktree: string
  readonly fingerprint: string
  readonly toolName: string
  readonly diff: RoutingDiff
  readonly vector: TasteVector | undefined
  readonly previousObserverOutput: ObserverOutput | undefined
  readonly observerOutput: ObserverOutput
}): Promise<void> => {
  const codecDir = join(input.worktree, ".taste-codec")
  const proposalDir = join(codecDir, "proposals", "pending")
  await mkdir(proposalDir, { recursive: true })

  const proposal = derivePassiveVectorProposal({
    fingerprint: input.fingerprint,
    changedFiles: input.diff.changedFiles,
    vector: input.vector,
    previous: input.previousObserverOutput,
    current: input.observerOutput,
  })
  if (proposal !== undefined) {
    const proposalPath = join(proposalDir, `${proposal.id}.json`)
    await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8")
    await appendObservation(codecDir, {
      schema_version: 1,
      observed_at: proposal.created_at,
      kind: "passive-proposal",
      fingerprint: input.fingerprint,
      changed_files: input.diff.changedFiles,
      summary: proposal.summary,
      signal_ids: proposal.deltas.map((delta) => delta.signal_id),
      proposal_path: relative(input.worktree, proposalPath),
    })
  }

  const aiProposal = deriveAiAssistedModeProposal({
    changedFiles: input.diff.changedFiles,
    toolName: input.toolName,
    vector: input.vector,
  })
  if (aiProposal === undefined) return
  if (proposalAlreadyTracked(codecDir, aiProposal.id)) return

  const aiProposalPath = join(proposalDir, `${aiProposal.id}.json`)
  await writeFile(aiProposalPath, `${JSON.stringify(aiProposal, null, 2)}\n`, "utf8")
  await appendObservation(codecDir, {
    schema_version: 1,
    observed_at: aiProposal.created_at,
    kind: "ai-assisted-mode-proposal",
    fingerprint: input.fingerprint,
    changed_files: input.diff.changedFiles,
    summary: aiProposal.summary,
    signal_ids: [],
    proposal_path: relative(input.worktree, aiProposalPath),
  })
}

const appendObservation = async (codecDir: string, observation: unknown): Promise<void> => {
  await appendFile(join(codecDir, "observations.log"), `${JSON.stringify(observation)}\n`, "utf8")
}

const proposalAlreadyTracked = (codecDir: string, proposalId: string): boolean =>
  ["pending", "accepted", "rejected"].some((status) =>
    existsSync(join(codecDir, "proposals", status, `${proposalId}.json`)),
  )

const settleWithin = async (
  promise: Promise<SettledAnalysis>,
  timeoutMs: number,
): Promise<SettledAnalysis | undefined> =>
  Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ])

const fingerprintOf = (value: unknown): string => {
  const hash = createHash("sha256")
  hash.update(JSON.stringify(value))
  return hash.digest("hex")
}

const buildRoutingDiffFromToolArgs = (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): RoutingDiff => {
  const patchText = args.patchText
  if (tool === "apply_patch" && typeof patchText === "string") {
    return parseApplyPatch(patchText, worktree)
  }

  const filePath = firstPathArg(args, worktree)
  if (filePath === undefined) {
    return {
      changedFiles: [],
      addedFiles: [],
      addedImports: [],
      astMatches: [],
      signalChanges: {},
    }
  }

  const snippets = collectContentSnippets(args)
  const addedImports = snippets.flatMap((snippet, index) =>
    parseImportsFromSnippet(filePath, snippet, index === 0 ? 1 : undefined),
  )
  const astMatches = snippets.flatMap((snippet) =>
    parseAstMatchesFromSnippet(filePath, snippet),
  )

  return {
    changedFiles: [filePath],
    addedFiles: [],
    addedImports,
    astMatches,
    signalChanges: {},
  }
}

const parseApplyPatch = (patchText: string, worktree: string): RoutingDiff => {
  const changedFiles = new Set<string>()
  const addedFiles = new Set<string>()
  const addedImports: Array<RoutingDiff["addedImports"][number]> = []
  const astMatches: Array<RoutingDiff["astMatches"][number]> = []
  let currentFile: string | undefined
  let currentLine = 1

  for (const rawLine of patchText.split(/\r?\n/)) {
    if (rawLine.startsWith("*** Add File: ")) {
      currentFile = normalizePath(worktree, rawLine.slice("*** Add File: ".length))
      changedFiles.add(currentFile)
      addedFiles.add(currentFile)
      currentLine = 1
      continue
    }
    if (rawLine.startsWith("*** Update File: ")) {
      currentFile = normalizePath(worktree, rawLine.slice("*** Update File: ".length))
      changedFiles.add(currentFile)
      currentLine = 1
      continue
    }
    if (rawLine.startsWith("*** Delete File: ")) {
      currentFile = normalizePath(worktree, rawLine.slice("*** Delete File: ".length))
      changedFiles.add(currentFile)
      currentLine = 1
      continue
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue
    if (currentFile === undefined) continue

    const line = rawLine.slice(1)
    addedImports.push(...parseImportsFromSnippet(currentFile, line, currentLine))
    astMatches.push(...parseAstMatchesFromSnippet(currentFile, line, currentLine))
    currentLine += 1
  }

  return {
    changedFiles: [...changedFiles],
    addedFiles: [...addedFiles],
    addedImports,
    astMatches,
    signalChanges: {},
  }
}

const collectContentSnippets = (
  args: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> =>
  [args.code_edit, args.content, args.newString, args.replacement, args.text].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )

const firstPathArg = (
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): string | undefined => {
  for (const candidate of [args.path, args.filePath]) {
    if (typeof candidate !== "string" || candidate.length === 0) continue
    return normalizePath(worktree, candidate)
  }
  return undefined
}

const parseImportsFromSnippet = (
  file: string,
  snippet: string,
  lineOffset?: number,
): ReadonlyArray<RoutingDiff["addedImports"][number]> => {
  const matches: Array<RoutingDiff["addedImports"][number]> = []
  const regexes = [
    /(?:import|export)\s+[^\n]*?from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ]

  for (const [index, line] of snippet.split(/\r?\n/).entries()) {
    for (const regex of regexes) {
      for (const match of line.matchAll(regex)) {
        const specifier = match[1]
        if (specifier === undefined) continue
        const base = { file, specifier }
        matches.push(
          lineOffset === undefined ? base : { ...base, line: lineOffset + index },
        )
      }
    }
  }

  return matches
}

const parseAstMatchesFromSnippet = (
  file: string,
  snippet: string,
  lineOffset = 1,
): ReadonlyArray<RoutingDiff["astMatches"][number]> => {
  if (!file.endsWith(".rs")) return []

  return snippet.split(/\r?\n/).flatMap((line, index) =>
    /\bunsafe\b/.test(line)
      ? [
          {
            signalId: "RS-LD-01",
            outputKey: "new-unsafe-block",
            location: { file, line: lineOffset + index },
          },
        ]
      : [],
  )
}

const normalizePath = (worktree: string, value: string): string => {
  const normalized = value.replace(/\\/g, "/")
  if (!isAbsolute(normalized)) return trimDotSlash(normalized)
  return trimDotSlash(relative(worktree, normalized).replace(/\\/g, "/"))
}

const trimDotSlash = (value: string): string => value.replace(/^\.\//, "")

const recordFromUnknown = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

const errorCodeOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code = error.code
  return typeof code === "string" ? code : undefined
}

const readyResult = (analysis: TasteCodecAnalysis): SettledAnalysis => ({
  status: "ready",
  analysis,
})

const errorResult = (message: string): SettledAnalysis => ({
  status: "error",
  message,
})

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
