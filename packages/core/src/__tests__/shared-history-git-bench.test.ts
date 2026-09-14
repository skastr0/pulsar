import { describe, expect, test } from "bun:test"
import { collectGitStdout, forEachGitLine } from "../shared-git.js"

/** Frozen tip used by the history microbench so sibling commits cannot move it. */
const FROZEN_HISTORY_TIP = "5358e69"
const FROZEN_PATCH_LINE_COUNT = 345_040

const FROZEN_PATHSPECS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"].flatMap(
  (extension) => [`:(glob)*${extension}`, `:(glob)**/*${extension}`],
)

describe("frozen git log -p stream microbench", () => {
  test("streams 5358e69 patch log without retaining raw stdout", async () => {
    const repoRoot = (await collectGitStdout(process.cwd(), ["rev-parse", "--show-toplevel"])).trim()
    const tip = (
      await collectGitStdout(repoRoot, ["rev-parse", "--verify", `${FROZEN_HISTORY_TIP}^{commit}`])
    ).trim()
    const until = (await collectGitStdout(repoRoot, ["log", "-1", "--format=%cI", tip])).trim()
    const since = new Date(new Date(until).getTime() - 365 * 24 * 3600 * 1000).toISOString()

    const gc = globalThis.gc
    if (typeof gc === "function") gc()
    const before = process.memoryUsage()
    const started = performance.now()

    let lineCount = 0
    await forEachGitLine(repoRoot, [
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
      ...FROZEN_PATHSPECS,
    ], () => {
      lineCount += 1
    })

    const wallMs = Math.round(performance.now() - started)
    const after = process.memoryUsage()
    const heapUsedDeltaMb = Number(((after.heapUsed - before.heapUsed) / 1024 / 1024).toFixed(2))

    expect(lineCount).toBe(FROZEN_PATCH_LINE_COUNT)
    expect(heapUsedDeltaMb).toBeLessThan(32)

    console.log(
      JSON.stringify({
        tip,
        since,
        until,
        lineCount,
        wallMs,
        heapUsedDeltaMb,
      }),
    )
  }, 30_000)
})
