import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { stdin as input, stdout as output } from "node:process"
import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises"
import { join, resolve } from "node:path"
import {
  inferPulsarVectorFromQuiz,
  loadQuizItems,
  type QuizItem,
  QuizResponse,
  type QuizSession,
  selectNextQuizItem,
  summarizeQuizTradeoff,
} from "@skastr0/pulsar-core/elicitation"
import { type PulsarVector } from "@skastr0/pulsar-core/vector"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { buildPulsarRegistry, resolveRepoRoot } from "./runtime.js"
import { discoverPulsarVector } from "./vector-discovery.js"
import {
  readQuizSessionIfPresent,
  writeJsonFile,
  writeQuizSession,
} from "./elicit-files.js"
import {
  dimAnsi,
  printFinalQuizVector,
  renderQuizItem,
  resetAnsi,
} from "./elicit-ui.js"
import type {
  ElicitCommandOptions,
  MutableQuizSession,
  QuizActionContext,
} from "./elicit-types.js"

export const runQuizAction = (
  opts: ElicitCommandOptions,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const context = yield* prepareQuizAction(opts)
    const { sessionPath, session } = context

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
          console.error(`Resume with: pulsar elicit quiz --resume ${sessionPath}`)
          process.exit(130)
        })
        .catch((error: unknown) => {
          console.error(`\nFailed to save partial quiz session: ${String(error)}`)
          process.exit(130)
        })
    }
    process.once("SIGINT", handleSigint)

    try {
      yield* runQuizPromptLoop(context, rl)
      yield* finalizeQuizAction(context)
      return 0
    } finally {
      process.off("SIGINT", handleSigint)
      rl.close()
    }
  })

const prepareQuizAction = (
  opts: ElicitCommandOptions,
): Effect.Effect<QuizActionContext, Error, never> =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry()
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const quizItems = yield* loadQuizItems("typescript")
    validateQuizItemsAgainstRegistry(quizItems, registry)
    const sessionPath = quizSessionPath(repoRoot, opts)
    const outputPath = quizOutputPath(repoRoot, opts)
    const current = yield* discoverPulsarVector({
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
    return {
      sessionPath,
      outputPath,
      quizItems,
      session: quizSessionForAction(opts, outputPath, existingSession, current.vector),
    }
  })

const quizSessionPath = (repoRoot: string, opts: ElicitCommandOptions): string =>
  opts.resumePath !== undefined
    ? resolve(opts.resumePath)
    : join(repoRoot, ".pulsar", "quiz-session.json")

const quizOutputPath = (repoRoot: string, opts: ElicitCommandOptions): string =>
  opts.outputPath !== undefined ? resolve(opts.outputPath) : join(repoRoot, ".pulsar", "vector.json")

const quizSessionForAction = (
  opts: ElicitCommandOptions,
  outputPath: string,
  existingSession: QuizSession | undefined,
  currentVector: PulsarVector | undefined,
): MutableQuizSession =>
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
          currentVector ?? {
            id: "all-defaults",
            domain: "typescript",
            signal_overrides: {},
          },
        asked_item_ids: [],
        responses: [],
        completed: false,
      }

const runQuizPromptLoop = (
  context: QuizActionContext,
  rl: ReadlineInterface,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const { session, quizItems, sessionPath } = context
    while (session.responses.length < session.item_target) {
      const nextItem = selectNextQuizItem({ items: quizItems, responses: session.responses })
      if (nextItem === undefined) break
      yield* askQuizItem(session, sessionPath, nextItem, rl)
    }
  })

const askQuizItem = (
  session: MutableQuizSession,
  sessionPath: string,
  nextItem: QuizItem,
  rl: ReadlineInterface,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    renderQuizItem(session.responses.length + 1, session.item_target, nextItem)
    const answer = yield* promptForQuizAnswer(rl)
    session.responses.push(
      Schema.decodeUnknownSync(QuizResponse)({
        item_id: nextItem.id,
        answer,
        answered_at: new Date().toISOString(),
      }),
    )
    session.asked_item_ids.push(nextItem.id)
    session.updated_at = new Date().toISOString()
    yield* writeQuizSession(sessionPath, session)
    printQuizAnswerSummary(answer, nextItem)
  })

const printQuizAnswerSummary = (
  answer: (typeof QuizResponse.Type)["answer"],
  nextItem: QuizItem,
): void => {
  if (answer === "skip") {
    console.log(`${dimAnsi}Skipped without changing signal weights.${resetAnsi}`)
  } else if (answer === "equal") {
    console.log(`${dimAnsi}Marked equal — evidence stays neutral for this tradeoff.${resetAnsi}`)
  } else {
    console.log(`${dimAnsi}${summarizeQuizTradeoff(nextItem)}${resetAnsi}`)
  }
  console.log("")
}

const finalizeQuizAction = (
  context: QuizActionContext,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    const { outputPath, quizItems, session, sessionPath } = context
    const nextVector = inferPulsarVectorFromQuiz({
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
    printFinalQuizVector(outputPath, session.base_vector, nextVector)
  })

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

const toMutableQuizSession = (session: QuizSession): MutableQuizSession => ({
  ...session,
  asked_item_ids: [...session.asked_item_ids],
  responses: [...session.responses],
})

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
