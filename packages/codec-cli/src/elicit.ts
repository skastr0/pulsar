import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { stdin as input, stdout as output } from "node:process"
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises"
import { dirname, join, relative, resolve } from "node:path"
import { promisify } from "node:util"
import {
  MINIMUM_REVEALED_PREFERENCE_SAMPLES,
  QuizResponse,
  applyTasteVectorProposal,
  decodeQuizSession,
  deriveRevealedPreferenceProposal,
  inferRevealedPreferencePairwise,
  inferRevealedPreferencePriorAdjusted,
  inferTasteVectorFromQuiz,
  loadQuizItems,
  loadTasteVectorPresetById,
  resolveTasteVectorProposal,
  selectNextQuizItem,
  summarizeQuizTradeoff,
  validateVectorAgainstRegistry,
  type ObserverOutput,
  type QuizItem,
  type QuizSession,
  type Registry,
  type RevealedPreferenceOutcome,
  type RevealedPreferenceSample,
  type TasteVector,
  TasteVectorProposal,
  type TasteVectorProposal as TasteVectorProposalType,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  buildCodecRegistry,
  loadTasteVectorFromPath,
  makeCodecRuntime,
  resolveRepoRoot,
} from "./runtime.js"
import { discoverTasteVector } from "./vector-discovery.js"
import { renderVectorDiff, summarizeVectorDiff } from "./vector-format.js"

const execFileAsync = promisify(execFile)

export interface ElicitCommandOptions {
  readonly action: "quiz" | "bootstrap" | "review" | "accept" | "reject"
  readonly items?: number
  readonly commits?: number
  readonly repoPath: string
  readonly outputPath?: string
  readonly resumePath?: string
  readonly vectorPath?: string
  readonly presetId?: string
  readonly proposalId?: string
  readonly force?: boolean
}

interface MutableQuizSession {
  schema_version: 1
  session_id: string
  created_at: string
  updated_at: string
  domain: string
  item_target: number
  output_path: string
  base_vector: TasteVector
  asked_item_ids: Array<string>
  responses: Array<typeof QuizResponse.Type>
  completed: boolean
}

interface ProposalPaths {
  readonly codecDir: string
  readonly pendingDir: string
  readonly acceptedDir: string
  readonly rejectedDir: string
  readonly revealedPreferenceDir: string
  readonly worktreeVectorPath: string
}

interface CommitLogEntry {
  readonly sha: string
  readonly parents: ReadonlyArray<string>
  readonly subject: string
  readonly body: string
  readonly changedFiles: ReadonlyArray<string>
  readonly revertTarget: string | undefined
  readonly isRevertCommit: boolean
}

interface ScoredCommitLogEntry extends CommitLogEntry {
  readonly observer: ObserverOutput
}

interface RevealedPreferenceCommitEvent extends RevealedPreferenceSample {
  readonly sha: string
  readonly subject: string
  readonly related_sha?: string
  readonly changed_files: ReadonlyArray<string>
  readonly detected_by: "survived-history" | "followup-overlap" | "revert-commit"
}

interface RevealedPreferenceBootstrapReport {
  readonly schema_version: 1
  readonly created_at: string
  readonly repo_root: string
  readonly head_sha: string
  readonly base_vector: string
  readonly algorithm: "pairwise" | "prior-adjusted"
  readonly sample_count: number
  readonly minimum_sample_count: number
  readonly sufficient_data: boolean
  readonly compared_pairs: number
  readonly outcome_counts: {
    readonly accepted: number
    readonly revised: number
    readonly reverted: number
  }
  readonly support: Readonly<Record<string, number>>
  readonly weights: Readonly<Record<string, number>>
  readonly events: ReadonlyArray<RevealedPreferenceCommitEvent>
}

const GREEN = "\u001b[32m"
const CYAN = "\u001b[36m"
const BOLD = "\u001b[1m"
const DIM = "\u001b[2m"
const RESET = "\u001b[0m"

const DEFAULT_BOOTSTRAP_COMMITS = 60
const REVISION_LOOKAHEAD = 3
const REVISION_OVERLAP_THRESHOLD = 0.5

export const runElicitCommand = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action === "quiz") {
      return yield* runQuizAction(opts)
    }

    if (opts.action === "bootstrap") {
      return yield* runBootstrapAction(opts)
    }

    if (opts.action === "review") {
      return yield* runReviewAction(opts)
    }

    if (opts.action === "accept") {
      return yield* runResolutionAction(opts, "accepted")
    }

    if (opts.action === "reject") {
      return yield* runResolutionAction(opts, "rejected")
    }

    return yield* Effect.fail(new Error(`Unknown elicit action: ${String(opts.action)}`))
  })

