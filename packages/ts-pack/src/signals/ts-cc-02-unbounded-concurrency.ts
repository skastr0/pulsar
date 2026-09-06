import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { hasModifier, textOf, walkDescendants } from "../ast.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import {
  SyntaxKind,
  isArrowFunction,
  isCallExpression,
  isPropertyAccessExpression,
  type CallExpression,
  type SourceFile,
} from "../tsgo-api.js"
import {
  inferConcurrencyBound,
  type ConcurrencyBoundInference,
  type ConcurrencyBoundReason,
} from "./ts-cc-02-concurrency-bounds.js"
import {
  compareDiagnosticOrderProperties,
  type DiagnosticOrderProperties,
} from "./shared-diagnostic-order.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  callName,
  isAnalyzableSourceFile,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsCc02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  limiter_name_patterns: Schema.Array(Schema.String),
})
export type TsCc02Config = typeof TsCc02Config.Type

export type UnboundedConcurrencyKind =
  | "promise-all-map"
  | "promise-all-settled-map"
  | "async-foreach"

export interface UnboundedConcurrencyFinding extends SourceLocation {
  readonly kind: UnboundedConcurrencyKind
  readonly expression: string
  readonly iterable: string
  readonly missingEvidence: string
  readonly boundExpression: string
  readonly resolvedUpperBound: null
  readonly inferenceStoppedReason: string
}

export interface BoundedConcurrencyFanout extends SourceLocation {
  readonly kind: UnboundedConcurrencyKind
  readonly expression: string
  readonly iterable: string
  readonly boundExpression: string
  readonly resolvedUpperBound: number
  readonly boundReason: ConcurrencyBoundReason
}

export interface TsCc02Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly fanoutsObserved: number
  readonly findings: ReadonlyArray<UnboundedConcurrencyFinding>
  readonly boundedFanouts: ReadonlyArray<BoundedConcurrencyFanout>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsCc02: Signal<TsCc02Config, TsCc02Output, TsAnalysisTag> = {
  id: "TS-CC-02-unbounded-concurrency",
  title: "Unbounded concurrency",
  aliases: ["TS-CC-02"],
  tier: 2,
  category: "concurrency-safety",
  kind: "structural",
  evidenceClass: "heuristic-pattern",
  knownFailureModes: [
    {
      description:
        "Imported, mutable, or runtime-computed concurrency bounds remain unresolved by design.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-cc-02.test.ts",
        testName: "keeps unknown collections, caps, and limiter sizes unbounded",
      },
    },
  ],
  cacheVersion: "unbounded-concurrency-v2-local-symbolic-bounds-v1",
  configSchema: TsCc02Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
    limiter_name_patterns: ["limit", "limiter", "pool", "queue", "pLimit", "concurrency"],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (context) => context.sourceFile)
      return yield* Effect.try({
        try: (): TsCc02Output => computeUnboundedConcurrency(sourceFiles, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-CC-02-unbounded-concurrency",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => out.state === "present" ? 1 / (1 + out.findings.length / 5) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message:
        `${finding.expression} fans out over ${finding.iterable}; upper bound unresolved: ` +
        finding.inferenceStoppedReason,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.expression}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "add-concurrency-limiter",
        title: "Bound the fanout",
        summary:
          "Use a limiter, pool, queue, or batched loop so the number of concurrent tasks is explicit.",
        confidence: "high",
        autoApplicable: false,
        data: { iterable: finding.iterable, kind: finding.kind },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computeUnboundedConcurrency = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsCc02Config,
): TsCc02Output => {
  const findings: Array<UnboundedConcurrencyFinding> = []
  const boundedFanouts: Array<BoundedConcurrencyFanout> = []
  let analyzedFiles = 0
  let fanoutsObserved = 0
  const limiterPattern = new RegExp(
    `(?:${config.limiter_name_patterns.map(escapeRegExp).join("|")})`,
    "i",
  )

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1
    const calls: Array<CallExpression> = []
    walkDescendants(sourceFile, (node) => {
      if (isCallExpression(node)) calls.push(node)
    })
    for (const call of calls) {
      const finding = classifyFanout(call, limiterPattern)
      if (finding === undefined) continue
      fanoutsObserved += 1
      if (finding.bound.state === "bounded") {
        boundedFanouts.push({
          ...finding.fanout,
          boundExpression: finding.bound.boundExpression,
          resolvedUpperBound: finding.bound.resolvedUpperBound,
          boundReason: finding.bound.boundReason,
        })
      } else {
        findings.push({
          ...finding.fanout,
          missingEvidence:
            "Expected a finite local collection, slice/window cap, or concurrency limiter bound",
          boundExpression: finding.bound.boundExpression,
          resolvedUpperBound: finding.bound.resolvedUpperBound,
          inferenceStoppedReason: finding.bound.inferenceStoppedReason,
        })
      }
    }
  }

  return {
    state: analyzedFiles === 0
      ? "not_applicable"
      : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    fanoutsObserved,
    findings: findings.sort(compareFindings),
    boundedFanouts: boundedFanouts.sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["concurrency review route", "agent trust readout"],
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.limiter_name_patterns",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.limiter_name_patterns and config.exclude_globs",
    enforcementCeiling: ["review-route"],
  }
}

const classifyFanout = (
  call: CallExpression,
  limiterPattern: RegExp,
): ClassifiedFanout | undefined => {
  const name = callName(call.expression)
  if (name === "Promise.all" || name === "Promise.allSettled") {
    const arg = call.arguments[0]
    if (arg === undefined || !isCallExpression(arg)) return undefined
    const innerExpression = arg.expression
    if (!isPropertyAccessExpression(innerExpression) || textOf(innerExpression.name) !== "map") {
      return undefined
    }
    const iterable = textOf(innerExpression.expression)
    const callback = arg.arguments[0]
    if (callback === undefined) return undefined
    return {
      bound: inferConcurrencyBound(innerExpression.expression, callback, limiterPattern),
      fanout: {
        ...locationOf(call),
        kind: name === "Promise.all" ? "promise-all-map" : "promise-all-settled-map",
        expression: name,
        iterable,
      },
    }
  }

  if (name.endsWith(".forEach")) {
    const callback = call.arguments[0]
    if (callback === undefined || !isArrowFunction(callback) || !hasModifier(callback, SyntaxKind.AsyncKeyword)) {
      return undefined
    }
    const property = call.expression
    const iterable = isPropertyAccessExpression(property)
      ? textOf(property.expression)
      : "iterable"
    return {
      bound: inferConcurrencyBound(
        isPropertyAccessExpression(property) ? property.expression : call,
        callback,
        limiterPattern,
      ),
      fanout: {
        ...locationOf(call),
        kind: "async-foreach",
        expression: name,
        iterable,
      },
    }
  }

  return undefined
}

interface ClassifiedFanout {
  readonly fanout: FanoutIdentity
  readonly bound: ConcurrencyBoundInference
}

interface FanoutIdentity extends SourceLocation {
  readonly kind: UnboundedConcurrencyKind
  readonly expression: string
  readonly iterable: string
}

const compareFindings = (
  left: FanoutIdentity,
  right: FanoutIdentity,
): number => compareDiagnosticOrderProperties(left, right, FANOUT_ORDER)

const FANOUT_ORDER = {
  file: "file",
  line: "line",
  kind: "kind",
  label: "iterable",
} satisfies DiagnosticOrderProperties<FanoutIdentity>

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
