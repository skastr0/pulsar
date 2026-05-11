import { overriddenFactorValue } from "@skastr0/pulsar-core/factors"
import type { SignalFactorDefinition, SignalFactorValue } from "@skastr0/pulsar-core/signal"

export type StubKind = "throw-not-implemented" | "empty-body" | "todo-comment" | "mock-return"
export type StubConfidence = "high" | "medium" | "low"
export type StubSeverity = "info" | "warn" | "block"

export const STUB_KIND_FACTOR_PREFIX = "stub_kinds" as const

export const stubKindFactorPath = (kind: StubKind, factor: string): string =>
  `${STUB_KIND_FACTOR_PREFIX}.${kind}.${factor}`

const stubKindFactorDefinitions = (
  kind: StubKind,
): ReadonlyArray<SignalFactorDefinition> => {
  const scoreCap = scoreCapForStubKind(kind)
  return [
    {
      path: stubKindFactorPath(kind, "confidence"),
      title: `${kind} confidence`,
      valueKind: "string",
      scoreRole: "confidence",
      defaultValue: confidenceForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "penalty_weight"),
      title: `${kind} penalty weight`,
      valueKind: "number",
      scoreRole: "penalty",
      defaultValue: penaltyWeightForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "score_cap_participation"),
      title: `${kind} score cap participation`,
      valueKind: "boolean",
      scoreRole: "score-cap",
      defaultValue: scoreCapParticipationForStubKind(kind),
    },
    {
      path: stubKindFactorPath(kind, "score_cap"),
      title: `${kind} score cap`,
      valueKind: "number",
      scoreRole: "score-cap",
      ...(scoreCap !== undefined ? { defaultValue: scoreCap } : {}),
    },
  ]
}

export const TsSl04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  ...stubKindFactorDefinitions("throw-not-implemented"),
  ...stubKindFactorDefinitions("empty-body"),
  ...stubKindFactorDefinitions("todo-comment"),
  ...stubKindFactorDefinitions("mock-return"),
  {
    path: "budget.expected_clean_function_ratio",
    title: "Expected clean function ratio",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: 0.01,
  },
  {
    path: "budget.expected_clean_min_functions",
    title: "Expected clean minimum functions",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: 10,
  },
  {
    path: "filtering.include_test_stubs",
    title: "Include test stubs",
    valueKind: "boolean",
    scoreRole: "metadata",
  },
  {
    path: "filtering.production_only_score",
    title: "Production-only score pressure",
    valueKind: "boolean",
    scoreRole: "metadata",
    defaultValue: true,
  },
]

export const STUB_KINDS = new Set<StubKind>([
  "throw-not-implemented",
  "empty-body",
  "todo-comment",
  "mock-return",
])

export const factorDefinitionByPath = (path: string): SignalFactorDefinition => {
  const definition = TsSl04FactorDefinitions.find((item) => item.path === path)
  if (definition === undefined) {
    throw new Error(`Unknown TS-SL-04 factor path: ${path}`)
  }
  return definition
}

export function confidenceForStubKind(kind: StubKind): StubConfidence {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return "high"
  if (kind === "mock-return") return "medium"
  return "low"
}

export const toStubConfidence = (value: string): StubConfidence =>
  value === "high" || value === "medium" || value === "low" ? value : "medium"

export const toStubKind = (value: string): StubKind =>
  value === "throw-not-implemented" ||
  value === "empty-body" ||
  value === "todo-comment" ||
  value === "mock-return"
    ? value
    : "empty-body"

export function penaltyWeightForStubKind(kind: StubKind): number {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return 1
  if (kind === "mock-return") return 0.6
  return 0.25
}

export function scoreCapParticipationForStubKind(kind: StubKind): boolean {
  return kind === "throw-not-implemented" || kind === "todo-comment"
}

export function scoreCapForStubKind(kind: StubKind): number | undefined {
  return scoreCapParticipationForStubKind(kind) ? 0.8 : undefined
}

export const severityForStub = (
  inTestPath: boolean,
  confidence: StubConfidence,
  hardGateProduction: boolean,
): StubSeverity =>
  hardGateProduction && !inTestPath && confidence === "high"
    ? "block"
    : !inTestPath
      ? "warn"
      : "info"

export const stubKindFromMetadata = (value: unknown): StubKind | undefined =>
  typeof value === "string" && STUB_KINDS.has(value as StubKind)
    ? (value as StubKind)
    : undefined

export const numberFactorValue = (
  path: string,
  defaultValue: number | undefined,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): number | undefined => {
  const value = overriddenFactorValue(path, defaultValue ?? null, overrides)
  return typeof value === "number" ? value : defaultValue
}

export const stringFactorValue = (
  path: string,
  defaultValue: string,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): string => {
  const value = overriddenFactorValue(path, defaultValue, overrides)
  return typeof value === "string" ? value : defaultValue
}

export const booleanFactorValue = (
  path: string,
  defaultValue: boolean,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): boolean => {
  const value = overriddenFactorValue(path, defaultValue, overrides)
  return typeof value === "boolean" ? value : defaultValue
}
