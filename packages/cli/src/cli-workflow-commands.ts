import { Effect } from "effect"
import { runCalibrateCommand } from "./calibrate.js"
import {
  collectPositional,
  fail,
  formatCliError,
  parseArg,
  parsePositiveInt,
  rejectUnknownFlags,
  runWithProgress,
} from "./cli-args.js"
import { runConventionsCommand } from "./conventions.js"
import { runElicitCommand } from "./elicit.js"
import { parseElicitOptions, type ElicitAction } from "./elicit-options.js"
import { runGlossaryCommand } from "./glossary.js"
import { runPersonaCommand } from "./persona.js"

export const runWorkflowCommand = async (
  command: string | undefined,
  commandArgs: ReadonlyArray<string>,
): Promise<boolean> => {
  if (command === "calibrate") {
    await runCalibrate(commandArgs)
    return true
  }
  if (command === "glossary") {
    await runGlossary(commandArgs)
    return true
  }
  if (command === "conventions") {
    await runConventions(commandArgs)
    return true
  }
  if (command === "persona") {
    await runPersona(commandArgs)
    return true
  }
  if (command === "elicit") {
    await runElicit(commandArgs)
    return true
  }
  return false
}

const runCalibrate = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (actionArg !== "suggest") {
    fail("calibrate requires one of: suggest")
  }
  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set<string>()
  rejectUnknownFlags(
    "calibrate",
    actionArgs,
    new Set(["--write", "--json", "--no-progress"]),
  )
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  const exitCode = await runWithProgress("calibrate", commandArgs, () =>
    Effect.runPromise(
      runCalibrateCommand({
        action: "suggest",
        repoPath,
        ...(actionArgs.includes("--json") ? { json: true } : {}),
        ...(actionArgs.includes("--write") ? { write: true } : {}),
      }).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar calibrate failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runGlossary = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (actionArg !== "extract" && actionArg !== "confirm") {
    fail("glossary requires one of: extract, confirm")
  }
  const action = actionArg as "extract" | "confirm"

  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--sha", "--auto-accept-above-frequency"])
  rejectUnknownFlags(
    "glossary",
    actionArgs,
    new Set([...flagsWithValues, "--no-parameters", "--no-progress"]),
  )
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  const sha = parseArg(actionArgs, "--sha")
  const autoAcceptAboveFrequencyRaw =
    action === "confirm" ? parseArg(actionArgs, "--auto-accept-above-frequency") : undefined
  const autoAcceptAboveFrequency =
    autoAcceptAboveFrequencyRaw === undefined
      ? undefined
      : parsePositiveInt(
          autoAcceptAboveFrequencyRaw,
          1,
          "--auto-accept-above-frequency",
        )
  const glossaryOptions = {
    action,
    repoPath,
    ...(sha !== undefined ? { sha } : {}),
    ...(actionArgs.includes("--no-parameters") ? { includeParameters: false } : {}),
    ...(autoAcceptAboveFrequency !== undefined
      ? { autoAcceptAboveFrequency }
      : {}),
  } satisfies Parameters<typeof runGlossaryCommand>[0]

  const exitCode = await runWithProgress("glossary", commandArgs, () =>
    Effect.runPromise(
      runGlossaryCommand(glossaryOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar glossary failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runConventions = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (actionArg !== "extract" && actionArg !== "confirm") {
    fail("conventions requires one of: extract, confirm")
  }
  const action = actionArg as "extract" | "confirm"

  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--sha"])
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  const sha = parseArg(actionArgs, "--sha")
  const conventionsOptions = {
    action,
    repoPath,
    ...(sha !== undefined ? { sha } : {}),
  } satisfies Parameters<typeof runConventionsCommand>[0]

  const exitCode = await runWithProgress("conventions", commandArgs, () =>
    Effect.runPromise(
      runConventionsCommand(conventionsOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar conventions failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runPersona = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (actionArg !== "list" && actionArg !== "show" && actionArg !== "apply" && actionArg !== "diff") {
    fail("persona requires one of: list, show, apply, diff")
  }

  const action = actionArg as "list" | "show" | "apply" | "diff"
  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--to", "--vector"])
  const presetId = collectPositional(actionArgs, flagsWithValues)[0]
  const repoPath = collectPositional(actionArgs, flagsWithValues)[1] ?? "."
  const personaOptions = {
    action,
    ...(presetId !== undefined ? { presetId } : {}),
    ...(parseArg(actionArgs, "--to") !== undefined ? { outputPath: parseArg(actionArgs, "--to")! } : {}),
    ...(parseArg(actionArgs, "--vector") !== undefined
      ? { vectorPath: parseArg(actionArgs, "--vector")! }
      : {}),
    ...(action === "diff" ? { repoPath } : {}),
    ...(commandArgs.includes("--force") ? { force: true } : {}),
  } satisfies Parameters<typeof runPersonaCommand>[0]

  const exitCode = await runWithProgress("persona", commandArgs, () =>
    Effect.runPromise(
      runPersonaCommand(personaOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar persona failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}

const runElicit = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  const actionArg = commandArgs[0]
  if (
    actionArg !== "quiz" &&
    actionArg !== "bootstrap" &&
    actionArg !== "review" &&
    actionArg !== "accept" &&
    actionArg !== "reject"
  ) {
    fail("elicit requires one of: quiz, bootstrap, review, accept, reject")
  }

  const elicitOptions = parseElicitOptions(actionArg as ElicitAction, commandArgs, fail)

  const exitCode = await runWithProgress("elicit", commandArgs, () =>
    Effect.runPromise(
      runElicitCommand(elicitOptions).pipe(
        Effect.catchAll((err) =>
          Effect.sync(() => {
            console.error(`pulsar elicit failed: ${formatCliError(err)}`)
            process.exit(1)
          }),
        ),
      ),
    ),
  )
  process.exit(exitCode)
}
