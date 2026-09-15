#!/usr/bin/env bun

import { closeSync, openSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"

const PULSAR_ROOT = resolve(import.meta.dir, "..")
const CLI_ENTRY = join(PULSAR_ROOT, "packages", "cli", "src", "bin.ts")

const DEFAULT_MAX_RSS_MIB = 4096
const DEFAULT_TIMEOUT_SECONDS = 120
const DEFAULT_SAMPLE_MS = 200
const DEFAULT_TERM_GRACE_MS = 2000
const DEFAULT_KILL_WAIT_MS = 5000

export const RESOURCE_BENCH_EXIT = {
  completed: 0,
  error: 1,
  "rss-limit": 2,
  timeout: 3,
} as const

export type ResourceBenchOutcome = keyof typeof RESOURCE_BENCH_EXIT

export interface ResourceBenchArgs {
  readonly repo: string
  readonly outDir: string
  readonly preload: string | undefined
  readonly maxRssMiB: number
  readonly timeoutSeconds: number
  readonly sampleIntervalMs: number
}

export interface ResourceBenchOptions extends ResourceBenchArgs {
  readonly command?: ReadonlyArray<string>
  readonly cwd?: string
  readonly termGraceMs?: number
  readonly killWaitMs?: number
}

export interface ResourceBenchProcess {
  readonly pid: number
  readonly ppid: number
  readonly rssKiB: number
  readonly rssMiB: number
  readonly command: string
}

export interface ResourceBenchMetrics {
  readonly outcome: ResourceBenchOutcome
  readonly exitCode: number
  readonly scoreAccepted: boolean
  readonly childExitCode: number | null
  readonly childSignal: string | null
  readonly wallMs: number
  readonly timeoutSeconds: number
  readonly maxRssMiB: number
  readonly peakRssMiB: number
  readonly peakRssKiB: number
  readonly peakAtMs: number
  readonly sampleCount: number
  readonly sampleIntervalMs: number
  readonly processGroupId: number | null
  readonly processGroupIsolated: boolean
  readonly processGroupReaped: boolean
  readonly peakProcesses: ReadonlyArray<ResourceBenchProcess>
  readonly command: ReadonlyArray<string>
  readonly repo: string
  readonly preload: string | null
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly metricsPath: string
  readonly error: string | null
}

export interface ResourceBenchResult {
  readonly metrics: ResourceBenchMetrics
  readonly exitCode: number
}

export const printUsage = (): void => {
  console.log(`Usage: bun scripts/resource-bench.ts --repo <path> --out <dir> [options]

Opt-in watchdog around current Pulsar source CLI:

  bun [--preload <file>] packages/cli/src/bin.ts score --profile --json <repo>

Root owns target snapshots and real large runs. This script only supervises
one detached child process group.

Writes under --out:
  stdout.json    streamed child stdout (raw score JSON)
  stderr.log     streamed child stderr
  metrics.json   outcome, peak process-group RSS, process breakdown

Stdout of this script is metrics JSON. Partial child stdout is never a
successful score.

Options:
  --repo <path>              Repository to score (required)
  --out <dir>                Output directory (required)
  --preload <file>           Optional Bun --preload for controlled experiments
  --max-rss-mib <n>          Stop own process group at this RSS (default: ${DEFAULT_MAX_RSS_MIB})
  --timeout-seconds <n>      Stop own process group after this many seconds (default: ${DEFAULT_TIMEOUT_SECONDS})
  --sample-ms <n>            Process-group RSS sample interval (default: ${DEFAULT_SAMPLE_MS})
  -h, --help                 Show this help

Exit codes:
  0  completed   child exited 0 without hitting a limit
  1  error       spawn, isolation, sampling, or child failure
  2  rss-limit   own process group reached --max-rss-mib
  3  timeout     own process group exceeded --timeout-seconds
`)
}

export const parseResourceBenchArgs = (argv: ReadonlyArray<string>): ResourceBenchArgs => {
  let repo: string | undefined
  let outDir: string | undefined
  let preload: string | undefined
  let maxRssMiB = DEFAULT_MAX_RSS_MIB
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
  let sampleIntervalMs = DEFAULT_SAMPLE_MS

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
    if (flag === "--out") {
      outDir = requiredValue(argv, index, flag)
      index += 1
      continue
    }
    if (flag === "--preload") {
      preload = requiredValue(argv, index, flag)
      index += 1
      continue
    }
    if (flag === "--max-rss-mib") {
      maxRssMiB = requiredPositiveNumber(requiredValue(argv, index, flag), flag)
      index += 1
      continue
    }
    if (flag === "--timeout-seconds") {
      timeoutSeconds = requiredPositiveNumber(requiredValue(argv, index, flag), flag)
      index += 1
      continue
    }
    if (flag === "--sample-ms") {
      sampleIntervalMs = requiredPositiveNumber(requiredValue(argv, index, flag), flag)
      index += 1
      continue
    }
    throw new Error(`unknown argument: ${flag}`)
  }

  if (repo === undefined) throw new Error("--repo is required")
  if (outDir === undefined) throw new Error("--out is required")

  return {
    repo: resolve(process.cwd(), repo),
    outDir: resolve(process.cwd(), outDir),
    preload: preload === undefined ? undefined : resolve(process.cwd(), preload),
    maxRssMiB,
    timeoutSeconds,
    sampleIntervalMs,
  }
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

const requiredPositiveNumber = (raw: string, flag: string): number => {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number, got ${raw}`)
  }
  return value
}

const toMiB = (rssKiB: number): number => Number((rssKiB / 1024).toFixed(2))

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const raceTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const runCaptured = async (
  command: ReadonlyArray<string>,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }> => {
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, code }
}

const isNoSuchProcess = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ESRCH"

const readPgid = async (pid: number): Promise<number | undefined> => {
  const result = await runCaptured(["ps", "-o", "pgid=", "-p", String(pid)])
  if (result.code !== 0) return undefined
  const pgid = Number(result.stdout.trim())
  return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined
}

const parsePidList = (stdout: string): number[] =>
  stdout
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0)

const listGroupPidsViaTable = async (pgid: number): Promise<number[]> => {
  const result = await runCaptured(["ps", "-axo", "pid=,pgid="])
  if (result.code !== 0) {
    throw new Error(`ps pid/pgid table failed: ${result.stderr.trim()}`)
  }
  const pids: number[] = []
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (match === null) continue
    if (Number(match[2]) === pgid) pids.push(Number(match[1]))
  }
  return pids
}

export const listProcessGroupPids = async (pgid: number): Promise<number[]> => {
  const result = await runCaptured(["pgrep", "-g", String(pgid)])
  if (result.code === 0) return parsePidList(result.stdout)
  if (result.code === 1 && result.stdout.trim() === "") return []
  return listGroupPidsViaTable(pgid)
}

const PROCESS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/

export const parseProcessTable = (stdout: string): ResourceBenchProcess[] => {
  const processes: ResourceBenchProcess[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    const match = PROCESS_LINE.exec(line)
    if (match === null) {
      throw new Error(`unrecognized ps line: ${line}`)
    }
    const rssKiB = Number(match[3])
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKiB,
      rssMiB: toMiB(rssKiB),
      command: match[4] ?? "",
    })
  }
  return processes
}

export const sampleProcessGroup = async (pgid: number): Promise<ResourceBenchProcess[]> => {
  const pids = await listProcessGroupPids(pgid)
  if (pids.length === 0) return []
  const result = await runCaptured(["ps", "-o", "pid=,ppid=,rss=,args=", "-p", pids.join(",")])
  if (result.code !== 0) {
    throw new Error(`ps process-group sample failed: ${result.stderr.trim()}`)
  }
  return parseProcessTable(result.stdout)
}

const sampleProcessGroupWithRetry = async (pgid: number): Promise<ResourceBenchProcess[]> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sampleProcessGroup(pgid)
    } catch (error) {
      lastError = error
      await sleep(50)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

const assertKillableProcessGroup = (pgid: number, watchdogPgid: number): void => {
  if (!Number.isInteger(pgid) || pgid <= 1) {
    throw new Error(`refusing to signal invalid process group ${pgid}`)
  }
  if (pgid === watchdogPgid) {
    throw new Error("refusing to signal the watchdog process group")
  }
}

const signalProcessGroup = (pgid: number, watchdogPgid: number, signal: NodeJS.Signals): void => {
  assertKillableProcessGroup(pgid, watchdogPgid)
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error
  }
}

const waitForGroupExit = async (pgid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await listProcessGroupPids(pgid)).length === 0) return true
    await sleep(50)
  }
  return (await listProcessGroupPids(pgid)).length === 0
}

const stopOwnProcessGroup = async (
  pgid: number,
  watchdogPgid: number,
  termGraceMs: number,
  killWaitMs: number,
): Promise<boolean> => {
  signalProcessGroup(pgid, watchdogPgid, "SIGTERM")
  if (await waitForGroupExit(pgid, termGraceMs)) return true
  signalProcessGroup(pgid, watchdogPgid, "SIGKILL")
  return waitForGroupExit(pgid, killWaitMs)
}

const waitUntilIsolated = async (
  childPid: number,
  watchdogPgid: number,
): Promise<{ readonly pgid: number; readonly isolated: boolean }> => {
  const deadline = Date.now() + 250
  let pgid = await readPgid(childPid)
  while (Date.now() < deadline) {
    if (pgid !== undefined && pgid > 1 && pgid !== watchdogPgid) {
      return { pgid, isolated: true }
    }
    await sleep(25)
    pgid = await readPgid(childPid)
  }
  return { pgid: pgid ?? childPid, isolated: false }
}

const defaultScoreCommand = (repo: string, preload: string | undefined): string[] => [
  process.execPath,
  ...(preload === undefined ? [] : ["--preload", preload]),
  CLI_ENTRY,
  "score",
  "--profile",
  "--json",
  repo,
]

const emptyPeak = (): {
  rssKiB: number
  atMs: number
  processes: ReadonlyArray<ResourceBenchProcess>
} => ({
  rssKiB: 0,
  atMs: 0,
  processes: [],
})

export const runResourceBench = async (options: ResourceBenchOptions): Promise<ResourceBenchResult> => {
  const outDir = isAbsolute(options.outDir) ? options.outDir : resolve(process.cwd(), options.outDir)
  const repo = isAbsolute(options.repo) ? options.repo : resolve(process.cwd(), options.repo)
  const preload = options.preload === undefined
    ? undefined
    : isAbsolute(options.preload)
      ? options.preload
      : resolve(process.cwd(), options.preload)
  const command = options.command === undefined ? defaultScoreCommand(repo, preload) : [...options.command]
  const cwd = options.cwd ?? PULSAR_ROOT
  const termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS
  const killWaitMs = options.killWaitMs ?? DEFAULT_KILL_WAIT_MS
  const timeoutMs = options.timeoutSeconds * 1000
  const maxRssKiB = options.maxRssMiB * 1024

  const stdoutPath = join(outDir, "stdout.json")
  const stderrPath = join(outDir, "stderr.log")
  const metricsPath = join(outDir, "metrics.json")

  await mkdir(outDir, { recursive: true })

  const started = performance.now()
  const watchdogPgid = (await readPgid(process.pid)) ?? process.pid
  let childExitCode: number | null = null
  let childSignal: string | null = null
  let processGroupId: number | null = null
  let processGroupIsolated = false
  let processGroupReaped = true
  let sampleCount = 0
  let peak = emptyPeak()
  let outcome: ResourceBenchOutcome = "error"
  let error: string | null = null
  let stopReason: "rss-limit" | "timeout" | undefined
  let stdoutFd: number | undefined
  let stderrFd: number | undefined

  const finish = async (): Promise<ResourceBenchResult> => {
    const exitCode = RESOURCE_BENCH_EXIT[outcome]
    const metrics: ResourceBenchMetrics = {
      outcome,
      exitCode,
      scoreAccepted: outcome === "completed",
      childExitCode,
      childSignal,
      wallMs: Math.round(performance.now() - started),
      timeoutSeconds: options.timeoutSeconds,
      maxRssMiB: options.maxRssMiB,
      peakRssMiB: toMiB(peak.rssKiB),
      peakRssKiB: peak.rssKiB,
      peakAtMs: peak.atMs,
      sampleCount,
      sampleIntervalMs: options.sampleIntervalMs,
      processGroupId,
      processGroupIsolated,
      processGroupReaped,
      peakProcesses: peak.processes,
      command,
      repo,
      preload: preload ?? null,
      stdoutPath,
      stderrPath,
      metricsPath,
      error,
    }
    await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`)
    return { metrics, exitCode }
  }

  try {
    stdoutFd = openSync(stdoutPath, "w")
    stderrFd = openSync(stderrPath, "w")
    const child = Bun.spawn(command, {
      cwd,
      env: process.env,
      stdin: "ignore",
      stdout: stdoutFd,
      stderr: stderrFd,
      detached: true,
    })
    const childPid = child.pid
    if (childPid === undefined) {
      error = "child spawned without a pid"
      return finish()
    }

    const isolation = await waitUntilIsolated(childPid, watchdogPgid)
    processGroupId = isolation.pgid
    processGroupIsolated = isolation.isolated
    if (!processGroupIsolated) {
      error = "child did not enter an isolated process group; refusing to supervise"
      try {
        process.kill(childPid, "SIGTERM")
      } catch (killError) {
        if (!isNoSuchProcess(killError)) throw killError
      }
      await raceTimeout(child.exited, termGraceMs)
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(childPid, "SIGKILL")
        } catch (killError) {
          if (!isNoSuchProcess(killError)) throw killError
        }
      }
      childExitCode = child.exitCode
      childSignal = child.signalCode
      processGroupReaped = child.exitCode !== null || child.signalCode !== null
      return finish()
    }

    const childExited = child.exited.then(() => "exited" as const)

    while (stopReason === undefined) {
      const processes = await sampleProcessGroupWithRetry(isolation.pgid)
      sampleCount += 1
      const rssKiB = processes.reduce((sum, processRow) => sum + processRow.rssKiB, 0)
      if (rssKiB >= peak.rssKiB) {
        peak = {
          rssKiB,
          atMs: Math.round(performance.now() - started),
          processes,
        }
      }
      if (rssKiB >= maxRssKiB) {
        stopReason = "rss-limit"
        break
      }
      const elapsed = performance.now() - started
      if (elapsed >= timeoutMs) {
        stopReason = "timeout"
        break
      }
      const waitMs = Math.min(options.sampleIntervalMs, timeoutMs - elapsed)
      const raced = await raceTimeout(childExited, waitMs)
      if (raced === "exited") break
    }

    if (stopReason !== undefined) {
      processGroupReaped = await stopOwnProcessGroup(
        isolation.pgid,
        watchdogPgid,
        termGraceMs,
        killWaitMs,
      )
      await raceTimeout(child.exited, killWaitMs)
    } else {
      await child.exited
      processGroupReaped = (await listProcessGroupPids(isolation.pgid)).length === 0
    }

    childExitCode = child.exitCode
    childSignal = child.signalCode
    if (stopReason !== undefined) {
      outcome = stopReason
      error = stopReason === "rss-limit"
        ? `process group RSS reached ${toMiB(peak.rssKiB)} MiB (limit ${options.maxRssMiB} MiB)`
        : `process group exceeded ${options.timeoutSeconds}s`
    } else if (child.signalCode !== null) {
      error = `child exited from signal ${child.signalCode}`
    } else if (child.exitCode === 0) {
      outcome = "completed"
    } else {
      error = `child exited with code ${child.exitCode}`
    }
    return finish()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
    if (processGroupIsolated && processGroupId !== null) {
      try {
        processGroupReaped = await stopOwnProcessGroup(
          processGroupId,
          watchdogPgid,
          termGraceMs,
          killWaitMs,
        )
      } catch (stopError) {
        const stopMessage = stopError instanceof Error ? stopError.message : String(stopError)
        error = `${error}; failed to stop process group: ${stopMessage}`
        processGroupReaped = false
      }
    }
    return finish()
  } finally {
    if (stdoutFd !== undefined) closeSync(stdoutFd)
    if (stderrFd !== undefined) closeSync(stderrFd)
  }
}

const main = async (): Promise<number> => {
  const result = await runResourceBench(parseResourceBenchArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result.metrics)}\n`)
  return result.exitCode
}

if (import.meta.main) {
  try {
    process.exitCode = await main()
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = RESOURCE_BENCH_EXIT.error
  }
}
