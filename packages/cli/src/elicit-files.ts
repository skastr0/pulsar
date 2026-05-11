import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import {
  decodeQuizSession,
  PulsarVectorProposal,
  type PulsarVectorProposal as PulsarVectorProposalType,
  type QuizSession,
} from "@skastr0/pulsar-core/elicitation"
import {
  type PulsarVector,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { loadPulsarVectorFromPath } from "./runtime.js"
import { discoverPulsarVector } from "./vector-discovery.js"
import type { MutableQuizSession, ProposalPaths } from "./elicit-types.js"

export const writeQuizSession = (sessionPath: string, session: MutableQuizSession) =>
  writeJsonFile(sessionPath, session)

export const readQuizSessionIfPresent = (sessionPath: string): Effect.Effect<QuizSession | undefined, Error, never> =>
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

export const writeJsonFile = (filePath: string, value: unknown) =>
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

export const proposalPaths = (repoRoot: string): ProposalPaths => ({
  pulsarDir: join(repoRoot, ".pulsar"),
  pendingDir: join(repoRoot, ".pulsar", "proposals", "pending"),
  acceptedDir: join(repoRoot, ".pulsar", "proposals", "accepted"),
  rejectedDir: join(repoRoot, ".pulsar", "proposals", "rejected"),
  revealedPreferenceDir: join(repoRoot, ".pulsar", "elicitation", "revealed-preference"),
  worktreeVectorPath: join(repoRoot, ".pulsar", "vector.json"),
})

export const ensureProposalDirectories = (paths: ProposalPaths) =>
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

export const readProposalFile = (filePath: string): Effect.Effect<PulsarVectorProposalType, Error, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf8"),
      catch: (cause) => new Error(`Failed to read proposal at ${filePath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) => new Error(`Failed to parse proposal at ${filePath}: ${String(cause)}`),
    })
    return Schema.decodeUnknownSync(PulsarVectorProposal)(parsed)
  })

export const loadPendingProposals = (repoRoot: string): Effect.Effect<ReadonlyArray<PulsarVectorProposalType>, Error, never> =>
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

export const resolveVectorTarget = (input: {
  readonly repoRoot: string
  readonly registry: Registry
  readonly explicitPath?: string
}) =>
  Effect.gen(function* () {
    if (input.explicitPath !== undefined) {
      const outputPath = resolve(input.explicitPath)
      const vector = existsSync(outputPath) ? yield* loadPulsarVectorFromPath(outputPath) : undefined
      if (vector !== undefined) {
        yield* validateVectorAgainstRegistry(vector, input.registry)
      }
      return { vector, outputPath }
    }

    const discovered = yield* discoverPulsarVector({
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

export const defaultVector = (domain: string): PulsarVector => ({
  id: "all-defaults",
  domain,
  signal_overrides: {},
})
