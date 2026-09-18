import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Ref, Schema } from "effect"
import type { AiFactLabelArtifact } from "../ai-facts.js"
import { ReferenceDataTag } from "../context.js"
import {
  type OwnershipFacts,
  type OwnershipGroup,
  type OwnershipLabelValue,
  type OwnershipPolicy,
  OWNERSHIP_LABEL_KIND,
  OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
  OWNERSHIP_REFERENCE_DATA_KEY,
  aggregateOwnershipAttainment,
  computeOwnershipContentHash,
  computeOwnershipInputFingerprint,
  computeOwnershipPolicyFingerprint,
  computeOwnershipRubricFingerprint,
  decodeOwnershipPolicySync,
  loadOwnershipFacts,
  ownershipGroupPaths,
} from "../ownership.js"
import { loadCanonicalReferenceDataEntries } from "../reference-data-loader.js"
import { buildRegistry } from "../registry.js"
import { computeContentHash } from "../scoring-engine-git-content-hash.js"
import { ScoringEngineLayer, ScoringEngineTag } from "../scoring-engine.js"
import { computeReferenceVersionHash } from "../scoring-engine-observer-cache.js"
import type { Signal } from "../signal.js"
import { createGitTestRepo, type GitTestRepo } from "./git-test-repo.js"

const CREATED_AT = "2026-01-01T00:00:00.000Z"
const CREATED_MS = Date.parse(CREATED_AT)
const DAY_MS = 86_400_000

const anchors = [
  { id: "contrary" as const, value: 0, description: "Independent copies contrary to the declared owner" },
  { id: "mixed" as const, value: 0.5, description: "Some callers delegate and others copy" },
  { id: "meets" as const, value: 1, description: "All relevant callers follow the declared owner" },
]

const groupA = (extra?: Partial<OwnershipGroup>): OwnershipGroup => ({
  id: "rule-a",
  owner_paths: ["src/owner.ts"],
  caller_paths: ["src/caller.ts"],
  context_paths: ["docs/note.md"],
  origin: "declared",
  ...extra,
})

const basePolicy = (groups: OwnershipPolicy["groups"] = [groupA()]): OwnershipPolicy => ({
  schema_version: 1,
  preference: "shared_domain_rule",
  target: 1,
  anchors,
  allowed_classifiers: [{
    id: "ownership",
    model_id: "jev-1.13.0",
    version: "1",
    prompt_id: "pulsar.ownership.choice.v2",
  }],
  groups,
})

const writeUtf8 = async (root: string, relativePath: string, content: string): Promise<void> => {
  const fullPath = join(root, relativePath)
  await mkdir(join(fullPath, ".."), { recursive: true })
  await writeFile(fullPath, content, "utf8")
}

const writeJson = async (root: string, relativePath: string, value: unknown): Promise<Buffer> => {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await writeUtf8(root, relativePath, text)
  return Buffer.from(text, "utf8")
}

const sourceFiles = {
  "src/owner.ts": "export const owner = true\n",
  "src/caller.ts": "export const caller = true\n",
  "src/healthy.ts": "export const healthy = true\n",
  "docs/note.md": "context\n",
}

const writeSources = async (
  root: string,
  files: Record<string, string> = sourceFiles,
): Promise<void> => {
  for (const [path, content] of Object.entries(files)) {
    await writeUtf8(root, path, content)
  }
}

const hashesFor = async (
  root: string,
  group: OwnershipGroup,
): Promise<Record<string, string>> => {
  const { createHash } = await import("node:crypto")
  const { readFile } = await import("node:fs/promises")
  const hashes: Record<string, string> = {}
  for (const path of ownershipGroupPaths(group)) {
    hashes[path] = `sha256:${createHash("sha256").update(await readFile(join(root, path))).digest("hex")}`
  }
  return hashes
}

