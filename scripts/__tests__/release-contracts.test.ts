import { describe, expect, test } from "bun:test"
import {
  SCORE_PARITY_PROVENANCE_NORMALIZATION,
  assertCompleteScoreParity,
  assertNpmPlatformContract,
  assertPublishedExportContract,
  type NpmPackMetadata,
  type PublishedExportsContract,
  type PublishedPackageManifest,
} from "../release-contracts.ts"

const manifest: PublishedPackageManifest = {
  name: "@skastr0/example",
  version: "1.2.3",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    },
  },
}

const contract: PublishedExportsContract = {
  schema_version: "pulsar/published-exports/v2",
  packages: {
    "@skastr0/example": {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    },
  },
}

const pack: NpmPackMetadata = {
  name: "@skastr0/example",
  version: "1.2.3",
  files: [{ path: "dist/index.d.ts" }, { path: "dist/index.js" }],
}

describe("published export release contract", () => {
  test("pins both export conditions to files in npm pack metadata", () => {
    expect(assertPublishedExportContract(contract, [{ manifest, pack }])).toBe(2)
  })

  test("rejects a manifest that drops its types condition", () => {
    const exportsWithoutTypes = {
      ...manifest,
      exports: { ".": { default: "./dist/index.js" } },
    }
    expect(() =>
      assertPublishedExportContract(contract, [{ manifest: exportsWithoutTypes, pack }]),
    ).toThrow("must declare string types and default targets")
  })

  test("rejects a manifest that drops its default condition", () => {
    const exportsWithoutDefault = {
      ...manifest,
      exports: { ".": { types: "./dist/index.d.ts" } },
    }
    expect(() =>
      assertPublishedExportContract(contract, [{ manifest: exportsWithoutDefault, pack }]),
    ).toThrow("must declare string types and default targets")
  })

  test("rejects a declared target omitted from the packed tarball", () => {
    const packWithoutTypes = { ...pack, files: [{ path: "dist/index.js" }] }
    expect(() =>
      assertPublishedExportContract(contract, [{ manifest, pack: packWithoutTypes }]),
    ).toThrow("packed tarball omits . types target ./dist/index.d.ts")
  })
})

describe("npm platform release contract", () => {
  const platform = {
    name: "@skastr0/pulsar-linux-x64",
    version: "1.2.3",
    os: ["linux"],
    cpu: ["x64"],
  }

  test("requires every supported package at the root version", () => {
    expect(
      assertNpmPlatformContract({
        rootVersion: "1.2.3",
        meta: {
          name: "@skastr0/pulsar",
          version: "1.2.3",
          optionalDependencies: { "@skastr0/pulsar-linux-x64": "1.2.3" },
        },
        platforms: [platform],
      }),
    ).toEqual(["@skastr0/pulsar-linux-x64"])
  })

  test("rejects a missing supported optional dependency", () => {
    expect(() =>
      assertNpmPlatformContract({
        rootVersion: "1.2.3",
        meta: { name: "@skastr0/pulsar", version: "1.2.3", optionalDependencies: {} },
        platforms: [platform],
      }),
    ).toThrow("optional dependency names diverged")
  })

  test("rejects a supported optional dependency at another version", () => {
    expect(() =>
      assertNpmPlatformContract({
        rootVersion: "1.2.3",
        meta: {
          name: "@skastr0/pulsar",
          version: "1.2.3",
          optionalDependencies: { "@skastr0/pulsar-linux-x64": "1.2.2" },
        },
        platforms: [platform],
      }),
    ).toThrow("must equal root version 1.2.3")
  })
})

describe("complete score release parity", () => {
  const source = {
    weighted_mean: 0.91,
    minimum: { signal: "signal-a", score: 0.82 },
    categories: { reliability: { score: 0.9 } },
    readiness: { score: 0.88, status: "green" },
  }

  test("normalizes no provenance fields", () => {
    expect(SCORE_PARITY_PROVENANCE_NORMALIZATION).toEqual([])
  })

  test("rejects category score drift", () => {
    expect(() =>
      assertCompleteScoreParity("native", "source", source, {
        ...source,
        categories: { reliability: { score: 0.89 } },
      }),
    ).toThrow("complete deterministic score JSON diverged")
  })

  test("rejects readiness score drift", () => {
    expect(() =>
      assertCompleteScoreParity("native", "source", source, {
        ...source,
        readiness: { score: 0.87, status: "green" },
      }),
    ).toThrow("complete deterministic score JSON diverged")
  })

  test("rejects aggregate score drift", () => {
    expect(() =>
      assertCompleteScoreParity("native", "source", source, {
        ...source,
        weighted_mean: 0.9,
      }),
    ).toThrow("complete deterministic score JSON diverged")
  })

  test("rejects minimum signal score drift", () => {
    expect(() =>
      assertCompleteScoreParity("native", "source", source, {
        ...source,
        minimum: { signal: "signal-a", score: 0.81 },
      }),
    ).toThrow("complete deterministic score JSON diverged")
  })
})
