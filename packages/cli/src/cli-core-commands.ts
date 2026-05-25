import { Effect } from "effect"
import { runBackpressureCommand } from "./backpressure.js"
import { runBaselineCommand } from "./baseline.js"
import { runBisectCommand } from "./bisect.js"
import { runCoverageIngestCommand, type CoverageIngestFormat } from "./coverage.js"
import {
  collectPositional,
  fail,
  formatCliError,
  parseArg,
  parseCategory,
  parseFirstCrossing,
  parsePositiveInt,
  parseRepeatedArgs,
  parseRepeatedCategories,
  parseSamplingMode,
  rejectUnknownFlags,
  runWithProgress,
} from "./cli-args.js"
import { runScoreCommand } from "./score.js"

export const runCoreCommand = async (
  command: string | undefined,
  commandArgs: ReadonlyArray<string>,
): Promise<boolean> => {
  if (command === "score") {
    await runScore(commandArgs)
    return true
  }
  if (command === "baseline") {
    await runBaseline(commandArgs)
    return true
  }
  if (command === "backpressure") {
    await runBackpressure(commandArgs)
    return true
  }
  if (command === "bisect") {
    await runBisect(commandArgs)
    return true
  }
  if (command === "coverage") {
    await runCoverage(commandArgs)
    return true
  }
  return false
}

const runScore = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const flagsWithValues = new Set(["--signal", "--vector", "--category", "--diff"])
  rejectUnknownFlags(
    "score",
    commandArgs,
    new Set([
      ...flagsWithValues,
      "--json",
      "--ci",
      "--profile",
      "--changed-only",
      "--agent-view",
      "--no-progress",
    ]),
  )
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."
  const signalId = parseArg(commandArgs, "--signal")
  const vectorPath = parseArg(commandArgs, "--vector")
  const diffRange = parseArg(commandArgs, "--diff")
  const category = parseCategory(parseArg(commandArgs, "--category"))
  const scoreOptions = {
    repoPath,
    ...(signalId !== undefined ? { signalId } : {}),
    ...(vectorPath !== undefined ? { vectorPath } : {}),
    ...(diffRange !== undefined ? { diffRange } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(commandArgs.includes("--json") ? { json: true } : {}),
    ...(commandArgs.includes("--ci") ? { ci: true } : {}),
    ...(commandArgs.includes("--profile") ? { profile: true } : {}),
    ...(commandArgs.includes("--changed-only") ? { changedOnly: true } : {}),
    ...(commandArgs.includes("--agent-view") ? { agentView: true } : {}),
  } satisfies Parameters<typeof runScoreCommand>[0]

  const exitCode = await runWithProgress("score", commandArgs, () =>
    Effect.runPromise(
      runScoreCommand(scoreOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar score failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runBaseline = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (actionArg !== "set" && actionArg !== "refresh" && actionArg !== "show") {
    fail("baseline requires one of: set, refresh, show")
  }
  const action = actionArg as "set" | "refresh" | "show"

  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--vector"])
  const vectorPath = parseArg(actionArgs, "--vector")
  if (action === "show" && vectorPath !== undefined) {
    fail("baseline show does not accept --vector")
  }

  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  const baselineOptions = {
    action,
    repoPath,
    ...(vectorPath !== undefined ? { vectorPath } : {}),
  } satisfies Parameters<typeof runBaselineCommand>[0]

  const exitCode = await runWithProgress("baseline", commandArgs, () =>
    Effect.runPromise(
      runBaselineCommand(baselineOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar baseline failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runCoverage = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const action = commandArgs[0]
  if (action !== "ingest") {
    fail("coverage requires: ingest <path> [--format auto|lcov|istanbul] [<repo-path>]")
  }
  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--format"])
  rejectUnknownFlags("coverage", actionArgs, new Set([...flagsWithValues, "--no-progress"]))
  const positional = collectPositional(actionArgs, flagsWithValues)
  const reportPath = positional[0] ?? fail("coverage ingest requires a report path")
  const repoPath = positional[1] ?? "."
  const format = parseCoverageFormat(parseArg(actionArgs, "--format"))

  const exitCode = await runWithProgress("coverage", commandArgs, () =>
    Effect.runPromise(
      runCoverageIngestCommand({
        repoPath,
        reportPath,
        ...(format !== undefined ? { format } : {}),
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar coverage failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const parseCoverageFormat = (raw: string | undefined): CoverageIngestFormat | undefined => {
  if (raw === undefined) return undefined
  if (raw === "auto" || raw === "lcov" || raw === "istanbul") return raw
  fail("--format must be one of: auto, lcov, istanbul")
}

const runBackpressure = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const flagsWithValues = new Set(["--vector"])
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."
  const vectorPath = parseArg(commandArgs, "--vector")
  const exitCode = await runWithProgress("backpressure", commandArgs, () =>
    Effect.runPromise(
      runBackpressureCommand({
        repoPath,
        ...(vectorPath !== undefined ? { vectorPath } : {}),
        ...(commandArgs.includes("--trend") ? { trend: true } : {}),
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar backpressure failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runBisect = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const flagsWithValues = new Set([
    "--signal",
    "--vector",
    "--range",
    "--concurrency",
    "--top",
    "--sample",
    "--category",
    "--scope",
    "--first-crossing",
  ])
  rejectUnknownFlags(
    "bisect",
    commandArgs,
    new Set([...flagsWithValues, "--observer", "--json", "--no-progress"]),
  )
  const signalId = parseArg(commandArgs, "--signal")
  const observer = commandArgs.includes("--observer")
  if (signalId !== undefined && observer) {
    fail("bisect accepts either --signal <id> or --observer, not both")
  }

  const range = parseArg(commandArgs, "--range") ?? fail("bisect requires --range <from>..<to>")
  const rangeMatch = /^([^.]+)\.\.([^.]+)$/.exec(range)
  if (rangeMatch === null) {
    fail("bisect --range must be <from>..<to> (two dots, no three-dot syntax)")
  }
  const checkedRangeMatch = rangeMatch as RegExpExecArray

  const fromSha = checkedRangeMatch[1]!
  const toSha = checkedRangeMatch[2]!
  const concurrency = parsePositiveInt(parseArg(commandArgs, "--concurrency"), 4, "--concurrency")
  const topCulprits = parsePositiveInt(parseArg(commandArgs, "--top"), 5, "--top")
  const sampling = parseSamplingMode(parseArg(commandArgs, "--sample"))
  const firstCrossing = parseFirstCrossing(parseArg(commandArgs, "--first-crossing"))
  const selectedCategories = parseRepeatedCategories(commandArgs)
  const selectedSignals = parseRepeatedArgs(commandArgs, "--scope")
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."

  await runWithProgress("bisect", commandArgs, () =>
    Effect.runPromise(
      runBisectCommand({
        ...(signalId !== undefined ? { signalId } : {}),
        ...(observer ? { observer: true } : {}),
        ...(parseArg(commandArgs, "--vector") !== undefined
          ? { vectorPath: parseArg(commandArgs, "--vector")! }
          : {}),
        ...(selectedSignals.length > 0 ? { selectedSignals } : {}),
        ...(selectedCategories.length > 0 ? { selectedCategories } : {}),
        ...(firstCrossing !== undefined ? { firstCrossing } : {}),
        fromSha,
        toSha,
        repoPath,
        concurrency,
        topCulprits,
        sampling,
        json: commandArgs.includes("--json"),
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar bisect failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(0)
}
