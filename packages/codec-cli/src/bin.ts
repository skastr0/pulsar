#!/usr/bin/env bun
import { Effect } from "effect"
import { CLI_VERSION } from "./index.js"
import { runScoreCommand } from "./score.js"

const args = process.argv.slice(2)

const help = (): void => {
  console.log(`taste — codec CLI v${CLI_VERSION}

Usage:
  taste score --signal <id> [<repo-path>]
  taste --version

Commands:
  score    Run one signal against a repo and print its score + diagnostics.

Options:
  --signal <id>    Required. E.g. TS-RP-01, TS-LD-01, SHARED-CHURN-01.
  --help, -h       Show this help.
  --version, -v    Print version.

Examples:
  taste score --signal TS-RP-01
  taste score --signal TS-RP-01 /path/to/repo
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

if (command === "score") {
  const signalId = parseArg("--signal")
  if (signalId === undefined) fail("score requires --signal <id>")
  const positional = args.slice(1).filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--signal")
  const repoPath = positional[0] ?? "."
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

fail(`unknown command: ${command}`)
