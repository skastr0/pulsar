import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import {
  observe,
  type ObserverOutput,
} from "@skastr0/pulsar-core/observer"
import { loadCanonicalReferenceDataEntries } from "@skastr0/pulsar-core/reference-data"
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
      await writeContractFreshnessFixture(repo)
      await writeDomainConstructionFixture(repo)
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
      const referenceDataEntries = await Effect.runPromise(
        loadCanonicalReferenceDataEntries(repo),
      )

      const registry = await Effect.runPromise(
        buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]),
      )
      const env = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: head,
          worktreePath: repo,
          changedHunks: [],
        }),
        Layer.succeed(ReferenceDataTag, makeReferenceData(referenceDataEntries)),
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

      const contractFreshness = result.signalResults.get("SHARED-09-contract-freshness")?.output as
        | {
            state?: string
            configuredContractCount?: number
            totalFindings?: number
          }
        | undefined
      expect(contractFreshness?.state).toBe("zero")
      expect(contractFreshness?.configuredContractCount).toBe(1)
      expect(contractFreshness?.totalFindings).toBe(0)

      const domainConstruction = result.signalResults.get("SHARED-10-domain-construction-control")?.output as
        | {
            state?: string
            configuredConstructCount?: number
            weightedFindings?: number
          }
        | undefined
      expect(domainConstruction?.state).toBe("zero")
      expect(domainConstruction?.configuredConstructCount).toBe(1)
      expect(domainConstruction?.weightedFindings).toBe(0)

      const theoryEncoding = result.signalResults.get("SHARED-11-theory-encoding-index")?.output as
        | {
            state?: string
            requiredFoundationMeasured?: boolean
            availableFactorWeight?: number
            inputFactStates?: {
              domainConstructionControl?: string
              contractFreshness?: string
            }
          }
        | undefined
      expect(theoryEncoding?.state).not.toBe("insufficient_evidence")
      expect(theoryEncoding?.requiredFoundationMeasured).toBe(true)
      expect(theoryEncoding?.availableFactorWeight).toBeGreaterThanOrEqual(0.45)
      expect(theoryEncoding?.inputFactStates).toMatchObject({
        domainConstructionControl: "zero",
        contractFreshness: "zero",
      })
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
      await writeContractFreshnessFixture(repo)
      await writeDomainConstructionFixture(repo)
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

      const contractFreshnessResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-09"),
      )
      const contractFreshnessOutput = contractFreshnessResult.result.output as {
        readonly state?: string
        readonly configuredContractCount?: number
        readonly totalFindings?: number
      }

      expect(contractFreshnessResult.result.signalId).toBe("SHARED-09-contract-freshness")
      expect(contractFreshnessOutput.state).toBe("zero")
      expect(contractFreshnessOutput.configuredContractCount).toBe(1)
      expect(contractFreshnessOutput.totalFindings).toBe(0)

      const domainConstructionResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-10"),
      )
      const domainConstructionOutput = domainConstructionResult.result.output as {
        readonly state?: string
        readonly configuredConstructCount?: number
        readonly weightedFindings?: number
      }

      expect(domainConstructionResult.result.signalId).toBe(
        "SHARED-10-domain-construction-control",
      )
      expect(domainConstructionOutput.state).toBe("zero")
      expect(domainConstructionOutput.configuredConstructCount).toBe(1)
      expect(domainConstructionOutput.weightedFindings).toBe(0)

      const theoryEncodingResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-11"),
      )
      const theoryEncodingOutput = theoryEncodingResult.result.output as {
        readonly state?: string
        readonly requiredFoundationMeasured?: boolean
        readonly availableFactorWeight?: number
        readonly inputFactStates?: {
          readonly domainConstructionControl?: string
          readonly contractFreshness?: string
        }
      }

      expect(theoryEncodingResult.result.signalId).toBe("SHARED-11-theory-encoding-index")
      expect(theoryEncodingOutput.state).not.toBe("insufficient_evidence")
      expect(theoryEncodingOutput.requiredFoundationMeasured).toBe(true)
      expect(theoryEncodingOutput.availableFactorWeight).toBeGreaterThanOrEqual(0.45)
      expect(theoryEncodingOutput.inputFactStates).toMatchObject({
        domainConstructionControl: "zero",
        contractFreshness: "zero",
      })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal runtime does not measure SHARED-11 without required reference data", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-theory-"))
    try {
      await writeFile(join(repo, "README.md"), "# theory fixture\n", "utf8")
      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)

      const result = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-11"),
      )
      const output = result.result.output as {
        readonly state?: string
        readonly requiredFoundationMeasured?: boolean
        readonly inputFactStates?: {
          readonly domainConstructionControl?: string
          readonly contractFreshness?: string
        }
      }

      expect(result.result.signalId).toBe("SHARED-11-theory-encoding-index")
      expect(output.state).toBe("insufficient_evidence")
      expect(output.requiredFoundationMeasured).toBe(false)
      expect(output.inputFactStates).toMatchObject({
        domainConstructionControl: "not_configured",
        contractFreshness: "not_configured",
      })
      expect(result.result.metadata).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(result.result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "warn",
          message:
            "Theory encoding index has insufficient configured evidence to measure.",
          data: expect.objectContaining({
            requiredFoundationMeasured: false,
          }),
        }),
      ])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal runtime exposes SHARED-09 reference-data failure states", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-contract-"))
    try {
      await mkdir(join(repo, "src", "generated"), { recursive: true })
      await writeFile(join(repo, "README.md"), "# contract fixture\n", "utf8")
      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)

      const absentResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-09"),
      )
      const absentOutput = absentResult.result.output as {
        readonly state?: string
      }
      expect(absentResult.result.signalId).toBe("SHARED-09-contract-freshness")
      expect(absentOutput.state).toBe("not_configured")
      expect(absentResult.result.metadata).toEqual({
        applicability: "insufficient_evidence",
      })

      await mkdir(join(repo, ".pulsar"), { recursive: true })
      await writeFile(join(repo, ".pulsar", "contract-freshness.json"), "{", "utf8")
      const malformedResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-09"),
      )
      const malformedOutput = malformedResult.result.output as {
        readonly state?: string
      }
      expect(malformedOutput.state).toBe("unknown")
      expect(malformedResult.result.diagnostics[0]?.severity).toBe("warn")
      expect(malformedResult.result.metadata).toEqual({
        applicability: "insufficient_evidence",
      })

      const artifactContent = "export const client = {}\n"
      await writeFile(join(repo, "src", "generated", "client.ts"), artifactContent, "utf8")
      await writeFile(
        join(repo, ".pulsar", "contract-freshness.json"),
        `${JSON.stringify(
          {
            schema_version: 1,
            contracts: [
              {
                id: "api-client",
                group_id: "openapi",
                source_paths: [],
                artifact_path: "src/generated/client.ts",
                artifact_sha256: sha256(artifactContent),
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const missingProvenanceResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-09"),
      )
      const missingProvenanceOutput = missingProvenanceResult.result.output as {
        readonly state?: string
        readonly findings?: ReadonlyArray<{ readonly kind?: string }>
      }

      expect(missingProvenanceOutput.state).toBe("present")
      expect(missingProvenanceOutput.findings?.[0]?.kind).toBe("missing-provenance")
      expect(missingProvenanceResult.result.score).toBeLessThan(1)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, 120_000)

  test("single-signal runtime exposes SHARED-10 reference-data failure states", async () => {
    const repo = await mkdtemp(join(tmpdir(), "pulsar-cli-shared-domain-"))
    try {
      await mkdir(join(repo, "src", "domain"), { recursive: true })
      await writeFile(join(repo, "README.md"), "# domain fixture\n", "utf8")
      sh("git", ["init", "-q", "-b", "main"], repo)
      sh("git", ["config", "user.email", "test@test.test"], repo)
      sh("git", ["config", "user.name", "test"], repo)
      sh("git", ["add", "."], repo)
      sh("git", ["commit", "-q", "-m", "fixture"], repo)

      const absentResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-10"),
      )
      const absentOutput = absentResult.result.output as {
        readonly state?: string
      }
      expect(absentResult.result.signalId).toBe("SHARED-10-domain-construction-control")
      expect(absentOutput.state).toBe("not_configured")
      expect(absentResult.result.metadata).toEqual({
        applicability: "insufficient_evidence",
      })

      await mkdir(join(repo, ".pulsar"), { recursive: true })
      await writeFile(join(repo, ".pulsar", "domain-construction.json"), "{", "utf8")
      const malformedResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-10"),
      )
      const malformedOutput = malformedResult.result.output as {
        readonly state?: string
      }
      expect(malformedOutput.state).toBe("unknown")
      expect(malformedResult.result.diagnostics[0]?.severity).toBe("warn")
      expect(malformedResult.result.metadata).toEqual({
        applicability: "insufficient_evidence",
      })

      const declarationContent = [
        "export class UserId {",
        "  private constructor(readonly value: string) {}",
        "}",
        "",
      ].join("\n")
      const parserContent = [
        "import { UserId } from './user-id'",
        "export const parseUserId = (value: string): UserId => value as unknown as UserId",
        "",
      ].join("\n")
      await writeFile(join(repo, "src", "domain", "user-id.ts"), declarationContent, "utf8")
      await writeFile(join(repo, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
      await writeFile(
        join(repo, ".pulsar", "domain-construction.json"),
        `${JSON.stringify(
          {
            schema_version: 1,
            constructs: [
              {
                id: "user-id",
                symbol: "UserId",
                kind: "value-object",
                declaration_path: "src/domain/user-id.ts",
                source_hashes: {},
                control: {
                  intent: "controlled",
                  parsers: [
                    {
                      path: "src/domain/parse-user-id.ts",
                      symbol: "parseUserId",
                    },
                  ],
                },
              },
            ],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )
      const missingProvenanceResult = await Effect.runPromise(
        runSignalInWorktree(repo, "SHARED-10"),
      )
      const missingProvenanceOutput = missingProvenanceResult.result.output as {
        readonly state?: string
        readonly findings?: ReadonlyArray<{ readonly kind?: string }>
      }

      expect(missingProvenanceOutput.state).toBe("present")
      expect(missingProvenanceOutput.findings?.map((finding) => finding.kind)).toContain(
        "missing-source-provenance",
      )
      expect(missingProvenanceResult.result.score).toBeLessThan(1)
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

const writeContractFreshnessFixture = async (repo: string): Promise<void> => {
  const sourceContent = `${JSON.stringify({ openapi: "3.1.0", paths: {} })}\n`
  const artifactContent = "export const client = {}\n"
  await mkdir(join(repo, ".pulsar"), { recursive: true })
  await mkdir(join(repo, "contracts"), { recursive: true })
  await mkdir(join(repo, "src", "generated"), { recursive: true })
  await writeFile(join(repo, "contracts", "openapi.json"), sourceContent, "utf8")
  await writeFile(join(repo, "src", "generated", "client.ts"), artifactContent, "utf8")
  await writeFile(
    join(repo, ".pulsar", "contract-freshness.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            source_hashes: {
              "contracts/openapi.json": sha256(sourceContent),
            },
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(artifactContent),
            generator: "openapi-generator",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

const writeDomainConstructionFixture = async (repo: string): Promise<void> => {
  const declarationContent = [
    "export class UserId {",
    "  private constructor(readonly value: string) {}",
    "}",
    "",
  ].join("\n")
  const parserContent = [
    "import { UserId } from './user-id'",
    "export const parseUserId = (value: string): UserId => value as unknown as UserId",
    "",
  ].join("\n")
  await mkdir(join(repo, ".pulsar"), { recursive: true })
  await mkdir(join(repo, "src", "domain"), { recursive: true })
  await writeFile(join(repo, "src", "domain", "user-id.ts"), declarationContent, "utf8")
  await writeFile(join(repo, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
  await writeFile(
    join(repo, ".pulsar", "domain-construction.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        constructs: [
          {
            id: "user-id",
            symbol: "UserId",
            kind: "value-object",
            declaration_path: "src/domain/user-id.ts",
            source_hashes: {
              "src/domain/user-id.ts": sha256(declarationContent),
              "src/domain/parse-user-id.ts": sha256(parserContent),
            },
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
