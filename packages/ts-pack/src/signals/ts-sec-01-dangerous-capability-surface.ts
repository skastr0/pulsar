import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type SourceFile,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  callName,
  isAnalyzableSourceFile,
  isStringLiteralLike,
  locationOf,
  normalizeDiagnosticLimit,
  stringLiteralValue,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsSec01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  review_route_weight: Schema.Number,
})
export type TsSec01Config = typeof TsSec01Config.Type

export type DangerousCapabilityKind =
  | "eval"
  | "function-constructor"
  | "dynamic-import"
  | "shell-process"
  | "raw-sql"
  | "filesystem"
  | "network"
  | "crypto"

export interface DangerousCapabilityFinding extends SourceLocation {
  readonly kind: DangerousCapabilityKind
  readonly sink: string
  readonly evidence: string
  readonly reviewRoute: "security"
  readonly weight: number
}

export interface TsSec01Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly findings: ReadonlyArray<DangerousCapabilityFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsSec01: Signal<TsSec01Config, TsSec01Output, TsProjectTag> = {
  id: "TS-SEC-01-dangerous-capability-surface",
  title: "Dangerous capability surface",
  aliases: ["TS-SEC-01"],
  tier: 1,
  category: "security-risk",
  kind: "structural",
  cacheVersion: "dangerous-capability-surface-v2-inventory-neutral",
  configSchema: TsSec01Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
    review_route_weight: 0,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsSec01Output =>
          computeDangerousCapabilitySurface(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-SEC-01-dangerous-capability-surface",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.state !== "present") return 1
    const pressure = out.findings.reduce((sum, finding) => sum + finding.weight, 0)
    return 1 / (1 + pressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: finding.kind === "eval" || finding.kind === "function-constructor"
        ? "warn"
        : "info",
      message: `${finding.sink} exposes ${finding.kind} capability and should be reviewed as a security boundary`,
      location: {
        file: finding.file,
        line: finding.line,
        column: finding.column,
      },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.sink}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "security-review-route",
        title: "Constrain the capability boundary",
        summary:
          "Prefer a narrow wrapper, explicit allowlist, and validated inputs around this capability; remove it if it is not required.",
        confidence: "medium",
        autoApplicable: false,
        data: { kind: finding.kind, sink: finding.sink },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computeDangerousCapabilitySurface = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsSec01Config,
): TsSec01Output => {
  const findings: Array<DangerousCapabilityFinding> = []
  let analyzedFiles = 0

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1
    collectImportCapabilities(sourceFile, findings, normalizeReviewRouteWeight(config.review_route_weight))
    collectCallCapabilities(sourceFile, findings)
    collectSqlCapabilities(sourceFile, findings)
  }

  return {
    state: analyzedFiles === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    findings: findings.sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["security review route", "agent trust readout"],
    cacheContributors: ["source tree", "config.exclude_globs", "config.top_n_diagnostics"],
    calibrationSurface: "config.exclude_globs only; generic capability categories are non-taste defaults",
    enforcementCeiling: ["review-route"],
  }
}

const collectImportCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
  weight: number,
): void => {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue()
    const kind = moduleCapabilityKind(specifier)
    if (kind === undefined) continue
    findings.push({
      ...locationOf(declaration),
      kind,
      sink: specifier,
      evidence: declaration.getText().slice(0, 160),
      reviewRoute: "security",
      weight,
    })
  }
}

const collectCallCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
): void => {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression()
    const name = callName(expression)
    if (name === "eval") {
      findings.push(findingFromCall(call, "eval", name, 1))
      continue
    }
    if (name === "Function") {
      findings.push(findingFromCall(call, "function-constructor", name, 1))
      continue
    }
    if (expression.getKind() === SyntaxKind.ImportKeyword && !isStringLiteralLike(call.getArguments()[0])) {
      findings.push(findingFromCall(call, "dynamic-import", "import(non-literal)", 0))
      continue
    }
    const processCall = /^(?:child_process\.)?(exec|execFile|execSync|execFileSync|spawn|spawnSync|fork)$/.exec(name)
    if (processCall !== null) {
      findings.push(findingFromCall(call, "shell-process", name, processCallWeight(call, processCall[1] ?? name)))
    }
  }

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (callName(expression.getExpression()) === "Function") {
      findings.push({
        ...locationOf(expression),
        kind: "function-constructor",
        sink: "new Function",
        evidence: expression.getText().slice(0, 160),
        reviewRoute: "security",
        weight: 1,
      })
    }
  }
}

const collectSqlCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
): void => {
  for (const tag of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    const tagName = callName(tag.getTag())
    if (/(\bsql\b|raw|unsafe)/i.test(tagName)) {
      findings.push({
        ...locationOf(tag),
        kind: "raw-sql",
        sink: tagName,
        evidence: tag.getText().slice(0, 160),
        reviewRoute: "security",
        weight: 0.75,
      })
    }
  }

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = callName(call.getExpression())
    if (!/(^|\.)(query|execute|raw|unsafe|sql)$/i.test(name)) continue
    if (!call.getArguments().some((arg) => Node.isTemplateExpression(arg))) continue
    findings.push(findingFromCall(call, "raw-sql", name, 0.75))
  }
}

const findingFromCall = (
  call: CallExpression,
  kind: DangerousCapabilityKind,
  sink: string,
  weight: number,
): DangerousCapabilityFinding => ({
  ...locationOf(call),
  kind,
  sink,
  evidence: call.getText().slice(0, 160),
  reviewRoute: "security",
  weight,
})

const normalizeReviewRouteWeight = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const processCallWeight = (call: CallExpression, processName: string): number => {
  if (processName === "exec" || processName === "execSync") return 0.75
  if (hasShellTrueOption(call)) return 0.75

  const command = call.getArguments()[0]
  return stringLiteralValue(command) === undefined ? 0.75 : 0
}

const hasShellTrueOption = (call: CallExpression): boolean =>
  call.getArguments().some((argument) => {
    if (!Node.isObjectLiteralExpression(argument)) return false
    return argument.getProperties().some((property) => {
      if (!Node.isPropertyAssignment(property)) return false
      if (property.getName().replace(/^["']|["']$/g, "") !== "shell") return false
      return property.getInitializer()?.getKind() === SyntaxKind.TrueKeyword
    })
  })

const moduleCapabilityKind = (specifier: string): DangerousCapabilityKind | undefined => {
  const normalized = specifier.replace(/^node:/, "")
  if (normalized === "child_process") return "shell-process"
  if (normalized === "fs" || normalized === "fs/promises") return "filesystem"
  if (normalized === "net" || normalized === "tls" || normalized === "dgram" || normalized === "http" || normalized === "https") {
    return "network"
  }
  if (normalized === "crypto") return "crypto"
  return undefined
}

const compareFindings = (
  left: DangerousCapabilityFinding,
  right: DangerousCapabilityFinding,
): number =>
  right.weight - left.weight ||
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.sink.localeCompare(right.sink)
