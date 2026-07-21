import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
} from "@skastr0/pulsar-core/signal"
import {
  buildRegistry,
  observe,
  runSignal as runRegisteredSignal,
} from "@skastr0/pulsar-core/scoring"
import { Effect, Layer } from "effect"
import {
  TsSec03,
  secretFindingEvidenceClass,
  secretFindingSeverity,
} from "../signals/ts-sec-03-secret-material.js"
import { TsProjectLayer } from "../ts-project.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

// Scanner-grade fixture tokens are assembled at runtime so this SOURCE file
// never contains a contiguous secret-shaped string — GitHub push protection
// scans test sources too and blocks pushes containing them. The temp
// fixtures pulsar scans still receive the full tokens, so detection
// coverage is unchanged. (AWS's AKIAIOSFODNN7EXAMPLE is the documented
// example key and is universally allowlisted; the JWT is the public HS256
// demo token.)
const FIXTURE_GITHUB_PAT = ["ghp", "_wWPw5k4aXcaT4fNP0UcnZwJUVFk6LO0pINUx"].join("")
const FIXTURE_SLACK_BOT_TOKEN = ["xoxb", "-2444333222111-0123456789012-AbCdEfGhIjKlMnOpQrStUvWx"].join("")
const FIXTURE_GOOGLE_API_KEY = ["AIza", "SyA1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tUvW"].join("")
const FIXTURE_OPENAI_KEY = ["sk-", "proj-4fNP0UcnZwJUVFk6LO0pINUxwWPw5k4aXcaT"].join("")

// Benign corpus: every string was a verified false positive from a real
// repository where the previous implementation produced a hard-gate block.
const BENIGN_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    "src/migrations.ts",
    [
      "import { Database } from 'bun:sqlite'",
      "export const migrationIds = [",
      "  '003_run_step_v1_fields',",
      "]",
      "export const db = new Database(':memory:')",
    ].join("\n"),
  ],
  [
    "src/workspaces.ts",
    [
      "import { mkdtemp } from 'node:fs/promises'",
      "import { tmpdir } from 'node:os'",
      "import { join } from 'node:path'",
      "export const createInstallDir = () => mkdtemp(join(tmpdir(), 'groundwork-local-install-'))",
      "export const createSnippetDir = () => mkdtemp(join(tmpdir(), 'groundwork-policy-snippet-'))",
      "export const createDeviceDir = () => mkdtemp(join(tmpdir(), 'probe-validate-device-'))",
    ].join("\n"),
  ],
  [
    "src/xcodebuild.ts",
    [
      "export const xcodeSelect = '/usr/bin/xcode-select'",
      "export const bootstrapRoot = '/tmp/probe-runner-bootstrap'",
      "export const buildArgs = [",
      "  '-allowProvisioningUpdates',",
      "  '-allowProvisioningDeviceRegistration',",
      "  'CODE_SIGNING_ALLOWED=NO',",
      "  '-destination',",
      "  'generic/platform=iOS',",
      "]",
    ].join("\n"),
  ],
  [
    "src/git-objects.ts",
    "export const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'\n",
  ],
  [
    "src/design-tokens.ts",
    [
      "export const palette = {",
      "  colorToken: 'blossomPetal',",
      "  designToken: 'meadowMistAtDawn',",
      "}",
    ].join("\n"),
  ],
]