const runQuizAction = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildCodecRegistry()
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const quizItems = yield* loadQuizItems("typescript")
    validateQuizItemsAgainstRegistry(quizItems, registry)

    const sessionPath =
      opts.resumePath !== undefined
        ? resolve(opts.resumePath)
        : join(repoRoot, ".taste-codec", "quiz-session.json")
    const outputPath =
      opts.outputPath !== undefined
        ? resolve(opts.outputPath)
        : join(repoRoot, ".taste-codec", "vector.json")
    const current = yield* discoverTasteVector({
      repoPath: repoRoot,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })

    const existingSession = yield* readQuizSessionIfPresent(sessionPath)
    if (existingSession === undefined && existsSync(outputPath) && !opts.force) {
      return yield* Effect.fail(
        new Error(`Refusing to overwrite existing vector at ${outputPath}; pass --force to replace it.`),
      )
    }

    const session: MutableQuizSession =
      existingSession !== undefined
        ? toMutableQuizSession(existingSession)
        : {
            schema_version: 1,
            session_id: `quiz-${Date.now().toString(36)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            domain: "typescript",
            item_target: Math.min(Math.max(opts.items ?? 15, 1), 20),
            output_path: outputPath,
            base_vector:
              current.vector ?? {
                id: "all-defaults",
                domain: "typescript",
                signal_overrides: {},
              },
            asked_item_ids: [],
            responses: [],
            completed: false,
          }

    yield* writeQuizSession(sessionPath, session)

    const rl = createInterface({ input, output })
    const handleSigint = () => {
      void Effect.runPromise(
        writeQuizSession(sessionPath, {
          ...session,
          updated_at: new Date().toISOString(),
        }),
      )
        .then(() => {
          console.error(`\nSaved partial quiz session to ${sessionPath}`)
          console.error(`Resume with: taste elicit quiz --resume ${sessionPath}`)
          process.exit(130)
        })
        .catch((error: unknown) => {
          console.error(`\nFailed to save partial quiz session: ${String(error)}`)
          process.exit(130)
        })
    }
    process.once("SIGINT", handleSigint)

    try {
      while (session.responses.length < session.item_target) {
        const nextItem = selectNextQuizItem({
          items: quizItems,
          responses: session.responses,
        })
        if (nextItem === undefined) break

        const questionNumber = session.responses.length + 1
        renderQuizItem(questionNumber, session.item_target, nextItem)
        const answer = yield* promptForQuizAnswer(rl)
        const response = Schema.decodeUnknownSync(QuizResponse)({
          item_id: nextItem.id,
          answer,
          answered_at: new Date().toISOString(),
        })
        session.responses.push(response)
        session.asked_item_ids.push(nextItem.id)
        session.updated_at = new Date().toISOString()
        yield* writeQuizSession(sessionPath, session)

        if (answer === "skip") {
          console.log(`${DIM}Skipped without changing signal weights.${RESET}`)
        } else if (answer === "equal") {
          console.log(`${DIM}Marked equal — evidence stays neutral for this tradeoff.${RESET}`)
        } else {
          console.log(`${DIM}${summarizeQuizTradeoff(nextItem)}${RESET}`)
        }
        console.log("")
      }

      const nextVector = inferTasteVectorFromQuiz({
        baseVector: session.base_vector,
        responses: session.responses,
        items: quizItems,
        vectorId: `${session.base_vector.id}-quiz`,
        outputPath,
      })
      yield* writeJsonFile(outputPath, nextVector)
      yield* Effect.tryPromise({
        try: () => rm(sessionPath, { force: true }),
        catch: (cause) =>
          new Error(`Failed to remove quiz session at ${sessionPath}: ${String(cause)}`),
      })

      console.log("")
      console.log(`${BOLD}Final vector saved to ${outputPath}${RESET}`)
      console.log("")
      for (const line of renderVectorDiff(summarizeVectorDiff(session.base_vector, nextVector))) {
        console.log(line)
      }
      console.log("")
      return 0
    } finally {
      process.off("SIGINT", handleSigint)
      rl.close()
    }
  })

const runBootstrapAction = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const registry = yield* buildCodecRegistry(repoRoot)
    const discovered = yield* discoverTasteVector({
      repoPath: repoRoot,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })

    const preset =
      discovered.vector === undefined && opts.presetId !== undefined
        ? yield* loadTasteVectorPresetById(opts.presetId)
        : undefined
    if (preset !== undefined) {
      yield* validateVectorAgainstRegistry(preset, registry)
    }

    const baseVector = discovered.vector ?? preset
    const baseVectorLabel = discovered.vector?.id ?? preset?.id ?? "all-defaults"
    const commitCount = opts.commits ?? DEFAULT_BOOTSTRAP_COMMITS
    const commitHistory = yield* loadRecentCommitHistory(repoRoot, commitCount)
    const scoredCommits = yield* scoreCommitHistory(repoRoot, baseVector, commitHistory)
    const events = classifyRevealedPreferenceEvents(scoredCommits)

    const outcomeCounts = countOutcomes(events)
    if (outcomeCounts.accepted === 0 || outcomeCounts.revised + outcomeCounts.reverted === 0) {
      return yield* Effect.fail(
        new Error(
          "Revealed preference bootstrap needs both accepted and revised/reverted events in the sampled history.",
        ),
      )
    }

    const priorWeights = collectPriorWeights(baseVector)
    const usePriorAdjusted =
      events.length < MINIMUM_REVEALED_PREFERENCE_SAMPLES && Object.keys(priorWeights).length > 0

    const result = usePriorAdjusted
      ? inferRevealedPreferencePriorAdjusted(events, priorWeights)
      : inferRevealedPreferencePairwise(events, priorWeights)
    const createdAt = new Date().toISOString()
    const proposalId = `proposal-revealed-${scoredCommits.at(-1)?.sha.slice(0, 12) ?? Date.now().toString(36)}`

    const report: RevealedPreferenceBootstrapReport = {
      schema_version: 1,
      created_at: createdAt,
      repo_root: repoRoot,
      head_sha: scoredCommits.at(-1)?.sha ?? "unknown",
      base_vector: baseVectorLabel,
      algorithm: usePriorAdjusted ? "prior-adjusted" : "pairwise",
      sample_count: result.sampleCount,
      minimum_sample_count: MINIMUM_REVEALED_PREFERENCE_SAMPLES,
      sufficient_data: result.sampleCount >= MINIMUM_REVEALED_PREFERENCE_SAMPLES,
      compared_pairs: result.comparedPairs,
      outcome_counts: outcomeCounts,
      support: result.support,
      weights: result.weights,
      events,
    }

    const paths = proposalPaths(repoRoot)
    yield* ensureProposalDirectories(paths)
    const reportPath = join(paths.revealedPreferenceDir, `${proposalId}.json`)
    yield* writeJsonFile(reportPath, report)

    const proposal = deriveRevealedPreferenceProposal({
      proposalId,
      createdAt,
      vector: baseVector,
      algorithm: report.algorithm,
      sampleCount: result.sampleCount,
      minimumSampleCount: MINIMUM_REVEALED_PREFERENCE_SAMPLES,
      comparedPairs: result.comparedPairs,
      outcomeCounts,
      weights: result.weights,
      support: result.support,
      changedFiles: uniqueSorted(events.flatMap((event) => event.changed_files)).slice(0, 25),
      reportPath: relative(repoRoot, reportPath),
    })

    if (proposal === undefined) {
      console.log("")
      console.log("No effective vector deltas emerged from the sampled repo history.")
      console.log("")
      return 0
    }

    const pendingPath = join(paths.pendingDir, `${proposal.id}.json`)
    yield* writeJsonFile(pendingPath, proposal)

    printBootstrapReport({
      repoRoot,
      baseVectorLabel,
      report,
      proposal,
      proposalPath: relative(repoRoot, pendingPath),
      reportPath: relative(repoRoot, reportPath),
      ...(preset?.id !== undefined ? { usedPriorPreset: preset.id } : {}),
    })
    return 0
  })

const runReviewAction = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const proposals = yield* loadPendingProposals(repoRoot)

    console.log("")
    if (proposals.length === 0) {
      console.log("No pending elicitation proposals.")
      console.log("")
      return 0
    }

    console.log(`Pending elicitation proposals: ${proposals.length}`)
    console.log("")
    for (const proposal of proposals) {
      renderProposalReview(proposal)
      console.log("")
      console.log(`  Accept: taste elicit accept ${proposal.id} ${repoRoot}`)
      console.log(`  Reject: taste elicit reject ${proposal.id} ${repoRoot}`)
      console.log("")
    }
    return 0
  })

const runResolutionAction = (
  opts: ElicitCommandOptions,
  status: "accepted" | "rejected",
) =>
  Effect.gen(function* () {
    const proposalId = opts.proposalId
    if (proposalId === undefined) {
      return yield* Effect.fail(new Error(`elicit ${status === "accepted" ? "accept" : "reject"} requires a proposal id`))
    }

    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const paths = proposalPaths(repoRoot)
    const pendingPath = join(paths.pendingDir, `${proposalId}.json`)
    if (!existsSync(pendingPath)) {
      return yield* Effect.fail(new Error(`Pending proposal not found: ${pendingPath}`))
    }

    const proposal = yield* readProposalFile(pendingPath)
    const resolved = resolveTasteVectorProposal({
      proposal,
      status,
    })

    if (status === "rejected") {
      const rejectedPath = join(paths.rejectedDir, `${proposalId}.json`)
      yield* ensureProposalDirectories(paths)
      yield* writeJsonFile(rejectedPath, resolved)
      yield* Effect.tryPromise({
        try: () => rm(pendingPath),
        catch: (cause) => new Error(`Failed to remove pending proposal ${pendingPath}: ${String(cause)}`),
      })
      console.log("")
      console.log(`Rejected proposal: ${proposalId}`)
      console.log(`Archived at:       ${rejectedPath}`)
      if (proposal.source === "ai-assisted-detection") {
        console.log("")
        console.log("AI-assisted mode remains manual. The codec will not silently tighten thresholds behind your back.")
      }
      console.log("")
      return 0
    }

    const registry = yield* buildCodecRegistry(repoRoot)
    const vectorTarget = yield* resolveVectorTarget({
      repoRoot,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const baseVector = vectorTarget.vector ?? defaultVector(proposal.domain)
    const acceptedPath = join(paths.acceptedDir, `${proposalId}.json`)
    const nextVector = applyTasteVectorProposal(baseVector, resolved, {
      artifactPath: relative(repoRoot, acceptedPath),
    })
    yield* validateVectorAgainstRegistry(nextVector, registry)

    yield* ensureProposalDirectories(paths)
    yield* writeJsonFile(acceptedPath, resolved)
    yield* writeJsonFile(vectorTarget.outputPath, nextVector)
    yield* Effect.tryPromise({
      try: () => rm(pendingPath),
      catch: (cause) => new Error(`Failed to remove pending proposal ${pendingPath}: ${String(cause)}`),
    })

    console.log("")
    console.log(`Accepted proposal: ${proposalId}`)
    console.log(`Wrote vector:      ${vectorTarget.outputPath}`)
    console.log(`Archived at:       ${acceptedPath}`)
    console.log("")
    for (const line of renderVectorDiff(summarizeVectorDiff(vectorTarget.vector, nextVector))) {
      console.log(line)
    }
    if (proposal.source === "ai-assisted-detection") {
      console.log("")
      console.log("AI-assisted mode stays explicit in the vector. Edit modes.ai_assisted or reject future proposals to return to manual thresholds.")
    }
    console.log("")
    return 0
  })

const toMutableQuizSession = (session: QuizSession): MutableQuizSession => ({
  ...session,
  asked_item_ids: [...session.asked_item_ids],
  responses: [...session.responses],
})

const renderQuizItem = (questionNumber: number, totalQuestions: number, item: QuizItem): void => {
  console.log(`${BOLD}Question ${questionNumber}/${totalQuestions} — ${item.prompt}${RESET}`)
  console.log("")
  console.log(`${GREEN}[A] ${item.a_title}${RESET}`)
  console.log(colorizeCode(item.a_code, GREEN))
  console.log("")
  console.log(`${CYAN}[B] ${item.b_title}${RESET}`)
  console.log(colorizeCode(item.b_code, CYAN))
  console.log("")
}

const promptForQuizAnswer = (rl: ReadlineInterface) =>
  Effect.tryPromise({
    try: async () => {
      while (true) {
        const raw = (await rl.question("[a] / [b] / [=] equal / [?] skip: ")).trim().toLowerCase()
        if (raw === "a") return "a" as const
        if (raw === "b") return "b" as const
        if (raw === "=") return "equal" as const
        if (raw === "?") return "skip" as const
        console.log("Please answer with a, b, =, or ?")
      }
    },
    catch: (cause) => new Error(`Failed to read quiz answer: ${String(cause)}`),
  })

const colorizeCode = (code: string, color: string): string =>
  code
    .split("\n")
    .map((line) => `${color}${line}${RESET}`)
    .join("\n")

const validateQuizItemsAgainstRegistry = (
  items: ReadonlyArray<QuizItem>,
  registry: Registry,
): void => {
  for (const item of items) {
    for (const signalId of [...Object.keys(item.a_signals), ...Object.keys(item.b_signals)]) {
      if (!registry.has(signalId)) {
        throw new Error(`Quiz item ${item.id} references unknown signal id: ${signalId}`)
      }
    }
  }
}

const readQuizSessionIfPresent = (sessionPath: string): Effect.Effect<QuizSession | undefined, Error, never> =>
  Effect.gen(function* () {
    if (!existsSync(sessionPath)) return undefined
    const raw = yield* Effect.tryPromise({
      try: () => readFile(sessionPath, "utf8"),
      catch: (cause) => new Error(`Failed to read quiz session at ${sessionPath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) => new Error(`Failed to parse quiz session at ${sessionPath}: ${String(cause)}`),
    })
    return yield* decodeQuizSession(parsed)
  })

