#!/usr/bin/env bun

import { collectGitStdout, forEachGitLine } from "../packages/core/src/shared-git.ts"

const DEFAULT_WINDOW_DAYS = 365
const DEFAULT_PATHSPECS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"].flatMap(
  (extension) => [`:(glob)*${extension}`, `:(glob)**/*${extension}`],
)

interface BenchArgs {
  readonly repo: string | undefined
  readonly tip: string
  readonly windowDays: number
}

const printUsage = (): void => {
  console.log(`Usage: bun scripts/shared-history-git-bench.ts [--repo <path>] [--tip <rev>] [--window-days <n>]

Opt-in git log -p stream microbench. Defaults: current repo toplevel, tip HEAD, 365-day window.
Does not assert frozen SHAs, line counts, or heap ceilings.
`)
}

const parseArgs = (argv: ReadonlyArray<string>): BenchArgs => {
  let repo: string | undefined
  let tip = "HEAD"
  let windowDays = DEFAULT_WINDOW_DAYS

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--help" || flag === "-h") {
      printUsage()
      process.exit(0)
    }
    if (flag === "--repo") {
      repo = requiredValue(argv, index, flag)
      index += 1
      continue
    }
    if (flag === "--tip") {
      tip = requiredValue(argv, index, flag)
      index += 1
      continue
    }
    if (flag === "--window-days") {
      windowDays = Number(requiredValue(argv, index, flag))
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${flag}`)
  }

  return { repo, tip, windowDays }
}

const requiredValue = (
  argv: ReadonlyArray<string>,
  flagIndex: number,
  flag: string,
): string => {
  const value = argv[flagIndex + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

const resolveRepo = async (repo: string | undefined): Promise<string> => {
  const cwd = repo ?? process.cwd()
  return (await collectGitStdout(cwd, ["rev-parse", "--show-toplevel"])).trim()
}

const runBench = async (args: BenchArgs): Promise<void> => {
  if (!Number.isFinite(args.windowDays) || args.windowDays <= 0) {
    throw new Error(`--window-days must be a positive number, got ${args.windowDays}`)
  }

  const repoRoot = await resolveRepo(args.repo)
  const tip = (await collectGitStdout(repoRoot, ["rev-parse", "--verify", `${args.tip}^{commit}`])).trim()
  const until = (await collectGitStdout(repoRoot, ["log", "-1", "--format=%cI", tip])).trim()
  const since = new Date(
    new Date(until).getTime() - args.windowDays * 24 * 3600 * 1000,
  ).toISOString()

  const gc = globalThis.gc
  if (typeof gc === "function") gc()
  const before = process.memoryUsage()
  const started = performance.now()

  let lineCount = 0
  await forEachGitLine(
    repoRoot,
    [
      "log",
      "--no-merges",
      `--since=${since}`,
      "--format=__commit__%x00%cI",
      "--unified=0",
      "--no-ext-diff",
      "--find-renames",
      "-p",
      tip,
      "--",
      ...DEFAULT_PATHSPECS,
    ],
    () => {
      lineCount += 1
    },
  )

  const wallMs = Math.round(performance.now() - started)
  const after = process.memoryUsage()

  console.log(
    JSON.stringify({
      repo: repoRoot,
      tip,
      since,
      until,
      windowDays: args.windowDays,
      lineCount,
      wallMs,
      heapUsedDeltaMb: Number(((after.heapUsed - before.heapUsed) / 1024 / 1024).toFixed(2)),
    }),
  )
}

await runBench(parseArgs(process.argv.slice(2)))
