import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  loadDomainConstructionFacts,
  type DomainConstructionManifest,
} from "../domain-construction.js"
import { loadCanonicalReferenceDataEntries } from "../reference-data-loader.js"
import { computeReferenceVersionHash } from "../scoring-engine-observer-cache.js"

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-core-domain-construction-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("loadDomainConstructionFacts", () => {
  test("does not claim construction control without source-hash provenance", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({
        declarationContent,
        parserContent,
        sourceHashes: {},
      }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-source-provenance",
          file: "src/domain/user-id.ts",
        }),
        expect.objectContaining({
          kind: "missing-source-provenance",
          file: "src/domain/parse-user-id.ts",
        }),
      ]),
    )
  })

  test("records expected source-hash paths even when they are not declared evidence", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    const policyContent = "export const userIdPolicy = true\n"
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({
        declarationContent,
        parserContent,
        sourceHashes: {
          "src/domain/user-id.ts": sha256(declarationContent),
          "src/domain/parse-user-id.ts": sha256(parserContent),
          "src/domain/user-id-policy.ts": sha256(policyContent),
        },
      }),
    })
    await writeFile(join(tmp, "src", "domain", "user-id-policy.ts"), policyContent, "utf8")

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.checkedPaths).toContain("src/domain/user-id-policy.ts")
    expect(facts.constructs[0]?.sourceHashes["src/domain/user-id-policy.ts"]).toBe(
      sha256(policyContent),
    )
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-source-provenance",
        file: "src/domain/user-id-policy.ts",
        evidence: [
          "recorded source hash src/domain/user-id-policy.ts is not declared as construction evidence",
        ],
      }),
    ])
  })

  test("flags missing declaration files even when no source hash was recorded", async () => {
    const parserContent = parserSource()
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
    await writeManifest(controlledManifest({
      declarationContent: controlledUserIdDeclaration(),
      parserContent,
      sourceHashes: {
        "src/domain/parse-user-id.ts": sha256(parserContent),
      },
    }))

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "stale-source",
          file: "src/domain/user-id.ts",
          evidence: ["declared domain construct declaration is missing"],
        }),
      ]),
    )
  })

  test("does not double-count missing declarations when a source hash was recorded", async () => {
    const parserContent = parserSource()
    await mkdir(join(tmp, ".pulsar"), { recursive: true })
    await mkdir(join(tmp, "src", "domain"), { recursive: true })
    await writeFile(join(tmp, "src", "domain", "parse-user-id.ts"), parserContent, "utf8")
    await writeManifest(controlledManifest({
      declarationContent: controlledUserIdDeclaration(),
      parserContent,
      sourceHashes: {
        "src/domain/user-id.ts": sha256(controlledUserIdDeclaration()),
        "src/domain/parse-user-id.ts": sha256(parserContent),
      },
    }))

    const facts = await loadDomainConstructionFacts(tmp)
    const staleDeclarationFindings = facts.findings.filter((finding) =>
      finding.kind === "stale-source" && finding.file === "src/domain/user-id.ts",
    )

    expect(staleDeclarationFindings).toEqual([
      expect.objectContaining({
        findingId: "user-id:stale-source:src/domain/user-id.ts",
        evidence: ["declared domain construct declaration is missing"],
      }),
    ])
  })

  test("requires controlled export evidence symbols to match real declarations", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: {
        schema_version: 1,
        constructs: [
          {
            ...controlledManifest({
              declarationContent,
              parserContent,
            }).constructs[0]!,
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
              controlled_exports: [
                {
                  path: "src/domain/user-id.ts",
                  symbol: "createUserId",
                },
              ],
            },
          },
        ],
      },
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/user-id.ts",
        evidence: ["declared controlled-export symbol createUserId was not found"],
      }),
    ])
  })

  test("requires the declared construct symbol to be exported from its declaration file", async () => {
    const declarationContent = [
      "class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({
        declarationContent,
        parserContent,
      }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/user-id.ts",
        evidence: ["declared domain construct symbol UserId was not found"],
      }),
    ])
  })

  test("requires controlled export evidence symbols to be exported values", async () => {
    const declarationContent = [
      "export class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "const createUserId = (value: string): UserId => value as unknown as UserId",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: {
        schema_version: 1,
        constructs: [
          {
            ...controlledManifest({
              declarationContent,
              parserContent,
            }).constructs[0]!,
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
              controlled_exports: [
                {
                  path: "src/domain/user-id.ts",
                  symbol: "createUserId",
                },
              ],
            },
          },
        ],
      },
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/user-id.ts",
        evidence: ["declared controlled-export symbol createUserId was not found"],
      }),
    ])
  })

  test("requires controlled export evidence symbols to be runtime values", async () => {
    const declarationContent = [
      "export class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "export declare const createUserId: (value: string) => UserId",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: {
        schema_version: 1,
        constructs: [
          {
            ...controlledManifest({
              declarationContent,
              parserContent,
            }).constructs[0]!,
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
              controlled_exports: [
                {
                  path: "src/domain/user-id.ts",
                  symbol: "createUserId",
                },
              ],
            },
          },
        ],
      },
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/user-id.ts",
        evidence: ["declared controlled-export symbol createUserId was not found"],
      }),
    ])
  })

  test("accepts controlled export evidence from named exported values", async () => {
    const declarationContent = [
      "export class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "const createUserId = (value: string): UserId => value as unknown as UserId",
      "export { createUserId }",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: {
        schema_version: 1,
        constructs: [
          {
            ...controlledManifest({
              declarationContent,
              parserContent,
            }).constructs[0]!,
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
              controlled_exports: [
                {
                  path: "src/domain/user-id.ts",
                  symbol: "createUserId",
                },
              ],
            },
          },
        ],
      },
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("zero")
    expect(facts.findings).toEqual([])
  })

  test("detects public constructors on the target class despite unrelated private constructors", async () => {
    const declarationContent = [
      "export class UserId {",
      "  constructor(readonly value: string) {}",
      "}",
      "export class OtherId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "uncontrolled-constructor-export",
          file: "src/domain/user-id.ts",
        }),
      ]),
    )
  })

  test("detects implicit public constructors on concrete exported classes", async () => {
    const declarationContent = [
      "export class UserId {",
      "  readonly value = 'user-id'",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "uncontrolled-constructor-export",
          file: "src/domain/user-id.ts",
        }),
      ]),
    )
  })

  test("detects public constructors when generic constraints contain braces", async () => {
    const declarationContent = [
      "export class UserId<T extends { raw: string }> {",
      "  constructor(readonly value: T) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "uncontrolled-constructor-export",
          file: "src/domain/user-id.ts",
        }),
      ]),
    )
  })

  test("does not let regex braces leak later constructors into the target class body", async () => {
    const declarationContent = [
      "export class UserId {",
      "  static readonly pattern = /{/u",
      "  constructor(readonly value: string) {}",
      "}",
      "export class OtherId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "uncontrolled-constructor-export",
        file: "src/domain/user-id.ts",
      }),
    ])
  })

  test("does not accept parser symbols that appear only in comments or strings", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = [
      "// parseUserId",
      "export const mentioned = 'parseUserId'",
      "",
    ].join("\n")
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/parse-user-id.ts",
        evidence: ["declared parser or smart-constructor symbol parseUserId was not found"],
      }),
    ])
  })

  test("deduplicates declared source paths before scoring missing provenance", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = parserSource()
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: {
        schema_version: 1,
        constructs: [
          {
            ...controlledManifest({
              declarationContent,
              parserContent,
              sourceHashes: {},
            }).constructs[0]!,
            control: {
              intent: "controlled",
              parsers: [
                {
                  path: "src/domain/parse-user-id.ts",
                  symbol: "parseUserId",
                },
              ],
              controlled_exports: [
                {
                  path: "src/domain/user-id.ts",
                  symbol: "UserId",
                },
              ],
            },
          },
        ],
      },
    })

    const facts = await loadDomainConstructionFacts(tmp)
    const provenanceFiles = facts.findings
      .filter((finding) => finding.kind === "missing-source-provenance")
      .map((finding) => finding.file)

    expect(provenanceFiles).toEqual([
      "src/domain/parse-user-id.ts",
      "src/domain/user-id.ts",
    ])
  })

  test("does not accept parser evidence from type-only declarations", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = [
      "import { UserId } from './user-id'",
      "export type parseUserId = (value: string) => UserId",
      "",
    ].join("\n")
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/parse-user-id.ts",
        evidence: ["declared parser or smart-constructor symbol parseUserId was not found"],
      }),
    ])
  })

  test("does not accept parser evidence from ambient declarations", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = [
      "import { UserId } from './user-id'",
      "declare function parseUserId(value: string): UserId",
      "",
    ].join("\n")
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/parse-user-id.ts",
        evidence: ["declared parser or smart-constructor symbol parseUserId was not found"],
      }),
    ])
  })

  test("does not accept parser evidence from ambient declaration blocks", async () => {
    const declarationContent = controlledUserIdDeclaration()
    const parserContent = [
      "import { UserId } from './user-id'",
      "declare namespace Ambient {",
      "  export function parseUserId(value: string): UserId",
      "}",
      "",
    ].join("\n")
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("present")
    expect(facts.findings).toEqual([
      expect.objectContaining({
        kind: "missing-construction-evidence",
        file: "src/domain/parse-user-id.ts",
        evidence: ["declared parser or smart-constructor symbol parseUserId was not found"],
      }),
    ])
  })

  test("accepts default-exported declaration and parser value evidence", async () => {
    const declarationContent = [
      "export default class UserId {",
      "  private constructor(readonly value: string) {}",
      "}",
      "",
    ].join("\n")
    const parserContent = [
      "import UserId from './user-id'",
      "export default function parseUserId(value: string): UserId {",
      "  return value as unknown as UserId",
      "}",
      "",
    ].join("\n")
    await writeDomainFixture({
      declarationContent,
      parserContent,
      manifest: controlledManifest({ declarationContent, parserContent }),
    })

    const facts = await loadDomainConstructionFacts(tmp)

    expect(facts.state).toBe("zero")
    expect(facts.findings).toEqual([])
  })

  test("reference version hash is stable across equivalent worktree paths", async () => {
    const second = await mkdtemp(join(tmpdir(), "pulsar-core-domain-construction-peer-"))
    try {
      const declarationContent = controlledUserIdDeclaration()
      const parserContent = parserSource()
      const manifest = controlledManifest({ declarationContent, parserContent })
      await writeDomainFixture({ declarationContent, parserContent, manifest }, tmp)
      await writeDomainFixture({ declarationContent, parserContent, manifest }, second)

      const firstEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
      const secondEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(second))

      expect(computeReferenceVersionHash(firstEntries)).toBe(
        computeReferenceVersionHash(secondEntries),
      )
    } finally {
      await rm(second, { recursive: true, force: true })
    }
  })
})