const writeQuizSession = (sessionPath: string, session: MutableQuizSession) =>
  writeJsonFile(sessionPath, session)

const writeJsonFile = (filePath: string, value: unknown) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(filePath), { recursive: true }),
      catch: (cause) => new Error(`Failed to create directory for ${filePath}: ${String(cause)}`),
    })
    yield* Effect.tryPromise({
      try: () => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
      catch: (cause) => new Error(`Failed to write ${filePath}: ${String(cause)}`),
    })
  })

const proposalPaths = (repoRoot: string): ProposalPaths => ({
  codecDir: join(repoRoot, ".taste-codec"),
  pendingDir: join(repoRoot, ".taste-codec", "proposals", "pending"),
  acceptedDir: join(repoRoot, ".taste-codec", "proposals", "accepted"),
  rejectedDir: join(repoRoot, ".taste-codec", "proposals", "rejected"),
  revealedPreferenceDir: join(repoRoot, ".taste-codec", "elicitation", "revealed-preference"),
  worktreeVectorPath: join(repoRoot, ".taste-codec", "vector.json"),
})

const ensureProposalDirectories = (paths: ProposalPaths) =>
  Effect.tryPromise({
    try: () =>
      Promise.all([
        mkdir(paths.pendingDir, { recursive: true }),
        mkdir(paths.acceptedDir, { recursive: true }),
        mkdir(paths.rejectedDir, { recursive: true }),
        mkdir(paths.revealedPreferenceDir, { recursive: true }),
      ]).then(() => undefined),
    catch: (cause) => new Error(`Failed to create proposal directories: ${String(cause)}`),
  })

