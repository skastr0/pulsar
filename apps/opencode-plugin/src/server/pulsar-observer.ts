import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  ScoringEngineLayer,
  ScoringEngineTag,
  buildRegistry,
  type Registry,
} from "@skastr0/pulsar-core/scoring"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { ChangedHunk } from "@skastr0/pulsar-core/signal"
import { createTimeSeriesServices } from "@skastr0/pulsar-core/time-series"
import {
  decodePulsarVector,
  isActive as vectorIsActive,
  timeSeriesConfigOf,
  validateVectorAgainstRegistry,
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import { RS_PACK_SIGNALS, RustProjectLayer, isRustSignalPath } from "@skastr0/pulsar-rs-pack"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"

const execFileAsync = promisify(execFile)
const ALL_SIGNALS = [...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]
type RuntimeEntry = {
  readonly registry: Registry
  readonly engine: typeof ScoringEngineTag.Service
}
const runtimePool = new Map<string, Promise<RuntimeEntry>>()

const loadPulsarRegistry = async (): Promise<Registry> => {
  return Effect.runPromise(buildRegistry(ALL_SIGNALS))
}

export const loadPulsarVectorForWorktree = async (
  worktree: string,
): Promise<PulsarVector | undefined> => {
  const path = `${worktree}/.pulsar/vector.json`
  let raw: string

  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (isFileNotFoundError(error)) return undefined
    throw error
  }

  const parsed = JSON.parse(raw)
  const vector = await Effect.runPromise(decodePulsarVector(parsed))
  const registry = await loadPulsarRegistry()
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

const runtimePoolKey = (worktree: string, vector: PulsarVector | undefined): string =>
  `${worktree}\0${stableStringify(vector ?? null)}`

const loadRuntime = (
  worktree: string,
  vector: PulsarVector | undefined,
): Promise<RuntimeEntry> => {
  const key = runtimePoolKey(worktree, vector)
  const existing = runtimePool.get(key)
  if (existing !== undefined) return existing

  const created = Effect.runPromise(
    Effect.gen(function* () {
      const signals = yield* Effect.tryPromise({
        try: () => detectPulsarSignals(worktree),
        catch: (cause) => cause,
      })
      const registry = (yield* buildRegistry(signals)) as Registry
      const activePacks = collectActiveLanguagePacks(registry, vector)
      const engineLayer = ScoringEngineLayer(
        registry,
        (worktreePath) =>
          Layer.mergeAll(
            activePacks.typescript
              ? TsProjectLayer(worktreePath, { productionOnly: true })
              : Layer.empty,
            activePacks.rust ? RustProjectLayer(worktreePath) : Layer.empty,
          ) as Layer.Layer<any, unknown, never>,
        vector,
        { cacheConfig: { cacheDir: join(worktree, ".pulsar", "cache") } },
      )
      const engine = yield* Effect.provide(ScoringEngineTag, engineLayer)
      return { registry, engine }
    }) as Effect.Effect<RuntimeEntry, never, never>,
  ).catch((error) => {
    runtimePool.delete(key)
    throw error
  })

  runtimePool.set(key, created)
  return created
}

const detectPulsarSignals = async (worktree: string) => {
  const result = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: worktree },
  )
  const files = result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
  const hasTypeScript = files.some(
    (file) => file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith("tsconfig.json"),
  )
  const hasRust = files.some(isRustSignalPath)

  return [
    ...(hasTypeScript || hasRust ? SHARED_SIGNALS : []),
    ...(hasTypeScript ? TS_PACK_SIGNALS : []),
    ...(hasRust ? RS_PACK_SIGNALS : []),
  ]
}

const collectActiveLanguagePacks = (
  registry: Registry,
  vector: PulsarVector | undefined,
): { readonly typescript: boolean; readonly rust: boolean } => {
  let typescript = false
  let rust = false
  for (const signal of registry.sorted) {
    if (!vectorIsActive(signal.id, vector)) continue
    if (signal.id.startsWith("TS-")) typescript = true
    if (signal.id.startsWith("RS-")) rust = true
  }
  return { typescript, rust }
}

export const observeCurrentWorktree = async (input: {
  readonly worktree: string
  readonly vector: PulsarVector | undefined
  readonly changedHunks?: ReadonlyArray<ChangedHunk>
  readonly persistTimeSeries?: boolean
}): Promise<{
  readonly sha: string
  readonly registry: Registry
  readonly observerOutput: ObserverOutput
}> => {
  const { registry, engine } = await loadRuntime(input.worktree, input.vector)
  const sha = await readHeadSha(input.worktree)
  const observerOutput = await Effect.runPromise(
    engine.observeWorktree(input.worktree, sha, {
      changedHunks: input.changedHunks ?? [],
    }),
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

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

const isFileNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  String((error as { code?: unknown }).code) === "ENOENT"
