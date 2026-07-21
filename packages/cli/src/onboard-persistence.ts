import { existsSync } from "node:fs"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import {
  computeObserverConfigHash,
  createBaseline,
  type Baseline,
} from "@skastr0/pulsar-core/scoring"
import {
  decodePulsarVector,
  type PulsarVector,
  type SignalOverride,
} from "@skastr0/pulsar-core/vector"
import {
  decodeProjectModuleManifest,
  type ProjectModuleManifest,
} from "@skastr0/pulsar-project-module-sdk"
import { Effect, Schema } from "effect"
import { loadProjectModuleCalibrationContext } from "./runtime-calibration.js"
import { buildPulsarRegistry, observeWorktree } from "./runtime.js"
import { discoverPulsarVector } from "./vector-discovery.js"

export type OnboardJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<OnboardJsonValue>
  | { readonly [key: string]: OnboardJsonValue }

export type OnboardCalibrationAction =
  | { readonly kind: "keep-default" }
  | { readonly kind: "vector-config"; readonly key: string; readonly value: OnboardJsonValue }
  | { readonly kind: "vector-weight"; readonly value: number }
  | { readonly kind: "vector-active"; readonly value: boolean }
  | { readonly kind: "baseline-accept" }
  | { readonly kind: "enable-pack"; readonly packId: string }
  | { readonly kind: "unsupported"; readonly reason: string }

export interface OnboardCalibrationChoice {
  readonly signalId: string
  readonly optionIndex: number
  readonly action: OnboardCalibrationAction
}

export type OnboardBaselineDecision = "accept" | "reject" | "not-provided"

export interface OnboardPlan {
  readonly choices: ReadonlyArray<OnboardCalibrationChoice>
  readonly enabledPacks: ReadonlyArray<string>
  readonly baseline: OnboardBaselineDecision
  readonly seed: Record<string, string>
}

export interface OnboardHeadlessAnswers {
  readonly choices?: ReadonlyArray<OnboardCalibrationChoice>
  readonly enabledPacks?: ReadonlyArray<string>
  readonly baseline?: OnboardBaselineDecision
  readonly seed?: Record<string, string>
}

type OnboardCalibrationKind =
  | "vector-weight"
  | "vector-config"
  | "vector-active"
  | "conventions"
  | "project-module"
  | "pack-toggle"
  | "baseline-accept"
  | "keep-default"

export interface OnboardCatalogEntry {
  readonly id: string
  readonly title: string
  readonly options: ReadonlyArray<{
    readonly label: string
    readonly summary: string
    readonly calibrationKind: OnboardCalibrationKind
    readonly calibrationTarget: string
    readonly framing: "sharpen" | "accept" | "keep"
  }>
  readonly packGate?: string
}

export interface OnboardCalibrationReceipt {
  readonly signalId: string
  readonly optionIndex: number
  readonly action: OnboardCalibrationAction
  readonly status: "applied" | "kept" | "unapplied"
  readonly detail: string
}

export interface OnboardSignalScan {
  readonly id: string
  readonly score: number
  readonly findingCount: number
  readonly findings: ReadonlyArray<{
    readonly file: string
    readonly line?: number
    readonly detail: string
  }>
  readonly category?: string
  readonly title?: string
}

export interface OnboardScanResult {
  readonly band: "green" | "yellow" | "red" | "unknown"
  readonly score: number
  readonly driver: string
  readonly topPressures: ReadonlyArray<{
    readonly id: string
    readonly score: number
    readonly category: string
  }>
  readonly signals: ReadonlyArray<OnboardSignalScan>
}

export interface CompiledOnboardPlan {
  readonly vector: PulsarVector
  readonly projectModules?: ProjectModuleManifest
  readonly receipts: ReadonlyArray<OnboardCalibrationReceipt>
}

export interface OnboardPreview {
  readonly before: OnboardScanResult
  readonly after: OnboardScanResult
  readonly receipts: ReadonlyArray<OnboardCalibrationReceipt>
}

export interface OnboardWriteResult {
  readonly written: ReadonlyArray<string>
  readonly receipts: ReadonlyArray<OnboardCalibrationReceipt>
  readonly baseline: OnboardBaselineDecision
}

interface WriteOptions {
  readonly createdAt?: string
}

