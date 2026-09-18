import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { InMemoryCacheLayer, ReferenceDataTag, SignalContextTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import { observe } from "@skastr0/pulsar-core/observer"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import {
  computeOwnershipContentHash,
  computeOwnershipInputFingerprint,
  computeOwnershipPolicyFingerprint,
  computeOwnershipRubricFingerprint,
  loadOwnershipFacts,
  OWNERSHIP_LABEL_KIND,
  OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
  OWNERSHIP_REFERENCE_DATA_KEY,
  type OwnershipFacts,
  type OwnershipPolicy,
} from "../../../core/src/ownership.js"
import { TsSl07, TsSl07Config } from "../signals/ts-sl-07-rule-ownership-alignment.js"

interface TempRepo {
  readonly root: string
  readonly write: (relPath: string, content: string) => Promise<string>
  readonly writeJson: (relPath: string, value: unknown) => Promise<string>
  readonly cleanup: () => Promise<void>
}

const createOwnershipRepo = async (): Promise<TempRepo> => {
  const root = await mkdtemp(join(tmpdir(), "pulsar-ts-sl-07-"))
  const write = async (relPath: string, content: string): Promise<string> => {
    const fullPath = join(root, relPath)
    await mkdir(join(fullPath, ".."), { recursive: true })
    await writeFile(fullPath, content)
    return fullPath
  }
  return {
    root,
    write,
    writeJson: (relPath, value) => write(relPath, `${JSON.stringify(value, null, 2)}\n`),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

let repo: TempRepo

beforeEach(async () => {
  repo = await createOwnershipRepo()
})

afterEach(async () => {
  await repo.cleanup()
})

const POLICY_CLASSIFIER = {
  id: "jev-ownership",
  version: "1.0.0",
  prompt_id: "pulsar.ownership.choice.v2",
  model_id: "jev-1.13.0",
}

const ARTIFACT_CLASSIFIER = {
  ...POLICY_CLASSIFIER,
  prompt_fingerprint: "sha256:prompt-ownership-v2",
}

const ANCHORS = [
  { id: "contrary" as const, value: 0, description: "Callers keep the shared mapping locally." },
  { id: "mixed" as const, value: 0.5, description: "Some callers share, some keep copies." },
  { id: "meets" as const, value: 1, description: "One owner holds the shared mapping." },
]

const policyFor = (
  groups: OwnershipPolicy["groups"],
  preference: OwnershipPolicy["preference"] = "shared_domain_rule",
): OwnershipPolicy => ({
  schema_version: 1,
  preference,
  target: 1,
  anchors: ANCHORS,
  allowed_classifiers: [POLICY_CLASSIFIER],
  groups,
})

const writeSources = async (paths: ReadonlyArray<string>, body = "export const value = 1\n") => {
  for (const path of paths) await repo.write(path, body)
}

const hashesFor = async (paths: ReadonlyArray<string>): Promise<Record<string, string>> => {
  const { createHash } = await import("node:crypto")
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(join(repo.root, path))
        return [path, `sha256:${createHash("sha256").update(bytes).digest("hex")}`] as const
      }),
    ),
  )
}

const distribution = (selected: "contrary" | "mixed" | "meets" | "unknown" | "not_applicable") => {
  const ids = ["contrary", "mixed", "meets", "unknown", "not_applicable"] as const
  const values: Record<(typeof ids)[number], number> = {
    contrary: selected === "contrary" ? 1 : 0,
    mixed: selected === "mixed" ? 1 : 0,
    meets: selected === "meets" ? 1 : 0,
    unknown: selected === "unknown" ? 1 : 0,
    not_applicable: selected === "not_applicable" ? 1 : 0,
  }
  return ids.map((id) => ({
    anchor_id: id,
    ...(id === "unknown" || id === "not_applicable" ? {} : { anchor_value: ANCHORS.find((anchor) => anchor.id === id)!.value }),
    probability: values[id],
    selected: id === selected,
  }))
}

