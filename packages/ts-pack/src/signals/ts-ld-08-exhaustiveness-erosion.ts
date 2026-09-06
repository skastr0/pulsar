import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { textOf, walkDescendants } from "../ast.js"
import {
  isAsExpression,
  isCallExpression,
  isCaseClause,
  isDefaultClause,
  isNewExpression,
  isSatisfiesExpression,
  isSwitchStatement,
  isTypeAssertion,
  isVariableDeclaration,
  type CaseClause,
  type DefaultClause,
  type Node,
  type Project,
  type SourceFile,
  type SwitchStatement,
} from "../tsgo-api.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import { isExcluded } from "./shared-globs.js"
import type { Type } from "tsgo-typescript/unstable/async"

export const TsLd08Config = Schema.Struct({
  min_case_clauses: Schema.Number,
  top_n_diagnostics: Schema.Number,
  exclude_globs: Schema.Array(Schema.String),
})
export type TsLd08Config = typeof TsLd08Config.Type

export interface ExhaustivenessErosionFinding {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly expression: string
  readonly typeText: string
  readonly caseCount: number
  readonly variantCount: number
  readonly handledVariantCount: number
  readonly unhandledVariantCount: number
  readonly defaultText: string
}

export interface TsLd08Output {
  readonly findings: ReadonlyArray<ExhaustivenessErosionFinding>
  readonly analyzedSwitches: number
  readonly analyzedFiniteSwitches: number
  readonly findingCount: number
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsLd08: Signal<TsLd08Config, TsLd08Output, TsAnalysisTag> = {
  id: "TS-LD-08-exhaustiveness-erosion",
  title: "Exhaustiveness erosion",
  aliases: ["TS-LD-08"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  evidenceClass: "deterministic-ast",
  cacheVersion: "switch-default-v4-finite-domain-never-guard-exclusions-v1",
  configSchema: TsLd08Config,
  defaultConfig: {
    min_case_clauses: 2,
    top_n_diagnostics: 10,
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.pi/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const files = yield* analysis.mapFiles(async (fileContext) => fileContext).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-LD-08-exhaustiveness-erosion",
            message: cause.message,
            cause,
          }),
        ),
      )
      return yield* Effect.tryPromise({
        try: () => computeExhaustivenessErosion(files, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-08-exhaustiveness-erosion",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => out.findingCount === 0 ? 1 : 1 / (1 + out.findingCount / 10),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.topDiagnostics).map((finding) => ({
      severity: "warn",
      message:
        `Switch on \`${finding.expression}\` (${finding.typeText}) has a catch-all default ` +
        `after ${finding.caseCount} explicit cases; ${finding.unhandledVariantCount} ` +
        `finite variant(s) are currently unhandled and future variants can be hidden`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: { ...finding },
    })),
  outputMetadata: (out) =>
    out.analyzedFiniteSwitches === 0 ? { applicability: "not_applicable" as const } : undefined,
}

interface ExhaustivenessScanResult {
  readonly findings: ReadonlyArray<ExhaustivenessErosionFinding>
  readonly analyzedSwitches: number
  readonly analyzedFiniteSwitches: number
}

