import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  Node,
  SyntaxKind,
  type CaseClause,
  type DefaultClause,
  type Expression,
  type Node as TsMorphNode,
  type Project,
  type SourceFile,
  type SwitchStatement,
  type Type,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"

const TsLd08Config = Schema.Struct({
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

export const TsLd08: Signal<TsLd08Config, TsLd08Output, TsProjectTag> = {
  id: "TS-LD-08-exhaustiveness-erosion",
  title: "Exhaustiveness erosion",
  aliases: ["TS-LD-08"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
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
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsLd08Output => computeExhaustivenessErosion(project, config),
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

const computeExhaustivenessErosion = (
  project: Project,
  config: TsLd08Config,
): TsLd08Output => {
  const scan = project.getSourceFiles()
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
    .map((sourceFile) => scanSourceFile(sourceFile, config))
    .reduce(mergeScanResults, emptyScanResult())
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

const scanSourceFile = (
  sourceFile: SourceFile,
  config: TsLd08Config,
): ExhaustivenessScanResult => {
  const findings: Array<ExhaustivenessErosionFinding> = []
  let analyzedFiniteSwitches = 0
  const switches = sourceFile.getDescendantsOfKind(SyntaxKind.SwitchStatement)

  for (const statement of switches) {
    const { finding, finite } = findingFromSwitch(sourceFile, statement, config)
    if (finite) analyzedFiniteSwitches += 1
    if (finding !== undefined) findings.push(finding)
  }

  return {
    findings,
    analyzedSwitches: switches.length,
    analyzedFiniteSwitches,
  }
}

const findingFromSwitch = (
  sourceFile: SourceFile,
  statement: SwitchStatement,
  config: TsLd08Config,
): { readonly finding?: ExhaustivenessErosionFinding; readonly finite: boolean } => {
  const domain = finiteSwitchDomain(statement.getExpression())
  if (domain === undefined) return { finite: false }

  const clauses = statement.getCaseBlock().getClauses()
  const caseClauses = clauses.filter(Node.isCaseClause)
  const defaultClause = clauses.find(Node.isDefaultClause)
  if (
    defaultClause === undefined ||
    caseClauses.length < config.min_case_clauses ||
    isExhaustivenessGuardDefault(defaultClause)
  ) {
    return { finite: true }
  }

  return {
    finite: true,
    finding: switchFinding(sourceFile, statement, caseClauses, defaultClause, domain),
  }
}

const switchFinding = (
  sourceFile: SourceFile,
  statement: SwitchStatement,
  caseClauses: ReadonlyArray<CaseClause>,
  defaultClause: DefaultClause,
  domain: FiniteSwitchDomain,
): ExhaustivenessErosionFinding => {
  const handledVariantCount = handledVariantKeys(caseClauses, domain.variantKeys).size
  const { line, column } = sourceFile.getLineAndColumnAtPos(statement.getStart())
  return {
    file: sourceFile.getFilePath(),
    line,
    column,
    expression: statement.getExpression().getText(),
    typeText: domain.typeText,
    caseCount: caseClauses.length,
    variantCount: domain.variantKeys.size,
    handledVariantCount,
    unhandledVariantCount: Math.max(0, domain.variantKeys.size - handledVariantCount),
    defaultText: defaultClause.getText().slice(0, 160),
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

const finiteSwitchDomain = (expression: Expression): FiniteSwitchDomain | undefined => {
  const type = expression.getType()
  const variants = finiteVariantKeys(type)
  if (variants.length === 0 || variants.every((variant) => variant.startsWith("boolean:"))) {
    return undefined
  }
  return {
    typeText: type.getText(expression),
    variantKeys: new Set(variants),
  }
}

const finiteVariantKeys = (type: Type): ReadonlyArray<string> => {
  if (type.isUnion()) {
    const variants = type.getUnionTypes().map(literalVariantKey)
    if (!variants.every((variant): variant is string => variant !== undefined)) return []
    return [...new Set(variants)]
  }
  const key = literalVariantKey(type)
  return key === undefined ? [] : [key]
}

const literalVariantKey = (type: Type): string | undefined => {
  if (type.isStringLiteral()) return `string:${String(type.getLiteralValue())}`
  if (type.isNumberLiteral()) return `number:${String(type.getLiteralValue())}`
  if (type.isEnumLiteral()) return `enum:${String(type.getLiteralValue() ?? type.getText())}`
  if (type.isBooleanLiteral()) return `boolean:${type.getText()}`
  if (type.isNull()) return "null:null"
  if (type.isUndefined()) return "undefined:undefined"
  if (type.isBigIntLiteral()) return `bigint:${type.getText()}`
  return undefined
}

const handledVariantKeys = (
  caseClauses: ReadonlyArray<CaseClause>,
  variantKeys: ReadonlySet<string>,
): ReadonlySet<string> => {
  const handled = new Set<string>()
  for (const clause of caseClauses) {
    for (const key of finiteVariantKeys(clause.getExpression().getType())) {
      if (variantKeys.has(key)) handled.add(key)
    }
  }
  return handled
}

const isExhaustivenessGuardDefault = (defaultClause: DefaultClause): boolean =>
  !containsExplicitNeverCast(defaultClause) &&
  defaultClause.getDescendants().some((node) =>
    isSatisfiesNeverCheck(node) ||
    isNeverAssignment(node) ||
    isNeverParameterGuard(node)
  )

const containsExplicitNeverCast = (node: TsMorphNode): boolean =>
  node.getDescendants().some((descendant) =>
    (Node.isAsExpression(descendant) || Node.isTypeAssertion(descendant)) &&
    isNeverTypeNode(descendant.getTypeNode())
  )

const isSatisfiesNeverCheck = (node: TsMorphNode): boolean =>
  Node.isSatisfiesExpression(node) &&
  isNeverTypeNode(node.getTypeNode()) &&
  node.getExpression().getType().isNever()

const isNeverAssignment = (node: TsMorphNode): boolean =>
  Node.isVariableDeclaration(node) &&
  isNeverTypeNode(node.getTypeNode()) &&
  node.getInitializer()?.getType().isNever() === true

const isNeverParameterGuard = (node: TsMorphNode): boolean => {
  if (!Node.isCallExpression(node) && !Node.isNewExpression(node)) return false
  const signature = node.getProject().getTypeChecker().getResolvedSignature(node)
  const parameters = signature?.getParameters() ?? []
  const args = node.getArguments()
  return args.some((arg, index) =>
    parameters[index]?.getTypeAtLocation(node).isNever() === true &&
    arg.getType().isNever()
  )
}

const isNeverTypeNode = (node: TsMorphNode | undefined): boolean =>
  node?.getText().trim() === "never"

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