const distribution = (
  selected: string,
  probabilities: Record<string, number>,
): OwnershipLabelValue["distribution"] =>
  (["contrary", "meets", "mixed", "not_applicable", "unknown"] as const).map((anchorId) => ({
    anchor_id: anchorId,
    ...(anchorId === "contrary" || anchorId === "mixed" || anchorId === "meets"
      ? { anchor_value: anchors.find((anchor) => anchor.id === anchorId)!.value }
      : {}),
    probability: probabilities[anchorId] ?? 0,
    selected: anchorId === selected,
  }))

const labelValue = (input: {
  readonly groupId: string
  readonly policyFingerprint: string
  readonly rubricFingerprint: string
  readonly status: OwnershipLabelValue["status"]
  readonly selected: string
  readonly probabilities?: Record<string, number>
}): OwnershipLabelValue => {
  const probabilities = input.probabilities ?? { [input.selected]: 1 }
  const resolved = input.status === "resolved"
  return {
    schema_version: OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
    group_id: input.groupId,
    policy_fingerprint: input.policyFingerprint,
    rubric_fingerprint: input.rubricFingerprint,
    status: input.status,
    ...(resolved
      ? {
          anchor_id: input.selected as "contrary" | "mixed" | "meets",
          anchor_value: anchors.find((anchor) => anchor.id === input.selected)!.value,
        }
      : {}),
    distribution: distribution(input.selected, probabilities),
    receipt: {
      artifact_id: `own.${input.groupId}.v1`,
      classifier_id: "ownership",
      model_id: "jev-1.13.0",
      prompt_id: "pulsar.ownership.choice.v2",
      prompt_fingerprint: "sha256:prompt-ownership-v2",
    },
  }
}

const artifactFor = (input: {
  readonly group: OwnershipGroup
  readonly value: OwnershipLabelValue
  readonly hashes: Record<string, string>
  readonly policyFingerprint: string
  readonly expiresAt?: string
  readonly staleAfterDays?: number
  readonly modelId?: string
}): AiFactLabelArtifact => ({
  schema_version: "pulsar.ai_fact_label.v1",
  artifact_id: `own.${input.group.id}.v1`,
  classifier: {
    id: "ownership",
    version: "1",
    prompt_id: "pulsar.ownership.choice.v2",
    prompt_fingerprint: "sha256:prompt-ownership-v2",
    model_id: input.modelId ?? "jev-1.13.0",
  },
  input: {
    scope: "repository",
    content_hash: computeOwnershipContentHash(input.hashes),
    input_fingerprint: computeOwnershipInputFingerprint(
      input.policyFingerprint,
      input.group.id,
      input.hashes,
    ),
    source_paths: [...ownershipGroupPaths(input.group)],
  },
  label: {
    kind: OWNERSHIP_LABEL_KIND,
    value: input.value,
    confidence: 0.99,
    rationale: "fixture",
    evidence: [{ path: input.group.owner_paths[0]! }],
  },
  policy: {
    enforcement_ceiling: "soft-warning",
    missing_label_behavior: "fail-open",
    ...(input.staleAfterDays === undefined ? {} : { stale_after_days: input.staleAfterDays }),
    ...(input.expiresAt === undefined ? {} : { expires_at: input.expiresAt }),
  },
  provenance: {
    mode: "offline-replay",
    created_at: CREATED_AT,
    created_by: "fixture",
    source: "committed-fixture",
  },
})

interface InventoryLabel {
  readonly group: OwnershipGroup
  readonly status: OwnershipLabelValue["status"]
  readonly selected: string
  readonly probabilities?: Record<string, number>
  readonly expiresAt?: string
  readonly staleAfterDays?: number
  readonly modelId?: string
}

