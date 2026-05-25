import { Schema } from "effect"
import { CATEGORIES, Category as CategorySchema } from "./category.js"
import { ProjectModuleScope } from "./calibration.js"
import { Diagnostic as DiagnosticSchema } from "./diagnostic.js"
import {
  emptyObserverCategoryOutput,
  OBSERVER_OUTPUT_SEMANTICS,
  type ObserverRuntimeOutput,
} from "./observer-model.js"

const ObserverCategorySnapshot = Schema.Struct({
  score: Schema.Number,
  signals: Schema.Record({ key: Schema.String, value: Schema.Number }),
  signalCount: Schema.optional(Schema.Number),
  applicableSignalCount: Schema.optional(Schema.Number),
  activeSignalIds: Schema.optional(Schema.Array(Schema.String)),
  aggregation: Schema.optional(
    Schema.Struct({
      strategy: Schema.Union(
        Schema.Literal("weighted-mean"),
        Schema.Literal("language-group-mean"),
      ),
      rawScore: Schema.Number,
      aggregateScore: Schema.Number,
      lowestSignalScore: Schema.Number,
      finalScore: Schema.Number,
      shapedByPressure: Schema.Boolean,
      pressure: Schema.Struct({
        strategy: Schema.Literal("pressure-pnorm-local-max"),
        p: Schema.Number,
        meanPressure: Schema.Number,
        pnormPressure: Schema.Number,
        maxLocalPressure: Schema.Number,
        localPressure: Schema.Number,
        finalPressure: Schema.Number,
      }),
      weightTotal: Schema.Number,
      weights: Schema.Record({ key: Schema.String, value: Schema.Number }),
    }),
  ),
  normalization: Schema.optional(
    Schema.Struct({
      strategy: Schema.Literal("language-group-mean"),
      groups: Schema.Record({
        key: Schema.String,
        value: Schema.Struct({
          score: Schema.Number,
          signals: Schema.Array(Schema.String),
          signalCount: Schema.Number,
        }),
      }),
    }),
  ),
})

const legacyCategoryIds = CATEGORIES.filter(
  (category) =>
    category !== "security-risk" &&
    category !== "concurrency-safety" &&
    category !== "behavior-preservation",
)
const trustCategoryIds = CATEGORIES.filter(
  (category) =>
    category === "security-risk" ||
    category === "concurrency-safety" ||
    category === "behavior-preservation",
)

const ObserverCategories = Schema.Struct({
  ...Object.fromEntries(
    legacyCategoryIds.map((category) => [category, ObserverCategorySnapshot]),
  ),
  ...Object.fromEntries(
    trustCategoryIds.map((category) => [
      category,
      Schema.optionalWith(ObserverCategorySnapshot, {
        default: () => emptyObserverCategoryOutput(),
      }),
    ]),
  ),
})

export const OBSERVER_CATEGORY_IDS = CATEGORIES

const MinimumDimensionSnapshot = Schema.Struct({
  signal: Schema.String,
  category: CategorySchema,
  score: Schema.Number,
  detail: Schema.String,
})

const HardGateViolationSnapshot = Schema.Struct({
  signalId: Schema.String,
  category: CategorySchema,
  diagnostic: DiagnosticSchema,
})

const ReadinessPressureSnapshot = Schema.Struct({
  signal_id: Schema.String,
  category: CategorySchema,
  score: Schema.Number,
  raw_pressure: Schema.Number,
  effective_pressure: Schema.Number,
  weight: Schema.Number,
  confidence: Schema.Number,
  applicability: Schema.Union(
    Schema.Literal("applicable"),
    Schema.Literal("not_applicable"),
    Schema.Literal("insufficient_evidence"),
    Schema.Literal("failed"),
  ),
})