const PACK_MODULES = {
  nextjs: { id: "@skastr0/pulsar-project-module-nextjs", kind: "builtin" as const },
  effect: { id: "@skastr0/pulsar-project-module-effect", kind: "builtin" as const },
  convex: { id: "@skastr0/pulsar-project-module-convex", kind: "builtin" as const },
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isJsonValue = (value: unknown): value is OnboardJsonValue => {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

const parseAction = (value: unknown, index: number): OnboardCalibrationAction => {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error(`answers.choices[${index}].action must be a tagged action object`)
  }
  switch (value.kind) {
    case "keep-default":
    case "baseline-accept":
      return { kind: value.kind }
    case "vector-config":
      if (typeof value.key !== "string" || value.key.length === 0 || !isJsonValue(value.value)) {
        throw new Error(`answers.choices[${index}].action requires a config key and finite JSON value`)
      }
      return { kind: "vector-config", key: value.key, value: value.value }
    case "vector-weight":
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        throw new Error(`answers.choices[${index}].action requires a finite numeric weight`)
      }
      return { kind: "vector-weight", value: value.value }
    case "vector-active":
      if (typeof value.value !== "boolean") {
        throw new Error(`answers.choices[${index}].action requires a boolean active value`)
      }
      return { kind: "vector-active", value: value.value }
    case "enable-pack":
      if (typeof value.packId !== "string" || value.packId.length === 0) {
        throw new Error(`answers.choices[${index}].action requires a packId`)
      }
      return { kind: "enable-pack", packId: value.packId }
    case "unsupported":
      if (typeof value.reason !== "string" || value.reason.length === 0) {
        throw new Error(`answers.choices[${index}].action requires a reason`)
      }
      return { kind: "unsupported", reason: value.reason }
    default:
      throw new Error(`answers.choices[${index}].action has unknown kind ${value.kind}`)
  }
}

export const parseOnboardAnswers = (value: unknown): OnboardHeadlessAnswers => {
  if (!isRecord(value)) throw new Error("Onboarding answers must be a JSON object")
  const choicesValue = value.choices
  const choices =
    choicesValue === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(choicesValue)) throw new Error("answers.choices must be an array")
          return choicesValue.map((choice, index): OnboardCalibrationChoice => {
            if (
              !isRecord(choice) ||
              typeof choice.signalId !== "string" ||
              choice.signalId.length === 0 ||
              typeof choice.optionIndex !== "number" ||
              !Number.isInteger(choice.optionIndex) ||
              choice.optionIndex < 0
            ) {
              throw new Error(`answers.choices[${index}] must contain signalId and a non-negative integer optionIndex`)
            }
            return {
              signalId: choice.signalId,
              optionIndex: choice.optionIndex,
              action: parseAction(choice.action, index),
            }
          })
        })()
  const enabledPacks = value.enabledPacks
  if (enabledPacks !== undefined && (!Array.isArray(enabledPacks) || !enabledPacks.every((item) => typeof item === "string"))) {
    throw new Error("answers.enabledPacks must be an array of strings")
  }
  const baseline = value.baseline
  if (baseline !== undefined && baseline !== "accept" && baseline !== "reject" && baseline !== "not-provided") {
    throw new Error("answers.baseline must be accept, reject, or not-provided")
  }
  const seed = value.seed
  if (seed !== undefined && (!isRecord(seed) || !Object.values(seed).every((item) => typeof item === "string"))) {
    throw new Error("answers.seed must be an object of string values")
  }
  return {
    ...(choices === undefined ? {} : { choices }),
    ...(enabledPacks === undefined ? {} : { enabledPacks: enabledPacks as string[] }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(seed === undefined ? {} : { seed: seed as Record<string, string> }),
  }
}

const sortedRecord = <Value>(entries: ReadonlyArray<readonly [string, Value]>): Record<string, Value> =>
  Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)))

const catalogOptionForChoice = (
  choice: OnboardCalibrationChoice,
  catalog: ReadonlyArray<OnboardCatalogEntry>,
): OnboardCatalogEntry["options"][number] => {
  const entry = catalog.find((candidate) => candidate.id === choice.signalId)
  if (entry === undefined) {
    throw new Error(`Unknown exact catalog signal id: ${choice.signalId}`)
  }
  const option = entry.options[choice.optionIndex]
  if (option === undefined) {
    throw new Error(`Unknown option ${choice.optionIndex} for catalog signal ${choice.signalId}`)
  }
  const expected = expectedActionKind(entry, option.calibrationKind)
  if (choice.action.kind !== expected) {
    throw new Error(
      `Action ${choice.action.kind} does not match ${choice.signalId}[${choice.optionIndex}] (${option.calibrationKind})`,
    )
  }
  if (choice.action.kind === "enable-pack" && choice.action.packId !== entry.packGate) {
    throw new Error(`Pack ${choice.action.packId} does not match ${choice.signalId} packGate ${entry.packGate}`)
  }
  return option
}

