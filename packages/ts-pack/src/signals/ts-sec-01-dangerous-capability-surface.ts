import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { textOf, walkDescendants } from "../ast.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import {
  SyntaxKind,
  isArrayLiteralExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isNamespaceImport,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
  isTaggedTemplateExpression,
  type CallExpression,
  type Identifier,
  type NewExpression,
  type Node,
  type SourceFile,
  type TaggedTemplateExpression,
} from "../tsgo-api.js"
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

export const TsSec01: Signal<TsSec01Config, TsSec01Output, TsAnalysisTag> = {
  id: "TS-SEC-01-dangerous-capability-surface",
  title: "Dangerous capability surface",
  aliases: ["TS-SEC-01"],
  tier: 1,
  category: "security-risk",
  kind: "structural",
  evidenceClass: "deterministic-ast",
  cacheVersion: "dangerous-capability-surface-v4-parameterized-sql-tags-risk-sorted-diagnostics",
  configSchema: TsSec01Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
    review_route_weight: 0,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (context) => context.sourceFile).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-SEC-01-dangerous-capability-surface",
            message: cause.message,
            cause,
          }),
        ),
      )
      return yield* Effect.try({
        try: (): TsSec01Output =>
          computeDangerousCapabilitySurface(sourceFiles, config),
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
    // Warn-class findings (eval, Function constructor) carry absolute
    // pressure: they are dangerous regardless of how big the repo is.
    // Info-class findings are capability inventory: their pressure is
    // normalized by analyzed-file density and bounded so a repo whose
    // purpose is process/db access never scores below ~0.5 on inventory
    // alone.
    const warnPressure = out.findings
      .filter((finding) => findingSeverity(finding.kind) === "warn")
      .reduce((sum, finding) => sum + finding.weight, 0)
    const infoPressure = out.findings
      .filter((finding) => findingSeverity(finding.kind) === "info")
      .reduce((sum, finding) => sum + finding.weight, 0)
    const infoDensity = infoPressure / Math.max(1, out.analyzedFiles)
    const infoScore = 1 - INFO_SCORE_SPAN * (infoDensity / (1 + infoDensity))
    return (1 / (1 + warnPressure)) * infoScore
  },
  // Risk-sorted before the top_n slice: warn-class findings first, then
  // descending weight, so a single unsafe escape hatch can never be crowded
  // out of the default output by benign capability inventory.
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    [...out.findings].sort(compareFindings).slice(0, out.diagnosticLimit).map((finding) => ({
      severity: findingSeverity(finding.kind),
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
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.top_n_diagnostics",
      "config.review_route_weight",
    ],
    calibrationSurface: "config.exclude_globs only; generic capability categories are non-taste defaults",
    enforcementCeiling: ["review-route"],
  }
}

const collectImportCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
  weight: number,
): void => {
  walkDescendants(sourceFile, (declaration) => {
    if (!isImportDeclaration(declaration)) return
    const specifierNode = declaration.moduleSpecifier
    const specifier = isStringLiteral(specifierNode) || isNoSubstitutionTemplateLiteral(specifierNode) ? specifierNode.text : undefined
    if (specifier === undefined) return
    const kind = moduleCapabilityKind(specifier)
    if (kind === undefined) return
    findings.push({
      ...locationOf(declaration),
      kind,
      sink: specifier,
      evidence: textOf(declaration).slice(0, 160),
      reviewRoute: "security",
      weight,
    })
  })
}

const collectCallCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
): void => {
  walkDescendants(sourceFile, (call) => {
    if (!isCallExpression(call)) return
    const expression = call.expression
    if (isIdentifier(expression)) {
      const name = textOf(expression)
      if (name === "eval" && isAmbientGlobalReference(expression)) {
        findings.push(findingFromCall(call, "eval", name, 1))
        return
      }
      if (name === "Function" && isAmbientGlobalReference(expression)) {
        findings.push(findingFromCall(call, "function-constructor", name, 1))
        return
      }
      // Name matches alone never fire: a bare exec/spawn/... call is a
      // capability only when its binding resolves to child_process. Local
      // helpers that reuse those names, and unresolvable bindings, emit
      // nothing.
      if (PROCESS_FUNCTION_NAMES.has(name) && isChildProcessValueBinding(expression)) {
        findings.push(findingFromCall(call, "shell-process", name, processCallWeight(call, name)))
      }
      return
    }
    if (expression.kind === SyntaxKind.ImportKeyword && !isStringLiteralLike(call.arguments[0])) {
      findings.push(findingFromCall(call, "dynamic-import", "import(non-literal)", 0))
      return
    }
    const member = resolveDangerousMemberCallee(expression)
    if (member !== undefined) {
      findings.push(findingFromCall(call, "shell-process", member.sink, memberCallWeight(call, member)))
    }
  })

  walkDescendants(sourceFile, (expression) => {
    if (!isNewExpression(expression)) return
    const callee = expression.expression
    if (
      isIdentifier(callee) &&
      textOf(callee) === "Function" &&
      isAmbientGlobalReference(callee)
    ) {
      findings.push({
        ...locationOf(expression),
        kind: "function-constructor",
        sink: "new Function",
        evidence: textOf(expression).slice(0, 160),
        reviewRoute: "security",
        weight: 1,
      })
      return
    }
    const member = resolveDangerousMemberCallee(callee)
    if (member !== undefined) {
      findings.push({
        ...locationOf(expression),
        kind: "shell-process",
        sink: `new ${member.sink}`,
        evidence: textOf(expression).slice(0, 160),
        reviewRoute: "security",
        weight: newExpressionWeight(expression),
      })
    }
  })

  walkDescendants(sourceFile, (tagged) => {
    if (!isTaggedTemplateExpression(tagged)) return
    const member = resolveDangerousMemberCallee(tagged.tag)
    if (member !== undefined) {
      findings.push({
        ...locationOf(tagged),
        kind: "shell-process",
        sink: member.sink,
        evidence: textOf(tagged).slice(0, 160),
        reviewRoute: "security",
        weight: 0.75,
      })
    }
  })
}

const collectSqlCapabilities = (
  sourceFile: SourceFile,
  findings: Array<DangerousCapabilityFinding>,
): void => {
  walkDescendants(sourceFile, (tag) => {
    if (!isTaggedTemplateExpression(tag)) return
    const tagName = callName(tag.tag)
    if (!/(\bsql\b|raw|unsafe)/i.test(tagName)) return
    // Tagged-template invocation of an sql-like tag (sql`... ${id}`) is the
    // parameterized pattern: the library escapes interpolations by
    // construction, so it is not raw SQL. Only tags that name an explicit
    // escape hatch (raw/unsafe/literal) expose raw query material.
    if (!SQL_ESCAPE_HATCH_MARKER.test(tagName)) return
    findings.push({
      ...locationOf(tag),
      kind: "raw-sql",
      sink: tagName,
      evidence: textOf(tag).slice(0, 160),
      reviewRoute: "security",
      weight: SQL_ESCAPE_HATCH_WEIGHT,
    })
  })

  walkDescendants(sourceFile, (call) => {
    if (!isCallExpression(call)) return
    const name = callName(call.expression)
    // Explicit escape hatches (sql.unsafe(...), sql.literal(...), db.raw(...))
    // bypass parameterization regardless of argument shape.
    if (isSqlEscapeHatchCall(name) && call.arguments.length > 0) {
      findings.push(findingFromCall(call, "raw-sql", name, SQL_ESCAPE_HATCH_WEIGHT))
      return
    }
    if (!/(^|\.)(query|execute|raw|unsafe|literal|sql)$/i.test(name)) return
    if (![...call.arguments].some(isDynamicQueryArgument)) return
    findings.push(findingFromCall(call, "raw-sql", name, 0.75))
  })
}

const SQL_ESCAPE_HATCH_WEIGHT = 1
const SQL_ESCAPE_HATCH_MARKER = /(raw|unsafe|literal)/i
// `.literal`/`.raw`/`.unsafe` member names are only escape hatches on an
// sql-like receiver: z.literal(...) or express.raw(...) are unrelated APIs.
const SQLISH_RECEIVER_PATTERN = /(^|\.)(sql|db|database|knex|sequelize|pg|client|connection|conn)$/i

