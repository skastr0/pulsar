import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type Baseline,
  decodeBaseline,
} from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"

const BASELINE_RELATIVE_PATH = "pulsar-baseline.json" as const

export const resolveBaselinePath = (repoRoot: string): string =>
  join(repoRoot, BASELINE_RELATIVE_PATH)

export const readBaselineFile = (
  repoRoot: string,
): Effect.Effect<Baseline | undefined, Error, never> =>
  Effect.gen(function* () {
    const baselinePath = resolveBaselinePath(repoRoot)
    const raw = yield* Effect.result(
      Effect.tryPromise({
        try: () => readFile(baselinePath, "utf8"),
        catch: (cause) => cause,
      }),
    )

    if (raw._tag === "Failure") {
      const err = raw.failure
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "ENOENT"
      ) {
        return undefined
      }
      return yield* Effect.fail(
        new Error(`Failed to read baseline at ${baselinePath}: ${String(raw.failure)}`),
      )
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw.success),
      catch: (cause) =>
        new Error(`Failed to parse baseline JSON at ${baselinePath}: ${String(cause)}`),
    })

    return yield* Effect.mapError(decodeBaseline(parsed), (cause) =>
      new Error(`Failed to decode baseline JSON at ${baselinePath}: ${String(cause)}`),
    )
  })

export const writeBaselineFile = (
  repoRoot: string,
  baseline: Baseline,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    const baselinePath = resolveBaselinePath(repoRoot)
    yield* Effect.tryPromise({
      try: () => mkdir(join(baselinePath, ".."), { recursive: true }),
      catch: (cause) =>
        new Error(`Failed to create baseline directory in ${repoRoot}: ${String(cause)}`),
    })
    yield* Effect.tryPromise({
      try: () => writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8"),
      catch: (cause) =>
        new Error(`Failed to write baseline at ${baselinePath}: ${String(cause)}`),
    })
    return baselinePath
  })
