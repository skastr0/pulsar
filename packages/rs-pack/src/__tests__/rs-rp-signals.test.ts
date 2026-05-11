import { summarize } from "@skastr0/pulsar-core/signal"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsRp01 } from "../signals/rs-rp-01-hotspots.js"
import { RsRp02 } from "../signals/rs-rp-02-compile-time.js"
import { RsRp03 } from "../signals/rs-rp-03-pr-size.js"
import { SharedChurn01, type SharedChurn01Output } from "../signals/shared-churn-01.js"
import type { RsLd05Output } from "../signals/rs-ld-05-complexity.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
  runSignalComputeWithContext,
} from "./helpers.js"

const execFileAsync = promisify(execFile)

describe("RS-RP-* signals", () => {
  test("RS-RP-01 combines churn and complexity into hotspots", async () => {
    const inputs = new Map<string, unknown>([
      [
        "RS-LD-05",
        {
          functions: [],
          byFile: new Map([
            ["/repo/a.rs", summarize([5])],
            ["/repo/b.rs", summarize([20])],
            ["/repo/c.rs", summarize([15])],
          ]),
          overThresholdCount: 2,
          totalFunctions: 3,
          analysisMode: "standard-cyclomatic",
        } satisfies RsLd05Output,
      ],
      [
        "SHARED-CHURN-01",
        {
          byFile: new Map([
            ["/repo/a.rs", 2],
            ["/repo/b.rs", 9],
            ["/repo/c.rs", 12],
          ]),
          windowDays: 90,
          totalCommits: 42,
        } satisfies SharedChurn01Output,
      ],
    ])
    const out = await Effect.runPromise(RsRp01.compute(RsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(3)
    expect(out.hotspots[0]?.hotspotScore).toBeGreaterThanOrEqual(out.hotspots[1]?.hotspotScore ?? 0)
  })

  test("RS-RP-02 parses existing cargo timing output without live builds", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp02-", {
      "Cargo.toml": [
        "[package]",
        'name = "compile-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn meaning() -> u32 { 42 }",
        "",
      ].join("\n"),
    })

    try {
      await mkdir(`${repo}/target/cargo-timings`, { recursive: true })
      await writeFile(
        `${repo}/target/cargo-timings/cargo-timing.html`,
        [
          "<script>",
          'const UNIT_DATA = [{"i":0,"name":"compile-fixture","duration":0.42,"unblocked_units":[],"unblocked_rmeta_units":[]}];',
          "</script>",
        ].join("\n"),
      )
      const out = await runSignalCompute(RsRp02, repo, RsRp02.defaultConfig)
      expect(out.buildStatus).toBe("measured")
      expect(out.crates.some((entry) => entry.crate === "compile-fixture")).toBe(true)
      expect(out.cacheProbeMode).toBe("unavailable")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-RP-03 counts diff size and new cross-crate import edges", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp03-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core/Cargo.toml": [
        "[package]",
        'name = "pulsar_core"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core/src/lib.rs": [
        "pub mod api { pub struct Thing; }",
        "",
      ].join("\n"),
      "crates/app/Cargo.toml": [
        "[package]",
        'name = "pulsar_app"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'pulsar_core = { path = "../core" }',
        "",
      ].join("\n"),
      "crates/app/src/lib.rs": [
        "pub fn untouched() {}",
        "",
      ].join("\n"),
    })

    try {
      await initGitRepo(repo)
      await writeFile(
        `${repo}/crates/app/src/lib.rs`,
        [
          "use pulsar_core::api::Thing;",
          "pub fn changed(_thing: Thing) {}",
          "",
        ].join("\n"),
      )

      const out = await runSignalComputeWithContext(
        RsRp03,
        repo,
        RsRp03.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [
            {
              file: "crates/app/src/lib.rs",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
            },
          ],
        },
      )

      expect(out.linesAdded).toBeGreaterThanOrEqual(2)
      expect(out.newCrossCrateEdges.some((edge) => edge.toCrate === "pulsar_core")).toBe(true)
      expect(out.cratesTouched).toContain("pulsar_app")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("rust-only registry builds with RS pack signals", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    expect(registry.has("SHARED-CHURN-01")).toBe(true)
    expect(registry.has("SHARED-02")).toBe(true)
    expect(registry.has("SHARED-03")).toBe(true)
    expect(registry.has("RS-RP-01")).toBe(true)
  })

  test("mixed TS+Rust registry builds and shared churn feeds Rust hotspots", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp01-mixed-", {
      "Cargo.toml": [
        "[package]",
        'name = "mixed-hotspot"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn hotspot(value: u32) -> u32 {",
        "    if value == 0 {",
        "        0",
        "    } else if value == 1 {",
        "        1",
        "    } else if value == 2 {",
        "        2",
        "    } else if value == 3 {",
        "        3",
        "    } else if value == 4 {",
        "        4",
        "    } else {",
        "        5",
        "    }",
        "}",
        "",
      ].join("\n"),
      "web.ts": "export const unused = 1\n",
    })

    try {
      await initGitRepo(repo)
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-10T00:00:00Z")
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-20T00:00:00Z")
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-25T00:00:00Z")

      const registry = await Effect.runPromise(
        buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]),
      )
      expect(registry.has("SHARED-CHURN-01")).toBe(true)
      expect(registry.has("SHARED-02")).toBe(true)
      expect(registry.has("SHARED-03")).toBe(true)

      const churn = await runSignalComputeWithContext(
        SharedChurn01,
        repo,
        SharedChurn01.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        },
      )
      const rustFile = `${repo}/src/lib.rs`
      expect(churn.byFile.get(rustFile)).toBeGreaterThanOrEqual(3)

      const hotspotOut = await Effect.runPromise(
        RsRp01.compute(
          RsRp01.defaultConfig,
          new Map<string, unknown>([
            [
              "RS-LD-05",
              {
                functions: [],
                byFile: new Map([[rustFile, summarize([6])]]),
                overThresholdCount: 0,
                totalFunctions: 1,
                analysisMode: "standard-cyclomatic",
              } satisfies RsLd05Output,
            ],
            ["SHARED-CHURN-01", churn],
          ]),
        ),
      )

      expect(hotspotOut.hotspots.some((entry) => entry.file === rustFile)).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)
})

const initGitRepo = async (repo: string): Promise<void> => {
  await execFileAsync("git", ["init"], { cwd: repo })
  await execFileAsync("git", ["add", "."], { cwd: repo })
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Pulsar",
      "-c",
      "user.email=pulsar@example.com",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: repo },
  )
}

const amendTrackedFile = async (repo: string, relativePath: string, dateIso: string): Promise<void> => {
  const fullPath = `${repo}/${relativePath}`
  const current = await Bun.file(fullPath).text()
  await writeFile(fullPath, `${current}// ${dateIso}\n`)
  await execFileAsync("git", ["add", relativePath], { cwd: repo })
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Pulsar",
      "-c",
      "user.email=pulsar@example.com",
      "commit",
      "-m",
      `touch ${relativePath}`,
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: dateIso,
        GIT_COMMITTER_DATE: dateIso,
      },
    },
  )
}
