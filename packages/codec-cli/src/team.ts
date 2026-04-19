import { basename, resolve } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import {
  aggregateTeamVector,
  decodeTasteVector,
  type TeamVectorResult,
  type TeamVectorInput,
} from "@taste-codec/core"
import { Effect } from "effect"
import { buildCodecRegistry } from "./runtime.js"

interface TeamMemberFile {
  readonly id?: string
  readonly weight?: number
  readonly vector?: unknown
}

export const runTeamCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const action = args[0]
    if (action !== "aggregate" && action !== "variance") {
      return yield* Effect.fail(new Error("team requires one of: aggregate, variance"))
    }

    const memberPaths = collectMultiValueFlag(args.slice(1), "--members")
    if (memberPaths.length === 0) {
      return yield* Effect.fail(new Error("team requires --members <path...>"))
    }

    const members = yield* Effect.forEach(memberPaths, loadTeamMember)
    const registry = yield* buildCodecRegistry()
    const result = aggregateTeamVector({ members }, registry)

    if (action === "aggregate") {
      const outputPath = parseArg(args.slice(1), "--out")
      if (outputPath !== undefined) {
        const absolutePath = resolve(outputPath)
        yield* Effect.tryPromise(() =>
          writeFile(absolutePath, `${JSON.stringify(result.vector, null, 2)}\n`),
        )
        console.log(`Wrote team vector to ${absolutePath}`)
      } else {
        console.log(JSON.stringify(result.vector, null, 2))
      }
      printVarianceSummary(result)
      return 0
    }

    printVarianceSummary(result)
    return 0
  })

const loadTeamMember = (path: string) =>
  Effect.gen(function* () {
    const absolutePath = resolve(path)
    const raw = yield* Effect.tryPromise(() => readFile(absolutePath, "utf8"))
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as TeamMemberFile | unknown,
      catch: (cause) => new Error(`Failed to parse ${absolutePath}: ${String(cause)}`),
    })

    if (isRecord(parsed) && "vector" in parsed) {
      const vector = yield* decodeTasteVector(parsed.vector)
      const id =
        typeof parsed.id === "string" && parsed.id.length > 0
          ? parsed.id
          : basename(absolutePath, ".json")
      const weight = typeof parsed.weight === "number" ? parsed.weight : undefined
      return {
        id,
        vector,
        ...(weight !== undefined ? { weight } : {}),
      } satisfies TeamVectorInput["members"][number]
    }

    const vector = yield* decodeTasteVector(parsed)
    return {
      id: basename(absolutePath, ".json"),
      vector,
    } satisfies TeamVectorInput["members"][number]
  })

const printVarianceSummary = (result: TeamVectorResult): void => {
  const rows = Object.entries(result.varianceBySignal)
    .sort((left, right) => right[1].variance - left[1].variance || left[0].localeCompare(right[0]))
    .slice(0, 20)

  console.log("")
  console.log("  Team variance:")
  for (const [signalId, variance] of rows) {
    console.log(
      `    ${signalId}  mode=${variance.mode}  weight=${variance.aggregatedWeight.toFixed(2)}  variance=${variance.variance.toFixed(4)}`,
    )
  }
  if (rows.length === 0) {
    console.log("    (no signal overrides to aggregate)")
  }
  console.log("")
}

const parseArg = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

const collectMultiValueFlag = (
  args: ReadonlyArray<string>,
  flag: string,
): ReadonlyArray<string> => {
  const index = args.indexOf(flag)
  if (index === -1) return []
  const values: Array<string> = []
  for (let i = index + 1; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === undefined || arg.startsWith("--")) break
    values.push(arg)
  }
  return values
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
