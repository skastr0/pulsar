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

describe("polyglot shared signals", () => {
  test("shared signals fire once across a polyglot workspace", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-"))
    try {
      await mkdir(join(repo, "packages/web/src"), { recursive: true })
      await mkdir(join(repo, "crates/core/src"), { recursive: true })
      await mkdir(join(repo, "crates/api/src"), { recursive: true })

      await writeFile(join(repo, "package.json"), '{"name":"shared-fixture","private":true}\n')
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
          "#[allow(clippy::unwrap_used)]",
          "pub fn render() -> &'static str {",
          "    use fixture_core::ping;",
          "    ping()",
          "}",
        ].join("\n"),
      )

      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)
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
        "SHARED-CHURN-01-recent-churn",
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
