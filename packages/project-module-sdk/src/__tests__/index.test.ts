import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import {
  addPolicyTag,
  addSourceCategory,
  classifyArchitectureRole,
  classifyTypeScriptNoop,
  decodeProjectModuleManifest,
  defineProcessor,
  defineProjectModule,
  fingerprintProjectModuleManifest,
  fingerprintProjectModule,
  loadEnabledProjectModules,
  loadProjectModuleRef,
  makeResolvedCalibrationContext,
  markTypeScriptExportFrameworkConsumed,
  markTypeScriptExportPublicEntrypoint,
  nameTypeScriptCallbackContext,
  readArchitectureRole,
  readPolicyTags,
  type RepoFacts,
  tuneFactorPolicy,
  tuneTypeScriptUnfinishedImplementation,
} from "../index.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["convex", "typescript"],
  sourceExtensions: [".ts"],
}

const listFiles = async (root: string): Promise<ReadonlyArray<string>> => {
  let entries: Awaited<ReturnType<typeof readDirectoryEntries>>
  try {
    entries = await readDirectoryEntries(root)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
    throw cause
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return listFiles(path)
      return [path]
    }),
  )
  return files.flat()
}

const readDirectoryEntries = (root: string) =>
  readdir(root, { withFileTypes: true, encoding: "utf8" })

