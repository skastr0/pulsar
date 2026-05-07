import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  decodeBaseline,
  type Baseline,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"

const BASELINE_RELATIVE_PATH = ".pulsar/baseline.json" as const

export const resolveBaselinePath = (repoRoot: string): string =>
  join(repoRoot, BASELINE_RELATIVE_PATH)

export const readBaselineFile = (repoRoot: string) =>
  Effect.gen(function* () {
    const baselinePath = resolveBaselinePath(repoRoot)
    const raw = yield* Effect.either(
      Effect.tryPromise({
        try: () => readFile(baselinePath, "utf8"),
        catch: (cause) => cause,
      }),
    )

    if (raw._tag === "Left") {
      const err = raw.left as NodeJS.ErrnoException
      if (err.code === "ENOENT") return undefined
      return yield* Effect.fail(
        new Error(`Failed to read baseline at ${baselinePath}: ${String(raw.left)}`),
      )
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw.right),
      catch: (cause) =>
        new Error(`Failed to parse baseline JSON at ${baselinePath}: ${String(cause)}`),
    })

    return yield* Effect.mapError(decodeBaseline(parsed), (cause) =>
      new Error(`Failed to decode baseline JSON at ${baselinePath}: ${String(cause)}`),
    )
  })

export const writeBaselineFile = (repoRoot: string, baseline: Baseline) =>
  Effect.gen(function* () {
    const baselinePath = resolveBaselinePath(repoRoot)
    yield* Effect.tryPromise({
      try: () => mkdir(join(repoRoot, ".pulsar"), { recursive: true }),
      catch: (cause) =>
        new Error(`Failed to create .pulsar directory in ${repoRoot}: ${String(cause)}`),
    })
    yield* Effect.tryPromise({
      try: () => writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8"),
      catch: (cause) =>
        new Error(`Failed to write baseline at ${baselinePath}: ${String(cause)}`),
    })
    return baselinePath
  })
