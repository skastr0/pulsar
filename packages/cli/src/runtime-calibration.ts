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
  detectRuntimeFrameworks,
  SOLIDJS_START_FRAMEWORK_ID,
  type DetectedRuntimeFramework,
} from "./runtime-framework-detection.js"

const PROJECT_MODULE_MANIFEST_SOURCE_REF = ".pulsar/project-modules.json"

const builtinProjectModules = new Map([
  [NEXTJS_PROJECT_MODULE_ID, nextjsProjectModule],
])

interface RuntimeProjectModuleDetection {
  readonly manifest?: ProjectModuleManifest
  readonly effectiveManifest: ProjectModuleManifest
  readonly detectedFrameworks: ReadonlyArray<DetectedFramework>
  readonly frameworkDetectionConflict: boolean
  readonly shouldAutoActivateNext: boolean
}

export const loadProjectModuleCalibrationContext = (
  repoRoot: string,
  options?: { readonly dependencyRoot?: string },
): Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never> =>
  Effect.gen(function* () {
    const detection = yield* detectRuntimeProjectModules(repoRoot)
    if (hasNoProjectModuleCalibrationEvidence(detection)) {
      return undefined
    }

    const loadedModules = yield* loadEnabledProjectModules(detection.effectiveManifest, {
      repoRoot,
      ...(options?.dependencyRoot !== undefined ? { dependencyRoot: options.dependencyRoot } : {}),
      builtinModules: builtinProjectModules,
    })
    return makeResolvedCalibrationContext({
      repoFacts: projectModuleRepoFacts(repoRoot, detection, loadedModules.length),
      activeModules: loadedModules.map((module) => module.activeModule),
      processors: loadedModules.flatMap((module) => module.processors),
    })
  })

const detectRuntimeProjectModules = (
  repoRoot: string,
): Effect.Effect<RuntimeProjectModuleDetection, unknown, never> =>
  Effect.gen(function* () {
    const manifest = yield* loadOptionalProjectModuleManifest(repoRoot)
    const detectedFrameworks = yield* detectRuntimeFrameworks(repoRoot)
    const detectedNext = detectedFrameworks.find((framework) =>
      framework.id === NEXTJS_APP_ROUTER_FRAMEWORK_ID
    )
    const explicitNextRef = manifest?.modules.find((ref) =>
      ref.id === NEXTJS_PROJECT_MODULE_ID
    )
    const frameworkDetectionConflict = detectedFrameworks.length > 1
    const shouldAutoActivateNext =
      explicitNextRef === undefined &&
      !frameworkDetectionConflict &&
      detectedNext?.confidence === "high"
    const effectiveManifest = makeEffectiveProjectModuleManifest(
      manifest,
      shouldAutoActivateNext,
    )

    return {
      ...(manifest !== undefined ? { manifest } : {}),
      effectiveManifest,
      detectedFrameworks: detectedFrameworkSummaries(
        detectedFrameworks,
        explicitNextRef,
        shouldAutoActivateNext,
      ),
      frameworkDetectionConflict,
      shouldAutoActivateNext,
    }
  })

const hasNoProjectModuleCalibrationEvidence = (
  detection: RuntimeProjectModuleDetection,
): boolean =>
  detection.manifest === undefined &&
  detection.effectiveManifest.modules.length === 0 &&
  detection.detectedFrameworks.length === 0

const projectModuleRepoFacts = (
  repoRoot: string,
  detection: RuntimeProjectModuleDetection,
  activeModuleCount: number,
): RepoFacts => {
  const manifestFingerprint =
    detection.manifest === undefined
      ? undefined
      : fingerprintProjectModuleManifest(detection.manifest)
  const effectiveManifestFingerprint = fingerprintProjectModuleManifest(detection.effectiveManifest)

  return {
    repoRoot,
    fingerprint: `project-modules:${hashCalibrationValue({
      manifestFingerprint: manifestFingerprint ?? null,
      effectiveManifestFingerprint,
      detectedFrameworks: detection.detectedFrameworks,
    })}`,
    detectedTechnologies: detectedTechnologyIds(detection.detectedFrameworks),
    ...(detection.detectedFrameworks.length > 0
      ? { detectedFrameworks: detection.detectedFrameworks }
      : {}),
    sourceExtensions: [],
    metadata: projectModuleRepoFactsMetadata(
      detection,
      activeModuleCount,
      manifestFingerprint,
      effectiveManifestFingerprint,
    ),
  }
}

