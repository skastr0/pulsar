#!/usr/bin/env bun
import { Effect } from "effect"
import { runBisectCommand } from "./bisect.js"
import { CLI_VERSION } from "./index.js"
import { runScoreCommand } from "./score.js"

const args = process.argv.slice(2)

const help = (): void => {
  console.log(`taste — codec CLI v${CLI_VERSION}

Usage:
  taste score --signal <id> [<repo-path>]
  taste bisect --signal <id> --range <from>..<to> [<repo-path>]
  taste --version

Commands:
  score    Run one signal against a repo and print its score + diagnostics.
  bisect   Replay a commit range through one signal; print trajectory + culprits.

Options:
  --signal <id>      Required. E.g. TS-RP-01, TS-LD-01, SHARED-CHURN-01.
  --range <a>..<b>   For bisect. Commit range, oldest..newest.
  --concurrency <n>  For bisect. Parallel worktrees (default 4).
  --top <n>          For bisect. Number of culprit commits (default 5).
  --json             Emit JSON instead of human-readable output.
  --help, -h         Show this help.
  --version, -v      Print version.

Examples:
  taste score --signal TS-RP-01
  taste bisect --signal TS-RP-01 --range HEAD~50..HEAD
  taste bisect --signal TS-RP-01 --range abc123..HEAD --json /path/to/repo
`)
}

const fail = (message: string, code = 1): never => {
  console.error(`taste: ${message}`)
  process.exit(code)
}

const parseArg = (flag: string): string | undefined => {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  return args[i + 1]
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  help()
  process.exit(0)
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(CLI_VERSION)
  process.exit(0)
}

const command = args[0]

const parseFlagValueArgs = new Set(["--signal", "--range", "--concurrency", "--top"])
const isFlagValue = (index: number): boolean => {
  const prev = args[index - 1]
  return prev !== undefined && parseFlagValueArgs.has(prev)
}
const collectPositional = (): ReadonlyArray<string> =>
  args.slice(1).filter((a, i) => !a.startsWith("--") && !isFlagValue(i + 1))

if (command === "score") {
  const signalId = parseArg("--signal")
  if (signalId === undefined) fail("score requires --signal <id>")
  const repoPath = collectPositional()[0] ?? "."
  await Effect.runPromise(
    runScoreCommand({ signalId: signalId as string, repoPath }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste score failed: ${String(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(0)
}

const parsePositiveInt = (raw: string | undefined, fallback: number, flag: string): number => {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    fail(`${flag} must be a positive integer, got: ${raw}`)
  }
  return n
}

if (command === "bisect") {
  const signalId = parseArg("--signal")
  if (signalId === undefined) fail("bisect requires --signal <id>")
  const range = parseArg("--range")
  if (range === undefined) fail("bisect requires --range <from>..<to>")
  const rangeMatch = /^([^.]+)\.\.([^.]+)$/.exec(range as string)
  if (rangeMatch === null) {
    fail("bisect --range must be <from>..<to> (two dots, no three-dot syntax)")
  }
  const fromSha = rangeMatch![1]!
  const toSha = rangeMatch![2]!
  const concurrency = parsePositiveInt(parseArg("--concurrency"), 4, "--concurrency")
  const topCulprits = parsePositiveInt(parseArg("--top"), 5, "--top")
  const json = args.includes("--json")
  const repoPath = collectPositional()[0] ?? "."
  await Effect.runPromise(
    runBisectCommand({
      signalId: signalId as string,
      fromSha,
      toSha,
      repoPath,
      concurrency,
      topCulprits,
      json,
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.error(`taste bisect failed: ${String(err)}`)
          process.exit(1)
        }),
      ),
    ),
  )
  process.exit(0)
}

fail(`unknown command: ${command}`)
