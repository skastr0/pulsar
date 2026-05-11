import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import type { FirstCrossingQuery } from "./bisect-types.js"
import { withCliProgress } from "./progress.js"

export const fail = (message: string, code = 1): never => {
  console.error(`pulsar: ${message}`)
  process.exit(code)
}

export const parseArg = (
  args: ReadonlyArray<string>,
  flag: string,
): string | undefined => {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  return args[i + 1]
}

const flagNameOf = (arg: string): string | undefined => {
  if (!arg.startsWith("--")) return undefined
  const equalsIndex = arg.indexOf("=")
  return equalsIndex === -1 ? arg : arg.slice(0, equalsIndex)
}

export const rejectUnknownFlags = (
  commandName: string,
  args: ReadonlyArray<string>,
  allowedFlags: ReadonlySet<string>,
): void => {
  for (const arg of args) {
    const flagName = flagNameOf(arg)
    if (flagName === undefined || allowedFlags.has(flagName)) continue
    fail(`${commandName} does not accept ${flagName}`)
  }
}

export const collectPositional = (
  args: ReadonlyArray<string>,
  flagsWithValues: ReadonlySet<string>,
): ReadonlyArray<string> =>
  args.filter((arg, index) => {
    if (arg.startsWith("--")) return false
    const prev = args[index - 1]
    return prev === undefined || !flagsWithValues.has(prev)
  })

export const parsePositiveInt = (
  raw: string | undefined,
  fallback: number,
  flag: string,
  failWith: (message: string) => never = fail,
): number => {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    failWith(`${flag} must be a positive integer, got: ${raw}`)
  }
  return n
}

export const parseSamplingMode = (
  raw: string | undefined,
): "auto" | "full" | "merge-only" | "adaptive-delta" => {
  if (raw === undefined) return "auto"
  if (
    raw === "auto" ||
    raw === "full" ||
    raw === "merge-only" ||
    raw === "adaptive-delta"
  ) {
    return raw
  }
  fail(`--sample must be one of: auto, full, merge-only, adaptive-delta (got ${raw})`)
  throw new Error("unreachable")
}

export const parseCategory = (raw: string | undefined): Category | undefined => {
  if (raw === undefined) return undefined
  if ((CATEGORIES as ReadonlyArray<string>).includes(raw)) {
    return raw as Category
  }
  fail(`--category must be one of: ${CATEGORIES.join(", ")}`)
}

export const parseRepeatedArgs = (
  args: ReadonlyArray<string>,
  flag: string,
): ReadonlyArray<string> => {
  const values: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith("--")) {
      fail(`${flag} requires a value`)
    }
    values.push(value as string)
  }
  return values
}

export const parseRepeatedCategories = (
  args: ReadonlyArray<string>,
): ReadonlyArray<Category> =>
  parseRepeatedArgs(args, "--category").map((raw) => {
    const category = parseCategory(raw)
    if (category === undefined) throw new Error("unreachable")
    return category
  })

export const parseFirstCrossing = (
  raw: string | undefined,
): FirstCrossingQuery | undefined => {
  if (raw === undefined) return undefined
  const match = /^([A-Za-z0-9_.:-]+)\s*(<=|>=|<|>)\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.exec(raw)
  if (match === null) {
    fail("--first-crossing must look like TS-LD-02<0.5, readiness>=0.8, or generated-slop<=0.7")
  }
  const checkedMatch = match as RegExpExecArray
  return {
    target: checkedMatch[1]!,
    op: checkedMatch[2]! as FirstCrossingQuery["op"],
    threshold: Number(checkedMatch[3]!),
  }
}

export const formatCliError = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (typeof err === "object" && err !== null) {
    const tagged = err as { _tag?: string; id?: string; message?: string }
    if (tagged._tag === "UnknownSignalIdError" && typeof tagged.id === "string") {
      return `Unknown signal id: ${tagged.id}`
    }
    if (typeof tagged.message === "string" && tagged.message !== "") {
      return tagged.message
    }
  }
  return String(err)
}

const progressEnabled = (
  name: string,
  args: ReadonlyArray<string>,
): boolean =>
  !(name === "elicit" && args[0] === "quiz") &&
  !args.includes("--no-progress") && !args.includes("--json")

const commandProgressLabel = (name: string): string => `pulsar ${name} running`

export const runWithProgress = async <A>(
  name: string,
  args: ReadonlyArray<string>,
  run: () => Promise<A>,
): Promise<A> =>
  await withCliProgress(run, {
    label: commandProgressLabel(name),
    enabled: progressEnabled(name, args),
  })