const detectedTechnologyIds = (
  detectedFrameworks: ReadonlyArray<DetectedFramework>,
): ReadonlyArray<string> => [
  ...(detectedFrameworks.some((framework) =>
    framework.id === NEXTJS_APP_ROUTER_FRAMEWORK_ID
  ) ? ["nextjs"] : []),
  ...(detectedFrameworks.some((framework) =>
    framework.id === SOLIDJS_START_FRAMEWORK_ID
  ) ? [SOLIDJS_START_FRAMEWORK_ID] : []),
]

const projectModuleRepoFactsMetadata = (
  detection: RuntimeProjectModuleDetection,
  activeModuleCount: number,
  manifestFingerprint: string | undefined,
  effectiveManifestFingerprint: string,
): NonNullable<RepoFacts["metadata"]> => ({
  ...(manifestFingerprint === undefined
    ? {}
    : {
        manifestPath: PROJECT_MODULE_MANIFEST_SOURCE_REF,
        manifestFingerprint,
      }),
  effectiveManifestFingerprint,
  declaredModuleCount: detection.manifest?.modules.length ?? 0,
  activeModuleCount,
  autoActivatedModuleCount: detection.shouldAutoActivateNext ? 1 : 0,
  ...(detection.frameworkDetectionConflict
    ? {
        frameworkDetectionConflict: true,
        frameworkDetectionConflictIds: detection.detectedFrameworks.map(
          (framework) => framework.id,
        ),
      }
    : {}),
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
  detectedFrameworks: ReadonlyArray<DetectedRuntimeFramework>,
  explicitNextRef: ProjectModuleRef | undefined,
  shouldAutoActivateNext: boolean,
): ReadonlyArray<DetectedFramework> => {
  const summaries = detectedFrameworks.map((framework): DetectedFramework => {
    if (framework.id === NEXTJS_APP_ROUTER_FRAMEWORK_ID) {
      return nextDetectedFrameworkSummary(
        framework,
        explicitNextRef,
        shouldAutoActivateNext,
      )
    }
    return detectedInactiveFrameworkSummary(framework)
  })

  if (
    explicitNextRef !== undefined &&
    !detectedFrameworks.some((framework) =>
      framework.id === NEXTJS_APP_ROUTER_FRAMEWORK_ID
    )
  ) {
    summaries.push(explicitNextFrameworkSummary(explicitNextRef))
  }

  return summaries.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  )
}

const nextDetectedFrameworkSummary = (
  detectedNext: DetectedRuntimeFramework,
  explicitNextRef: ProjectModuleRef | undefined,
  shouldAutoActivateNext: boolean,
): DetectedFramework => {
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

  return {
    id: detectedNext.id,
    name: detectedNext.name,
    confidence: detectedNext.confidence,
    activation: shouldAutoActivateNext ? "auto-active" : "detected-inactive",
    evidence: detectedNext.evidence,
  }
}

const explicitNextFrameworkSummary = (
  explicitNextRef: ProjectModuleRef,
): DetectedFramework => ({
  id: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
  name: "Next App Router",
  confidence: "high",
  activation: explicitNextRef.enabled ? "explicit-active" : "explicit-inactive",
  evidence: manifestRefEvidence(explicitNextRef),
})

const detectedInactiveFrameworkSummary = (
  detectedFramework: DetectedRuntimeFramework,
): DetectedFramework => ({
  id: detectedFramework.id,
  name: detectedFramework.name,
  confidence: detectedFramework.confidence,
  activation: "detected-inactive",
  evidence: detectedFramework.evidence,
})

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