const isSqlEscapeHatchCall = (name: string): boolean => {
  const match = /^(.+)\.(unsafe|literal|raw)$/i.exec(name)
  return match !== null && SQLISH_RECEIVER_PATTERN.test(match[1]!)
}

const isDynamicQueryArgument = (node: Node): boolean =>
  node.kind === SyntaxKind.TemplateExpression || isStringConcatenation(node)

const isStringConcatenation = (node: Node): boolean => {
  if (!isBinaryExpression(node)) return false
  if (node.operatorToken.kind !== SyntaxKind.PlusToken) return false
  return hasStringOperand(node.left) || hasStringOperand(node.right)
}

const hasStringOperand = (node: Node): boolean =>
  isStringLiteral(node) ||
  isNoSubstitutionTemplateLiteral(node) ||
  node.kind === SyntaxKind.TemplateExpression ||
  isStringConcatenation(node)

const findingFromCall = (
  call: CallExpression,
  kind: DangerousCapabilityKind,
  sink: string,
  weight: number,
): DangerousCapabilityFinding => ({
  ...locationOf(call),
  kind,
  sink,
  evidence: textOf(call).slice(0, 160),
  reviewRoute: "security",
  weight,
})

const normalizeReviewRouteWeight = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const INFO_SCORE_SPAN = 0.5

const findingSeverity = (kind: DangerousCapabilityKind): "warn" | "info" =>
  kind === "eval" || kind === "function-constructor" ? "warn" : "info"

const PROCESS_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "exec",
  "execFile",
  "execSync",
  "execFileSync",
  "spawn",
  "spawnSync",
  "fork",
])

const SHELL_PARSING_PROCESS_FUNCTIONS: ReadonlySet<string> = new Set(["exec", "execSync"])

const DANGEROUS_GLOBAL_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Bun", new Set(["spawn", "spawnSync", "$"])],
  ["Deno", new Set(["run", "Command"])],
])

interface DangerousMemberCallee {
  readonly sink: string
  readonly method: string
}

const resolveDangerousMemberCallee = (expression: Node): DangerousMemberCallee | undefined => {
  if (!isPropertyAccessExpression(expression)) return undefined
  const method = textOf(expression.name)
  const base = expression.expression
  if (isIdentifier(base)) {
    const baseName = textOf(base)
    const globalMembers = DANGEROUS_GLOBAL_MEMBERS.get(baseName)
    if (globalMembers?.has(method) === true && isAmbientGlobalReference(base)) {
      return { sink: `${baseName}.${method}`, method }
    }
    if (PROCESS_FUNCTION_NAMES.has(method) && isChildProcessModuleBinding(base)) {
      return { sink: `${baseName}.${method}`, method }
    }
    return undefined
  }
  if (PROCESS_FUNCTION_NAMES.has(method) && isChildProcessRequireCall(base)) {
    return { sink: `require("child_process").${method}`, method }
  }
  return undefined
}

/**
 * True when every declaration of the identifier lives in ambient or
 * vendored code (lib/.d.ts/node_modules), or the binding does not resolve
 * at all — the cases where the name can only be the runtime global.
 * A declaration in analyzed user source means the global is shadowed.
 */
const isAmbientGlobalReference = (identifier: Identifier): boolean =>
  !hasLocalBinding(identifier)

const isChildProcessValueBinding = (identifier: Identifier): boolean =>
  childProcessBindingKind(identifier) === "value"

const isChildProcessModuleBinding = (identifier: Identifier): boolean =>
  childProcessBindingKind(identifier) === "module"

const hasLocalBinding = (identifier: Identifier): boolean => {
  const name = identifier.text
  const sourceFile = identifier.getSourceFile()
  let found = false
  walkDescendants(sourceFile, (node) => {
    if (found) return
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name && node.name !== identifier) {
      found = true
      return
    }
    if (isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause?.name?.text === name) {
        found = true
        return
      }
      if (clause?.namedBindings !== undefined && isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) {
        found = true
      }
    }
  })
  return found
}

