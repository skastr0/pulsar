import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
  buildRegistry,
  createTimeSeriesServices,
  decodeTasteVector,
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  observe,
  timeSeriesConfigOf,
  validateVectorAgainstRegistry,
  type ObserverOutput,
  type Registry,
  type ChangedHunk,
  type TasteVector,
} from "@taste-codec/core"
import { RS_PACK_SIGNALS, RustProjectLayer } from "@taste-codec/rs-pack"
import { SHARED_SIGNALS } from "@taste-codec/shared-signals"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@taste-codec/ts-pack"
import { Effect, Layer } from "effect"

const execFileAsync = promisify(execFile)
const ALL_SIGNALS = [...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]

const loadCodecRegistry = async (): Promise<Registry> => {
  return Effect.runPromise(buildRegistry(ALL_SIGNALS))
}

export const loadTasteVectorForWorktree = async (
  worktree: string,
): Promise<TasteVector | undefined> => {
  const path = `${worktree}/.taste-codec/vector.json`
  let raw: string

  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return undefined
    throw error
  }

  const parsed = JSON.parse(raw)
  const vector = await Effect.runPromise(decodeTasteVector(parsed))
  const registry = await loadCodecRegistry()
  await Effect.runPromise(validateVectorAgainstRegistry(vector, registry))
  return vector
}

const readHeadSha = async (worktree: string): Promise<string> => {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktree })
    return result.stdout.trim()
  } catch {
    return "unknown"
  }
}

export const observeCurrentWorktree = async (input: {
  readonly worktree: string
  readonly vector: TasteVector | undefined
  readonly changedHunks?: ReadonlyArray<ChangedHunk>
  readonly persistTimeSeries?: boolean
}): Promise<{
  readonly sha: string
  readonly registry: Registry
  readonly observerOutput: ObserverOutput
}> => {
  const registry = await loadCodecRegistry()
  const referenceEntries = await Effect.runPromise(
    loadCanonicalReferenceDataEntries(input.worktree),
  )
  const sha = await readHeadSha(input.worktree)

  const envLayer = Layer.mergeAll(
    Layer.succeed(SignalContextTag, {
      gitSha: sha,
      worktreePath: input.worktree,
      changedHunks: input.changedHunks ?? [],
    }),
    Layer.succeed(ReferenceDataTag, makeReferenceData(referenceEntries)),
    InMemoryCacheLayer,
    TsProjectLayer(input.worktree),
    RustProjectLayer(input.worktree),
  )

  const observerOutput = await Effect.runPromise(
    Effect.provide(observe(registry, input.vector), envLayer) as Effect.Effect<
      ObserverOutput,
      never,
      never
    >,
  )

  const timeSeriesConfig = timeSeriesConfigOf(input.vector)
  if (input.persistTimeSeries === true || timeSeriesConfig.enabled) {
    const services = createTimeSeriesServices(input.worktree, {
      compactionThreshold: timeSeriesConfig.compaction_threshold,
      rawRetentionDays: timeSeriesConfig.raw_retention_days,
    })
    await Effect.runPromise(services.writer.appendObservation(sha, observerOutput))
  }

  return { sha, registry, observerOutput }
}

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
