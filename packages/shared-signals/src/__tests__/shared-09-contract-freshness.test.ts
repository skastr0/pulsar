import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { ReferenceDataTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import {
  loadCanonicalReferenceDataEntries,
  type ContractFreshnessFinding,
  type ContractFreshnessManifest,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  Shared09ContractFreshness,
  type Shared09ContractFreshnessOutput,
} from "../shared-09-contract-freshness.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

const runSignal = async (
  repoRoot = tmp,
  config = Shared09ContractFreshness.defaultConfig,
): Promise<Shared09ContractFreshnessOutput> => {
  const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(repoRoot))
  return Effect.runPromise(
    Shared09ContractFreshness.compute(config, new Map()).pipe(
      Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(entries))),
    ) as Effect.Effect<Shared09ContractFreshnessOutput, unknown, never>,
  )
}

describe("SHARED-09 contract freshness", () => {
  test("declares identity, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-09"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-09")
    const decoded = Schema.decodeUnknownSync(Shared09ContractFreshness.configSchema)(
      Shared09ContractFreshness.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared09ContractFreshnessOutput)

    expect(Shared09ContractFreshness).toMatchObject({
      id: "SHARED-09-contract-freshness",
      title: "Contract freshness",
      aliases: ["SHARED-09"],
      tier: 2,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "reference-data-v2-normalized-config-source-provenance",
      inputs: [],
    })
    expect(decoded).toEqual({
      top_n_diagnostics: 10,
      max_weighted_findings: 8,
    })
    expect(registered?.id).toBe(Shared09ContractFreshness.id)
    expect(registered?.cacheVersion).toContain(Shared09ContractFreshness.cacheVersion)
    expect(registry.byId.get("SHARED-09")?.id).toBe(Shared09ContractFreshness.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_weighted_findings",
        value: 8,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("distinguishes not configured reference data from zero findings", async () => {
    const out = await runSignal()

    expect(out.state).toBe("not_configured")
    expect(out.totalFindings).toBe(0)
    expect(Shared09ContractFreshness.score(out)).toBe(1)
    expect(Shared09ContractFreshness.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(out.cacheContributors).toContain("reference-data.contract-freshness")
  })

  test("reports zero when declared source and artifact hashes are fresh", async () => {
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const artifactContent = "export const client = {}\n"
    await writeContractFixture({
      sourceContent,
      artifactContent,
      manifest: {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(artifactContent),
            generator: "openapi-generator",
          },
        ],
      },
    })

    const out = await runSignal()

    expect(out.state).toBe("zero")
    expect(out.totalFindings).toBe(0)
    expect(out.configuredContractCount).toBe(1)
    expect(out.sourceFileCount).toBe(1)
    expect(out.artifactFileCount).toBe(1)
    expect(out.compositeConsumers).toContain("contract safety gap")
    expect(out.diagnosticLimit).toBe(10)
    expect(out.maxWeightedFindings).toBe(8)
    expect(out.scorePressure).toBe(0)
    expect(Shared09ContractFreshness.score(out)).toBe(1)
  })

  test("flags stale generated artifacts when source content hash changes", async () => {
    const oldSourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const artifactContent = "export const client = {}\n"
    await writeContractFixture({
      sourceContent: JSON.stringify({ openapi: "3.1.0", paths: { "/users": {} } }),
      artifactContent,
      manifest: {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            source_hashes: { "contracts/openapi.json": sha256(oldSourceContent) },
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(artifactContent),
          },
        ],
      },
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings.map((finding: ContractFreshnessFinding) => finding.kind)).toContain(
      "stale-artifact",
    )
    expect(Shared09ContractFreshness.score(out)).toBeLessThan(1)
    expect(Shared09ContractFreshness.diagnose(out)[0]?.message).toContain(
      "Stale generated artifact",
    )
  })

  test("flags stale generated artifacts when artifact content hash changes", async () => {
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const oldArtifactContent = "export const client = {}\n"
    await writeContractFixture({
      sourceContent,
      artifactContent: "export const client = { changed: true }\n",
      manifest: {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(oldArtifactContent),
          },
        ],
      },
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "stale-artifact",
        artifactFile: "src/generated/client.ts",
        evidence: expect.arrayContaining([
          `expected artifact hash ${sha256(oldArtifactContent)}`,
        ]),
      }),
    ])
  })

  test("flags missing source contracts as stale artifact evidence", async () => {
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const artifactContent = "export const client = {}\n"
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "generated"), { recursive: true })
    await writeFile(join(tmp, "src", "generated", "client.ts"), artifactContent, "utf8")
    await writeManifest({
      schema_version: 1,
      contracts: [
        {
          id: "api-client",
          group_id: "openapi",
          source_paths: ["contracts/openapi.json"],
          source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
          artifact_path: "src/generated/client.ts",
          artifact_sha256: sha256(artifactContent),
        },
      ],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "stale-artifact",
        sourceFile: "contracts/openapi.json",
        artifactFile: "src/generated/client.ts",
        evidence: ["declared source contract is missing"],
      }),
    ])
  })

  test("does not claim freshness when declared sources lack recorded source hashes", async () => {
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    const artifactContent = "export const client = {}\n"
    await writeContractFixture({
      sourceContent,
      artifactContent,
      manifest: {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(artifactContent),
          },
        ],
      },
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "missing-provenance",
        severity: "info",
        sourceFile: "contracts/openapi.json",
        artifactFile: "src/generated/client.ts",
      }),
    ])
  })

  test("does not claim freshness from artifact-only hashes without source provenance", async () => {
    const artifactContent = "export const client = {}\n"
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "generated"), { recursive: true })
    await writeFile(join(tmp, "src", "generated", "client.ts"), artifactContent, "utf8")
    await writeManifest({
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
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "missing-provenance",
        severity: "info",
        artifactFile: "src/generated/client.ts",
      }),
    ])
  })

  test("flags generated artifacts with missing provenance", async () => {
    await writeContractFixture({
      sourceContent: JSON.stringify({ openapi: "3.1.0", paths: {} }),
      artifactContent: "export const client = {}\n",
      manifest: {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            source_paths: ["contracts/openapi.json"],
            artifact_path: "src/generated/client.ts",
          },
        ],
      },
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "missing-provenance",
        severity: "info",
      }),
    ])
  })

  test("flags declared generated artifacts that are missing", async () => {
    const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "contracts"), { recursive: true })
    await writeFile(join(tmp, "contracts", "openapi.json"), sourceContent, "utf8")
    await writeManifest({
      schema_version: 1,
      contracts: [
        {
          id: "api-client",
          source_paths: ["contracts/openapi.json"],
          source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
          artifact_path: "src/generated/client.ts",
        },
      ],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "missing-generated-artifact",
        artifactFile: "src/generated/client.ts",
      }),
    ])
  })

  test("flags generated artifacts matched by opt-in orphan globs", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "generated"), { recursive: true })
    await writeFile(join(tmp, "src", "generated", "client.ts"), "export {}\n", "utf8")
    await writeManifest({
      schema_version: 1,
      generated_artifact_globs: ["src/generated/*.ts"],
      contracts: [],
    })

    const out = await runSignal()

    expect(out.state).toBe("present")
    expect(out.findings).toEqual([
      expect.objectContaining({
        kind: "orphan-generated-artifact",
        artifactFile: "src/generated/client.ts",
      }),
    ])
  })

  test("score decreases monotonically as weighted findings increase", async () => {
    const zeroRepo = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-zero-"))
    const missingProvenanceRepo = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-missing-"))
    const staleRepo = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-stale-"))
    const matrixRepo = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-matrix-"))
    try {
      const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
      const staleSourceContent = JSON.stringify({ openapi: "3.1.0", paths: { "/users": {} } })
      const artifactContent = "export const client = {}\n"

      await writeContractFixture({
        sourceContent,
        artifactContent,
        manifest: {
          schema_version: 1,
          contracts: [
            {
              id: "api-client",
              group_id: "openapi",
              source_paths: ["contracts/openapi.json"],
              source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
              artifact_path: "src/generated/client.ts",
              artifact_sha256: sha256(artifactContent),
            },
          ],
        },
      }, zeroRepo)
      await writeContractFixture({
        sourceContent,
        artifactContent,
        manifest: {
          schema_version: 1,
          contracts: [
            {
              id: "api-client",
              group_id: "openapi",
              source_paths: ["contracts/openapi.json"],
              artifact_path: "src/generated/client.ts",
              artifact_sha256: sha256(artifactContent),
            },
          ],
        },
      }, missingProvenanceRepo)
      await writeContractFixture({
        sourceContent: staleSourceContent,
        artifactContent,
        manifest: {
          schema_version: 1,
          contracts: [
            {
              id: "api-client",
              group_id: "openapi",
              source_paths: ["contracts/openapi.json"],
              source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
              artifact_path: "src/generated/client.ts",
              artifact_sha256: sha256(artifactContent),
            },
          ],
        },
      }, staleRepo)
      await writeFindingMatrixFixture(matrixRepo)

      const zero = await runSignal(zeroRepo)
      const missingProvenance = await runSignal(missingProvenanceRepo)
      const stale = await runSignal(staleRepo)
      const matrixDefault = await runSignal(matrixRepo)
      const matrixAtCap = await runSignal(matrixRepo, {
        top_n_diagnostics: 10,
        max_weighted_findings: 14,
      })
      const matrixTight = await runSignal(matrixRepo, {
        top_n_diagnostics: 10,
        max_weighted_findings: 7,
      })
      const matrixLoose = await runSignal(matrixRepo, {
        top_n_diagnostics: 10,
        max_weighted_findings: 28,
      })

      expect(zero.weightedFindings).toBe(0)
      expect(missingProvenance.weightedFindings).toBe(2)
      expect(stale.weightedFindings).toBe(5)
      expect(matrixDefault.weightedFindings).toBe(14)
      expect(Shared09ContractFreshness.score(zero)).toBe(1)
      expect(Shared09ContractFreshness.score(missingProvenance)).toBeLessThan(
        Shared09ContractFreshness.score(zero),
      )
      expect(Shared09ContractFreshness.score(stale)).toBeLessThan(
        Shared09ContractFreshness.score(missingProvenance),
      )
      expect(Shared09ContractFreshness.score(matrixDefault)).toBeLessThan(
        Shared09ContractFreshness.score(stale),
      )
      expect(Shared09ContractFreshness.score(matrixAtCap)).toBe(0.5)
      expect(Shared09ContractFreshness.score(matrixTight)).toBeLessThan(
        Shared09ContractFreshness.score(matrixAtCap),
      )
      expect(Shared09ContractFreshness.score(matrixLoose)).toBeGreaterThan(
        Shared09ContractFreshness.score(matrixAtCap),
      )
    } finally {
      await rm(zeroRepo, { recursive: true, force: true })
      await rm(missingProvenanceRepo, { recursive: true, force: true })
      await rm(staleRepo, { recursive: true, force: true })
      await rm(matrixRepo, { recursive: true, force: true })
    }
  })

  test("orders, caps, and scores weighted findings deterministically", async () => {
    await writeFindingMatrixFixture()

    const out = await runSignal(tmp, {
      top_n_diagnostics: 2.9,
      max_weighted_findings: 5,
    })
    const diagnostics = Shared09ContractFreshness.diagnose(out)

    expect(out.totalFindings).toBe(4)
    expect(out.weightedFindings).toBe(14)
    expect(out.maxWeightedFindings).toBe(5)
    expect(out.scorePressure).toBe(14 / 5)
    expect(Shared09ContractFreshness.score(out)).toBe(1 / (1 + 14 / 5))
    expect(out.diagnosticLimit).toBe(2)
    expect(out.topFindings.map((finding) => finding.kind)).toEqual([
      "stale-artifact",
      "missing-generated-artifact",
    ])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      location: { file: "src/generated/client.ts", line: 1 },
      data: {
        weightedFindings: 14,
        maxWeightedFindings: 5,
        scorePressure: 14 / 5,
        diagnosticLimit: 2,
        cacheContributors: expect.arrayContaining([
          "reference-data.contract-freshness",
          ".pulsar/contract-freshness.json",
        ]),
        evidenceClass: expect.arrayContaining([
          "repo-owned manifest",
          "sha256 source content",
          "sha256 artifact content",
        ]),
        claimLimit:
          "declared generated contracts are fresh relative to recorded source and artifact hashes",
        nonClaimLimit:
          "does not prove semantic compatibility, generator correctness, or undeclared contract coverage",
        knownFailureModes: expect.arrayContaining([
          "manifest omitted for a generated surface",
        ]),
        enforcementCeiling: expect.arrayContaining(["soft-warning"]),
      },
    })
  })

  test("normalizes non-finite diagnostic and pressure config", async () => {
    await writeFindingMatrixFixture()

    const out = await runSignal(tmp, {
      top_n_diagnostics: Number.POSITIVE_INFINITY,
      max_weighted_findings: Number.NaN,
    })

    expect(out.diagnosticLimit).toBe(0)
    expect(out.topFindings).toEqual([])
    expect(Shared09ContractFreshness.diagnose(out)).toEqual([])
    expect(out.maxWeightedFindings).toBe(8)
    expect(out.scorePressure).toBe(14 / 8)
    expect(Number.isFinite(Shared09ContractFreshness.score(out))).toBe(true)
  })

  test("keeps source fingerprints stable across equivalent repositories", async () => {
    const first = tmp
    const second = await mkdtemp(join(tmpdir(), "pulsar-contract-freshness-peer-"))
    try {
      const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
      const artifactContent = "export const client = {}\n"
      const manifest: ContractFreshnessManifest = {
        schema_version: 1,
        contracts: [
          {
            id: "api-client",
            group_id: "openapi",
            source_paths: ["contracts/openapi.json"],
            source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
            artifact_path: "src/generated/client.ts",
            artifact_sha256: sha256(artifactContent),
          },
        ],
      }
      await writeContractFixture({ sourceContent, artifactContent, manifest }, first)
      await writeContractFixture({ sourceContent, artifactContent, manifest }, second)

      const firstOut = await runSignal(first)
      const secondOut = await runSignal(second)

      expect(firstOut.sourceFingerprint).toBe(secondOut.sourceFingerprint)
      expect(firstOut.contracts).toEqual(secondOut.contracts)
      expect(firstOut.findings).toEqual(secondOut.findings)
    } finally {
      await rm(second, { recursive: true, force: true })
    }
  })

  test("treats malformed contract freshness data as unknown", async () => {
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await writeFile(join(tmp, ".pulsar", "contract-freshness.json"), "{", "utf8")

    const out = await runSignal()
    const diagnostics = Shared09ContractFreshness.diagnose(out)

    expect(out.state).toBe("unknown")
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(Shared09ContractFreshness.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
  })

  test("uses an explicit not-configured fallback when reference data omits contract freshness", async () => {
    const out = await Effect.runPromise(
      Shared09ContractFreshness.compute(
        Shared09ContractFreshness.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(new Map()))),
      ) as Effect.Effect<Shared09ContractFreshnessOutput, unknown, never>,
    )

    expect(out.state).toBe("not_configured")
    expect(out.checkedPaths).toEqual([])
    expect(out.sourceFingerprint).toBe("not-configured")
    expect(out.message).toBe("Contract freshness reference data was not loaded")
    expect(Shared09ContractFreshness.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
  })

  test("is registered in the shared pack", () => {
    expect(SHARED_SIGNALS.map((signal) => signal.id)).toContain(
      "SHARED-09-contract-freshness",
    )
  })
})