const childProcessBindingKind = (identifier: Identifier): "value" | "module" | undefined => {
  const sourceFile = identifier.getSourceFile()
  const name = identifier.text
  let kind: "value" | "module" | undefined
  walkDescendants(sourceFile, (node) => {
    if (kind !== undefined) return
    if (isImportDeclaration(node)) {
      const specifierNode = node.moduleSpecifier
      const specifier = isStringLiteral(specifierNode) || isNoSubstitutionTemplateLiteral(specifierNode)
        ? specifierNode.text
        : undefined
      if (specifier === undefined || !isChildProcessSpecifier(specifier)) return
      const clause = node.importClause
      if (clause?.name?.text === name) {
        kind = "module"
        return
      }
      if (clause?.namedBindings !== undefined && isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) {
        kind = "module"
        return
      }
      if (clause?.namedBindings !== undefined && "elements" in clause.namedBindings) {
        for (const element of clause.namedBindings.elements as ReadonlyArray<{ readonly name: Identifier }>) {
          if (element.name.text === name) kind = "value"
        }
      }
    }
    if (isVariableDeclaration(node) && isIdentifier(node.name) && node.name.text === name) {
      if (isChildProcessRequireCall(node.initializer)) kind = "module"
    }
    if (isBindingElement(node) && node.name !== undefined && isIdentifier(node.name) && node.name.text === name) {
      let current: Node | undefined = node.parent
      while (current !== undefined) {
        if (isVariableDeclaration(current)) {
          if (isChildProcessRequireCall(current.initializer)) kind = "value"
          break
        }
        current = current.parent
      }
    }
  })
  return kind
}

const isChildProcessRequireCall = (node: Node | undefined): boolean => {
  if (node === undefined || !isCallExpression(node)) return false
  if (textOf(node.expression) !== "require") return false
  return isChildProcessSpecifier(stringLiteralValue(node.arguments[0]) ?? "")
}

const isChildProcessSpecifier = (specifier: string): boolean =>
  specifier.replace(/^node:/, "") === "child_process"

const processCallWeight = (call: CallExpression, processName: string): number => {
  if (SHELL_PARSING_PROCESS_FUNCTIONS.has(processName)) return 0.75
  if (hasShellTrueOption(call)) return 0.75
  return isConstrainedCommandArgument(call.arguments[0]) ? 0 : 0.75
}

const memberCallWeight = (call: CallExpression, member: DangerousMemberCallee): number => {
  if (member.method === "$" || member.method === "run") return 0.75
  return processCallWeight(call, member.method)
}

const newExpressionWeight = (expression: NewExpression): number =>
  isConstrainedCommandArgument(expression.arguments?.[0]) ? 0 : 0.75

const isConstrainedCommandArgument = (node: Node | undefined): boolean => {
  if (stringLiteralValue(node) !== undefined) return true
  if (node !== undefined && isArrayLiteralExpression(node)) {
    const elements = node.elements
    return elements.length > 0 &&
      elements.every((element) => stringLiteralValue(element) !== undefined)
  }
  return false
}

const hasShellTrueOption = (call: CallExpression): boolean =>
  [...call.arguments].some((argument) => {
    if (!isObjectLiteralExpression(argument)) return false
    return argument.properties.some((property) => {
      if (!isPropertyAssignment(property)) return false
      if (textOf(property.name).replace(/^["']|["']$/g, "") !== "shell") return false
      return property.initializer?.kind === SyntaxKind.TrueKeyword
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

// Descending risk class — warn-class findings (eval, Function constructor)
// first, then escape hatches and inventory by descending weight — with
// file/line/column/sink as the deterministic tie-breaker.
const compareFindings = (
  left: DangerousCapabilityFinding,
  right: DangerousCapabilityFinding,
): number =>
  severityRankOf(left.kind) - severityRankOf(right.kind) ||
  right.weight - left.weight ||
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.sink.localeCompare(right.sink)

const severityRankOf = (kind: DangerousCapabilityKind): number =>
  findingSeverity(kind) === "warn" ? 0 : 1