const labelArtifact = (input: {
  readonly groupId: string
  readonly status: "resolved" | "unresolved" | "not_applicable"
  readonly selected: "contrary" | "mixed" | "meets" | "unknown" | "not_applicable"
  readonly confidence: number
  readonly policyFingerprint: string
  readonly rubricFingerprint: string
  readonly sourcePaths: ReadonlyArray<string>
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly createdAt?: string
  readonly expiresAt?: string
}) => {
  const resolved = input.status === "resolved"
  const anchor = resolved ? ANCHORS.find((item) => item.id === input.selected) : undefined
  return {
    schema_version: "pulsar.ai_fact_label.v1",
    artifact_id: `ownership.${input.groupId}`,
    classifier: ARTIFACT_CLASSIFIER,
    input: {
      scope: "module",
      content_hash: computeOwnershipContentHash(input.sourceHashes),
      input_fingerprint: computeOwnershipInputFingerprint(
        input.policyFingerprint,
        input.groupId,
        input.sourceHashes,
      ),
      source_paths: [...input.sourcePaths].sort(),
    },
    label: {
      kind: OWNERSHIP_LABEL_KIND,
      value: {
        schema_version: OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
        group_id: input.groupId,
        policy_fingerprint: input.policyFingerprint,
        rubric_fingerprint: input.rubricFingerprint,
        status: input.status,
        ...(resolved ? { anchor_id: anchor!.id, anchor_value: anchor!.value } : {}),
        distribution: distribution(input.selected),
      },
      confidence: input.confidence,
      rationale: "fixture",
      evidence: input.sourcePaths.map((path) => ({ path })),
    },
    policy: {
      enforcement_ceiling: "soft-warning",
      missing_label_behavior: "fail-open",
      ...(input.expiresAt === undefined ? {} : { expires_at: input.expiresAt }),
    },
    provenance: {
      mode: "offline-replay",
      created_at: input.createdAt ?? "2026-05-16T00:00:00.000Z",
      created_by: "fixture",
      source: "committed-fixture",
    },
  }
}

const writeInventory = async (input: {
  readonly groups: OwnershipPolicy["groups"]
  readonly labels: ReadonlyArray<{
    readonly groupId: string
    readonly status: "resolved" | "unresolved" | "not_applicable"
    readonly selected: "contrary" | "mixed" | "meets" | "unknown" | "not_applicable"
    readonly confidence: number
    readonly expiresAt?: string
  }>
  readonly preference?: OwnershipPolicy["preference"]
  readonly omitAssessment?: boolean
}) => {
  const policy = policyFor(input.groups, input.preference)
  const sourcePaths = [...new Set(input.groups.flatMap((group) => [...group.owner_paths, ...group.caller_paths, ...(group.context_paths ?? [])]))]
  await writeSources(sourcePaths)
  const policyPath = ".pulsar/ownership.json"
  await repo.writeJson(policyPath, policy)
  const policyBytes = await readFile(join(repo.root, policyPath))
  const policyFingerprint = computeOwnershipPolicyFingerprint(policyBytes)
  const rubricFingerprint = computeOwnershipRubricFingerprint(policy)
  if (input.omitAssessment === true) return
  const labels = await Promise.all(
    input.labels.map(async (label) => {
      const group = input.groups.find((item) => item.id === label.groupId)!
      const paths = [...group.owner_paths, ...group.caller_paths, ...(group.context_paths ?? [])]
      const uniquePaths = [...new Set(paths)].sort()
      const sourceHashes = await hashesFor(uniquePaths)
      return labelArtifact({
        groupId: label.groupId,
        status: label.status,
        selected: label.selected,
        confidence: label.confidence,
        policyFingerprint,
        rubricFingerprint,
        sourcePaths: uniquePaths,
        sourceHashes,
        ...(label.expiresAt === undefined ? {} : { expiresAt: label.expiresAt }),
      })
    }),
  )
  await repo.writeJson(".pulsar/ownership-assessment.json", {
    schema_version: 1,
    policy_path: policyPath,
    policy_fingerprint: policyFingerprint,
    created_at: "2026-05-16T00:00:00.000Z",
    labels,
  })
}

const loadFacts = (): Promise<OwnershipFacts> => loadOwnershipFacts(repo.root)

const run = async (facts: OwnershipFacts, config = TsSl07.defaultConfig) => {
  const layer = Layer.mergeAll(
    Layer.succeed(SignalContextTag, {
      gitSha: "TEST",
      worktreePath: repo.root,
      changedHunks: [],
    }),
    Layer.succeed(ReferenceDataTag, makeReferenceData(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, facts]]))),
  )
  return Effect.runPromise(TsSl07.compute(config, new Map()).pipe(Effect.provide(layer)))
}

