#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "onboard-parity")
const SOURCE_ENTRY = join(REPO_ROOT, "packages", "cli", "src", "bin.ts")
const hostTarget = `${process.platform}-${process.arch}`
const HOST_BINARY = join(REPO_ROOT, "dist", `pulsar-${hostTarget}`)
const NPM_LAUNCHER = join(REPO_ROOT, "packages", "npm", "pulsar", "bin", "pulsar.js")
const runNpm = process.argv.includes("--npm")
const runTui = process.argv.includes("--tui")

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface HeadlessResult {
  readonly mode: string
  readonly activeSignals: number
  readonly before: { readonly band: string; readonly score: number; readonly driver: string }
  readonly after: { readonly band: string; readonly score: number; readonly driver: string }
  readonly topPressures: ReadonlyArray<{ readonly id: string; readonly score: number }>
  readonly choices: ReadonlyArray<unknown>
  readonly enabledPacks: ReadonlyArray<string>
  readonly baseline: string
  readonly written: ReadonlyArray<string>
}

const run = async (
  command: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env?: Record<string, string | undefined> },
): Promise<CommandResult> => {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

const runChecked = async (
  label: string,
  command: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env?: Record<string, string | undefined> },
): Promise<CommandResult> => {
  const result = await run(command, options)
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit ${result.exitCode}\n${result.stderr || result.stdout}`,
    )
  }
  return result
}

const initializeFixture = async (root: string): Promise<string> => {
  const repoPath = join(root, "repo")
  await cp(FIXTURE_ROOT, repoPath, { recursive: true })
  const gitEnv = {
    GIT_AUTHOR_DATE: "2024-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2024-01-01T00:00:00Z",
  }
  await runChecked("fixture git init", ["git", "init", "-q", "-b", "main"], {
    cwd: repoPath,
    env: gitEnv,
  })
  await runChecked("fixture git config email", ["git", "config", "user.email", "pulsar@example.test"], {
    cwd: repoPath,
    env: gitEnv,
  })
  await runChecked("fixture git config name", ["git", "config", "user.name", "Pulsar Fixture"], {
    cwd: repoPath,
    env: gitEnv,
  })
  await runChecked("fixture git add", ["git", "add", "."], { cwd: repoPath, env: gitEnv })
  await runChecked("fixture git commit", ["git", "commit", "-qm", "fixture"], {
    cwd: repoPath,
    env: gitEnv,
  })
  return repoPath
}

const parseHeadless = (label: string, stdout: string): HeadlessResult => {
  try {
    return JSON.parse(stdout) as HeadlessResult
  } catch (cause) {
    throw new Error(`${label} emitted invalid JSON: ${String(cause)}\n${stdout}`)
  }
}

const assertRealObservation = (label: string, result: HeadlessResult): void => {
  if (result.mode !== "preview-only") {
    throw new Error(`${label} did not use preview-only headless mode`)
  }
  if (result.activeSignals <= 5) {
    throw new Error(`${label} observed only ${result.activeSignals} signals; demo data has five`)
  }
  if (result.topPressures.length === 0) {
    throw new Error(`${label} did not report any real signal pressure for the fixture`)
  }
  if (JSON.stringify(result.before) !== JSON.stringify(result.after)) {
    throw new Error(`${label} mutated the no-answers preview result`)
  }
  if (
    result.choices.length !== 0 ||
    result.enabledPacks.length !== 0 ||
    result.baseline !== "not-provided" ||
    result.written.length !== 0
  ) {
    throw new Error(`${label} persisted or synthesized onboarding choices during parity smoke`)
  }
}

const assertParity = (
  expectedLabel: string,
  expected: HeadlessResult,
  actualLabel: string,
  actual: HeadlessResult,
): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${actualLabel} headless output diverged from ${expectedLabel}`)
  }
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const linuxPtyCommand = (repoPath: string): ReadonlyArray<string> => {
  const scriptPath = "/usr/bin/script"
  if (!existsSync(scriptPath)) throw new Error("PTY smoke requires /usr/bin/script")
  return [
    scriptPath,
    "-q",
    "-e",
    "-c",
    [HOST_BINARY, "onboard", repoPath].map(shellQuote).join(" "),
    "/dev/null",
  ]
}

const DARWIN_EXPECT_PROGRAM = `
set timeout 10
set binary $env(PULSAR_SMOKE_BINARY)
set repo $env(PULSAR_SMOKE_REPO)
spawn -noecho $binary onboard $repo
expect {
  -re {PULSAR} {}
  timeout { puts stderr "timed out waiting for PULSAR"; exit 124 }
  eof { exit 125 }
}
expect {
  -re {The code-trust band} { after 100; send -- "\003" }
  timeout { puts stderr "timed out waiting for first frame"; exit 124 }
  eof { exit 125 }
}
expect {
  eof {}
  timeout {
    set child_pid [exp_pid]
    catch { exec kill -TERM $child_pid }
    after 250
    catch { close }
    catch { wait }
    puts stderr "timed out waiting for clean TUI exit"
    exit 124
  }
}
if {[catch { wait } wait_status]} { exit 1 }
exit [lindex $wait_status 3]
`