const expectedActionKind = (
  entry: OnboardCatalogEntry,
  kind: OnboardCalibrationKind,
): OnboardCalibrationAction["kind"] => {
  switch (kind) {
    case "keep-default":
      return "keep-default"
    case "vector-config":
      return "vector-config"
    case "vector-weight":
      return "vector-weight"
    case "vector-active":
      return "vector-active"
    case "baseline-accept":
      return "baseline-accept"
    case "project-module":
    case "pack-toggle":
      return entry.packGate === undefined ? "unsupported" : "enable-pack"
    case "conventions":
      return "unsupported"
  }
}

const validateBaselineAuthority = (plan: OnboardPlan): void => {
  const hasBaselineAction = plan.choices.some((choice) => choice.action.kind === "baseline-accept")
  if (hasBaselineAction && plan.baseline !== "accept") {
    throw new Error("A baseline-accept action requires plan baseline=accept")
  }
}

const validateEnabledPacks = (plan: OnboardPlan): void => {
  const declared = [...new Set(plan.enabledPacks)].sort()
  const selected = [
    ...new Set(
      plan.choices.flatMap((choice) =>
        choice.action.kind === "enable-pack" ? [choice.action.packId] : [],
      ),
    ),
  ].sort()
  if (JSON.stringify(declared) !== JSON.stringify(selected)) {
    throw new Error("enabledPacks must exactly match explicit enable-pack actions")
  }
  for (const packId of declared) {
    if (!(packId in PACK_MODULES)) throw new Error(`Unknown onboarding pack: ${packId}`)
  }
}

export const compileOnboardPlan = async (
  repoPath: string,
  plan: OnboardPlan,
  catalog: ReadonlyArray<OnboardCatalogEntry>,
): Promise<CompiledOnboardPlan> => {
  validateBaselineAuthority(plan)
  validateEnabledPacks(plan)
  const registry = await Effect.runPromise(buildPulsarRegistry(repoPath))
  const overrides = new Map<string, SignalOverride>()
  const receipts: OnboardCalibrationReceipt[] = []
  const canonicalIds = new Set<string>()

  for (const choice of [...plan.choices].sort(
    (left, right) => left.signalId.localeCompare(right.signalId) || left.optionIndex - right.optionIndex,
  )) {
    catalogOptionForChoice(choice, catalog)
    const signal = registry.byId.get(choice.signalId)
    if (signal === undefined) {
      throw new Error(`Catalog signal ${choice.signalId} is not registered for this repository`)
    }
    if (canonicalIds.has(signal.id)) {
      throw new Error(`Duplicate onboarding choice for signal ${signal.id}`)
    }
    canonicalIds.add(signal.id)

    const action = choice.action
    switch (action.kind) {
      case "keep-default":
        receipts.push({ ...choice, status: "kept", detail: "Repository default kept; no override written" })
        break
      case "unsupported":
        receipts.push({ ...choice, status: "unapplied", detail: action.reason })
        break
      case "baseline-accept":
        receipts.push({ ...choice, status: "applied", detail: "Production baseline requested" })
        break
      case "enable-pack":
        receipts.push({ ...choice, status: "applied", detail: `Enabled project module pack ${action.packId}` })
        break
      case "vector-weight":
        setOverride(overrides, choice.signalId, { weight: action.value })
        receipts.push({ ...choice, status: "applied", detail: `Set weight to ${action.value}` })
        break
      case "vector-active":
        setOverride(overrides, choice.signalId, { active: action.value })
        receipts.push({ ...choice, status: "applied", detail: `Set active to ${action.value}` })
        break
      case "vector-config": {
        const defaults = signal.defaultConfig
        if (
          defaults === null ||
          typeof defaults !== "object" ||
          Array.isArray(defaults) ||
          !Object.prototype.hasOwnProperty.call(defaults, action.key)
        ) {
          throw new Error(`${choice.signalId}.config.${action.key} is an unknown config key`)
        }
        const candidate = { ...(defaults as Record<string, unknown>), [action.key]: action.value }
        try {
          Schema.decodeUnknownSync(signal.configSchema)(candidate)
        } catch (cause) {
          throw new Error(`Invalid ${choice.signalId}.config.${action.key}: ${String(cause)}`)
        }
        setOverride(overrides, choice.signalId, { config: { [action.key]: action.value } })
        receipts.push({
          ...choice,
          status: "applied",
          detail: `Set config.${action.key} to ${JSON.stringify(action.value)}`,
        })
        break
      }
    }
  }

  const vector = await Effect.runPromise(
    decodePulsarVector({
      id: "repo",
      domain: plan.seed.shape ?? "app",
      description: "Calibrated via pulsar onboard",
      signal_overrides: sortedRecord([...overrides.entries()]),
    }).pipe(Effect.mapError((cause) => new Error(`Invalid onboarding vector: ${String(cause)}`))),
  )

  const projectModules =
    plan.enabledPacks.length === 0
      ? undefined
      : await Effect.runPromise(
          decodeProjectModuleManifest({
            schema: "pulsar/project-modules/v1",
            modules: [...new Set(plan.enabledPacks)].sort().map((packId) => ({
              ...PACK_MODULES[packId as keyof typeof PACK_MODULES],
              enabled: true,
            })),
          }).pipe(Effect.mapError((cause) => new Error(`Invalid project module manifest: ${String(cause)}`))),
        )

  return {
    vector,
    ...(projectModules === undefined ? {} : { projectModules }),
    receipts,
  }
}

