import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import {
  addSourceCategory,
  classifyTypeScriptNoop,
  decodeProjectModuleManifest,
  defineProcessor,
  defineProjectModule,
  fingerprintProjectModuleManifest,
  fingerprintProjectModule,
  loadEnabledProjectModules,
  loadProjectModuleRef,
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
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              addSourceCategory(
                current,
                runtime,
                "generated",
                {
                  reason: "Convex generated API path",
                  evidence: [{ kind: "path", value: current.value.path }],
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

    expect(result.value.categories).toEqual(["generated", "unknown"])
    expect(result.decisions[0]?.moduleId).toBe("acme.convex")
    expect(result.decisions[0]?.processorId).toBe("convex-generated-taxonomy")
  })

  test("processor runtime helpers classify TypeScript noops with attribution", async () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "contract-noops",
          slot: "typescript.noop-classifier",
          role: "normalizer",
          fingerprint: "contract-noops-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() => {
              expect(runtime).toMatchObject({
                moduleId: "acme.project",
                moduleVersion: "1.0.0",
                processorId: "contract-noops",
                slot: "typescript.noop-classifier",
              })
              return classifyTypeScriptNoop(current, runtime, {
                classification: "intentional_noop",
                confidence: "high",
                reason: "Project contract hook",
                evidence: [{ kind: "symbol", value: current.value.name }],
                metadata: { contract: true },
              })
            }),
        }),
      ],
    })
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [module.activeModule],
      processors: module.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.noop-classifier", {
        file: "/repo/src/contracts.ts",
        name: "projectContract",
        line: 1,
        nodeKind: "FunctionDeclaration",
        classification: "stub",
      }),
    )

    expect(result.value.classification).toBe("intentional_noop")
    expect(result.value.metadata).toMatchObject({ contract: true })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.project",
      processorId: "contract-noops",
      slot: "typescript.noop-classifier",
      action: "classify-intentional_noop",
      confidence: "high",
    })
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

  test("loads repo-local project module definition exports", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      await writeFile(
        join(repoRoot, "module.mjs"),
        [
          "export default {",
          "  id: 'loaded.definition',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "loaded.definition",
              kind: "repo-local",
              path: "module.mjs",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor.id).toBe("loaded.definition")
      expect(loaded.descriptor.sourceRef).toBe("module.mjs")
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
      expect(loaded.activeModule.fingerprint).toBe(
        fingerprintProjectModule(loaded.descriptor),
      )
      expect(loaded.processors).toEqual([])
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("loads named DefinedProjectModule exports and skips disabled manifest refs", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      await writeFile(
        join(repoRoot, "defined.mjs"),
        [
          "export const named = {",
          "  descriptor: {",
          "    id: 'loaded.defined',",
          "    version: '1.0.0',",
          "    scope: 'repository',",
          "    source: 'repo-local',",
          "    contributions: []",
          "  },",
          "  activeModule: {",
          "    id: 'loaded.defined',",
          "    version: '1.0.0',",
          "    scope: 'repository',",
          "    source: 'repo-local',",
          "    contributions: [],",
          "    fingerprint: 'defined-fingerprint'",
          "  },",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "loaded.defined",
              kind: "repo-local",
              path: "defined.mjs",
              exportName: "named",
            },
            {
              id: "disabled",
              kind: "repo-local",
              path: "missing.mjs",
              enabled: false,
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadEnabledProjectModules(manifest, { repoRoot }),
      )

      expect(loaded).toHaveLength(1)
      expect(loaded[0]?.descriptor.id).toBe("loaded.defined")
      expect(loaded[0]?.descriptor.sourceFingerprint).toMatch(/^sha256:/)
      expect(loaded[0]?.activeModule.fingerprint).toBe(
        fingerprintProjectModule(loaded[0]!.descriptor),
      )
      expect(loaded[0]?.activeModule.fingerprint).not.toBe("defined-fingerprint")
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("repo-local source content changes invalidate loaded module fingerprints", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      const writeModule = (marker: string) =>
        writeFile(
          join(repoRoot, "module.mjs"),
          [
            `// ${marker}`,
            "export default {",
            "  id: 'loaded.definition',",
            "  version: '1.0.0',",
            "  scope: 'repository',",
            "  processors: []",
            "}",
          ].join("\n"),
          "utf8",
        )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "loaded.definition",
              kind: "repo-local",
              path: "module.mjs",
            },
          ],
        }),
      )

      await writeModule("first")
      const first = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )
      await writeModule("second")
      const second = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(first.descriptor.sourceFingerprint).not.toBe(
        second.descriptor.sourceFingerprint,
      )
      expect(first.activeModule.fingerprint).not.toBe(second.activeModule.fingerprint)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("loads package project modules relative to the target repo root", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      const packageRoot = join(repoRoot, "node_modules", "@acme", "taste-module")
      await mkdir(packageRoot, { recursive: true })
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@acme/taste-module",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        }),
        "utf8",
      )
      await writeFile(
        join(packageRoot, "index.mjs"),
        [
          "export default {",
          "  id: '@acme/taste-module',",
          "  version: '1.0.0',",
          "  scope: 'organization',",
          "  source: 'package',",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "@acme/taste-module",
              kind: "package",
              packageName: "@acme/taste-module",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor).toMatchObject({
        id: "@acme/taste-module",
        scope: "organization",
        source: "package",
        sourceRef: "@acme/taste-module",
      })
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("rejects repo-local project module refs that escape the repo root", async () => {
    const root = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    const repoRoot = join(root, "repo")
    try {
      await mkdir(repoRoot, { recursive: true })
      await writeFile(
        join(root, "outside.mjs"),
        "export default { id: 'outside', version: '1.0.0', scope: 'repository', processors: [] }\n",
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "outside",
              kind: "repo-local",
              path: "../outside.mjs",
            },
          ],
        }),
      )

      const exit = await Effect.runPromiseExit(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null
        expect((err as { _tag?: string } | null)?._tag).toBe("ProjectModuleLoadError")
        expect((err as { message?: string } | null)?.message).toContain(
          "outside the repository root",
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects package project module refs that are import specifiers", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "data-ref",
              kind: "package",
              packageName:
                "data:text/javascript,export default { id: 'data', version: '1.0.0', scope: 'repository', processors: [] }",
            },
          ],
        }),
      )

      const exit = await Effect.runPromiseExit(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null
        expect((err as { _tag?: string } | null)?._tag).toBe("ProjectModuleLoadError")
        expect((err as { refId?: string } | null)?.refId).toBe("data-ref")
        expect((err as { message?: string } | null)?.message).toContain(
          "not a valid package name",
        )
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("reports typed load errors for missing exports", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "taste-project-module-"))
    try {
      await writeFile(join(repoRoot, "empty.mjs"), "export const nope = {}\n", "utf8")
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "bad-export",
              kind: "repo-local",
              path: "empty.mjs",
              exportName: "missing",
            },
          ],
        }),
      )

      const exit = await Effect.runPromiseExit(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === "Fail" ? exit.cause.error : null
        expect((err as { _tag?: string } | null)?._tag).toBe("ProjectModuleLoadError")
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
