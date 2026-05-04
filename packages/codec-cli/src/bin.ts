#!/usr/bin/env bun
import { CATEGORIES, type Category } from "@taste-codec/core"
import { Effect } from "effect"
import { runBackpressureCommand } from "./backpressure.js"
import { runBaselineCommand } from "./baseline.js"
import { runBisectCommand } from "./bisect.js"
import { runConventionsCommand } from "./conventions.js"
import { runElicitCommand } from "./elicit.js"
import { runGlossaryCommand } from "./glossary.js"
import { CLI_VERSION } from "./index.js"
import { runPersonaCommand } from "./persona.js"
import { runScoreCommand } from "./score.js"

const argv = process.argv.slice(2)

const help = (): void => {
  console.log(`taste — codec CLI v${CLI_VERSION}

Usage:
  taste score [<repo-path>]
  taste score --signal <id> [<repo-path>]
  taste baseline <set|refresh|show> [<repo-path>]
  taste backpressure [--trend] [--vector <path>] [<repo-path>]
  taste bisect --signal <id> --range <from>..<to> [<repo-path>]
  taste bisect --observer --range <from>..<to> [--vector <path>] [<repo-path>]
  taste bisect --range <from>..<to> [--vector <path>] [<repo-path>]
  taste persona <list|show|apply|diff> [args]
  taste elicit <quiz|bootstrap|review|accept|reject> [args]
  taste glossary extract --sha <ref> [--no-parameters] [<repo-path>]
  taste glossary confirm [<repo-path>]
  taste conventions extract --sha <ref> [<repo-path>]
  taste conventions confirm [<repo-path>]
  taste --version

Commands:
  score        Run one signal or the full Observer against a repo.
  baseline     Record or inspect tolerated hard-gate debt for ratcheting.
  backpressure Evaluate the score history as green/yellow/red pressure.
  bisect       Replay a commit range through one signal or the full Observer.
  persona      List, show, apply, or diff curated taste presets.
  elicit       Run quiz, bootstrap, and proposal review workflows.
  glossary     Extract a draft glossary and confirm canonical terms.
  conventions  Extract a draft schema-conventions file and confirm it.

Score options:
  --signal <id>        Single-signal mode (existing TC-003 path).
  --vector <path>      Load a specific taste vector JSON.
  --json               Emit raw ObserverOutput JSON.
  --category <name>    Human output for one category only.
  --ci                 Apply baseline ratcheting and exit 2 on new violations.
  --profile            Include runtime attribution and bypass observer cache.

Baseline options:
  set                  Write .taste-codec/baseline.json from current hard-gate debt.
  refresh              Replace the baseline with current state.
  show                 Render tolerated counts per signal + baseline age.

Backpressure options:
  --trend              Render the persisted series as a trend table.
  --vector <path>      Optional taste vector JSON.

Bisect options:
  --signal <id>        Single-signal bisect mode.
  --observer           Run the full Observer across active signals.
  --vector <path>      Optional taste vector JSON.
  --range <a>..<b>     Commit range, oldest..newest.
  --concurrency <n>    Parallel worktrees (default 4).
  --top <n>            Number of culprit commits (default 5).
  --json               Emit JSON instead of human-readable output.

Persona options:
  list                 Enumerate available presets.
  show <name>          Print the full preset vector and rationale.
  apply <name>         Write the preset to --to <path> (refuses overwrite without --force).
  diff <name>          Show deltas between the current vector and the preset.
  --to <path>          Output path for persona apply.
  --force              Overwrite an existing output file.
  --vector <path>      Compare against an explicit vector instead of discovery.

Elicit options:
  quiz                 Run the pairwise tradeoff quiz.
  bootstrap            Infer a pending proposal from recent repo history.
  review               Show pending elicitation proposals.
  accept <id>          Accept one pending proposal and update the vector.
  reject <id>          Reject one pending proposal without resurfacing it.
  --items <count>      Quiz questions to ask (default 15, max 20).
  --resume <path>      Resume a saved quiz session JSON.
  --to <path>          Quiz output path for the final vector.
  --vector <path>      Explicit vector path for quiz/bootstrap/accept flows.
  --force              Overwrite an existing quiz output vector.
  --commits <count>    Bootstrap over the most recent N commits (default 60).
  --preset <name>      Optional preset prior for low-sample bootstrap runs.

Glossary options:
  --sha <ref>          Commit or ref to inspect in a detached worktree.
  --no-parameters      Exclude parameter names from glossary extraction.

Conventions options:
  --sha <ref>          Commit or ref to inspect in a detached worktree.

Vector discovery order (score + baseline when --vector is omitted):
  1. .taste-codec/vector.json at the worktree root
  2. ~/.config/taste-codec/vector.json as an organization-standard fallback
  3. Fallback: detected language-pack/shared signals active with default config and weight 1

Examples:
  taste score .
  taste score --json .
  taste score --profile --category generated-slop .
  taste score --category legibility-decay .
  taste score --ci .
  taste baseline set .
  taste baseline show .
  taste backpressure .
  taste backpressure --trend .
  taste bisect --signal TS-RP-01 --range HEAD~50..HEAD
  taste bisect --observer --range HEAD~50..HEAD
  taste bisect --range HEAD~50..HEAD --vector ./taste-vector.json --json /path/to/repo
  taste persona list
  taste persona show security-paranoid
  taste persona apply strict-type-safety --to ./.taste-codec/vector.json
  taste persona diff ai-slop-defense
  taste elicit quiz --items 15 .
  taste elicit bootstrap --commits 80 --preset strict-type-safety .
  taste elicit review .
  taste elicit accept proposal-ai-assisted-mode .
  taste elicit reject proposal-abc123def456 .
  taste glossary extract --sha HEAD .
  taste glossary confirm .
  taste conventions extract --sha HEAD .
  taste conventions confirm .
`)
}