const writeInventory = async (input: {
  readonly root: string
  readonly policy?: OwnershipPolicy
  readonly labels?: ReadonlyArray<InventoryLabel>
  readonly skipAssessment?: boolean
}): Promise<{
  readonly policy: OwnershipPolicy
  readonly policyFingerprint: string
  readonly rubricFingerprint: string
}> => {
  const policy = input.policy ?? basePolicy()
  await writeSources(input.root)
  const policyBytes = await writeJson(input.root, ".pulsar/ownership.json", policy)
  const policyFingerprint = computeOwnershipPolicyFingerprint(policyBytes)
  const rubricFingerprint = computeOwnershipRubricFingerprint(policy)
  if (input.skipAssessment === true) {
    return { policy, policyFingerprint, rubricFingerprint }
  }
  const labels: AiFactLabelArtifact[] = []
  const items: ReadonlyArray<InventoryLabel> = input.labels ?? policy.groups.map((group) => ({
    group,
    status: "resolved",
    selected: "meets",
  }))
  for (const item of items) {
    const hashes = await hashesFor(input.root, item.group)
    const value = labelValue({
      groupId: item.group.id,
      policyFingerprint,
      rubricFingerprint,
      status: item.status,
      selected: item.selected,
      ...(item.probabilities === undefined ? {} : { probabilities: item.probabilities }),
    })
    labels.push(artifactFor({
      group: item.group,
      value,
      hashes,
      policyFingerprint,
      ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
      ...(item.staleAfterDays === undefined ? {} : { staleAfterDays: item.staleAfterDays }),
      ...(item.modelId === undefined ? {} : { modelId: item.modelId }),
    }))
  }
  await writeJson(input.root, ".pulsar/ownership-assessment.json", {
    schema_version: 1,
    policy_path: ".pulsar/ownership.json",
    policy_fingerprint: policyFingerprint,
    created_at: CREATED_AT,
    labels,
  })
  return { policy, policyFingerprint, rubricFingerprint }
}

const makeOwnershipSignal = (
  counter: Ref.Ref<number>,
): Signal<Record<string, never>, OwnershipFacts, ReferenceDataTag> => ({
  id: "MOCK-OWNERSHIP",
  tier: 3,
  category: "architectural-drift",
  kind: "structural",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      yield* Ref.update(counter, (n) => n + 1)
      const referenceData = yield* ReferenceDataTag
      return yield* referenceData.require<OwnershipFacts>(
        "MOCK-OWNERSHIP",
        OWNERSHIP_REFERENCE_DATA_KEY,
      )
    }),
  score: (output) => output.aggregate?.score ?? 1,
  diagnose: () => [],
  outputMetadata: (output) => ({
    applicability:
      output.aggregate?.applicability ??
      (output.state === "not_configured" ? "not_applicable" : "insufficient_evidence"),
    factSource: "ai_classified",
  }),
})

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-ownership-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("aggregateOwnershipAttainment", () => {
  const resolved = (
    groupId: string,
    selected: "contrary" | "mixed" | "meets",
  ): OwnershipLabelValue =>
    labelValue({
      groupId,
      policyFingerprint: "sha256:policy",
      rubricFingerprint: "sha256:rubric",
      status: "resolved",
      selected,
    })

  test("mins unique applicable groups and ignores healthy padding", () => {
    const groups = [
      groupA(),
      groupA({ id: "rule-b", owner_paths: ["src/healthy.ts"], caller_paths: ["src/caller.ts"] }),
      groupA({ id: "rule-c", owner_paths: ["src/owner.ts"], caller_paths: ["src/healthy.ts"] }),
    ]
    const shortfall = aggregateOwnershipAttainment({
      ...basePolicy(groups),
      labels: [
        resolved("rule-a", "contrary"),
        resolved("rule-b", "meets"),
        labelValue({
          groupId: "rule-c",
          policyFingerprint: "sha256:policy",
          rubricFingerprint: "sha256:rubric",
          status: "not_applicable",
          selected: "not_applicable",
        }),
      ],
      inventoryComplete: true,
      validityState: "fresh",
    })
    const padded = aggregateOwnershipAttainment({
      ...basePolicy([
        ...groups,
        groupA({ id: "rule-d", owner_paths: ["src/healthy.ts"], caller_paths: ["src/owner.ts"] }),
      ]),
      labels: [
        resolved("rule-a", "contrary"),
        resolved("rule-b", "meets"),
        labelValue({
          groupId: "rule-c",
          policyFingerprint: "sha256:policy",
          rubricFingerprint: "sha256:rubric",
          status: "not_applicable",
          selected: "not_applicable",
        }),
        resolved("rule-d", "meets"),
      ],
      inventoryComplete: true,
      validityState: "fresh",
    })

    expect(shortfall.applicability).toBe("applicable")
    expect(shortfall.attainment).toBe(0)
    expect(shortfall.score).toBe(0)
    expect(shortfall.histogram).toEqual({ contrary: 1, meets: 1 })
    expect(padded.attainment).toBe(0)
    expect(padded.score).toBe(shortfall.score)
  })

  test("incomplete or unresolved populations abstain without an overall claim", () => {
    const incomplete = aggregateOwnershipAttainment({
      ...basePolicy([groupA(), groupA({ id: "rule-b", owner_paths: ["src/healthy.ts"], caller_paths: ["src/caller.ts"] })]),
      labels: [resolved("rule-a", "meets")],
      inventoryComplete: false,
      validityState: "fresh",
    })
    expect(incomplete.applicability).toBe("insufficient_evidence")
    expect(incomplete.observedAttainment).toBe(1)
    expect(incomplete.attainment).toBeUndefined()
    expect(incomplete.score).toBeUndefined()
    expect(incomplete.missingGroupIds).toEqual(["rule-b"])
  })

  test("complete empty applicable population is not_applicable", () => {
    const empty = aggregateOwnershipAttainment({
      ...basePolicy([]),
      labels: [],
      inventoryComplete: true,
      validityState: "fresh",
    })
    expect(empty.applicability).toBe("not_applicable")
    expect(empty.attainment).toBeUndefined()
  })

  test("rejects repeated group ids instead of merging them", () => {
    expect(() =>
      aggregateOwnershipAttainment({
        ...basePolicy(),
        labels: [resolved("rule-a", "meets"), resolved("rule-a", "contrary")],
        inventoryComplete: true,
        validityState: "fresh",
      }),
    ).toThrow("Duplicate label group id")
  })
})

