import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadContractFreshnessFacts,
  type ContractFreshnessManifest,
} from "../contract-freshness.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-core-contract-freshness-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("loadContractFreshnessFacts", () => {
  test("does not claim freshness when declared sources lack source-hash provenance", async () => {
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

    const facts = await loadContractFreshnessFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        findingId:
          "api-client:missing-provenance:contracts/openapi.json:src/generated/client.ts",
        kind: "missing-provenance",
        sourceFile: "contracts/openapi.json",
        artifactFile: "src/generated/client.ts",
      }),
    ])
  })

  test("does not treat artifact-only hashes as source-to-artifact freshness", async () => {
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

    const facts = await loadContractFreshnessFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        findingId:
          "api-client:missing-provenance:src/generated/client.ts:src/generated/client.ts",
        kind: "missing-provenance",
        artifactFile: "src/generated/client.ts",
      }),
    ])
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