describe("TS-SEC-03 secret material", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-sec-03-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  const run = () => runSignal(repo.root, TsSec03, TsSec03.defaultConfig)

  const runEnforced = async () => {
    const registry = await Effect.runPromise(buildRegistry([TsSec03]))
    const layer = Layer.mergeAll(
      TsProjectLayer(repo.root),
      InMemoryCacheLayer,
      Layer.succeed(SignalContextTag, {
        gitSha: "TEST",
        worktreePath: repo.root,
        changedHunks: [],
      }),
      Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
    )
    return Effect.runPromise(
      runRegisteredSignal(registry, TsSec03.id).pipe(Effect.provide(layer)),
    )
  }

  const runObserved = async () => {
    const registry = await Effect.runPromise(buildRegistry([TsSec03]))
    const layer = Layer.mergeAll(
      TsProjectLayer(repo.root),
      InMemoryCacheLayer,
      Layer.succeed(SignalContextTag, {
        gitSha: "TEST",
        worktreePath: repo.root,
        changedHunks: [],
      }),
      Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
    )
    return Effect.runPromise(observe(registry, undefined).pipe(Effect.provide(layer)))
  }

  const writeFixture = async (path: string) => {
    const fixture = BENIGN_FIXTURES.find(([file]) => file === path)
    expect(fixture).toBeDefined()
    await repo.write(fixture![0], fixture![1])
  }

  test("benign corpus produces zero findings at any severity", async () => {
    for (const [path, content] of BENIGN_FIXTURES) {
      await repo.write(path, content)
    }

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.state).toBe("zero")
    expect(TsSec03.score(out)).toBe(1)
    expect(TsSec03.diagnose(out)).toEqual([])
  })

  test("ignores snake_case dictionary-word migration ids despite passing entropy", async () => {
    await writeFixture("src/migrations.ts")

    const out = await run()

    expect(out.findings).toEqual([])
  })

  test("ignores kebab-case mkdtemp prefixes with trailing separators", async () => {
    await writeFixture("src/workspaces.ts")

    const out = await run()

    expect(out.findings).toEqual([])
  })

  test("ignores absolute paths, single-dash flags, and KEY=VALUE build settings", async () => {
    await writeFixture("src/xcodebuild.ts")

    const out = await run()

    expect(out.findings).toEqual([])
  })

  test("ignores pure-hex values bound to checksum-named identifiers", async () => {
    await writeFixture("src/git-objects.ts")

    const out = await run()

    expect(out.findings).toEqual([])
  })

  test("ignores design-system token vocabulary on the secret-named path", async () => {
    await writeFixture("src/design-tokens.ts")

    const out = await run()

    expect(out.findings).toEqual([])
  })

  test("Vellum lookup-key aliases and explicit fixture labels stay clean", async () => {
    await repo.write(
      "src/chat-state.ts",
      [
        "export const tokenUsageFields = [",
        "  'inputTokens',",
        "  'outputTokens',",
        "  'promptTokens',",
        "  'completionTokens',",
        "  'totalTokens',",
        "] as const",
        "export const readApiToken = (usage: Record<string, number>) => usage['apiToken']",
        "export const kernelProbeToken = '__kernel-probe-fixture__'",
        "type SecretChannelOutput = { scoreChannels: unknown }",
        "export const secretScoreChannels = (): SecretChannelOutput['scoreChannels'] => undefined",
        "export const redactSecret = () => '<redacted>'",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.state).toBe("zero")
    expect(TsSec03.score(out)).toBe(1)
  })

  test("SST-style constructor labels stay clean without suppressing proof material", async () => {
    await repo.write(
      "infra/secret.ts",
      [
        "declare const sst: { Secret: new (name: string, value?: string) => unknown }",
        "export const R2SecretKey = new sst.Secret('R2SecretKey')",
        "export const consoleSecret = new sst.Secret('GITHUB_CLIENT_SECRET_CONSOLE')",
        `export const leakedSecret = new sst.Secret('LEAKED_SECRET_RESOURCE', '${FIXTURE_GITHUB_PAT}')`,
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "known-secret-prefix",
      identifier: "leakedSecret",
      evidencePath: "proof",
    })
    expect(TsSec03.score(out)).toBe(0.8)
  })

  test("attributes findings to the nearest enclosing binding, not nearby imports", async () => {
    await repo.write(
      "src/session-store.ts",
      [
        "import { Database } from 'bun:sqlite'",
        "export const sessionBlobs = [",
        "  'mQ9zX2kP7vL4nR8tW1yC5sD3hJ6gF0bE9aU4iO7e=',",
        "]",
        "export const db = new Database(':memory:')",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "high-entropy-literal",
      identifier: "sessionBlobs",
    })
  })

  test("attributes class property literals to the property name", async () => {
    await repo.write(
      "src/vault-client.ts",
      [
        "export class VaultClient {",
        "  private readonly sessionSecret = 'Zk9qPm4XvR7tBn2LsW8yHd5JcQ0aUf6eGi3oTx1+'",
        "}",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "secret-named-literal",
      identifier: "sessionSecret",
    })
    expect(TsSec03.diagnose(out)[0]?.severity).toBe("warn")
  })

  test("ignores fused YYYYMMDD date chunks in model identifiers", async () => {
    await repo.write(
      "src/models.ts",
      [
        "export const MODEL_ID = 'claude-sonnet-4-20250514'",
        "export const FALLBACK_MODEL_ID = 'claude-3-5-haiku-20241022'",
      ].join("\n"),
    )

    const out = await run()

    expect(out.findings).toEqual([])
    expect(out.state).toBe("zero")
  })

  test("positive control: random material on a non-secret name still flags", async () => {
    await repo.write(
      "src/blob.ts",
      "export const opaqueBlob = 'mQ9zX2kP7vL4nR8tW1yC5sD3hJ6gF0bE9aU4iO7e='\n",
    )

    const out = await run()

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "high-entropy-literal",
      identifier: "opaqueBlob",
    })
  })

  test("positive control: secret-named identifier holding a date-bearing value still flags", async () => {
    await repo.write(
      "src/config.ts",
      "export const apiKey = 'claude-sonnet-4-20250514'\n",
    )

    const out = await run()

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "secret-named-literal",
      identifier: "apiKey",
    })
  })

  test("true-secret corpus: every known format is detected at block severity", async () => {
    await repo.write(
      "src/leaked.ts",
      [
        "export const pemBlock = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEAxF6bPnUuq\\n-----END RSA PRIVATE KEY-----'",
        "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'",
        `export const githubPat = '${FIXTURE_GITHUB_PAT}'`,
        `export const slackBot = '${FIXTURE_SLACK_BOT_TOKEN}'`,
        `export const googleMaps = '${FIXTURE_GOOGLE_API_KEY}'`,
        `export const openaiAdmin = '${FIXTURE_OPENAI_KEY}'`,
        "export const signedJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'",
      ].join("\n"),
    )

    const out = await run()
    const diagnostics = TsSec03.diagnose(out)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(7)
    expect(out.findings.filter((finding) => finding.kind === "private-key-block")).toHaveLength(1)
    expect(out.findings.filter((finding) => finding.kind === "known-secret-prefix")).toHaveLength(6)
    expect(diagnostics).toHaveLength(7)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "block")).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.evidenceClass === "deterministic-ast"))
      .toBe(true)
    expect(out.findings.every((finding) => finding.evidencePath === "proof")).toBe(true)
    expect(out.findings.every((finding) => finding.scoreDenominator === 5)).toBe(true)
    expect(out.findings.every((finding) => finding.affectsSignalScore)).toBe(true)
    expect(out.findings.every((finding) =>
      finding.enforcementCeiling.length === 1 && finding.enforcementCeiling[0] === "hard-gate"
    )).toBe(true)
    expect(out.scoreChannels).toEqual({
      proof: {
        findingCount: 7,
        denominator: 5,
        score: 0,
        affectsSignalScore: true,
        enforcementCeiling: ["hard-gate"],
      },
      advisory: {
        findingCount: 0,
        denominator: 10,
        score: 1,
        affectsSignalScore: false,
        enforcementCeiling: ["review-routing"],
      },
    })
    expect(TsSec03.score(out)).toBe(0)
  })

  test("positive control: random base64 assigned to a secret-named const warns", async () => {
    await repo.write(
      "src/config.ts",
      "export const apiSecret = 'Qm7vXz3kRp9LbT2wYs8HdJ4cN6fAu0eGi5oM1xE+'\n",
    )

    const out = await run()
    const diagnostics = TsSec03.diagnose(out)

    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "secret-named-literal",
      identifier: "apiSecret",
    })
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.evidenceClass).toBe("heuristic-pattern")
    expect(out.findings[0]).toMatchObject({
      evidencePath: "advisory",
      detectorReason: "secret-name-and-entropy",
      enforcementCeiling: ["review-routing"],
      scoreDenominator: 10,
      affectsSignalScore: false,
    })
    expect(TsSec03.score(out)).toBe(1)
    expect(out.scoreChannels.advisory.score).toBeCloseTo(0.9)
  })

  test("heuristic-only findings keep the proof score clean and retain an advisory floor", async () => {
    await repo.write(
      "src/blobs.ts",
      [
        "export const blob1 = 'pV7kXm2qRz9LbW4tYs1HdJ8c='",
        "export const blob2 = 'aT3fWh6jKl9MnP2qRs5UvB8x='",
        "export const blob3 = 'bY4cZe7gHi0JkL3mNo6PqR9s='",
        "export const blob4 = 'cU5dVf8hWj1KxL4mYn7ZoQ0r='",
        "export const blob5 = 'dQ6eRg9iSh2TkU5lVm8WnX1o='",
        "export const blob6 = 'fP7gQh0jRk3SlT6mUn9VoW2p='",
      ].join("\n"),
    )

    const out = await run()
    const diagnostics = TsSec03.diagnose(out)

    expect(out.findings).toHaveLength(6)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warn")).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.evidenceClass === "heuristic-pattern"))
      .toBe(true)
    expect(TsSec03.score(out)).toBe(1)
    expect(out.scoreChannels).toEqual({
      proof: {
        findingCount: 0,
        denominator: 5,
        score: 1,
        affectsSignalScore: true,
        enforcementCeiling: ["hard-gate"],
      },
      advisory: {
        findingCount: 6,
        denominator: 10,
        score: 0.6,
        affectsSignalScore: false,
        enforcementCeiling: ["review-routing"],
      },
    })
  })

  test("registered heuristic-only evidence is score-neutral, ungated, and non-poisoning", async () => {
    await repo.write(
      "src/blob.ts",
      "export const sessionToken = 'Qm7vXz3kRp9LbT2wYs8HdJ4cN6fAu0eGi5oM1xE+'\n",
    )

    const observation = await runObserved()
    const result = observation.signalResults.get(TsSec03.id)
    const pressure = observation.readiness?.top_pressures.find(
      (candidate) => candidate.signal_id === TsSec03.id,
    )

    expect(result?.score).toBe(1)
    expect(result?.diagnostics).toHaveLength(1)
    expect(result?.diagnostics[0]).toMatchObject({
      severity: "warn",
      evidenceClass: "heuristic-pattern",
    })
    expect(observation.hard_gate_status).toBe("pass")
    expect(observation.hard_gate_violations).toEqual([])
    expect(pressure).toMatchObject({
      raw_pressure: 0,
      poison_authority: false,
    })
  })

  test("registered proof-only evidence follows the proof curve and hard-gates", async () => {
    await repo.write(
      "src/leaked.ts",
      "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'\n",
    )

    const observation = await runObserved()
    const result = observation.signalResults.get(TsSec03.id)

    expect(result?.score).toBe(0.8)
    expect(result?.diagnostics).toHaveLength(1)
    expect(result?.diagnostics[0]).toMatchObject({
      severity: "block",
      evidenceClass: "deterministic-ast",
    })
    expect(observation.hard_gate_status).toBe("fail")
    expect(observation.hard_gate_violations).toHaveLength(1)
    expect(observation.hard_gate_violations[0]).toMatchObject({
      signalId: TsSec03.id,
      diagnostic: { severity: "block", evidenceClass: "deterministic-ast" },
    })
  })

  test("mixed proof and heuristic findings use independent score denominators", async () => {
    await repo.write(
      "src/mixed.ts",
      [
        "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'",
        `export const githubPat = '${FIXTURE_GITHUB_PAT}'`,
        "export const opaqueBlob = 'mQ9zX2kP7vL4nR8tW1yC5sD3hJ6gF0bE9aU4iO7e='",
      ].join("\n"),
    )

    const out = await run()
    const diagnostics = TsSec03.diagnose(out)
    const severities = diagnostics.map((diagnostic) => diagnostic.severity)

    expect(out.findings).toHaveLength(3)
    expect(severities).toEqual(["block", "block", "warn"])
    expect(diagnostics.map((diagnostic) => diagnostic.evidenceClass)).toEqual([
      "deterministic-ast",
      "deterministic-ast",
      "heuristic-pattern",
    ])
    expect(TsSec03.score(out)).toBeCloseTo(0.6)
    expect(out.scoreChannels).toEqual({
      proof: {
        findingCount: 2,
        denominator: 5,
        score: 0.6,
        affectsSignalScore: true,
        enforcementCeiling: ["hard-gate"],
      },
      advisory: {
        findingCount: 1,
        denominator: 10,
        score: 0.9,
        affectsSignalScore: false,
        enforcementCeiling: ["review-routing"],
      },
    })
    expect(out.findings.map((finding) => secretFindingSeverity(finding.kind))).toEqual([
      "block",
      "block",
      "warn",
    ])
    expect(out.findings.map((finding) => secretFindingEvidenceClass(finding.kind))).toEqual([
      "deterministic-ast",
      "deterministic-ast",
      "heuristic-pattern",
    ])
  })

  test("resolved enforcement preserves proof blocks and keeps heuristic findings advisory", async () => {
    await repo.write(
      "src/enforcement.ts",
      [
        "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'",
        "export const opaqueBlob = 'mQ9zX2kP7vL4nR8tW1yC5sD3hJ6gF0bE9aU4iO7e='",
      ].join("\n"),
    )

    const result = await runEnforced()

    expect(result.diagnostics.map(({ severity, evidenceClass }) => ({
      severity,
      evidenceClass,
    }))).toEqual([
      { severity: "block", evidenceClass: "deterministic-ast" },
      { severity: "warn", evidenceClass: "heuristic-pattern" },
    ])
    expect(result.score).toBe(0.8)
    expect(result.output).toMatchObject({
      scoreChannels: {
        proof: { findingCount: 1, score: 0.8, affectsSignalScore: true },
        advisory: { findingCount: 1, score: 0.9, affectsSignalScore: false },
      },
    })

    const observation = await runObserved()
    expect(observation.signalResults.get(TsSec03.id)?.score).toBe(0.8)
    expect(observation.hard_gate_violations).toHaveLength(1)
    expect(observation.hard_gate_violations[0]?.diagnostic).toMatchObject({
      severity: "block",
      evidenceClass: "deterministic-ast",
    })
    expect(observation.signalResults.get(TsSec03.id)?.diagnostics[1]).toMatchObject({
      severity: "warn",
      evidenceClass: "heuristic-pattern",
    })
  })
})
