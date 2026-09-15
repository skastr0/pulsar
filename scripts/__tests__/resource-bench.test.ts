import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parseProcessTable,
  parseResourceBenchArgs,
  RESOURCE_BENCH_EXIT,
  runResourceBench,
  type ResourceBenchOptions,
} from "../resource-bench.ts"

const childPath = join(import.meta.dir, "../fixtures/resource-bench/child.ts")
const preloadPath = join(import.meta.dir, "../fixtures/resource-bench/preload.ts")

const tempDirs: string[] = []

const makeOutDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "pulsar-resource-bench-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const fixtureOptions = (
  outDir: string,
  mode: string,
  overrides?: Partial<ResourceBenchOptions>,
): ResourceBenchOptions => ({
  repo: join(outDir, "unused-repo"),
  outDir,
  preload: undefined,
  maxRssMiB: 4096,
  timeoutSeconds: 8,
  sampleIntervalMs: 50,
  command: [process.execPath, childPath, mode],
  termGraceMs: 200,
  killWaitMs: 400,
  ...overrides,
})

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("resource-bench watchdog", () => {
  test("parses required repo and out paths", () => {
    const args = parseResourceBenchArgs(["--repo", "./target", "--out", "./receipts"])
    expect(args.repo.endsWith("/target")).toBe(true)
    expect(args.outDir.endsWith("/receipts")).toBe(true)
    expect(args.maxRssMiB).toBe(4096)
    expect(args.timeoutSeconds).toBe(120)
  })

  test("parses process-group RSS rows from ps", () => {
    const processes = parseProcessTable("  11  10  2048 bun child.ts\n  12  11   512 sleep 30\n")
    expect(processes).toEqual([
      { pid: 11, ppid: 10, rssKiB: 2048, rssMiB: 2, command: "bun child.ts" },
      { pid: 12, ppid: 11, rssKiB: 512, rssMiB: 0.5, command: "sleep 30" },
    ])
  })

  test("completed child is the only accepted score", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(fixtureOptions(outDir, "ok"))
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT.completed)
    expect(metrics.outcome).toBe("completed")
    expect(metrics.scoreAccepted).toBe(true)
    expect(metrics.childExitCode).toBe(0)
    expect(metrics.processGroupIsolated).toBe(true)
    expect(metrics.processGroupId).toBe(metrics.childPid)
    expect(metrics.processGroupReaped).toBe(true)
    expect(await readFile(metrics.stdoutPath, "utf8")).toBe('{"ok":true}\n')
    expect(JSON.parse(await readFile(metrics.metricsPath, "utf8")).scoreAccepted).toBe(true)
  })

  test("non-zero child is error and not an accepted score", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(fixtureOptions(outDir, "fail"))
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT.error)
    expect(metrics.outcome).toBe("error")
    expect(metrics.scoreAccepted).toBe(false)
    expect(metrics.childExitCode).toBe(1)
    expect(await readFile(metrics.stdoutPath, "utf8")).toBe('{"partial":true}\n')
  })

  test("timeout stops only the supervised group and rejects partial stdout", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(
      fixtureOptions(outDir, "hold", { timeoutSeconds: 1 }),
    )
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT.timeout)
    expect(metrics.outcome).toBe("timeout")
    expect(metrics.scoreAccepted).toBe(false)
    expect(await readFile(metrics.stdoutPath, "utf8")).toBe('{"partial":true}\n')
    expect(metrics.processGroupIsolated).toBe(true)
    expect(metrics.processGroupId).toBe(metrics.childPid)
    expect(metrics.processGroupReaped).toBe(true)
    expect(metrics.peakProcesses.some((row) => row.command.includes("sleep"))).toBe(true)
    const nested = /nested=(\d+)/.exec(await readFile(metrics.stderrPath, "utf8"))
    expect(nested).not.toBeNull()
    expect(processAlive(Number(nested?.[1]))).toBe(false)
  })

  test("rss-limit stops the group before treating stdout as a score", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(
      fixtureOptions(outDir, "sleep", { maxRssMiB: 1, timeoutSeconds: 8 }),
    )
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT["rss-limit"])
    expect(metrics.outcome).toBe("rss-limit")
    expect(metrics.scoreAccepted).toBe(false)
    expect(metrics.peakRssMiB).toBeGreaterThanOrEqual(1)
    expect(metrics.peakProcesses.length).toBeGreaterThan(0)
    expect(metrics.peakProcesses.every((row) => row.rssKiB >= 0)).toBe(true)
    const leftover = await readFile(metrics.stdoutPath, "utf8")
    if (leftover !== "") {
      expect(leftover).toBe('{"partial":true}\n')
    }
  })

  test("optional preload is visible to the supervised child", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(
      fixtureOptions(outDir, "preload", {
        preload: preloadPath,
        command: [process.execPath, "--preload", preloadPath, childPath, "preload"],
      }),
    )
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT.completed)
    expect(metrics.preload).toBe(preloadPath)
    expect(JSON.parse(await readFile(metrics.stdoutPath, "utf8"))).toEqual({ preload: true })
  })

  test("leftover same-group descendants are reaped as error, not completed", async () => {
    const outDir = await makeOutDir()
    const { metrics, exitCode } = await runResourceBench(fixtureOptions(outDir, "orphan"))
    expect(exitCode).toBe(RESOURCE_BENCH_EXIT.error)
    expect(metrics.outcome).toBe("error")
    expect(metrics.scoreAccepted).toBe(false)
    expect(metrics.childExitCode).toBe(0)
    expect(metrics.processGroupId).toBe(metrics.childPid)
    expect(metrics.processGroupReaped).toBe(true)
    expect(metrics.error).toContain("descendants remained")
    expect(await readFile(metrics.stdoutPath, "utf8")).toBe('{"ok":true}\n')
    const nested = /nested=(\d+)/.exec(await readFile(metrics.stderrPath, "utf8"))
    expect(nested).not.toBeNull()
    expect(processAlive(Number(nested?.[1]))).toBe(false)
  })

  test("SIGTERM to the watchdog host reaps only the established child group", async () => {
    const outDir = await makeOutDir()
    const host = join(import.meta.dir, "../fixtures/resource-bench/host.ts")
    const proc = Bun.spawn([process.execPath, host, outDir, "hold"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderrPath = join(outDir, "stderr.log")
    const deadline = Date.now() + 3000
    let nestedPid: number | undefined
    while (Date.now() < deadline) {
      const stderr = await readFile(stderrPath, "utf8").catch(() => "")
      const nested = /nested=(\d+)/.exec(stderr)
      if (nested !== null) {
        nestedPid = Number(nested[1])
        break
      }
      await Bun.sleep(50)
    }
    expect(nestedPid).toBeDefined()
    expect(proc.pid).toBeDefined()
    process.kill(proc.pid!, "SIGTERM")
    const [stdout, hostCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    expect(hostCode).toBe(RESOURCE_BENCH_EXIT.error)
    const metrics = JSON.parse(stdout === "" ? await readFile(join(outDir, "metrics.json"), "utf8") : stdout)
    expect(metrics.outcome).toBe("error")
    expect(metrics.scoreAccepted).toBe(false)
    expect(metrics.processGroupIsolated).toBe(true)
    expect(metrics.processGroupId).toBe(metrics.childPid)
    expect(metrics.processGroupReaped).toBe(true)
    expect(metrics.error).toContain("SIGTERM")
    expect(processAlive(nestedPid!)).toBe(false)
  })
})