describe("loadOwnershipFacts", () => {
  test("missing policy is not_configured and canonical entries stay neutral", async () => {
    const facts = await loadOwnershipFacts(tmp)
    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const loaded = entries.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts
    expect(facts.state).toBe("not_configured")
    expect(facts.aggregate).toBeUndefined()
    expect(loaded.state).toBe("not_configured")
    expect(computeReferenceVersionHash(entries)).toBe(
      computeReferenceVersionHash(await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))),
    )
  })

  test("empty declared inventory is present and not_applicable without an assessment", async () => {
    await writeInventory({ root: tmp, policy: basePolicy([]), skipAssessment: true })
    const facts = await loadOwnershipFacts(tmp)
    expect(facts.state).toBe("present")
    expect(facts.inventory.complete).toBe(true)
    expect(facts.aggregate?.applicability).toBe("not_applicable")
    expect(facts.assessmentFingerprint).toBeUndefined()
  })

  test("present policy without assessment is unknown, not neutral", async () => {
    await writeInventory({ root: tmp, skipAssessment: true })
    const facts = await loadOwnershipFacts(tmp)
    expect(facts.state).toBe("unknown")
    expect(facts.policy).toBeDefined()
    expect(facts.aggregate?.applicability).toBe("insufficient_evidence")
  })

  test("detector_proposed groups are rejected until explicitly declared", async () => {
    await writeInventory({
      root: tmp,
      policy: basePolicy([groupA({ origin: "detector_proposed" })]),
      skipAssessment: true,
    })
    const facts = await loadOwnershipFacts(tmp)
    expect(facts.state).toBe("unknown")
    expect(facts.findings[0]?.message).toContain("missing, malformed, unsafe")
  })

  test("source, policy, rubric, model, and label edits change the reference hash", async () => {
    const first = await writeInventory({ root: tmp })
    const beforeEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const before = beforeEntries.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts
    const beforeHash = computeReferenceVersionHash(beforeEntries)
    expect(before.state).toBe("present")
    expect(before.aggregate?.score).toBe(1)
    expect(before.policyFingerprint).toBe(first.policyFingerprint)

    await writeUtf8(tmp, "docs/note.md", "context changed\n")
    const afterSource = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    expect(computeReferenceVersionHash(afterSource)).not.toBe(beforeHash)
    expect((afterSource.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts).state).toBe("unknown")

    await writeInventory({ root: tmp })
    const restoredHash = computeReferenceVersionHash(
      await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp)),
    )
    await writeInventory({
      root: tmp,
      policy: { ...basePolicy(), preference: "caller_local" },
    })
    const afterPolicy = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    expect(computeReferenceVersionHash(afterPolicy)).not.toBe(restoredHash)
    expect(computeOwnershipRubricFingerprint(
      (afterPolicy.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts).policy!,
    )).not.toBe(first.rubricFingerprint)

    await writeInventory({ root: tmp })
    const healthyHash = computeReferenceVersionHash(
      await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp)),
    )
    await writeInventory({
      root: tmp,
      labels: [{ group: groupA(), status: "resolved", selected: "meets", modelId: "jev-other" }],
    })
    const afterModel = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    expect(computeReferenceVersionHash(afterModel)).not.toBe(healthyHash)
    expect((afterModel.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts).state).toBe("unknown")

    await writeInventory({
      root: tmp,
      labels: [{ group: groupA(), status: "resolved", selected: "contrary" }],
    })
    const afterLabel = await Effect.runPromise(loadCanonicalReferenceDataEntries(tmp))
    const afterLabelFacts = afterLabel.get(OWNERSHIP_REFERENCE_DATA_KEY) as OwnershipFacts
    expect(computeReferenceVersionHash(afterLabel)).not.toBe(healthyHash)
    expect(afterLabelFacts.aggregate?.attainment).toBe(0)
  })

  test("crossing expiration with the same files changes validity without hashing the clock", async () => {
    const expiresAt = new Date(CREATED_MS + 30 * DAY_MS).toISOString()
    const expiresMs = Date.parse(expiresAt)
    await writeInventory({
      root: tmp,
      labels: [{ group: groupA(), status: "resolved", selected: "meets", expiresAt }],
    })
    const freshEarly = await loadOwnershipFacts(tmp, expiresMs - 1_000)
    const freshLate = await loadOwnershipFacts(tmp, expiresMs)
    const expired = await loadOwnershipFacts(tmp, expiresMs + 1)
    expect(freshEarly.state).toBe("present")
    expect(freshEarly.validityState).toBe("fresh")
    expect(freshLate.validityState).toBe("fresh")
    expect(freshEarly.sourceFingerprint).toBe(freshLate.sourceFingerprint)
    expect(computeReferenceVersionHash(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, freshEarly]]))).toBe(
      computeReferenceVersionHash(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, freshLate]])),
    )
    expect(expired.validityState).toBe("expired")
    expect(expired.state).toBe("unknown")
    expect(expired.aggregate?.applicability).toBe("insufficient_evidence")
    expect(computeReferenceVersionHash(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, expired]]))).not.toBe(
      computeReferenceVersionHash(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, freshLate]])),
    )
  })

  test("malformed, unsafe, missing, and incomplete evidence stay unknown", async () => {
    await writeUtf8(tmp, ".pulsar/ownership.json", "{")
    expect((await loadOwnershipFacts(tmp)).state).toBe("unknown")

    await writeInventory({
      root: tmp,
      policy: {
        ...basePolicy([{
          id: "escape",
          owner_paths: ["../secret.ts"],
          caller_paths: ["src/caller.ts"],
          origin: "declared",
        }]),
      },
      skipAssessment: true,
    })
    expect((await loadOwnershipFacts(tmp)).state).toBe("unknown")

    await writeInventory({ root: tmp })
    await rm(join(tmp, "src", "owner.ts"))
    const missing = await loadOwnershipFacts(tmp)
    expect(missing.state).toBe("unknown")
    expect(missing.findings.some((finding) => finding.message.includes("unavailable"))).toBe(true)
  })
})

