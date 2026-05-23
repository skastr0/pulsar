import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "bun:test"
import {
  observe,
  type ObserverOutput,
} from "@skastr0/pulsar-core/observer"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { makeReferenceData } from "@skastr0/pulsar-core/reference-data"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
} from "@skastr0/pulsar-core/signal"
import { RustProjectLayer, RS_PACK_SIGNALS } from "@skastr0/pulsar-rs-pack"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TsProjectLayer, TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
import { Effect, Layer } from "effect"
import { runSignalInWorktree } from "../runtime.js"

describe("polyglot shared signals", () => {
  test("shared signals fire once across a polyglot workspace", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-"))
    try {
      await mkdir(join(repo, "packages/web/src"), { recursive: true })
      await mkdir(join(repo, "crates/core/src"), { recursive: true })
      await mkdir(join(repo, "crates/api/src"), { recursive: true })

      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "shared-fixture",
          private: true,
          scripts: {
            build: "tsc -b",
            typecheck: "tsc --noEmit",
            test: "bun test",
            lint: "eslint .",
          },
        }),
      )
      await writeFile(
        join(repo, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
            },
            include: ["packages/**/*.ts"],
          },
          null,
          2,
        ),
      )
      await writeFile(
        join(repo, "packages/web/src/index.ts"),
        [
          "// @ts-ignore intentional fixture suppression",
          'import { shared } from "./shared"',
          "export const view = shared()",
        ].join("\n"),
      )
      await writeFile(join(repo, "packages/web/src/shared.ts"), "export const shared = () => 'ok'\n")

      await writeFile(
        join(repo, "Cargo.toml"),
        [
          "[workspace]",
          'members = ["crates/core", "crates/api"]',
          'resolver = "2"',
        ].join("\n"),
      )
      await writeFile(
        join(repo, "crates/core/Cargo.toml"),
        [
          "[package]",
          'name = "fixture_core"',
          'version = "0.1.0"',
          'edition = "2021"',
        ].join("\n"),
      )
      await writeFile(join(repo, "crates/core/src/lib.rs"), "pub fn ping() -> &'static str { \"pong\" }\n")
      await writeFile(
        join(repo, "crates/api/Cargo.toml"),
        [
          "[package]",
          'name = "fixture_api"',
          'version = "0.1.0"',
          'edition = "2021"',
          "",
          "[dependencies]",
          'fixture_core = { path = "../core" }',
        ].join("\n"),
      )
      await writeFile(
        join(repo, "crates/api/src/lib.rs"),
        [
          "pub fn render() -> &'static str {",
          '    "pong"',
          "}",
        ].join("\n"),
      )

      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)
      await writeFile(
        join(repo, "crates/api/src/lib.rs"),
        [
          "use fixture_core::ping;",
          "#[allow(clippy::unwrap_used)]",
          "pub fn render() -> &'static str {",
          "    ping()",
          "}",
        ].join("\n"),
      )
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "add cross crate dependency"], repo)
      const head = sh("git", ["rev-parse", "HEAD"], repo)

      const registry = await Effect.runPromise(
        buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]),
      )
      const env = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: head,
          worktreePath: repo,
          changedHunks: [],
        }),
        Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
        InMemoryCacheLayer,
        TsProjectLayer(repo),
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), env) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )

      const sharedIds = [...result.signalResults.keys()].filter((id) => id.startsWith("SHARED-"))
      expect(sharedIds.sort()).toEqual([
        "SHARED-02-bus-factor",
        "SHARED-03-churn-rate",
        "SHARED-05-suppression-governance",
        "SHARED-06-pr-dependency-delta",
        "SHARED-07-machine-feedback-coverage",
        "SHARED-09-contract-freshness",
        "SHARED-10-domain-construction-control",
        "SHARED-11-theory-encoding-index",
        "SHARED-CHURN-01-recent-churn",
        "SHARED-CHURN-02-recency-weighted-churn",
        "SHARED-COCHANGE-01-logical-coupling",
        "SHARED-COV-01-coverage-facts",
      ])

      const suppression = result.signalResults.get("SHARED-05-suppression-governance")?.output as
        | {
            byLanguage?: {
              typescript?: { totalSuppressions: number }
              rust?: { totalSuppressions: number }
            }
          }
        | undefined
      expect(suppression?.byLanguage?.typescript?.totalSuppressions).toBe(1)
      expect(suppression?.byLanguage?.rust?.totalSuppressions).toBe(1)

      const prDependencyDelta = result.signalResults.get("SHARED-06-pr-dependency-delta")?.output as
        | {
            dependencyDeltaState?: string
            crossCrateEdges?: number
            byLanguage?: {
              rust?: { newDependencyEdges: number }
            }
          }
        | undefined
      expect(prDependencyDelta?.dependencyDeltaState).toBe("measured")
      expect(prDependencyDelta?.crossCrateEdges).toBe(1)
      expect(prDependencyDelta?.byLanguage?.rust?.newDependencyEdges).toBe(1)

      const machineFeedbackCoverage = result.signalResults.get("SHARED-07-machine-feedback-coverage")?.output as
        | {
            state?: string
            configuredClassCount?: number
            missingClassCount?: number
          }
        | undefined
      expect(machineFeedbackCoverage?.state).toBe("present")
      expect(machineFeedbackCoverage?.configuredClassCount).toBeGreaterThanOrEqual(4)
      expect(machineFeedbackCoverage?.missingClassCount).toBe(0)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal runtime provides language layers for shared compound inputs", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-single-"))
    try {
      await mkdir(join(repo, "src"), { recursive: true })
      await mkdir(join(repo, "crates/core/src"), { recursive: true })

      await writeFile(
        join(repo, "package.json"),
        JSON.stringify({
          name: "shared-single",
          private: true,
          scripts: {
            build: "tsc -b",
            typecheck: "tsc --noEmit",
            test: "bun test",
            lint: "eslint .",
          },
        }),
      )
      await writeFile(
        join(repo, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      )
      await writeFile(
        join(repo, "src/index.ts"),
        [
          "// @ts-ignore intentional fixture suppression",
          "export const value = 1",
        ].join("\n"),
      )
      await writeFile(
        join(repo, "Cargo.toml"),
        [
          "[workspace]",
          'members = ["crates/core"]',
          'resolver = "2"',
        ].join("\n"),
      )
      await writeFile(
        join(repo, "crates/core/Cargo.toml"),
        [
          "[package]",
          'name = "fixture_core"',
          'version = "0.1.0"',
          'edition = "2021"',
        ].join("\n"),
      )
      await writeFile(
        join(repo, "crates/core/src/lib.rs"),
        [
          "#[allow(clippy::unwrap_used)]",
          "pub fn value() -> i32 { 1 }",
        ].join("\n"),
      )

      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)
      await writeFile(join(repo, "src/extra.ts"), "export const extra = 2\n")
      await writeFile(
        join(repo, "crates/core/src/lib.rs"),
        [
          "#[allow(clippy::unwrap_used)]",
          "pub fn value() -> i32 { 1 }",
          "pub fn extra() -> i32 { 2 }",
        ].join("\n"),
      )
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "change fixture"], repo)

      const result = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-05"),
      )
      const output = result.result.output as {
        readonly byLanguage?: {
          readonly typescript?: { readonly totalSuppressions: number }
          readonly rust?: { readonly totalSuppressions: number }
        }
      }

      expect(result.result.signalId).toBe("SHARED-05-suppression-governance")
      expect(output.byLanguage?.typescript?.totalSuppressions).toBe(1)
      expect(output.byLanguage?.rust?.totalSuppressions).toBe(1)

      const prDeltaResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-06"),
      )
      const prDeltaOutput = prDeltaResult.result.output as {
        readonly dependencyDeltaState?: string
        readonly byLanguage?: {
          readonly typescript?: { readonly linesAdded: number }
          readonly rust?: { readonly linesAdded: number }
        }
      }

      expect(prDeltaResult.result.signalId).toBe("SHARED-06-pr-dependency-delta")
      expect(prDeltaOutput.dependencyDeltaState).toBe("measured")
      expect(prDeltaOutput.byLanguage?.typescript?.linesAdded).toBeGreaterThan(0)
      expect(prDeltaOutput.byLanguage?.rust?.linesAdded).toBeGreaterThan(0)

      const feedbackResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-07"),
      )
      const feedbackOutput = feedbackResult.result.output as {
        readonly state?: string
        readonly missingClassCount?: number
      }

      expect(feedbackResult.result.signalId).toBe("SHARED-07-machine-feedback-coverage")
      expect(feedbackOutput.state).toBe("present")
      expect(feedbackOutput.missingClassCount).toBe(0)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, 120_000)
})

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}