const readProposalFile = (filePath: string): Effect.Effect<TasteVectorProposalType, Error, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf8"),
      catch: (cause) => new Error(`Failed to read proposal at ${filePath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) => new Error(`Failed to parse proposal at ${filePath}: ${String(cause)}`),
    })
    return Schema.decodeUnknownSync(TasteVectorProposal)(parsed)
  })

const loadPendingProposals = (repoRoot: string): Effect.Effect<ReadonlyArray<TasteVectorProposalType>, Error, never> =>
  Effect.gen(function* () {
    const paths = proposalPaths(repoRoot)
    if (!existsSync(paths.pendingDir)) return []
    const entries = yield* Effect.tryPromise({
      try: () => readdir(paths.pendingDir),
      catch: (cause) => new Error(`Failed to read ${paths.pendingDir}: ${String(cause)}`),
    })
    const proposals = yield* Effect.forEach(
      entries.filter((entry) => entry.endsWith(".json")).sort((left, right) => left.localeCompare(right)),
      (entry) => readProposalFile(join(paths.pendingDir, entry)),
    )
    return [...proposals].sort((left, right) => left.created_at.localeCompare(right.created_at))
  })

const resolveVectorTarget = (input: {
  readonly repoRoot: string
  readonly registry: Registry
  readonly explicitPath?: string
}) =>
  Effect.gen(function* () {
    if (input.explicitPath !== undefined) {
      const outputPath = resolve(input.explicitPath)
      const vector = existsSync(outputPath) ? yield* loadTasteVectorFromPath(outputPath) : undefined
      if (vector !== undefined) {
        yield* validateVectorAgainstRegistry(vector, input.registry)
      }
      return { vector, outputPath }
    }

    const discovered = yield* discoverTasteVector({
      repoPath: input.repoRoot,
      registry: input.registry,
    })
    return {
      vector: discovered.vector,
      outputPath:
        discovered.source === "worktree" && discovered.path !== undefined
          ? discovered.path
          : proposalPaths(input.repoRoot).worktreeVectorPath,
    }
  })

const defaultVector = (domain: string): TasteVector => ({
  id: "all-defaults",
  domain,
  signal_overrides: {},
})

const loadRecentCommitHistory = (
  repoRoot: string,
  maxCommits: number,
): Effect.Effect<ReadonlyArray<CommitLogEntry>, Error, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        const result = await execFileAsync(
          "git",
          [
            "log",
            `--max-count=${maxCommits}`,
            "--reverse",
            "--format=%H%x1f%P%x1f%s%x1f%b%x1e",
            "HEAD",
          ],
          { cwd: repoRoot },
        )
        return result.stdout
      },
      catch: (cause) => new Error(`Failed to load git history: ${String(cause)}`),
    })

    const entries = raw
      .split("\x1e")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => {
        const [sha, parentsRaw, subject, body] = chunk.split("\x1f")
        const parents = (parentsRaw ?? "")
          .split(/\s+/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        const revertTarget = detectRevertTarget(subject ?? "", body ?? "")
        return {
          sha: sha ?? "",
          parents,
          subject: subject ?? "",
          body: body ?? "",
          revertTarget,
          isRevertCommit: /^revert\b/i.test(subject ?? "") || revertTarget !== undefined,
        }
      })
      .filter((entry) => entry.sha.length > 0)

    const withFiles = yield* Effect.forEach(entries, (entry) =>
      Effect.tryPromise({
        try: async () => {
          const result = await execFileAsync(
            "git",
            ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", entry.sha],
            { cwd: repoRoot },
          )
          return {
            ...entry,
            changedFiles: result.stdout
              .split("\n")
              .map((file) => file.trim())
              .filter((file) => file.length > 0),
          } satisfies CommitLogEntry
        },
        catch: (cause) => new Error(`Failed to read changed files for ${entry.sha}: ${String(cause)}`),
      }),
    )

    return withFiles.filter((entry) => entry.parents.length <= 1 && entry.changedFiles.length > 0)
  })

const scoreCommitHistory = (
  repoRoot: string,
  baseVector: TasteVector | undefined,
  commits: ReadonlyArray<CommitLogEntry>,
): Effect.Effect<ReadonlyArray<ScoredCommitLogEntry>, Error, never> =>
  Effect.gen(function* () {
    const { engine } = yield* makeCodecRuntime(repoRoot, baseVector).pipe(
      Effect.mapError((cause) => new Error(`Failed to build codec runtime: ${String(cause)}`)),
    )
    return yield* Effect.forEach(
      commits,
      (commit) =>
        engine.observeCommit(repoRoot, commit.sha).pipe(
          Effect.map((observer) => ({
            ...commit,
            observer,
          })),
          Effect.mapError((cause) => new Error(`Failed to score ${commit.sha}: ${String(cause)}`)),
        ),
      { concurrency: 4 },
    )
  })

const classifyRevealedPreferenceEvents = (
  commits: ReadonlyArray<ScoredCommitLogEntry>,
): ReadonlyArray<RevealedPreferenceCommitEvent> => {
  const reverted = new Map<string, { relatedSha: string; confidence: number }>()
  for (const commit of commits) {
    if (commit.revertTarget === undefined) continue
    reverted.set(commit.revertTarget, {
      relatedSha: commit.sha,
      confidence: 0.95,
    })
  }

  const revised = new Map<string, { relatedSha: string; confidence: number }>()
  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index]
    if (commit === undefined || commit.isRevertCommit || reverted.has(commit.sha)) continue
    const revision = detectRevisionFollowup(commit, commits.slice(index + 1, index + 1 + REVISION_LOOKAHEAD))
    if (revision !== undefined) {
      revised.set(commit.sha, revision)
    }
  }

  return commits.flatMap((commit) => {
    if (commit.isRevertCommit) return []

    const revertedEvent = reverted.get(commit.sha)
    if (revertedEvent !== undefined) {
      return [toRevealedPreferenceEvent(commit, "reverted", revertedEvent.confidence, revertedEvent.relatedSha, "revert-commit")]
    }

    const revisedEvent = revised.get(commit.sha)
    if (revisedEvent !== undefined) {
      return [toRevealedPreferenceEvent(commit, "revised", revisedEvent.confidence, revisedEvent.relatedSha, "followup-overlap")]
    }

    return [toRevealedPreferenceEvent(commit, "accepted", 1, undefined, "survived-history")]
  })
}

const detectRevisionFollowup = (
  commit: ScoredCommitLogEntry,
  lookahead: ReadonlyArray<ScoredCommitLogEntry>,
): { readonly relatedSha: string; readonly confidence: number } | undefined => {
  let best: { readonly relatedSha: string; readonly confidence: number } | undefined

  for (let index = 0; index < lookahead.length; index += 1) {
    const candidate = lookahead[index]
    if (candidate === undefined || candidate.isRevertCommit) continue
    const overlap = overlapRatio(commit.changedFiles, candidate.changedFiles)
    const hinted = revisionHint(candidate.subject)
    if (overlap < REVISION_OVERLAP_THRESHOLD && !hinted) continue

    const confidence = clamp(
      0.45 + overlap * 0.4 + (hinted ? 0.1 : 0) - index * 0.05,
      0.55,
      0.9,
    )
    if (best === undefined || confidence > best.confidence) {
      best = { relatedSha: candidate.sha, confidence: round(confidence) }
    }
  }

  return best
}

const toRevealedPreferenceEvent = (
  commit: ScoredCommitLogEntry,
  outcome: RevealedPreferenceOutcome,
  confidence: number,
  relatedSha: string | undefined,
  detectedBy: RevealedPreferenceCommitEvent["detected_by"],
): RevealedPreferenceCommitEvent => ({
  id: commit.sha,
  sha: commit.sha,
  subject: commit.subject,
  outcome,
  signal_scores: collectSignalScores(commit.observer),
  confidence,
  ...(relatedSha !== undefined ? { related_sha: relatedSha } : {}),
  changed_files: [...commit.changedFiles],
  detected_by: detectedBy,
})

const collectSignalScores = (observer: ObserverOutput): Readonly<Record<string, number>> =>
  Object.fromEntries(
    [...observer.signalResults.entries()].map(([signalId, result]) => [signalId, round(result.score)]),
  )

const detectRevertTarget = (subject: string, body: string): string | undefined => {
  const match = /This reverts commit ([0-9a-f]{7,40})\.?/i.exec(`${subject}\n${body}`)
  return match?.[1]
}

const revisionHint = (subject: string): boolean =>
  /^(fixup!|squash!)/i.test(subject) ||
  /\b(cleanup|follow-?up|adjust|tweak|polish|refactor|address|revise|trim)\b/i.test(subject)

const overlapRatio = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number => {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const overlap = [...leftSet].filter((file) => rightSet.has(file)).length
  return overlap / Math.min(leftSet.size, rightSet.size)
}

const countOutcomes = (
  events: ReadonlyArray<RevealedPreferenceCommitEvent>,
): {
  readonly accepted: number
  readonly revised: number
  readonly reverted: number
} => ({
  accepted: events.filter((event) => event.outcome === "accepted").length,
  revised: events.filter((event) => event.outcome === "revised").length,
  reverted: events.filter((event) => event.outcome === "reverted").length,
})

const collectPriorWeights = (vector: TasteVector | undefined): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.entries(vector?.signal_overrides ?? {})
      .filter(([, override]) => override.weight !== undefined)
      .map(([signalId, override]) => [signalId, override.weight ?? 1]),
  )

const printBootstrapReport = (input: {
  readonly repoRoot: string
  readonly baseVectorLabel: string
  readonly report: RevealedPreferenceBootstrapReport
  readonly proposal: TasteVectorProposal
  readonly proposalPath: string
  readonly reportPath: string
  readonly usedPriorPreset?: string
}): void => {
  console.log("")
  console.log("Revealed-preference bootstrap")
  console.log("")
  console.log(`  Repo:            ${input.repoRoot}`)
  console.log(`  Head:            ${input.report.head_sha}`)
  console.log(`  Base vector:     ${input.baseVectorLabel}`)
  console.log(`  Algorithm:       ${input.report.algorithm}`)
  console.log(`  Labeled events:  ${input.report.sample_count}/${input.report.minimum_sample_count} ${dataSufficiencyLabel(input.report.sample_count, input.report.minimum_sample_count)}`)
  console.log(
    `  Outcomes:        accepted ${input.report.outcome_counts.accepted}, revised ${input.report.outcome_counts.revised}, reverted ${input.report.outcome_counts.reverted}`,
  )
  console.log(`  Compared pairs:  ${input.report.compared_pairs}`)
  console.log(`  Proposal confidence: ${(input.proposal.confidence * 100).toFixed(0)}%`)
  if (input.usedPriorPreset !== undefined) {
    console.log(`  Prior preset:    ${input.usedPriorPreset}`)
  }
  console.log(`  Pending proposal:${input.proposalPath}`)
  console.log(`  Evidence report: ${input.reportPath}`)
  console.log("")
  console.log("Support / proposed weights:")
  for (const delta of input.proposal.deltas.slice(0, 8)) {
    console.log(
      `  ${delta.signal_id.padEnd(12)} support ${formatSigned(delta.support ?? 0).padStart(5)}  weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}`,
    )
  }
  console.log("")
  console.log("Review with: taste elicit review .")
  console.log("")
}

const renderProposalReview = (proposal: TasteVectorProposal): void => {
  console.log(`${proposal.id}  [${proposal.source}]  confidence ${(proposal.confidence * 100).toFixed(0)}%`)
  console.log(`  ${proposal.summary}`)

  const bootstrapStats = extractBootstrapStats(proposal)
  if (bootstrapStats !== undefined) {
    console.log(
      `  Data sufficiency: ${bootstrapStats.sampleCount}/${bootstrapStats.minimumSampleCount} ${dataSufficiencyLabel(bootstrapStats.sampleCount, bootstrapStats.minimumSampleCount)}; compared pairs ${bootstrapStats.comparedPairs}`,
    )
  }

  if (proposal.mode_deltas.length > 0) {
    console.log("  Mode deltas:")
    for (const delta of proposal.mode_deltas) {
      console.log(`    ${delta.mode} ${String(delta.previous)} -> ${String(delta.proposed)}`)
      console.log(`      ${delta.rationale}`)
    }
  }

  if (proposal.deltas.length > 0) {
    console.log("  Signal deltas:")
    for (const delta of proposal.deltas.slice(0, 8)) {
      const supportSuffix = delta.support !== undefined ? `, support ${formatSigned(delta.support)}` : ""
      const scoreSuffix =
        delta.previous_score !== undefined && delta.current_score !== undefined
          ? `, score ${delta.previous_score.toFixed(2)} -> ${delta.current_score.toFixed(2)}`
          : ""
      console.log(
        `    ${delta.signal_id} weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}${supportSuffix}${scoreSuffix}`,
      )
    }
  }

  const reportArtifact = proposal.evidence.find((entry) => entry.artifact_path !== undefined)?.artifact_path
  if (reportArtifact !== undefined) {
    console.log(`  Artifact: ${reportArtifact}`)
  }

  if (proposal.source === "ai-assisted-detection") {
    console.log("  Anti-dark-pattern stance:")
    console.log("    Accepting writes modes.ai_assisted into the vector. Rejecting preserves manual thresholds.")
    console.log("    The codec does not silently enable AI-assisted mode behind a hidden switch.")
  }
}

const extractBootstrapStats = (
  proposal: TasteVectorProposal,
):
  | {
      readonly sampleCount: number
      readonly minimumSampleCount: number
      readonly comparedPairs: number
    }
  | undefined => {
  const evidence = proposal.evidence.find((entry) => entry.kind === "proposal")
  const sampleCount = numberMeta(evidence?.metadata, "sample_count")
  const minimumSampleCount = numberMeta(evidence?.metadata, "minimum_sample_count")
  const comparedPairs = numberMeta(evidence?.metadata, "compared_pairs")
  if (sampleCount === undefined || minimumSampleCount === undefined || comparedPairs === undefined) {
    return undefined
  }
  return { sampleCount, minimumSampleCount, comparedPairs }
}

const numberMeta = (
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined => {
  const value = metadata?.[key]
  return typeof value === "number" ? value : undefined
}

const dataSufficiencyLabel = (sampleCount: number, minimumSampleCount: number): string =>
  sampleCount >= minimumSampleCount ? "(meets minimum)" : "(below minimum — kept pending)"

const uniqueSorted = (values: ReadonlyArray<string>): Array<string> =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

const round = (value: number): number => Number(value.toFixed(3))

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
