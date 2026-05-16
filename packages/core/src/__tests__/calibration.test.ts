import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  activateProjectModule,
  appendCalibrationDecision,
  computeResolvedCalibrationFingerprint,
  defineCalibrationProcessor,
  fingerprintProjectModule,
  makeResolvedCalibrationContext,
  type ActiveProjectModule,
  type RepoFacts,
} from "../calibration.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["typescript"],
  sourceExtensions: [".ts"],
}

const moduleA = activateProjectModule({
  id: "acme.project",
  version: "1.0.0",
  scope: "repository",
  source: "repo-local",
  sourceRef: ".pulsar/modules/acme.ts",
  configHash: "config-a",
  contributions: [
    {
      slot: "taxonomy.file-classifier",
      processorId: "generated-taxonomy",
      role: "filter",
      priority: 10,
      fingerprint: "processor-a",
    },
  ],
})

const moduleB = activateProjectModule({
  id: "acme.effect",
  version: "1.0.0",
  scope: "technology",
  source: "package",
  sourceRef: "@skastr0/pulsar-project-module-effect",
  contributions: [
    {
      slot: "typescript.noop-classifier",
      processorId: "effect-noops",
      role: "normalizer",
      priority: 10,
      fingerprint: "processor-b",
    },
  ],
})

describe("calibration contracts", () => {
  test("project module fingerprints are stable across contribution order", () => {
    const left = fingerprintProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      source: "repo-local",
      contributions: [
        {
          slot: "typescript.noop-classifier",
          processorId: "noop",
          role: "normalizer",
          priority: 20,
          fingerprint: "noop-v1",
        },
        {
          slot: "taxonomy.file-classifier",
          processorId: "taxonomy",
          role: "filter",
          priority: 10,
          fingerprint: "taxonomy-v1",
        },
      ],
    })
    const right = fingerprintProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      source: "repo-local",
      contributions: [
        {
          slot: "taxonomy.file-classifier",
          processorId: "taxonomy",
          role: "filter",
          priority: 10,
          fingerprint: "taxonomy-v1",
        },
        {
          slot: "typescript.noop-classifier",
          processorId: "noop",
          role: "normalizer",
          priority: 20,
          fingerprint: "noop-v1",
        },
      ],
    })

    expect(left).toBe(right)
  })

  test("project module fingerprints include loader-observed source fingerprints", () => {
    const base = {
      id: "acme.project",
      version: "1.0.0",
      scope: "repository" as const,
      source: "repo-local" as const,
      sourceRef: ".pulsar/modules/acme.ts",
      contributions: [
        {
          slot: "typescript.noop-classifier" as const,
          processorId: "noop",
          role: "normalizer" as const,
          priority: 20,
          fingerprint: "noop-v1",
        },
      ],
    }

    expect(fingerprintProjectModule(base)).not.toBe(
      fingerprintProjectModule({ ...base, sourceFingerprint: "sha256:module-a" }),
    )
    expect(
      fingerprintProjectModule({ ...base, sourceFingerprint: "sha256:module-a" }),
    ).not.toBe(
      fingerprintProjectModule({ ...base, sourceFingerprint: "sha256:module-b" }),
    )
  })

  test("resolved calibration fingerprints are stable across module and processor order", () => {
    const firstProcessor = defineCalibrationProcessor({
      id: "first",
      moduleId: "acme.project",
      moduleVersion: "1.0.0",
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 10,
      fingerprint: "first-v1",
      process: (current) => Effect.succeed(current),
    })
    const secondProcessor = defineCalibrationProcessor({
      id: "second",
      moduleId: "acme.effect",
      moduleVersion: "1.0.0",
      slot: "typescript.noop-classifier",
      role: "normalizer",
      priority: 10,
      fingerprint: "second-v1",
      process: (current) => Effect.succeed(current),
    })

    const left = computeResolvedCalibrationFingerprint({
      repoFacts,
      activeModules: [moduleB, moduleA],
      processors: [secondProcessor, firstProcessor],
    })
    const right = computeResolvedCalibrationFingerprint({
      repoFacts,
      activeModules: [moduleA, moduleB],
      processors: [firstProcessor, secondProcessor],
    })

    expect(left).toBe(right)
  })

  test("resolved calibration fingerprints include repo fact metadata", () => {
    const base = computeResolvedCalibrationFingerprint({
      repoFacts,
      activeModules: [moduleA],
      processors: [],
    })
    const withMetadata = computeResolvedCalibrationFingerprint({
      repoFacts: {
        ...repoFacts,
        metadata: { architecturalTierManifest: "v1" },
      },
      activeModules: [moduleA],
      processors: [],
    })
    const withChangedMetadata = computeResolvedCalibrationFingerprint({
      repoFacts: {
        ...repoFacts,
        metadata: { architecturalTierManifest: "v2" },
      },
      activeModules: [moduleA],
      processors: [],
    })

    expect(withMetadata).not.toBe(base)
    expect(withChangedMetadata).not.toBe(withMetadata)
  })

  test("runSlot executes matching processors in priority order and preserves attribution", async () => {
    const order: Array<string> = []
    const taxonomyModule: ActiveProjectModule = moduleA
    const generatedProcessor = defineCalibrationProcessor({
      id: "generated-taxonomy",
      moduleId: taxonomyModule.id,
      moduleVersion: taxonomyModule.version,
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 20,
      fingerprint: "generated-taxonomy-v1",
      process: (current) =>
        Effect.sync(() => {
          order.push("generated")
          return appendCalibrationDecision(
            current,
            {
              moduleId: taxonomyModule.id,
              processorId: "generated-taxonomy",
              slot: "taxonomy.file-classifier",
              action: "classify-generated",
              confidence: "high",
              reason: "Project generated output path",
              evidence: [{ kind: "path", value: current.value.path }],
            },
            {
              ...current.value,
              categories: [...current.value.categories, "generated"],
            },
          )
        }),
    })
    const toolingProcessor = defineCalibrationProcessor({
      id: "tooling-taxonomy",
      moduleId: taxonomyModule.id,
      moduleVersion: taxonomyModule.version,
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 10,
      fingerprint: "tooling-taxonomy-v1",
      process: (current) =>
        Effect.sync(() => {
          order.push("tooling")
          return appendCalibrationDecision(
            current,
            {
              moduleId: taxonomyModule.id,
              processorId: "tooling-taxonomy",
              slot: "taxonomy.file-classifier",
              action: "classify-config-tooling",
              confidence: "medium",
              reason: "Project tooling convention",
              evidence: [{ kind: "path", value: current.value.path }],
            },
            {
              ...current.value,
              categories: [...current.value.categories, "config_tooling"],
            },
          )
        }),
    })
    const noopProcessor = defineCalibrationProcessor({
      id: "noop-normalizer",
      moduleId: moduleB.id,
      moduleVersion: moduleB.version,
      slot: "typescript.noop-classifier",
      role: "normalizer",
      priority: 1,
      fingerprint: "noop-normalizer-v1",
      process: (current) => Effect.succeed(current),
    })

    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [taxonomyModule, moduleB],
      processors: [generatedProcessor, noopProcessor, toolingProcessor],
    })

    const result = await Effect.runPromise(
      context.runSlot("taxonomy.file-classifier", {
        path: "/repo/convex/_generated/api.ts",
        categories: ["unknown"],
      }),
    )

    expect(order).toEqual(["tooling", "generated"])
    expect(result.value.categories).toEqual(["unknown", "config_tooling", "generated"])
    expect(result.decisions.map((decision) => decision.processorId)).toEqual([
      "tooling-taxonomy",
      "generated-taxonomy",
    ])
    expect(result.decisions[0]?.moduleId).toBe("acme.project")
  })

  test("factor policy processors can tune unfinished implementation factors with attribution", async () => {
    const module = activateProjectModule({
      id: "acme.effect",
      version: "1.0.0",
      scope: "technology",
      source: "package",
      sourceRef: "@acme/pulsar-effect-module",
      contributions: [
        {
          slot: "typescript.unfinished-implementation-policy",
          processorId: "effect-unfinished-policy",
          role: "factor-policy",
          priority: 10,
          fingerprint: "effect-unfinished-policy-v1",
        },
      ],
    })
    const processor = defineCalibrationProcessor({
      id: "effect-unfinished-policy",
      moduleId: module.id,
      moduleVersion: module.version,
      slot: "typescript.unfinished-implementation-policy",
      role: "factor-policy",
      priority: 10,
      fingerprint: "effect-unfinished-policy-v1",
      process: (current) =>
        Effect.succeed(
          appendCalibrationDecision(
            current,
            {
              moduleId: module.id,
              processorId: "effect-unfinished-policy",
              slot: "typescript.unfinished-implementation-policy",
              action: "deweight-accepted-effect-stub",
              confidence: "high",
              reason: "Effect package explicitly accepts this placeholder while ratcheting",
              ruleId: "effect.unfinished.accepted-placeholder.v1",
              factorPaths: [
                "stub_kinds.throw-not-implemented.penalty_weight",
                "stub_kinds.throw-not-implemented.score_cap_participation",
              ],
              before: {
                penaltyWeight: current.value.penaltyWeight,
                scoreCapParticipation: current.value.scoreCapParticipation,
              },
              after: {
                penaltyWeight: 0.25,
                scoreCapParticipation: false,
              },
              evidence: [{ kind: "symbol", value: current.value.name }],
            },
            {
              ...current.value,
              penaltyWeight: 0.25,
              scoreCapParticipation: false,
            },
          ),
        ),
    })
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [module],
      processors: [processor],
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.unfinished-implementation-policy", {
        signalId: "TS-SL-04-unfinished-implementations",
        findingId: "src/program.ts:10:main",
        file: "/repo/src/program.ts",
        name: "main",
        line: 10,
        stubKind: "throw-not-implemented",
        message: "Function throws not implemented",
        visible: true,
        severity: "block",
        confidence: "high",
        penaltyWeight: 1,
        scoreCapParticipation: true,
        scoreCap: 0.8,
        factorPathPrefix: "stub_kinds.throw-not-implemented",
      }),
    )

    expect(result.value.visible).toBe(true)
    expect(result.value.penaltyWeight).toBe(0.25)
    expect(result.value.scoreCapParticipation).toBe(false)
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.effect",
      processorId: "effect-unfinished-policy",
      slot: "typescript.unfinished-implementation-policy",
      action: "deweight-accepted-effect-stub",
      ruleId: "effect.unfinished.accepted-placeholder.v1",
      factorPaths: [
        "stub_kinds.throw-not-implemented.penalty_weight",
        "stub_kinds.throw-not-implemented.score_cap_participation",
      ],
    })
  })
})
