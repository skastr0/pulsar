import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceDataTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import {
  loadCanonicalReferenceDataEntries,
  type ContractFreshnessFinding,
  type ContractFreshnessManifest,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Layer } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import { Shared09ContractFreshness } from "../shared-09-contract-freshness.js"

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
) => {
  const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(repoRoot))
  return Effect.runPromise(
    Shared09ContractFreshness.compute(config, new Map()).pipe(
      Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(entries))),
    ) as Effect.Effect<any, any, never>,
  )
}

describe("SHARED-09 contract freshness", () => {
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
}) => {
  await mkdir(join(tmp, ".pulsar"), { recursive: true })
  await mkdir(join(tmp, "contracts"), { recursive: true })
  await mkdir(join(tmp, "src", "generated"), { recursive: true })
  await writeFile(join(tmp, "contracts", "openapi.json"), args.sourceContent, "utf8")
  await writeFile(join(tmp, "src", "generated", "client.ts"), args.artifactContent, "utf8")
  await writeManifest(args.manifest)
}

const writeManifest = async (manifest: ContractFreshnessManifest) => {
  await mkdir(join(tmp, ".pulsar"), { recursive: true })
  await writeFile(
    join(tmp, ".pulsar", "contract-freshness.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
}

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