const twoGroups = (): OwnershipPolicy["groups"] => [
  {
    id: "http-status-class",
    owner_paths: ["src/http-map.ts"],
    caller_paths: ["src/stripe-adapter.ts"],
  },
  {
    id: "retry-budget",
    owner_paths: ["src/retry.ts"],
    caller_paths: ["src/client.ts"],
  },
]

describe("TS-SL-07 (rule ownership alignment)", () => {
  test("pack registration exposes canonical id, alias, title, and wrapped cache version", () => {
    expect(TsSl07.id).toBe("TS-SL-07-rule-ownership-alignment")
    expect(TsSl07.aliases).toEqual(["TS-SL-07"])
    expect(TsSl07.title).toBe("Rule ownership alignment")
    expect(TsSl07.tier).toBe(3)
    expect(TsSl07.kind).toBe("structural")
    expect(TsSl07.cacheVersion).toBe("ownership-attainment-v2")
    expect(TsSl07.enforcement).toEqual(["soft-warning", "review-routing", "dashboard"])
  })

  test("configSchema decodes defaults and sanitizes top_n_diagnostics", async () => {
    expect(Schema.decodeUnknownSync(TsSl07Config)(TsSl07.defaultConfig)).toEqual({ top_n_diagnostics: 10 })
    await writeInventory({ groups: twoGroups(), labels: [] })
    const facts = await loadFacts()
    const infinite = await run(facts, { top_n_diagnostics: Number.POSITIVE_INFINITY })
    expect(infinite.diagnosticLimit).toBe(0)
    const negative = await run(facts, { top_n_diagnostics: -3.9 })
    expect(negative.diagnosticLimit).toBe(0)
    const floored = await run(facts, { top_n_diagnostics: 1.8 })
    expect(floored.diagnosticLimit).toBe(1)
  })

  test("contrary declared group produces below-target pressure on the weakest obligation", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "contrary", confidence: 0.2 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 0.99 },
      ],
    })
    const out = await run(await loadFacts())
    expect(out.facts?.aggregate?.applicability).toBe("applicable")
    expect(out.facts?.aggregate?.attainment).toBe(0)
    expect(TsSl07.score(out)).toBe(0)
    expect(TsSl07.outputMetadata?.(out)).toMatchObject({
      factSource: "ai_classified",
      applicability: "applicable",
    })
    const diagnostics = TsSl07.diagnose(out)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.data?.comparison).toBe("below_target")
    expect(diagnostics.some((diagnostic) => diagnostic.data?.group_id === "http-status-class")).toBe(true)
  })

  test("all-meets declared inventory scores healthy with no hard-gate authority", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "meets", confidence: 0.4 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 0.4 },
      ],
    })
    const out = await run(await loadFacts())
    expect(TsSl07.score(out)).toBe(1)
    expect(TsSl07.diagnose(out)[0]?.severity).toBe("info")
    expect(TsSl07.diagnose(out)[0]?.data?.enforcement_ceiling).toBe("soft-warning")
    expect(JSON.stringify(TsSl07.diagnose(out))).not.toContain("hard")
  })

  test("missing policy is not_applicable and scores 0 rather than healthy 1", async () => {
    const facts = await loadFacts()
    expect(facts.state).toBe("not_configured")
    const out = await run(facts)
    expect(TsSl07.score(out)).toBe(0)
    expect(TsSl07.outputMetadata?.(out)?.applicability).toBe("not_applicable")
    expect(TsSl07.diagnose(out)).toEqual([])
  })

  test("public summary names declared inventory scope and preserves partial evidence", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "contrary", confidence: 1 },
        { groupId: "retry-budget", status: "unresolved", selected: "unknown", confidence: 0.4 },
      ],
    })
    const out = await run(await loadFacts())
    expect(out.facts?.aggregate?.applicability).toBe("insufficient_evidence")
    expect(out.facts?.aggregate?.score).toBeUndefined()
    expect(out.facts?.aggregate?.observedAttainment).toBe(0)
    expect(TsSl07.score(out)).toBe(0)
    expect(TsSl07.outputMetadata?.(out)?.applicability).toBe("insufficient_evidence")
    const summary = TsSl07.diagnose(out)[0]
    expect(summary?.message).toContain("declared ownership inventory, not all repository rules")
    expect(summary?.data?.scope).toBe("declared-ownership-inventory")
    expect(summary?.data?.observed_attainment).toBe(0)
    expect(summary?.data?.attainment).toBeNull()
    expect(summary?.data?.comparison).toBe("unknown")
  })

  test("model confidence does not change preference attainment or grant hard-gate authority", async () => {
    const groups = twoGroups()
    await writeInventory({
      groups,
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "contrary", confidence: 0.05 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 0.99 },
      ],
    })
    const low = await run(await loadFacts())
    await repo.cleanup()
    repo = await createOwnershipRepo()
    await writeInventory({
      groups,
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "contrary", confidence: 0.99 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 0.05 },
      ],
    })
    const high = await run(await loadFacts())
    expect(TsSl07.score(low)).toBe(0)
    expect(TsSl07.score(high)).toBe(0)
    expect(low.facts?.aggregate?.attainment).toBe(0)
    expect(high.facts?.aggregate?.attainment).toBe(0)
    expect(TsSl07.diagnose(low)[0]?.data?.enforcement_ceiling).toBe("soft-warning")
    expect(JSON.stringify(TsSl07.factorLedger?.(low))).not.toContain("confidence")
  })

  test("diagnostics honor top_n_diagnostics as a per-group cap plus inventory summary", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "meets", confidence: 1 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 1 },
      ],
    })
    const facts = await loadFacts()
    const none = TsSl07.diagnose(await run(facts, { top_n_diagnostics: 0 }))
    expect(none).toHaveLength(1)
    expect(none[0]?.data?.kind).toBe("ownership-alignment")
    const one = TsSl07.diagnose(await run(facts, { top_n_diagnostics: 1 }))
    expect(one).toHaveLength(2)
    expect(one.filter((diagnostic) => diagnostic.data?.kind === "ownership-group")).toHaveLength(1)
    const all = TsSl07.diagnose(await run(facts, { top_n_diagnostics: 10 }))
    expect(all.filter((diagnostic) => diagnostic.data?.kind === "ownership-group")).toHaveLength(2)
  })

  test("factor ledger exposes the full rubric, not only a policy fingerprint", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "mixed", confidence: 1 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 1 },
      ],
    })
    const out = await run(await loadFacts())
    const ledger = TsSl07.factorLedger?.(out)
    const policy = ledger?.entries.find((entry) => entry.path === "ownership.policy")
    const attainment = ledger?.entries.find((entry) => entry.path === "ownership.attainment")
    expect(policy?.value).toMatchObject({
      preference: "shared_domain_rule",
      target: 1,
      anchors: ANCHORS,
      stretch: null,
    })
    expect(typeof (policy?.value as { fingerprint?: unknown }).fingerprint).toBe("string")
    expect(attainment?.value).toBe(0.5)
    expect(TsSl07.score(out)).toBe(0.5)
  })

  test("stale assessment cannot claim fit", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        {
          groupId: "http-status-class",
          status: "resolved",
          selected: "meets",
          confidence: 1,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 1 },
      ],
    })
    const out = await run(await loadFacts())
    expect(out.facts?.state).toBe("unknown")
    expect(TsSl07.outputMetadata?.(out)?.applicability).toBe("insufficient_evidence")
    expect(out.facts?.aggregate?.score).toBeUndefined()
    expect(TsSl07.score(out)).toBe(0)
  })

  test("observer applicability matches single-signal output and wrapped cache version includes semantic id", async () => {
    await writeInventory({
      groups: twoGroups(),
      labels: [
        { groupId: "http-status-class", status: "resolved", selected: "meets", confidence: 1 },
        { groupId: "retry-budget", status: "resolved", selected: "meets", confidence: 1 },
      ],
    })
    const facts = await loadFacts()
    const single = await run(facts)
    const registry = await Effect.runPromise(buildRegistry([TsSl07]))
    const observer = await Effect.runPromise(
      Effect.provide(
        observe(registry, undefined),
        Layer.mergeAll(
          InMemoryCacheLayer,
          Layer.succeed(SignalContextTag, {
            gitSha: "TEST",
            worktreePath: repo.root,
            changedHunks: [],
          }),
          Layer.succeed(
            ReferenceDataTag,
            makeReferenceData(new Map([[OWNERSHIP_REFERENCE_DATA_KEY, facts]])),
          ),
        ),
      ) as Effect.Effect<ObserverOutput, unknown, never>,
    )
    const observerResult = observer.signalResults.get(TsSl07.id)
    expect(TsSl07.outputMetadata?.(single)?.applicability).toBe("applicable")
    expect(observerResult?.metadata?.applicability).toBe("applicable")
    expect(TsSl07.cacheVersion).toBe("ownership-attainment-v2")
  })
})
