import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  hashCalibrationValue,
  makeResolvedCalibrationContext,
  type CalibrationEvidenceRef,
  type DetectedFramework,
  type RepoFacts,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import {
  NEXTJS_APP_ROUTER_FRAMEWORK_ID,
  NEXTJS_PROJECT_MODULE_ID,
  nextjsProjectModule,
} from "@skastr0/pulsar-project-module-nextjs"
import {
  decodeProjectModuleManifest,
  fingerprintProjectModuleManifest,
  loadEnabledProjectModules,
  type ProjectModuleManifest,
  type ProjectModuleRef,
} from "@skastr0/pulsar-project-module-sdk"
import { Effect } from "effect"
import {
  detectNextAppRouterFramework,
  type DetectedRuntimeFramework,
} from "./runtime-framework-detection.js"

const PROJECT_MODULE_MANIFEST_SOURCE_REF = ".pulsar/project-modules.json"

const builtinProjectModules = new Map([
  [NEXTJS_PROJECT_MODULE_ID, nextjsProjectModule],
])

export const loadProjectModuleCalibrationContext = (
  repoRoot: string,
  options?: { readonly dependencyRoot?: string },
): Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never> =>
  Effect.gen(function* () {
    const manifest = yield* loadOptionalProjectModuleManifest(repoRoot)
    const detectedNext = yield* detectNextAppRouterFramework(repoRoot)
    const explicitNextRef = manifest?.modules.find((ref) =>
      ref.id === NEXTJS_PROJECT_MODULE_ID
    )
    const shouldAutoActivateNext =
      explicitNextRef === undefined && detectedNext?.confidence === "high"
    const effectiveManifest = makeEffectiveProjectModuleManifest(
      manifest,
      shouldAutoActivateNext,
    )
    const detectedFrameworks = detectedFrameworkSummaries(detectedNext, explicitNextRef)

    if (
      manifest === undefined &&
      effectiveManifest.modules.length === 0 &&
      detectedFrameworks.length === 0
    ) {
      return undefined
    }

    const loadedModules = yield* loadEnabledProjectModules(effectiveManifest, {
      repoRoot,
      ...(options?.dependencyRoot !== undefined ? { dependencyRoot: options.dependencyRoot } : {}),
      builtinModules: builtinProjectModules,
    })
    const manifestFingerprint =
      manifest === undefined ? undefined : fingerprintProjectModuleManifest(manifest)
    const effectiveManifestFingerprint = fingerprintProjectModuleManifest(effectiveManifest)
    const repoFacts: RepoFacts = {
      repoRoot,
      fingerprint: `project-modules:${hashCalibrationValue({
        manifestFingerprint: manifestFingerprint ?? null,
        effectiveManifestFingerprint,
        detectedFrameworks,
      })}`,
      detectedTechnologies: detectedFrameworks.some((framework) =>
        framework.id === NEXTJS_APP_ROUTER_FRAMEWORK_ID
      )
        ? ["nextjs"]
        : [],
      ...(detectedFrameworks.length > 0 ? { detectedFrameworks } : {}),
      sourceExtensions: [],
      metadata: {
        ...(manifestFingerprint === undefined
          ? {}
          : {
              manifestPath: PROJECT_MODULE_MANIFEST_SOURCE_REF,
              manifestFingerprint,
            }),
        effectiveManifestFingerprint,
        declaredModuleCount: manifest?.modules.length ?? 0,
        activeModuleCount: loadedModules.length,
        autoActivatedModuleCount: shouldAutoActivateNext ? 1 : 0,
      },
    }

    return makeResolvedCalibrationContext({
      repoFacts,
      activeModules: loadedModules.map((module) => module.activeModule),
      processors: loadedModules.flatMap((module) => module.processors),
    })
  })

const loadOptionalProjectModuleManifest = (
  repoRoot: string,
): Effect.Effect<ProjectModuleManifest | undefined, unknown, never> =>
  Effect.gen(function* () {
    const manifestPath = join(repoRoot, PROJECT_MODULE_MANIFEST_SOURCE_REF)
    if (!existsSync(manifestPath)) return undefined

    const raw = yield* Effect.tryPromise({
      try: () => readFile(manifestPath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read project module manifest at ${manifestPath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse project module manifest JSON at ${manifestPath}: ${String(cause)}`),
    })
    return yield* decodeProjectModuleManifest(parsed)
  })

const makeEffectiveProjectModuleManifest = (
  manifest: ProjectModuleManifest | undefined,
  autoActivateNext: boolean,
): ProjectModuleManifest => ({
  schema: manifest?.schema ?? "pulsar/project-modules/v1",
  modules: [
    ...(manifest?.modules ?? []),
    ...(autoActivateNext
      ? [
          {
            id: NEXTJS_PROJECT_MODULE_ID,
            kind: "builtin" as const,
            enabled: true,
          },
        ]
      : []),
  ],
})

const detectedFrameworkSummaries = (
  detectedNext: DetectedRuntimeFramework | undefined,
  explicitNextRef: ProjectModuleRef | undefined,
): ReadonlyArray<DetectedFramework> => {
  const summary = nextDetectedFrameworkSummary(detectedNext, explicitNextRef)
  return summary === undefined ? [] : [summary]
}

const nextDetectedFrameworkSummary = (
  detectedNext: DetectedRuntimeFramework | undefined,
  explicitNextRef: ProjectModuleRef | undefined,
): DetectedFramework | undefined => {
  if (explicitNextRef !== undefined) {
    return {
      id: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
      name: detectedNext?.name ?? "Next App Router",
      confidence: detectedNext?.confidence ?? "high",
      activation: explicitNextRef.enabled ? "explicit-active" : "explicit-inactive",
      evidence: [
        ...manifestRefEvidence(explicitNextRef),
        ...(detectedNext?.evidence ?? []),
      ],
    }
  }

  if (detectedNext === undefined) return undefined
  return {
    id: detectedNext.id,
    name: detectedNext.name,
    confidence: detectedNext.confidence,
    activation: detectedNext.confidence === "high" ? "auto-active" : "detected-inactive",
    evidence: detectedNext.evidence,
  }
}

const manifestRefEvidence = (
  ref: ProjectModuleRef,
): ReadonlyArray<CalibrationEvidenceRef> => [
  {
    kind: "manifest",
    value: PROJECT_MODULE_MANIFEST_SOURCE_REF,
    metadata: {
      moduleId: ref.id,
      kind: ref.kind,
      enabled: ref.enabled,
    },
  },
]