const setOverride = (
  overrides: Map<string, SignalOverride>,
  signalId: string,
  patch: SignalOverride,
): void => {
  const current = overrides.get(signalId)
  overrides.set(signalId, {
    ...current,
    ...patch,
    ...(current?.config === undefined && patch.config === undefined
      ? {}
      : { config: { ...(current?.config ?? {}), ...(patch.config ?? {}) } }),
  })
}

export const previewOnboardPlan = async (
  repoPath: string,
  plan: OnboardPlan,
  catalog: ReadonlyArray<OnboardCatalogEntry>,
): Promise<OnboardPreview> => {
  const compiled = await compileOnboardPlan(repoPath, plan, catalog)
  const beforeRun = await observeCurrentOnboardWorktree(repoPath)
  const proposedCalibrationContext = await proposedCalibrationContextOf(repoPath, compiled)
  const afterRun = await Effect.runPromise(
    observeWorktree(repoPath, compiled.vector, {
      ...(proposedCalibrationContext === undefined ? {} : { calibrationContext: proposedCalibrationContext }),
    }),
  )
  return {
    before: scanResultOf(beforeRun),
    after: scanResultOf(afterRun),
    receipts: compiled.receipts,
  }
}

const observeCurrentOnboardWorktree = async (repoPath: string): Promise<Observation> => {
  const registry = await Effect.runPromise(buildPulsarRegistry(repoPath))
  const selection = await Effect.runPromise(discoverPulsarVector({ repoPath, registry }))
  return Effect.runPromise(observeWorktree(repoPath, selection.vector))
}

export const scanCurrentOnboardRepo = async (repoPath: string): Promise<OnboardScanResult> =>
  scanResultOf(await observeCurrentOnboardWorktree(repoPath))

type Observation = Effect.Effect.Success<ReturnType<typeof observeWorktree>>

export const scanResultOf = (run: Observation): OnboardScanResult => {
  const output = run.result
  const readiness = output.readiness
  const band = readiness?.band ?? "unknown"
  const score = typeof readiness?.score === "number" ? readiness.score : output.weighted_mean
  const driverId = readiness?.top_pressures[0]?.signal_id ?? output.hard_gate_violations[0]?.signalId ?? "—"
  const driverTitle = run.registry.byId.get(driverId)?.title
  const signals: OnboardSignalScan[] = []
  for (const [id, result] of output.signalResults) {
    const metadata = run.registry.byId.get(id)
    signals.push({
      id,
      score: result.score,
      findingCount: result.diagnostics.length,
      findings: result.diagnostics.slice(0, 8).map((diagnostic) => ({
        file: diagnostic.location?.file ?? "—",
        ...(diagnostic.location?.line === undefined ? {} : { line: diagnostic.location.line }),
        detail: diagnostic.message,
      })),
      ...(metadata?.category === undefined ? {} : { category: metadata.category }),
      ...(metadata?.title === undefined ? {} : { title: metadata.title }),
    })
  }
  signals.sort((left, right) => left.id.localeCompare(right.id))
  return {
    band,
    score,
    driver: driverTitle === undefined ? driverId : `${driverId} · ${driverTitle}`,
    topPressures: readiness?.top_pressures.map((pressure) => ({
      id: pressure.signal_id,
      score: pressure.score,
      category: pressure.category,
    })) ?? [],
    signals,
  }
}