describe("ownership cache identity", () => {
  test("scoreCommit refVersionHash misses when only non-source context bytes change", async () => {
    const repo: GitTestRepo = await createGitTestRepo("pulsar-own-cache-")
    try {
      await writeInventory({ root: repo.root })
      await writeUtf8(repo.root, "a.ts", "export const x = 1\n")
      const sha1 = await repo.commitAll({ message: "ownership present" })
      const content1 = await Effect.runPromise(computeContentHash(repo.root, sha1))

      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const registry = yield* buildRegistry([makeOwnershipSignal(counter)])
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(ScoringEngineLayer(registry, () => Layer.empty)),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
        const first = yield* engine.scoreCommit(repo.root, sha1, "MOCK-OWNERSHIP")
        const afterFirst = yield* Ref.get(counter)
        const second = yield* engine.scoreCommit(repo.root, sha1, "MOCK-OWNERSHIP")
        const afterSecond = yield* Ref.get(counter)
        yield* Effect.promise(() => writeUtf8(repo.root, "docs/note.md", "context changed\n"))
        const sha2 = yield* Effect.promise(() => repo.commitAll({ message: "context only" }))
        const content2 = yield* computeContentHash(repo.root, sha2)
        const third = yield* engine.scoreCommit(repo.root, sha2, "MOCK-OWNERSHIP")
        const afterThird = yield* Ref.get(counter)
        return { first, second, third, afterFirst, afterSecond, afterThird, content2, sha2 }
      })
      const result = await Effect.runPromise(program)
      expect(result.afterFirst).toBe(1)
      expect(result.afterSecond).toBe(1)
      expect(result.content2).toBe(content1)
      expect(result.afterThird).toBe(2)
      expect(result.first.score).toBe(1)
      expect((result.third.output as OwnershipFacts).state).toBe("unknown")
    } finally {
      await repo.cleanup()
    }
  })

  test("observer cache misses after the same files expire", async () => {
    const repo: GitTestRepo = await createGitTestRepo("pulsar-own-expire-")
    const expiresAt = new Date(CREATED_MS + 30 * DAY_MS).toISOString()
    const expiresMs = Date.parse(expiresAt)
    const now = spyOn(Date, "now").mockReturnValue(expiresMs)
    try {
      await writeInventory({
        root: repo.root,
        labels: [{ group: groupA(), status: "resolved", selected: "meets", expiresAt }],
      })
      await writeUtf8(repo.root, "a.ts", "export const x = 1\n")
      const sha = await repo.commitAll({ message: "expiring ownership" })
      const program = Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        const registry = yield* buildRegistry([makeOwnershipSignal(counter)])
        const engine = yield* ScoringEngineTag.pipe(
          Effect.provide(ScoringEngineLayer(registry, () => Layer.empty)),
        ) as Effect.Effect<typeof ScoringEngineTag.Service, never, never>
        const fresh = yield* engine.observeCommit(repo.root, sha)
        const afterFresh = yield* Ref.get(counter)
        now.mockReturnValue(expiresMs + 1)
        const expired = yield* engine.observeCommit(repo.root, sha)
        const afterExpired = yield* Ref.get(counter)
        return { fresh, expired, afterFresh, afterExpired }
      })
      const result = await Effect.runPromise(program)
      expect(result.afterFresh).toBe(1)
      expect(result.afterExpired).toBe(2)
      expect(result.fresh.signalResults.get("MOCK-OWNERSHIP")?.score).toBe(1)
      expect((result.expired.signalResults.get("MOCK-OWNERSHIP")?.output as OwnershipFacts).validityState)
        .toBe("expired")
    } finally {
      now.mockRestore()
      await repo.cleanup()
    }
  })
})

describe("decodeOwnershipPolicySync", () => {
  test("requires confined paths and an authorized evaluator", () => {
    expect(() => decodeOwnershipPolicySync({ ...basePolicy(), allowed_classifiers: [] })).toThrow(
      "authorize an evaluator",
    )
    expect(() =>
      decodeOwnershipPolicySync(basePolicy([groupA({ owner_paths: [".pulsar/vector.json"] })])),
    ).toThrow("tool state")
  })
})