const fail = (message: string, code = 1): never => {
  console.error(`taste: ${message}`)
  process.exit(code)
}

const parseArg = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  return args[i + 1]
}

const collectPositional = (
  args: ReadonlyArray<string>,
  flagsWithValues: ReadonlySet<string>,
): ReadonlyArray<string> =>
  args.filter((arg, index) => {
    if (arg.startsWith("--")) return false
    const prev = args[index - 1]
    return prev === undefined || !flagsWithValues.has(prev)
  })

const parsePositiveInt = (raw: string | undefined, fallback: number, flag: string): number => {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    fail(`${flag} must be a positive integer, got: ${raw}`)
  }
  return n
}

const parseSamplingMode = (
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

const parseCategory = (raw: string | undefined): Category | undefined => {
  if (raw === undefined) return undefined
  if ((CATEGORIES as ReadonlyArray<string>).includes(raw)) {
    return raw as Category
  }
  fail(`--category must be one of: ${CATEGORIES.join(", ")}`)
}

const formatCliError = (err: unknown): string => {
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

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  help()
  process.exit(0)
}

if (argv[0] === "--version" || argv[0] === "-v") {
  console.log(CLI_VERSION)
  process.exit(0)
}

const command = argv[0]
const commandArgs = argv.slice(1)

if (command === "score") {
  const flagsWithValues = new Set(["--signal", "--vector", "--category"])
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."
  const signalId = parseArg(commandArgs, "--signal")
  const vectorPath = parseArg(commandArgs, "--vector")
  const category = parseCategory(parseArg(commandArgs, "--category"))
  const scoreOptions = {
    repoPath,
    ...(signalId !== undefined ? { signalId } : {}),
    ...(vectorPath !== undefined ? { vectorPath } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(commandArgs.includes("--json") ? { json: true } : {}),
    ...(commandArgs.includes("--ci") ? { ci: true } : {}),
    ...(commandArgs.includes("--profile") ? { profile: true } : {}),
  } satisfies Parameters<typeof runScoreCommand>[0]

  const exitCode = await Effect.runPromise(
    runScoreCommand(scoreOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste score failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "baseline") {
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

  const exitCode = await Effect.runPromise(
    runBaselineCommand(baselineOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste baseline failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "backpressure") {
  const flagsWithValues = new Set(["--vector"])
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."
  const vectorPath = parseArg(commandArgs, "--vector")
  const exitCode = await Effect.runPromise(
    runBackpressureCommand({
      repoPath,
      ...(vectorPath !== undefined ? { vectorPath } : {}),
      ...(commandArgs.includes("--trend") ? { trend: true } : {}),
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste backpressure failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "bisect") {
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
  const flagsWithValues = new Set([
    "--signal",
    "--vector",
    "--range",
    "--concurrency",
    "--top",
    "--sample",
  ])
  const repoPath = collectPositional(commandArgs, flagsWithValues)[0] ?? "."

  await Effect.runPromise(
    runBisectCommand({
      ...(signalId !== undefined ? { signalId } : {}),
      ...(observer ? { observer: true } : {}),
      ...(parseArg(commandArgs, "--vector") !== undefined
        ? { vectorPath: parseArg(commandArgs, "--vector")! }
        : {}),
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
          console.error(`taste bisect failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(0)
}

if (command === "glossary") {
  const actionArg = commandArgs[0]
  if (actionArg !== "extract" && actionArg !== "confirm") {
    fail("glossary requires one of: extract, confirm")
  }
  const action = actionArg as "extract" | "confirm"

  const actionArgs = commandArgs.slice(1)
  const flagsWithValues = new Set(["--sha"])
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  const sha = parseArg(actionArgs, "--sha")
  const glossaryOptions = {
    action,
    repoPath,
    ...(sha !== undefined ? { sha } : {}),
    ...(actionArgs.includes("--no-parameters") ? { includeParameters: false } : {}),
  } satisfies Parameters<typeof runGlossaryCommand>[0]

  const exitCode = await Effect.runPromise(
    runGlossaryCommand(glossaryOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste glossary failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "conventions") {
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

  const exitCode = await Effect.runPromise(
    runConventionsCommand(conventionsOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste conventions failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "persona") {
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

  const exitCode = await Effect.runPromise(
    runPersonaCommand(personaOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste persona failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

if (command === "elicit") {
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

  const actionArgs = commandArgs.slice(1)
  const elicitOptions = (() => {
    if (actionArg === "quiz") {
      const flagsWithValues = new Set(["--items", "--resume", "--to", "--vector"])
      const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
      return {
        action: "quiz",
        repoPath,
        ...(parseArg(actionArgs, "--items") !== undefined
          ? { items: parsePositiveInt(parseArg(actionArgs, "--items"), 15, "--items") }
          : {}),
        ...(parseArg(actionArgs, "--resume") !== undefined
          ? { resumePath: parseArg(actionArgs, "--resume")! }
          : {}),
        ...(parseArg(actionArgs, "--to") !== undefined ? { outputPath: parseArg(actionArgs, "--to")! } : {}),
        ...(parseArg(actionArgs, "--vector") !== undefined
          ? { vectorPath: parseArg(actionArgs, "--vector")! }
          : {}),
        ...(commandArgs.includes("--force") ? { force: true } : {}),
      } satisfies Parameters<typeof runElicitCommand>[0]
    }

    if (actionArg === "bootstrap") {
      const flagsWithValues = new Set(["--commits", "--preset", "--vector"])
      const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
      return {
        action: "bootstrap",
        repoPath,
        ...(parseArg(actionArgs, "--commits") !== undefined
          ? { commits: parsePositiveInt(parseArg(actionArgs, "--commits"), 60, "--commits") }
          : {}),
        ...(parseArg(actionArgs, "--preset") !== undefined
          ? { presetId: parseArg(actionArgs, "--preset")! }
          : {}),
        ...(parseArg(actionArgs, "--vector") !== undefined
          ? { vectorPath: parseArg(actionArgs, "--vector")! }
          : {}),
      } satisfies Parameters<typeof runElicitCommand>[0]
    }

    if (actionArg === "review") {
      const repoPath = collectPositional(actionArgs, new Set())[0] ?? "."
      return {
        action: "review",
        repoPath,
      } satisfies Parameters<typeof runElicitCommand>[0]
    }

    const action = actionArg as "accept" | "reject"
    const flagsWithValues = new Set(["--vector"])
    const proposalId = collectPositional(actionArgs, flagsWithValues)[0] ?? fail(`elicit ${actionArg} requires a proposal id`)
    const repoPath = collectPositional(actionArgs, flagsWithValues)[1] ?? "."
    return {
      action,
      proposalId,
      repoPath,
      ...(parseArg(actionArgs, "--vector") !== undefined
        ? { vectorPath: parseArg(actionArgs, "--vector")! }
        : {}),
    } satisfies Parameters<typeof runElicitCommand>[0]
  })()

  const exitCode = await Effect.runPromise(
    runElicitCommand(elicitOptions).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste elicit failed: ${formatCliError(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(exitCode)
}

fail(`unknown command: ${command}`)
