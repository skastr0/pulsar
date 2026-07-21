#!/usr/bin/env bun
import { fail } from "./cli-args.js"
import { runCoreCommand } from "./cli-core-commands.js"
import { printHelp } from "./cli-help.js"
import { runWorkflowCommand } from "./cli-workflow-commands.js"
import { CLI_VERSION } from "./index.js"

const main = async (argv: ReadonlyArray<string>): Promise<number> => {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp()
    return 0
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(CLI_VERSION)
    return 0
  }

  const command = argv[0]
  const commandArgs = argv.slice(1)

  const coreExitCode = await runCoreCommand(command, commandArgs)
  if (coreExitCode !== undefined) {
    return coreExitCode
  }

  const workflowExitCode = await runWorkflowCommand(command, commandArgs)
  if (workflowExitCode !== undefined) {
    return workflowExitCode
  }

  return fail(`unknown command: ${command}`)
}

process.exitCode = await main(process.argv.slice(2))