const writeContractFixture = async (args: {
  readonly sourceContent: string
  readonly artifactContent: string
  readonly manifest: ContractFreshnessManifest
}, repoRoot = tmp) => {
  await mkdir(join(repoRoot, ".pulsar"), { recursive: true })
  await mkdir(join(repoRoot, "contracts"), { recursive: true })
  await mkdir(join(repoRoot, "src", "generated"), { recursive: true })
  await writeFile(join(repoRoot, "contracts", "openapi.json"), args.sourceContent, "utf8")
  await writeFile(join(repoRoot, "src", "generated", "client.ts"), args.artifactContent, "utf8")
  await writeManifest(args.manifest, repoRoot)
}

const writeFindingMatrixFixture = async (repoRoot = tmp) => {
  const sourceContent = JSON.stringify({ openapi: "3.1.0", paths: { "/users": {} } })
  const oldSourceContent = JSON.stringify({ openapi: "3.1.0", paths: {} })
  const artifactContent = "export const client = {}\n"
  const noProvenanceSource = JSON.stringify({ asyncapi: "3.0.0", channels: {} })
  const noProvenanceArtifact = "export const events = {}\n"
  await mkdir(join(repoRoot, ".pulsar"), { recursive: true })
  await mkdir(join(repoRoot, "contracts"), { recursive: true })
  await mkdir(join(repoRoot, "src", "generated"), { recursive: true })
  await writeFile(join(repoRoot, "contracts", "openapi.json"), sourceContent, "utf8")
  await writeFile(join(repoRoot, "contracts", "asyncapi.json"), noProvenanceSource, "utf8")
  await writeFile(join(repoRoot, "src", "generated", "client.ts"), artifactContent, "utf8")
  await writeFile(join(repoRoot, "src", "generated", "events.ts"), noProvenanceArtifact, "utf8")
  await writeFile(join(repoRoot, "src", "generated", "orphan.ts"), "export {}\n", "utf8")
  await writeManifest({
    schema_version: 1,
    generated_artifact_globs: ["src/generated/*.ts"],
    contracts: [
      {
        id: "api-client",
        group_id: "openapi",
        source_paths: ["contracts/openapi.json"],
        source_hashes: { "contracts/openapi.json": sha256(oldSourceContent) },
        artifact_path: "src/generated/client.ts",
        artifact_sha256: sha256(artifactContent),
      },
      {
        id: "missing-client",
        group_id: "openapi",
        source_paths: ["contracts/openapi.json"],
        source_hashes: { "contracts/openapi.json": sha256(sourceContent) },
        artifact_path: "src/generated/missing.ts",
      },
      {
        id: "event-client",
        group_id: "asyncapi",
        source_paths: ["contracts/asyncapi.json"],
        artifact_path: "src/generated/events.ts",
      },
    ],
  }, repoRoot)
}

const writeManifest = async (manifest: ContractFreshnessManifest, repoRoot = tmp) => {
  await mkdir(join(repoRoot, ".pulsar"), { recursive: true })
  await writeFile(
    join(repoRoot, ".pulsar", "contract-freshness.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
}

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
