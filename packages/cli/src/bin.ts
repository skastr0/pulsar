#!/usr/bin/env bun
import { fail } from "./cli-args.js"
import { runCoreCommand } from "./cli-core-commands.js"
import { printHelp } from "./cli-help.js"
import { runWorkflowCommand } from "./cli-workflow-commands.js"
import { CLI_VERSION } from "./index.js"

const argv = process.argv.slice(2)

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  printHelp()
  process.exit(0)
}

if (argv[0] === "--version" || argv[0] === "-v") {
  console.log(CLI_VERSION)
  process.exit(0)
}

const command = argv[0]
const commandArgs = argv.slice(1)

if (await runCoreCommand(command, commandArgs)) {
  process.exit(0)
}

if (await runWorkflowCommand(command, commandArgs)) {
  process.exit(0)
}

fail(`unknown command: ${command}`)