const smokeTuiFirstFrame = async (
  repoPath: string,
  env: Record<string, string | undefined>,
): Promise<void> => {
  const ttyEnv = { ...env, TERM: "xterm-256color", COLUMNS: "100", LINES: "30" }
  if (process.platform === "darwin") {
    const expectPath = "/usr/bin/expect"
    if (!existsSync(expectPath)) throw new Error("PTY smoke requires /usr/bin/expect on Darwin")
    const result = await runChecked(
      "native TUI first frame",
      [expectPath, "-c", DARWIN_EXPECT_PROGRAM],
      {
        cwd: repoPath,
        env: {
          ...ttyEnv,
          PULSAR_SMOKE_BINARY: HOST_BINARY,
          PULSAR_SMOKE_REPO: repoPath,
        },
      },
    )
    if (!result.stdout.includes("PULSAR") || !result.stdout.includes("The code-trust band")) {
      throw new Error(`native TUI did not render the first frame\n${result.stderr || result.stdout}`)
    }
    return
  }

  const proc = Bun.spawn(linuxPtyCommand(repoPath), {
    cwd: repoPath,
    env: { ...process.env, ...ttyEnv },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  let firstFrame = false
  let timedOut = false
  let stdout = ""
  const decoder = new TextDecoder()
  const capture = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true })
      if (!firstFrame && stdout.includes("PULSAR") && stdout.includes("The code-trust band")) {
        firstFrame = true
        proc.stdin.write("q")
        proc.stdin.flush()
        proc.stdin.end()
      }
    }
    stdout += decoder.decode()
  })()
  const stderrPromise = new Response(proc.stderr).text()
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, 10_000)
  const exitCode = await proc.exited
  clearTimeout(timer)
  await capture
  const stderr = await stderrPromise
  if (timedOut) throw new Error(`native TUI first frame timed out\n${stderr || stdout}`)
  if (!firstFrame) throw new Error(`native TUI did not render the first frame\n${stderr || stdout}`)
  if (exitCode !== 0) throw new Error(`native TUI exited ${exitCode}\n${stderr || stdout}`)
}

if (process.platform !== "darwin" && process.platform !== "linux") {
  throw new Error(`Unsupported onboard smoke host: ${hostTarget}`)
}
if (process.arch !== "arm64" && process.arch !== "x64") {
  throw new Error(`Unsupported onboard smoke host: ${hostTarget}`)
}
if (!existsSync(HOST_BINARY)) {
  throw new Error(`Host binary is missing: ${HOST_BINARY}`)
}

const tempRoot = await mkdtemp(join(tmpdir(), "pulsar-onboard-parity-"))
try {
  const repoPath = await initializeFixture(tempRoot)
  const stateHome = join(tempRoot, "state")
  await mkdir(stateHome, { recursive: true })
  const env = { PULSAR_STATE_HOME: stateHome, NO_COLOR: "1", CI: "1" }
  const commandSuffix = ["onboard", "--json", repoPath]
  const variants: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["source", [process.execPath, SOURCE_ENTRY, ...commandSuffix]],
    ["native", [HOST_BINARY, ...commandSuffix]],
    ...(runNpm
      ? ([
          ["npm", ["node", NPM_LAUNCHER, ...commandSuffix]],
        ] as const)
      : []),
  ]

  let reference: { readonly label: string; readonly result: HeadlessResult } | undefined
  for (const [label, command] of variants) {
    const commandResult = await runChecked(`${label} headless onboard`, command, {
      cwd: repoPath,
      env,
    })
    if (commandResult.stderr !== "") {
      throw new Error(`${label} headless onboard wrote to stderr\n${commandResult.stderr}`)
    }
    const result = parseHeadless(label, commandResult.stdout)
    assertRealObservation(label, result)
    if (reference === undefined) reference = { label, result }
    else assertParity(reference.label, reference.result, label, result)
  }

  if (runTui) await smokeTuiFirstFrame(repoPath, env)
  if (reference === undefined) throw new Error("Onboard smoke ran no headless variants")
  console.log(
    `Onboard smoke passed: ${variants.map(([label]) => label).join(" = ")}${runTui ? " + native PTY first frame" : ""}; ${reference.result.activeSignals} real signals; driver ${reference.result.before.driver}`,
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
