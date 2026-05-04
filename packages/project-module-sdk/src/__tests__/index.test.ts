import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import {
  appendCalibrationDecision,
  decodeProjectModuleManifest,
  defineProcessor,
  defineProjectModule,
  fingerprintProjectModuleManifest,
  fingerprintProjectModule,
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "../index.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["convex", "typescript"],
  sourceExtensions: [".ts"],
}

describe("project module sdk", () => {
  test("defineProjectModule derives descriptor contributions and active fingerprint", () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      sourceRef: ".taste-codec/modules/acme.ts",
      processors: [
        defineProcessor({
          id: "convex-generated-taxonomy",
          slot: "taxonomy.file-classifier",
          role: "filter",
          fingerprint: "taxonomy-v1",
          priority: 10,
          process: (current) => Effect.succeed(current),
        }),
      ],
    })

    expect(module.descriptor).toMatchObject({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      source: "repo-local",
      sourceRef: ".taste-codec/modules/acme.ts",
      contributions: [
        {
          slot: "taxonomy.file-classifier",
          processorId: "convex-generated-taxonomy",
          role: "filter",
          priority: 10,
          fingerprint: "taxonomy-v1",
        },
      ],
    })
    expect(module.activeModule.fingerprint).toBe(
      fingerprintProjectModule(module.descriptor),
    )
    expect(module.processors[0]?.moduleId).toBe("acme.project")
    expect(module.processors[0]?.moduleVersion).toBe("1.0.0")
  })

  test("defined processors execute through the core calibration context", async () => {
    const module = defineProjectModule({
      id: "acme.convex",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "convex-generated-taxonomy",
          slot: "taxonomy.file-classifier",
          role: "filter",
          fingerprint: "taxonomy-v1",
          process: (current) =>
            Effect.sync(() =>
              appendCalibrationDecision(
                current,
                {
                  moduleId: "acme.convex",
                  processorId: "convex-generated-taxonomy",
                  slot: "taxonomy.file-classifier",
                  action: "classify-generated",
                  confidence: "high",
                  reason: "Convex generated API path",
                  evidence: [{ kind: "path", value: current.value.path }],
                },
                {
                  ...current.value,
                  categories: [...current.value.categories, "generated"],
                },
              ),
            ),
        }),
      ],
    })
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [module.activeModule],
      processors: module.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("taxonomy.file-classifier", {
        path: "/repo/convex/_generated/api.ts",
        categories: ["unknown"],
      }),
    )

    expect(result.value.categories).toEqual(["unknown", "generated"])
    expect(result.decisions[0]?.moduleId).toBe("acme.convex")
    expect(result.decisions[0]?.processorId).toBe("convex-generated-taxonomy")
  })

  test("decodes project module manifests with repo-local, workspace, and package refs", async () => {
    const manifest = await Effect.runPromise(
      decodeProjectModuleManifest({
        modules: [
          {
            id: "repo-convex",
            kind: "repo-local",
            path: ".taste-codec/modules/convex.ts",
          },
          {
            id: "org-effect",
            kind: "workspace",
            packageName: "@acme/taste-effect-module",
            exportName: "default",
            config: { strict: true },
          },
          {
            id: "published-react",
            kind: "package",
            packageName: "@taste-codec/project-module-react",
            version: "1.0.0",
            enabled: false,
          },
        ],
      }),
    )

    expect(manifest.schema).toBe("taste/project-modules/v1")
    expect(manifest.modules[0]).toMatchObject({
      id: "repo-convex",
      enabled: true,
    })
    expect(manifest.modules[1]).toMatchObject({
      id: "org-effect",
      config: { strict: true },
    })
    expect(manifest.modules[2]).toMatchObject({
      id: "published-react",
      enabled: false,
    })
  })

  test("rejects invalid project module refs", async () => {
    const exit = await Effect.runPromiseExit(
      decodeProjectModuleManifest({
        modules: [
          {
            id: "missing-target",
            kind: "repo-local",
          },
        ],
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("project module manifest fingerprints are deterministic across module order", async () => {
    const left = await Effect.runPromise(
      decodeProjectModuleManifest({
        modules: [
          {
            id: "b",
            kind: "package",
            packageName: "@taste-codec/project-module-effect",
          },
          {
            id: "a",
            kind: "repo-local",
            path: ".taste-codec/modules/acme.ts",
          },
        ],
      }),
    )
    const right = await Effect.runPromise(
      decodeProjectModuleManifest({
        modules: [
          {
            id: "a",
            kind: "repo-local",
            path: ".taste-codec/modules/acme.ts",
          },
          {
            id: "b",
            kind: "package",
            packageName: "@taste-codec/project-module-effect",
          },
        ],
      }),
    )

    expect(fingerprintProjectModuleManifest(left)).toBe(
      fingerprintProjectModuleManifest(right),
    )
  })
})