export const writeOnboardPlan = async (
  repoPath: string,
  plan: OnboardPlan,
  catalog: ReadonlyArray<OnboardCatalogEntry>,
  options: WriteOptions = {},
): Promise<OnboardWriteResult> => {
  const compiled = await compileOnboardPlan(repoPath, plan, catalog)
  const target = resolveWriteTarget(repoPath, compiled.projectModules !== undefined, plan.baseline === "accept")
  const baseline =
    plan.baseline === "accept"
      ? await createOnboardBaseline(repoPath, compiled, target.preview, options.createdAt)
      : undefined
  const artifacts = [
    { path: target.vectorPath, contents: jsonFile(compiled.vector) },
    ...(compiled.projectModules === undefined
      ? []
      : [{ path: target.modulesPath, contents: jsonFile(compiled.projectModules) }]),
    ...(baseline === undefined ? [] : [{ path: target.baselinePath, contents: jsonFile(baseline) }]),
  ]
  await writeArtifactsAtomically(artifacts)
  return {
    written: artifacts.map((artifact) => artifact.path),
    receipts: compiled.receipts,
    baseline: plan.baseline,
  }
}

const createOnboardBaseline = async (
  repoPath: string,
  compiled: CompiledOnboardPlan,
  preview: boolean,
  createdAt: string | undefined,
): Promise<Baseline> => {
  const proposedCalibrationContext = await proposedCalibrationContextOf(repoPath, compiled)
  const run = await Effect.runPromise(
    observeWorktree(repoPath, compiled.vector, {
      ...(proposedCalibrationContext === undefined ? {} : { calibrationContext: proposedCalibrationContext }),
    }),
  )
  return createBaseline({
    baselineSha: run.gitSha,
    ...(createdAt === undefined ? {} : { createdAt }),
    vectorId: compiled.vector.id,
    vectorSource: preview ? ".pulsar/onboard-preview/vector.json" : ".pulsar/vector.json",
    vectorTrustBoundary: preview ? "explicit-path" : "repo-local",
    observerConfigHash: computeObserverConfigHash(
      run.registry,
      compiled.vector,
      run.calibrationContext?.fingerprint,
    ),
    canonicalSignalId: run.registry.canonicalIdOf,
    violations: run.result.hard_gate_violations,
  })
}

const proposedCalibrationContextOf = async (
  repoPath: string,
  compiled: CompiledOnboardPlan,
) =>
  compiled.projectModules === undefined
    ? undefined
    : Effect.runPromise(
        loadProjectModuleCalibrationContext(repoPath, { manifest: compiled.projectModules }),
      )

const resolveWriteTarget = (
  repoPath: string,
  hasModules: boolean,
  hasBaseline: boolean,
): {
  readonly preview: boolean
  readonly vectorPath: string
  readonly modulesPath: string
  readonly baselinePath: string
} => {
  const pulsarDir = join(repoPath, ".pulsar")
  const primaryVector = join(pulsarDir, "vector.json")
  const primaryModules = join(pulsarDir, "project-modules.json")
  const primaryBaseline = join(repoPath, "pulsar-baseline.json")
  const preview =
    existsSync(primaryVector) || existsSync(primaryModules) || existsSync(primaryBaseline)
  const configDir = preview ? join(pulsarDir, "onboard-preview") : pulsarDir
  const target = {
    preview,
    vectorPath: join(configDir, "vector.json"),
    modulesPath: join(configDir, "project-modules.json"),
    baselinePath: preview ? join(configDir, "pulsar-baseline.json") : primaryBaseline,
  }
  for (const path of [target.vectorPath, ...(hasModules ? [target.modulesPath] : []), ...(hasBaseline ? [target.baselinePath] : [])]) {
    if (existsSync(path)) {
      throw new Error(`Onboarding refuses to overwrite existing artifact ${relative(repoPath, path)}`)
    }
  }
  return target
}

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const writeArtifactsAtomically = async (
  artifacts: ReadonlyArray<{ readonly path: string; readonly contents: string }>,
): Promise<void> => {
  const nonce = `${process.pid}-${Date.now()}`
  const staged = artifacts.map((artifact, index) => ({
    ...artifact,
    temporaryPath: `${artifact.path}.onboard-${nonce}-${index}.tmp`,
  }))
  const committed: string[] = []
  try {
    for (const artifact of staged) {
      await mkdir(dirname(artifact.path), { recursive: true })
      await writeFile(artifact.temporaryPath, artifact.contents, { encoding: "utf8", flag: "wx" })
    }
    for (const artifact of staged) {
      await rename(artifact.temporaryPath, artifact.path)
      committed.push(artifact.path)
    }
  } catch (cause) {
    await Promise.allSettled([
      ...staged.map((artifact) => unlink(artifact.temporaryPath)),
      ...committed.map((path) => unlink(path)),
    ])
    throw cause
  }
}