const ReadinessSnapshot = Schema.Struct({
  score: Schema.Number,
  pressure: Schema.Number,
  status: Schema.Union(
    Schema.Literal("green"),
    Schema.Literal("yellow"),
    Schema.Literal("red"),
    Schema.Literal("blocked"),
    Schema.Literal("unknown"),
    Schema.Literal("failed"),
  ),
  aggregation: Schema.Struct({
    strategy: Schema.Literal("pressure-pnorm-local-max"),
    p: Schema.Number,
    mean_pressure: Schema.Number,
    pnorm_pressure: Schema.Number,
    max_local_pressure: Schema.Number,
    failed_signal_pressure: Schema.optional(Schema.Number),
    hard_gate_pressure: Schema.Number,
    hard_gate_score_cap: Schema.Number,
    local_warning_threshold: Schema.Number,
    local_poison_threshold: Schema.Number,
    local_warning_gain: Schema.Number,
    applicable_signal_count: Schema.Number,
    ignored_signal_count: Schema.Number,
    failed_signal_count: Schema.optional(Schema.Number),
  }),
  top_pressures: Schema.Array(ReadinessPressureSnapshot),
})

const ObserverSignalMetadataSnapshot = Schema.Struct({
  effectiveConfidence: Schema.optional(Schema.Number),
  baseConfidence: Schema.optional(Schema.Number),
  computedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  factSource: Schema.optional(
    Schema.Union(
      Schema.Literal("deterministic"),
      Schema.Literal("ai_classified"),
    ),
  ),
  applicability: Schema.optional(
    Schema.Union(
      Schema.Literal("applicable"),
      Schema.Literal("not_applicable"),
      Schema.Literal("insufficient_evidence"),
      Schema.Literal("failed"),
    ),
  ),
})

const ObserverRuntimeProfileSnapshot = Schema.Struct({
  total_ms: Schema.Number,
  stages: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({
        duration_ms: Schema.Number,
      }),
    }),
  ),
  signals: Schema.Record({
    key: Schema.String,
    value: Schema.Struct({
      duration_ms: Schema.Number,
      score: Schema.Number,
      diagnostics: Schema.Number,
    }),
  }),
})

const ObserverCalibrationSnapshot = Schema.Struct({
  fingerprint: Schema.String,
  active_modules: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      version: Schema.String,
      scope: ProjectModuleScope,
      source: Schema.Literal("builtin", "package", "workspace", "repo-local"),
      source_ref: Schema.optional(Schema.String),
      source_fingerprint: Schema.optional(Schema.String),
      fingerprint: Schema.String,
    }),
  ),
})

const SignalFactorLedgerEntrySnapshot = Schema.Struct({
  path: Schema.String,
  value: Schema.Unknown,
  source: Schema.Literal("signal-default", "computed", "vector", "module"),
  affectsScore: Schema.Boolean,
  title: Schema.optional(Schema.String),
  scoreRole: Schema.optional(
    Schema.Literal(
      "evidence",
      "threshold",
      "penalty",
      "weight",
      "confidence",
      "score-cap",
      "metadata",
    ),
  ),
  attribution: Schema.optional(Schema.Unknown),
  mutations: Schema.optional(Schema.Array(Schema.Unknown)),
})

export type SignalFactorLedgerEntrySnapshotValue =
  typeof SignalFactorLedgerEntrySnapshot.Type

export const ObserverOutput = Schema.Struct({
  observer_semantics: Schema.optional(Schema.Literal(OBSERVER_OUTPUT_SEMANTICS)),
  categories: ObserverCategories,
  minimum: Schema.Union(MinimumDimensionSnapshot, Schema.Undefined),
  weighted_mean: Schema.Number,
  readiness: Schema.optional(ReadinessSnapshot),
  hard_gate_status: Schema.Literal("pass", "fail"),
  hard_gate_violations: Schema.Array(HardGateViolationSnapshot),
  signal_metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: ObserverSignalMetadataSnapshot }),
  ),
  runtime_profile: Schema.optional(ObserverRuntimeProfileSnapshot),
  calibration: Schema.optional(ObserverCalibrationSnapshot),
  signal_factors: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Array(SignalFactorLedgerEntrySnapshot) }),
  ),
})

export type ObserverOutputPublic = typeof ObserverOutput.Type

export type ObserverOutput = ObserverOutputPublic & ObserverRuntimeOutput
