import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsSec03, secretFindingSeverity } from "../signals/ts-sec-03-secret-material.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

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

  test("true-secret corpus: every known format is detected at block severity", async () => {
    await repo.write(
      "src/leaked.ts",
      [
        "export const pemBlock = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEAxF6bPnUuq\\n-----END RSA PRIVATE KEY-----'",
        "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'",
        "export const githubPat = 'ghp_REDACTED'",
        "export const slackBot = 'xoxb-REDACTED'",
        "export const googleMaps = 'AIza-REDACTED'",
        "export const openaiAdmin = 'sk-proj-REDACTED'",
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
    expect(TsSec03.score(out)).toBeCloseTo(0.9)
  })

  test("warn-only findings never drop the score below the 0.6 floor", async () => {
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
    expect(TsSec03.score(out)).toBe(0.6)
  })

  test("block findings keep the aggressive curve even when mixed with warns", async () => {
    await repo.write(
      "src/mixed.ts",
      [
        "export const awsAccessKeyId = 'AKIAIOSFODNN7EXAMPLE'",
        "export const githubPat = 'ghp_REDACTED'",
        "export const opaqueBlob = 'mQ9zX2kP7vL4nR8tW1yC5sD3hJ6gF0bE9aU4iO7e='",
      ].join("\n"),
    )

    const out = await run()
    const severities = TsSec03.diagnose(out).map((diagnostic) => diagnostic.severity)

    expect(out.findings).toHaveLength(3)
    expect(severities).toEqual(["block", "block", "warn"])
    expect(TsSec03.score(out)).toBeCloseTo(0.4)
    expect(out.findings.map((finding) => secretFindingSeverity(finding.kind))).toEqual([
      "block",
      "block",
      "warn",
    ])
  })
})