describe("project module sdk", () => {
  test("defineProjectModule derives descriptor contributions and active fingerprint", () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      sourceRef: ".pulsar/modules/acme.ts",
      sourceFingerprint: "source-v1",
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
      sourceRef: ".pulsar/modules/acme.ts",
      sourceFingerprint: "source-v1",
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

  test("taxonomy helpers classify repo-defined architecture roles and policy tags", async () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "domain-boundary-taxonomy",
          slot: "taxonomy.file-classifier",
          role: "enricher",
          fingerprint: "domain-boundary-taxonomy-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() => {
              if (!current.value.path.endsWith("/src/domain/user.ts")) return current
              const withRole = classifyArchitectureRole(
                current,
                runtime,
                "domain-boundary",
                {
                  reason: "This repository marks domain aggregate files as boundary-owned",
                  ruleId: "acme.domain-boundary.v1",
                  evidence: [{ kind: "path", value: current.value.path }],
                },
              )
              return addPolicyTag(withRole, runtime, "owner-reviewed", {
                reason: "Domain boundaries require owner review in this repository",
                ruleId: "acme.owner-reviewed.v1",
                evidence: [{ kind: "path", value: current.value.path }],
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
      context.runSlot("taxonomy.file-classifier", {
        path: "/repo/src/domain/user.ts",
        categories: ["production_source"],
      }),
    )

    expect(readArchitectureRole(result.value.metadata)).toBe("domain-boundary")
    expect(readPolicyTags(result.value.metadata)).toEqual(["owner-reviewed"])
    expect(result.decisions.map((decision) => decision.action)).toEqual([
      "classify-architecture-role",
      "add-policy-tag",
    ])
    expect(result.decisions.map((decision) => decision.ruleId)).toEqual([
      "acme.domain-boundary.v1",
      "acme.owner-reviewed.v1",
    ])

    const paddedResult = await Effect.runPromise(
      context.runSlot("taxonomy.file-classifier", {
        path: "/repo/src/domain/user.ts",
        categories: ["production_source"],
        metadata: { architecture_role: " legacy " },
      }),
    )

    expect(paddedResult.value.metadata?.architecture_role).toBe("domain-boundary")
    expect(paddedResult.decisions[0]).toMatchObject({
      before: "legacy",
      after: "domain-boundary",
    })
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

  test("TypeScript noop helper decision confidence follows slot confidence by default", async () => {
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
            Effect.sync(() =>
              classifyTypeScriptNoop(current, runtime, {
                classification: "intentional_noop",
                reason: "Project contract hook",
              }),
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
      context.runSlot("typescript.noop-classifier", {
        file: "/repo/src/contracts.ts",
        name: "projectContract",
        line: 1,
        nodeKind: "FunctionDeclaration",
        classification: "stub",
        confidence: "medium",
      }),
    )

    expect(result.value.confidence).toBe("medium")
    expect(result.decisions[0]?.confidence).toBe("medium")
  })

  test("processor runtime helpers mark TypeScript exports as public entrypoints", async () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "runtime-entrypoints",
          slot: "typescript.export-reachability",
          role: "resolver",
          fingerprint: "runtime-entrypoints-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              markTypeScriptExportPublicEntrypoint(current, runtime, {
                reason: "Project runtime invokes this export externally",
                evidence: [{ kind: "path", value: current.value.exportFile }],
                metadata: { runtime: "project" },
              }),
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
      context.runSlot("typescript.export-reachability", {
        exportFile: "/repo/src/runtime.ts",
        exportName: "handler",
        declarationFiles: ["/repo/src/runtime.ts"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      }),
    )

    expect(result.value.isPublicEntrypoint).toBe(true)
    expect(result.value.metadata).toMatchObject({ runtime: "project" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.project",
      processorId: "runtime-entrypoints",
      slot: "typescript.export-reachability",
      action: "mark-public-entrypoint",
      confidence: "high",
    })
  })

  test("processor runtime helpers mark TypeScript exports as framework-consumed", async () => {
    const module = defineProjectModule({
      id: "acme.framework",
      version: "1.0.0",
      scope: "framework",
      processors: [
        defineProcessor({
          id: "framework-entrypoints",
          slot: "typescript.export-reachability",
          role: "resolver",
          fingerprint: "framework-entrypoints-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              markTypeScriptExportFrameworkConsumed(current, runtime, {
                frameworkId: "acme-router",
                frameworkName: "Acme Router",
                contractId: "acme-router.page.metadata",
                reason: "Acme Router consumes this export by file convention",
                evidence: [{ kind: "path", value: current.value.exportFile }],
                metadata: { routeContract: true },
              }),
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
      context.runSlot("typescript.export-reachability", {
        exportFile: "/repo/app/page.tsx",
        exportName: "metadata",
        declarationFiles: ["/repo/app/page.tsx"],
        declarationKinds: ["VariableDeclaration"],
        isPublicEntrypoint: false,
      }),
    )

    expect(result.value.frameworkConsumer).toEqual({
      frameworkId: "acme-router",
      frameworkName: "Acme Router",
      contractId: "acme-router.page.metadata",
    })
    expect(result.value.isPublicEntrypoint).toBe(false)
    expect(result.value.metadata).toMatchObject({
      framework: "acme-router",
      frameworkName: "Acme Router",
      frameworkContract: "acme-router.page.metadata",
      routeContract: true,
    })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.framework",
      processorId: "framework-entrypoints",
      slot: "typescript.export-reachability",
      action: "mark-framework-consumed",
      confidence: "high",
    })
  })

  test("processor runtime helpers name TypeScript callback contexts", async () => {
    const module = defineProjectModule({
      id: "acme.effect",
      version: "1.0.0",
      scope: "technology",
      processors: [
        defineProcessor({
          id: "effect-callback-names",
          slot: "typescript.callback-context-namer",
          role: "enricher",
          fingerprint: "effect-callback-names-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              nameTypeScriptCallbackContext(current, runtime, {
                resolvedName: "Session.create",
                reason: "Effect.fn label provides the callback's operation name",
                ruleId: "effect.callback-context-name.v1",
                evidence: [{ kind: "symbol", value: "Session.create" }],
                metadata: { technology: "effect" },
              }),
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
      context.runSlot("typescript.callback-context-namer", {
        file: "/repo/src/session.ts",
        line: 12,
        fallbackName: "<anonymous>",
        resolvedName: "create/Effect.fn",
      }),
    )

    expect(result.value.resolvedName).toBe("Session.create")
    expect(result.value.metadata).toMatchObject({ technology: "effect" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.effect",
      processorId: "effect-callback-names",
      slot: "typescript.callback-context-namer",
      action: "name-callback-context",
      ruleId: "effect.callback-context-name.v1",
      confidence: "high",
    })
  })

  test("processor runtime helpers tune unfinished implementation factors", async () => {
    const module = defineProjectModule({
      id: "acme.effect",
      version: "1.0.0",
      scope: "technology",
      processors: [
        defineProcessor({
          id: "effect-unfinished-policy",
          slot: "typescript.unfinished-implementation-policy",
          role: "factor-policy",
          fingerprint: "effect-unfinished-policy-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              tuneTypeScriptUnfinishedImplementation(current, runtime, {
                penaltyWeight: 0.2,
                scoreCapParticipation: false,
                reason: "Effect workflow treats this placeholder as tracked debt",
                ruleId: "effect.unfinished.tracked-debt.v1",
                evidence: [{ kind: "symbol", value: current.value.name }],
                metadata: { technology: "effect" },
              }),
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
    expect(result.value.penaltyWeight).toBe(0.2)
    expect(result.value.scoreCapParticipation).toBe(false)
    expect(result.value.metadata).toMatchObject({ technology: "effect" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.effect",
      processorId: "effect-unfinished-policy",
      slot: "typescript.unfinished-implementation-policy",
      action: "tune-unfinished-implementation",
      confidence: "high",
      ruleId: "effect.unfinished.tracked-debt.v1",
      factorPaths: [
        "stub_kinds.throw-not-implemented.penalty_weight",
        "stub_kinds.throw-not-implemented.score_cap_participation",
      ],
    })
    expect(result.decisions[0]?.before).toMatchObject({
      penaltyWeight: 1,
      scoreCapParticipation: true,
    })
    expect(result.decisions[0]?.after).toMatchObject({
      penaltyWeight: 0.2,
      scoreCapParticipation: false,
    })
  })

  test("processor runtime helpers tune TypeScript type-coupling factors", async () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "contract-type-coupling",
          slot: "typescript.type-coupling-policy",
          role: "factor-policy",
          fingerprint: "contract-type-coupling-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              tuneFactorPolicy(current, runtime, {
                action: "tune-type-coupling",
                severity: "info",
                penaltyWeight: 0,
                reason: "Project contract file intentionally aggregates type dependencies",
                ruleId: "acme.type-coupling.contract.v1",
                evidence: [{ kind: "path", value: current.value.file }],
                metadata: { contract: true },
              }),
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
      context.runSlot("typescript.type-coupling-policy", {
        signalId: "TS-DE-01-type-level-coupling",
        findingId: "/repo/src/contracts.ts",
        file: "/repo/src/contracts.ts",
        externalTypesReferenced: 12,
        typesReferencedExternally: 2,
        totalCoupling: 14,
        outlierThreshold: 9,
        visible: true,
        severity: "warn",
        penaltyWeight: 0.33,
        factorPathPrefix: "type_coupling.src_contracts.ts",
      }),
    )

    expect(result.value.severity).toBe("info")
    expect(result.value.penaltyWeight).toBe(0)
    expect(result.value.metadata).toMatchObject({ contract: true })
    expect(result.decisions[0]).toMatchObject({
      moduleId: "acme.project",
      processorId: "contract-type-coupling",
      slot: "typescript.type-coupling-policy",
      action: "tune-type-coupling",
      confidence: "high",
      ruleId: "acme.type-coupling.contract.v1",
      factorPaths: [
        "type_coupling.src_contracts.ts.severity",
        "type_coupling.src_contracts.ts.penalty_weight",
      ],
    })
  })

  test("processor runtime helpers tune review-pain process factors", async () => {
    const module = defineProjectModule({
      id: "acme.project",
      version: "1.0.0",
      scope: "repository",
      processors: [
        defineProcessor({
          id: "active-pr-size-policy",
          slot: "typescript.pr-size-policy",
          role: "factor-policy",
          fingerprint: "active-pr-size-policy-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              tuneFactorPolicy(current, runtime, {
                action: "tune-pr-size",
                severity: "info",
                penaltyWeight: 0,
                reason: "Project marks this PR surface as an active consolidation sprint",
                ruleId: "acme.pr-size.active-sprint.v1",
                evidence: [{ kind: "diff-mode", value: current.value.diffMode }],
                metadata: { process: "active-sprint" },
              }),
            ),
        }),
        defineProcessor({
          id: "single-maintainer-policy",
          slot: "shared.bus-factor-policy",
          role: "factor-policy",
          fingerprint: "single-maintainer-policy-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              tuneFactorPolicy(current, runtime, {
                action: "tune-bus-factor",
                severity: "info",
                penaltyWeight: 0,
                reason: "Project tracks single-maintainer authorship outside code health",
                ruleId: "acme.bus-factor.single-maintainer.v1",
                evidence: [{ kind: "repo-authors", value: current.value.repoAuthors.join(",") }],
                metadata: { process: "single-maintainer" },
              }),
            ),
        }),
        defineProcessor({
          id: "active-churn-policy",
          slot: "shared.churn-rate-policy",
          role: "factor-policy",
          fingerprint: "active-churn-policy-v1",
          process: (current, _context, runtime) =>
            Effect.sync(() =>
              tuneFactorPolicy(current, runtime, {
                action: "tune-churn-rate",
                severity: "info",
                penaltyWeight: 0,
                reason: "Project marks this churn as active cleanup",
                ruleId: "acme.churn.active-cleanup.v1",
                evidence: [{ kind: "churn-rate", value: String(current.value.churnRate) }],
                metadata: { process: "active-cleanup" },
              }),
            ),
        }),
      ],
    })
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [module.activeModule],
      processors: module.processors,
    })

    const prSize = await Effect.runPromise(
      context.runSlot("typescript.pr-size-policy", {
        signalId: "TS-RP-02-pr-size",
        findingId: "pr-size",
        diffMode: "git-branch-range",
        linesAdded: 1_000,
        linesDeleted: 200,
        filesChanged: ["/repo/src/large.ts"],
        sizeCategory: "oversized",
        visible: true,
        severity: "warn",
        penaltyWeight: 0.6,
        factorPathPrefix: "pr_size",
      }),
    )
    const busFactor = await Effect.runPromise(
      context.runSlot("shared.bus-factor-policy", {
        signalId: "SHARED-02-bus-factor",
        findingId: "/repo/src/owned.ts",
        file: "/repo/src/owned.ts",
        author: "Alice",
        loc: 250,
        windowDays: 180,
        maxCommits: 5_000,
        touchedFileCount: 1,
        touchedLoc: 250,
        repoAuthors: ["Alice"],
        visible: true,
        severity: "warn",
        penaltyWeight: 0.35,
        factorPathPrefix: "bus_factor.src_owned.ts",
      }),
    )
    const churnRate = await Effect.runPromise(
      context.runSlot("shared.churn-rate-policy", {
        signalId: "SHARED-03-churn-rate",
        findingId: "/repo/src/churn.ts",
        file: "/repo/src/churn.ts",
        windowDays: 14,
        introduced: 10,
        churned: 5,
        rate: 0.5,
        introducedLineCount: 10,
        churnedLineCount: 5,
        churnRate: 0.5,
        repoIntroduced: 10,
        repoChurned: 5,
        repoRate: 0.5,
        visible: true,
        severity: "warn",
        penaltyWeight: 1,
        factorPathPrefix: "churn_rate.src_churn.ts",
      }),
    )

    expect(prSize.value.penaltyWeight).toBe(0)
    expect(prSize.decisions[0]).toMatchObject({
      slot: "typescript.pr-size-policy",
      action: "tune-pr-size",
      factorPaths: ["pr_size.severity", "pr_size.penalty_weight"],
    })
    expect(busFactor.value.penaltyWeight).toBe(0)
    expect(busFactor.decisions[0]).toMatchObject({
      slot: "shared.bus-factor-policy",
      action: "tune-bus-factor",
      factorPaths: [
        "bus_factor.src_owned.ts.severity",
        "bus_factor.src_owned.ts.penalty_weight",
      ],
    })
    expect(churnRate.value.penaltyWeight).toBe(0)
    expect(churnRate.decisions[0]).toMatchObject({
      slot: "shared.churn-rate-policy",
      action: "tune-churn-rate",
      factorPaths: [
        "churn_rate.src_churn.ts.severity",
        "churn_rate.src_churn.ts.penalty_weight",
      ],
    })
  })

  test("decodes project module manifests with builtin, repo-local, workspace, and package refs", async () => {
    const manifest = await Effect.runPromise(
      decodeProjectModuleManifest({
        modules: [
          {
            id: "@skastr0/pulsar-project-module-nextjs",
            kind: "builtin",
            enabled: false,
          },
          {
            id: "repo-convex",
            kind: "repo-local",
            path: ".pulsar/modules/convex.ts",
          },
          {
            id: "org-effect",
            kind: "workspace",
            packageName: "@acme/pulsar-effect-module",
            exportName: "default",
            config: { strict: true },
          },
          {
            id: "published-react",
            kind: "package",
            packageName: "@skastr0/pulsar-project-module-react",
            version: "1.0.0",
            enabled: false,
          },
        ],
      }),
    )

    expect(manifest.schema).toBe("pulsar/project-modules/v1")
    expect(manifest.modules[0]).toMatchObject({
      id: "@skastr0/pulsar-project-module-nextjs",
      kind: "builtin",
      enabled: false,
    })
    expect(manifest.modules[1]).toMatchObject({
      id: "repo-convex",
      enabled: true,
    })
    expect(manifest.modules[2]).toMatchObject({
      id: "org-effect",
      config: { strict: true },
    })
    expect(manifest.modules[3]).toMatchObject({
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
            packageName: "@skastr0/pulsar-project-module-effect",
          },
          {
            id: "c",
            kind: "builtin",
          },
          {
            id: "a",
            kind: "repo-local",
            path: ".pulsar/modules/acme.ts",
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
            path: ".pulsar/modules/acme.ts",
          },
          {
            id: "c",
            kind: "builtin",
          },
          {
            id: "b",
            kind: "package",
            packageName: "@skastr0/pulsar-project-module-effect",
          },
        ],
      }),
    )

    expect(fingerprintProjectModuleManifest(left)).toBe(
      fingerprintProjectModuleManifest(right),
    )
  })

  test("loads builtin project modules from the provided registry", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const builtin = defineProjectModule({
        id: "builtin.next",
        version: "1.0.0",
        scope: "framework",
        source: "package",
        processors: [],
      })
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "builtin.next",
              kind: "builtin",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, {
          repoRoot,
          builtinModules: new Map([["builtin.next", builtin]]),
        }),
      )

      expect(loaded.descriptor).toMatchObject({
        id: "builtin.next",
        source: "builtin",
        sourceRef: "builtin.next",
      })
      expect(loaded.descriptor.sourceFingerprint).toBeUndefined()
      expect(loaded.activeModule.fingerprint).toBe(
        fingerprintProjectModule(loaded.descriptor),
      )
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("rejects unknown builtin project modules", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "missing.builtin",
              kind: "builtin",
            },
          ],
        }),
      )

      const exit = await Effect.runPromiseExit(
        loadProjectModuleRef(manifest.modules[0]!, {
          repoRoot,
          builtinModules: new Map(),
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("loads repo-local project module definition exports", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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

  test("repo-local helper source changes invalidate loaded module fingerprints", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      await writeFile(
        join(repoRoot, "module.mjs"),
        [
          "import { marker } from './helper.mjs'",
          "export default {",
          "  id: 'loaded.definition',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  configHash: marker,",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const writeHelper = (marker: string) =>
        writeFile(
          join(repoRoot, "helper.mjs"),
          `export const marker = '${marker}'\n`,
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

      await writeHelper("first")
      const first = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )
      await writeHelper("second")
      const second = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(first.descriptor.configHash).toBe("first")
      expect(second.descriptor.configHash).toBe("second")
      expect(first.descriptor.sourceFingerprint).not.toBe(
        second.descriptor.sourceFingerprint,
      )
      expect(first.activeModule.fingerprint).not.toBe(second.activeModule.fingerprint)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("materialized repo-local modules can import package dependencies", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const helperRoot = join(repoRoot, "node_modules", "@acme", "module-helper")
      await mkdir(helperRoot, { recursive: true })
      await writeFile(
        join(helperRoot, "package.json"),
        JSON.stringify({
          name: "@acme/module-helper",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        }),
        "utf8",
      )
      await writeFile(
        join(helperRoot, "index.mjs"),
        "export const marker = 'repo-local-dependency-loaded'\n",
        "utf8",
      )
      await writeFile(
        join(repoRoot, "module.ts"),
        [
          "import { marker } from '@acme/module-helper'",
          "export default {",
          "  id: 'loaded.definition',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  configHash: marker,",
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
              path: "module.ts",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor.configHash).toBe("repo-local-dependency-loaded")
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("repo-local module loading exercises the production bundle path", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    const stateRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-state-"))
    const previousNodeEnv = process.env.NODE_ENV
    const previousPulsarStateHome = process.env.PULSAR_STATE_HOME
    try {
      const helperRoot = join(repoRoot, "node_modules", "@acme", "module-helper")
      await mkdir(helperRoot, { recursive: true })
      await writeFile(
        join(helperRoot, "package.json"),
        JSON.stringify({
          name: "@acme/module-helper",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        }),
        "utf8",
      )
      await writeFile(
        join(helperRoot, "index.mjs"),
        "export const marker = 'production-bundle-loaded'\n",
        "utf8",
      )
      await writeFile(
        join(repoRoot, "module.ts"),
        [
          "import { marker } from '@acme/module-helper'",
          "export default {",
          "  id: 'loaded.definition',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  configHash: marker,",
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
              path: "module.ts",
            },
          ],
        }),
      )

      process.env.NODE_ENV = "production"
      process.env.PULSAR_STATE_HOME = stateRoot
      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )
      const cacheFiles = await listFiles(stateRoot)

      expect(loaded.descriptor.configHash).toBe("production-bundle-loaded")
      expect(
        cacheFiles.some((file) => file.split(/[\\/]/).includes(".pulsar-bundle")),
      ).toBe(true)
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      if (previousPulsarStateHome === undefined) {
        delete process.env.PULSAR_STATE_HOME
      } else {
        process.env.PULSAR_STATE_HOME = previousPulsarStateHome
      }
      await rm(repoRoot, { recursive: true, force: true })
      await rm(stateRoot, { recursive: true, force: true })
    }
  })

  test("transitive helper source changes invalidate loaded module behavior", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      await writeFile(
        join(repoRoot, "module.mjs"),
        [
          "import { marker } from './helper.mjs'",
          "export default {",
          "  id: 'loaded.definition',",
          "  version: '1.0.0',",
          "  scope: 'repository',",
          "  configHash: marker,",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      await writeFile(
        join(repoRoot, "helper.mjs"),
        "export { marker } from './leaf.mjs'\n",
        "utf8",
      )
      const writeLeaf = (marker: string) =>
        writeFile(
          join(repoRoot, "leaf.mjs"),
          `export const marker = '${marker}'\n`,
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

      await writeLeaf("first")
      const first = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )
      await writeLeaf("second")
      const second = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(first.descriptor.configHash).toBe("first")
      expect(second.descriptor.configHash).toBe("second")
      expect(first.descriptor.sourceFingerprint).not.toBe(
        second.descriptor.sourceFingerprint,
      )
      expect(first.activeModule.fingerprint).not.toBe(second.activeModule.fingerprint)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("loads package project modules relative to the target repo root", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const packageRoot = join(repoRoot, "node_modules", "@acme", "pulsar-module")
      await mkdir(packageRoot, { recursive: true })
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
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
          "  id: '@acme/pulsar-module',",
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
              id: "@acme/pulsar-module",
              kind: "package",
              packageName: "@acme/pulsar-module",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor).toMatchObject({
        id: "@acme/pulsar-module",
        scope: "organization",
        source: "package",
        sourceRef: "@acme/pulsar-module",
      })
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("loads package project modules from an in-repo package root", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      await writeFile(
        join(repoRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        }),
        "utf8",
      )
      await writeFile(
        join(repoRoot, "index.mjs"),
        [
          "export default {",
          "  id: '@acme/pulsar-module',",
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
              id: "@acme/pulsar-module",
              kind: "package",
              packageName: "@acme/pulsar-module",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor).toMatchObject({
        id: "@acme/pulsar-module",
        scope: "organization",
        source: "package",
        sourceRef: "@acme/pulsar-module",
      })
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("materialized package modules can import package dependencies", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const moduleRoot = join(repoRoot, "node_modules", "@acme", "pulsar-module")
      const helperRoot = join(repoRoot, "node_modules", "@acme", "module-helper")
      await mkdir(moduleRoot, { recursive: true })
      await mkdir(helperRoot, { recursive: true })
      await writeFile(
        join(helperRoot, "package.json"),
        JSON.stringify({
          name: "@acme/module-helper",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
        }),
        "utf8",
      )
      await writeFile(
        join(helperRoot, "index.mjs"),
        "export const marker = 'dependency-loaded'\n",
        "utf8",
      )
      await writeFile(
        join(moduleRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
          version: "1.0.0",
          type: "module",
          exports: "./index.mjs",
          dependencies: {
            "@acme/module-helper": "1.0.0",
          },
        }),
        "utf8",
      )
      await writeFile(
        join(moduleRoot, "index.mjs"),
        [
          "import { marker } from '@acme/module-helper'",
          "export default {",
          "  id: '@acme/pulsar-module',",
          "  version: '1.0.0',",
          "  scope: 'organization',",
          "  source: 'package',",
          "  configHash: marker,",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "@acme/pulsar-module",
              kind: "package",
              packageName: "@acme/pulsar-module",
            },
          ],
        }),
      )

      const loaded = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(loaded.descriptor.configHash).toBe("dependency-loaded")
      expect(loaded.descriptor.sourceFingerprint).toMatch(/^sha256:/)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("package self and imports helpers invalidate loaded module behavior", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    try {
      const packageRoot = join(repoRoot, "node_modules", "@acme", "pulsar-module")
      await mkdir(packageRoot, { recursive: true })
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
          version: "1.0.0",
          type: "module",
          exports: {
            ".": "./index.mjs",
            "./helper": "./helper.mjs",
          },
          imports: {
            "#suffix": "./suffix.mjs",
          },
        }),
        "utf8",
      )
      await writeFile(
        join(packageRoot, "index.mjs"),
        [
          "import { marker } from '@acme/pulsar-module/helper'",
          "import { suffix } from '#suffix'",
          "export default {",
          "  id: '@acme/pulsar-module',",
          "  version: '1.0.0',",
          "  scope: 'organization',",
          "  source: 'package',",
          "  configHash: `${marker}:${suffix}`,",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      await writeFile(
        join(packageRoot, "suffix.mjs"),
        "export const suffix = 'stable'\n",
        "utf8",
      )
      const writeHelper = (marker: string) =>
        writeFile(
          join(packageRoot, "helper.mjs"),
          `export const marker = '${marker}'\n`,
          "utf8",
        )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "@acme/pulsar-module",
              kind: "package",
              packageName: "@acme/pulsar-module",
            },
          ],
        }),
      )

      await writeHelper("first")
      const first = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )
      await writeHelper("second")
      const second = await Effect.runPromise(
        loadProjectModuleRef(manifest.modules[0]!, { repoRoot }),
      )

      expect(first.descriptor.configHash).toBe("first:stable")
      expect(second.descriptor.configHash).toBe("second:stable")
      expect(first.descriptor.sourceFingerprint).not.toBe(
        second.descriptor.sourceFingerprint,
      )
      expect(first.activeModule.fingerprint).not.toBe(second.activeModule.fingerprint)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test("rejects package project module refs resolved from ambient parent node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    const repoRoot = join(root, "repo")
    try {
      const packageRoot = join(root, "node_modules", "@acme", "pulsar-module")
      await mkdir(packageRoot, { recursive: true })
      await mkdir(repoRoot, { recursive: true })
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
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
          "  id: '@acme/pulsar-module',",
          "  version: '1.0.0',",
          "  scope: 'organization',",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "@acme/pulsar-module",
              kind: "package",
              packageName: "@acme/pulsar-module",
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
          "repository package graph",
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects workspace project module refs resolved from ambient parent node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
    const repoRoot = join(root, "repo")
    try {
      const packageRoot = join(root, "node_modules", "@acme", "pulsar-module")
      await mkdir(packageRoot, { recursive: true })
      await mkdir(repoRoot, { recursive: true })
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({
          name: "@acme/pulsar-module",
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
          "  id: '@acme/pulsar-module',",
          "  version: '1.0.0',",
          "  scope: 'organization',",
          "  processors: []",
          "}",
        ].join("\n"),
        "utf8",
      )
      const manifest = await Effect.runPromise(
        decodeProjectModuleManifest({
          modules: [
            {
              id: "@acme/pulsar-module",
              kind: "workspace",
              packageName: "@acme/pulsar-module",
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
          "inside the repository root",
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects repo-local project module refs that escape the repo root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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
    const repoRoot = await mkdtemp(join(tmpdir(), "pulsar-project-module-"))
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