const computeExhaustivenessErosion = async (
  files: ReadonlyArray<{ readonly sourceFile: SourceFile; readonly project: Project }>,
  config: TsLd08Config,
): Promise<TsLd08Output> => {
  const scans: Array<ExhaustivenessScanResult> = []
  for (const file of files) {
    if (isExcluded(file.sourceFile.fileName, config.exclude_globs)) continue
    scans.push(await scanSourceFile(file.sourceFile, file.project, config))
  }
  const scan = scans.reduce(mergeScanResults, emptyScanResult())
  const findings = [...scan.findings].sort(compareFindings)

  return {
    findings,
    analyzedSwitches: scan.analyzedSwitches,
    analyzedFiniteSwitches: scan.analyzedFiniteSwitches,
    findingCount: findings.length,
    topDiagnostics: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: [
      "contract safety gap",
      "boundary trust breach",
    ],
    cacheContributors: [
      "source tree",
      "config.min_case_clauses",
      "config.exclude_globs",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.min_case_clauses and config.exclude_globs",
    enforcementCeiling: ["soft-warning", "trend"],
  }
}

const scanSourceFile = async (
  sourceFile: SourceFile,
  project: Project,
  config: TsLd08Config,
): Promise<ExhaustivenessScanResult> => {
  const findings: Array<ExhaustivenessErosionFinding> = []
  let analyzedFiniteSwitches = 0
  const switches: Array<SwitchStatement> = []
  walkDescendants(sourceFile, (node) => {
    if (isSwitchStatement(node)) switches.push(node)
  })

  for (const statement of switches) {
    const { finding, finite } = await findingFromSwitch(sourceFile, project, statement, config)
    if (finite) analyzedFiniteSwitches += 1
    if (finding !== undefined) findings.push(finding)
  }

  return {
    findings,
    analyzedSwitches: switches.length,
    analyzedFiniteSwitches,
  }
}

const findingFromSwitch = async (
  sourceFile: SourceFile,
  project: Project,
  statement: SwitchStatement,
  config: TsLd08Config,
): Promise<{ readonly finding?: ExhaustivenessErosionFinding; readonly finite: boolean }> => {
  const domain = await finiteSwitchDomain(project, statement.expression)
  if (domain === undefined) return { finite: false }

  const clauses = [...statement.caseBlock.clauses]
  const caseClauses = clauses.filter(isCaseClause)
  const defaultClause = clauses.find(isDefaultClause)
  if (
    defaultClause === undefined ||
    caseClauses.length < config.min_case_clauses ||
    await isExhaustivenessGuardDefault(project, defaultClause)
  ) {
    return { finite: true }
  }

  return {
    finite: true,
    finding: await switchFinding(sourceFile, project, statement, caseClauses, defaultClause, domain),
  }
}

const switchFinding = async (
  sourceFile: SourceFile,
  project: Project,
  statement: SwitchStatement,
  caseClauses: ReadonlyArray<CaseClause>,
  defaultClause: DefaultClause,
  domain: FiniteSwitchDomain,
): Promise<ExhaustivenessErosionFinding> => {
  const handledVariantCount = (await handledVariantKeys(project, caseClauses, domain.variantKeys)).size
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
  return {
    file: sourceFile.fileName,
    line: line + 1,
    column: character + 1,
    expression: textOf(statement.expression),
    typeText: domain.typeText,
    caseCount: caseClauses.length,
    variantCount: domain.variantKeys.size,
    handledVariantCount,
    unhandledVariantCount: Math.max(0, domain.variantKeys.size - handledVariantCount),
    defaultText: textOf(defaultClause).slice(0, 160),
  }
}

const emptyScanResult = (): ExhaustivenessScanResult => ({
  findings: [],
  analyzedSwitches: 0,
  analyzedFiniteSwitches: 0,
})

const mergeScanResults = (
  left: ExhaustivenessScanResult,
  right: ExhaustivenessScanResult,
): ExhaustivenessScanResult => ({
  findings: [...left.findings, ...right.findings],
  analyzedSwitches: left.analyzedSwitches + right.analyzedSwitches,
  analyzedFiniteSwitches: left.analyzedFiniteSwitches + right.analyzedFiniteSwitches,
})

const compareFindings = (
  left: ExhaustivenessErosionFinding,
  right: ExhaustivenessErosionFinding,
): number =>
  right.caseCount - left.caseCount ||
  right.unhandledVariantCount - left.unhandledVariantCount ||
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column

interface FiniteSwitchDomain {
  readonly typeText: string
  readonly variantKeys: ReadonlySet<string>
}

const finiteSwitchDomain = async (
  project: Project,
  expression: Node,
): Promise<FiniteSwitchDomain | undefined> => {
  const type = await project.checker.getTypeAtLocation(expression)
  const variants = await finiteVariantKeys(type)
  if (variants.length === 0 || variants.every((variant) => variant.startsWith("boolean:"))) {
    return undefined
  }
  return {
    typeText: await project.checker.typeToString(type, expression),
    variantKeys: new Set(variants),
  }
}

const finiteVariantKeys = async (type: Type): Promise<ReadonlyArray<string>> => {
  if (type.isUnionType()) {
    const variants = (await type.getTypes()).map(literalVariantKey)
    if (!variants.every((variant): variant is string => variant !== undefined)) return []
    return [...new Set(variants)]
  }
  const key = literalVariantKey(type)
  return key === undefined ? [] : [key]
}

const literalVariantKey = (type: Type): string | undefined => {
  if (type.isStringLiteralType()) return `string:${String(type.value)}`
  if (type.isNumberLiteralType()) return `number:${String(type.value)}`
  if (type.isBooleanLiteralType()) return `boolean:${String(type.value)}`
  if (type.isBigIntLiteralType()) return `bigint:${String(type.value)}`
  const text = intrinsicName(type)
  if (text === "null") return "null:null"
  if (text === "undefined") return "undefined:undefined"
  return undefined
}

const intrinsicName = (type: Type): string | undefined => {
  if (!type.isIntrinsicType()) return undefined
  return (type as { readonly intrinsicName?: string }).intrinsicName
}

const handledVariantKeys = async (
  project: Project,
  caseClauses: ReadonlyArray<CaseClause>,
  variantKeys: ReadonlySet<string>,
): Promise<ReadonlySet<string>> => {
  const handled = new Set<string>()
  for (const clause of caseClauses) {
    const type = await project.checker.getTypeAtLocation(clause.expression)
    for (const key of await finiteVariantKeys(type)) {
      if (variantKeys.has(key)) handled.add(key)
    }
  }
  return handled
}

const isExhaustivenessGuardDefault = async (
  project: Project,
  defaultClause: DefaultClause,
): Promise<boolean> => {
  if (containsExplicitNeverCast(defaultClause)) return false
  const candidates: Array<Node> = []
  walkDescendants(defaultClause, (node) => {
    if (isSatisfiesNeverCheck(node) && isSatisfiesExpression(node)) {
      candidates.push(node.expression)
    }
    if (isNeverAssignment(node) && isVariableDeclaration(node) && node.initializer !== undefined) {
      candidates.push(node.initializer)
    }
    if (isCallExpression(node) || isNewExpression(node)) {
      if (node.arguments !== undefined) candidates.push(...node.arguments)
    }
  })
  for (const candidate of candidates) {
    const type = await project.checker.getTypeAtLocation(candidate)
    if (intrinsicName(type) === "never") return true
  }
  return false
}

const containsExplicitNeverCast = (node: Node): boolean => {
  let found = false
  walkDescendants(node, (descendant) => {
    if ((isAsExpression(descendant) || isTypeAssertion(descendant)) && isNeverTypeNode(descendant.type)) {
      found = true
    }
  })
  return found
}

const isSatisfiesNeverCheck = (node: Node): boolean =>
  isSatisfiesExpression(node) && isNeverTypeNode(node.type)

const isNeverAssignment = (node: Node): boolean =>
  isVariableDeclaration(node) && isNeverTypeNode(node.type)

const isNeverTypeNode = (node: Node | undefined): boolean =>
  node !== undefined && textOf(node).trim() === "never"

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