const writeDomainFixture = async (args: {
  readonly declarationContent: string
  readonly parserContent: string
  readonly manifest: DomainConstructionManifest
}, repoRoot = tmp) => {
  await mkdir(join(repoRoot, ".pulsar"), { recursive: true })
  await mkdir(join(repoRoot, "src", "domain"), { recursive: true })
  await writeFile(join(repoRoot, "src", "domain", "user-id.ts"), args.declarationContent, "utf8")
  await writeFile(join(repoRoot, "src", "domain", "parse-user-id.ts"), args.parserContent, "utf8")
  await writeManifest(args.manifest, repoRoot)
}

const writeManifest = async (manifest: DomainConstructionManifest, repoRoot = tmp) => {
  await mkdir(join(repoRoot, ".pulsar"), { recursive: true })
  await writeFile(
    join(repoRoot, ".pulsar", "domain-construction.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
}

const controlledManifest = (args: {
  readonly declarationContent: string
  readonly parserContent: string
  readonly sourceHashes?: Record<string, string>
}): DomainConstructionManifest => ({
  schema_version: 1,
  constructs: [
    {
      id: "user-id",
      symbol: "UserId",
      kind: "value-object",
      declaration_path: "src/domain/user-id.ts",
      source_hashes: args.sourceHashes ?? {
        "src/domain/user-id.ts": sha256(args.declarationContent),
        "src/domain/parse-user-id.ts": sha256(args.parserContent),
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
})

const controlledUserIdDeclaration = (): string =>
  [
    "export class UserId {",
    "  private constructor(readonly value: string) {}",
    "}",
    "",
  ].join("\n")

const parserSource = (): string =>
  [
    "import { UserId } from './user-id'",
    "export const parseUserId = (value: string): UserId => value as unknown as UserId",
    "",
  ].join("\n")

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")
