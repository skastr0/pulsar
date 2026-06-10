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
  type Identifier,
  type NewExpression,
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
  cacheVersion: "dangerous-capability-surface-v3-binding-resolved-bounded-info",
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
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
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
    if (Node.isIdentifier(expression)) {
      const name = expression.getText()
      if (name === "eval" && isAmbientGlobalReference(expression)) {
        findings.push(findingFromCall(call, "eval", name, 1))
        continue
      }
      if (name === "Function" && isAmbientGlobalReference(expression)) {
        findings.push(findingFromCall(call, "function-constructor", name, 1))
        continue
      }
      // Name matches alone never fire: a bare exec/spawn/... call is a
      // capability only when its binding resolves to child_process. Local
      // helpers that reuse those names, and unresolvable bindings, emit
      // nothing.
      if (PROCESS_FUNCTION_NAMES.has(name) && isChildProcessValueBinding(expression)) {
        findings.push(findingFromCall(call, "shell-process", name, processCallWeight(call, name)))
      }
      continue
    }
    if (expression.getKind() === SyntaxKind.ImportKeyword && !isStringLiteralLike(call.getArguments()[0])) {
      findings.push(findingFromCall(call, "dynamic-import", "import(non-literal)", 0))
      continue
    }
    const member = resolveDangerousMemberCallee(expression)
    if (member !== undefined) {
      findings.push(findingFromCall(call, "shell-process", member.sink, memberCallWeight(call, member)))
    }
  }

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const callee = expression.getExpression()
    if (
      Node.isIdentifier(callee) &&
      callee.getText() === "Function" &&
      isAmbientGlobalReference(callee)
    ) {
      findings.push({
        ...locationOf(expression),
        kind: "function-constructor",
        sink: "new Function",
        evidence: expression.getText().slice(0, 160),
        reviewRoute: "security",
        weight: 1,
      })
      continue
    }
    const member = resolveDangerousMemberCallee(callee)
    if (member !== undefined) {
      findings.push({
        ...locationOf(expression),
        kind: "shell-process",
        sink: `new ${member.sink}`,
        evidence: expression.getText().slice(0, 160),
        reviewRoute: "security",
        weight: newExpressionWeight(expression),
      })
    }
  }

  for (const tagged of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    const member = resolveDangerousMemberCallee(tagged.getTag())
    if (member !== undefined) {
      findings.push({
        ...locationOf(tagged),
        kind: "shell-process",
        sink: member.sink,
        evidence: tagged.getText().slice(0, 160),
        reviewRoute: "security",
        weight: 0.75,
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
  if (!Node.isPropertyAccessExpression(expression)) return undefined
  const method = expression.getName()
  const base = expression.getExpression()
  if (Node.isIdentifier(base)) {
    const baseName = base.getText()
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
  declarationsOf(identifier).every((declaration) => {
    const declarationFile = declaration.getSourceFile()
    return declarationFile.isDeclarationFile() || declarationFile.isInNodeModules()
  })

const isChildProcessValueBinding = (identifier: Identifier): boolean =>
  declarationsOf(identifier).some((declaration) => {
    if (Node.isImportSpecifier(declaration)) {
      return isChildProcessSpecifier(declaration.getImportDeclaration().getModuleSpecifierValue())
    }
    if (Node.isBindingElement(declaration)) {
      const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
      return variable !== undefined && isChildProcessRequireCall(variable.getInitializer())
    }
    return false
  })

const isChildProcessModuleBinding = (identifier: Identifier): boolean =>
  declarationsOf(identifier).some((declaration) => {
    if (Node.isNamespaceImport(declaration) || Node.isImportClause(declaration)) {
      const moduleSpecifier = declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue()
      return moduleSpecifier !== undefined && isChildProcessSpecifier(moduleSpecifier)
    }
    if (Node.isVariableDeclaration(declaration)) {
      return isChildProcessRequireCall(declaration.getInitializer())
    }
    return false
  })

const declarationsOf = (identifier: Identifier): ReadonlyArray<Node> =>
  identifier.getSymbol()?.getDeclarations() ?? []

const isChildProcessRequireCall = (node: Node | undefined): boolean => {
  if (node === undefined || !Node.isCallExpression(node)) return false
  if (node.getExpression().getText() !== "require") return false
  return isChildProcessSpecifier(stringLiteralValue(node.getArguments()[0]) ?? "")
}

const isChildProcessSpecifier = (specifier: string): boolean =>
  specifier.replace(/^node:/, "") === "child_process"

const processCallWeight = (call: CallExpression, processName: string): number => {
  if (SHELL_PARSING_PROCESS_FUNCTIONS.has(processName)) return 0.75
  if (hasShellTrueOption(call)) return 0.75
  return isConstrainedCommandArgument(call.getArguments()[0]) ? 0 : 0.75
}

const memberCallWeight = (call: CallExpression, member: DangerousMemberCallee): number => {
  if (member.method === "$" || member.method === "run") return 0.75
  return processCallWeight(call, member.method)
}

const newExpressionWeight = (expression: NewExpression): number =>
  isConstrainedCommandArgument(expression.getArguments()[0]) ? 0 : 0.75

const isConstrainedCommandArgument = (node: Node | undefined): boolean => {
  if (stringLiteralValue(node) !== undefined) return true
  if (node !== undefined && Node.isArrayLiteralExpression(node)) {
    const elements = node.getElements()
    return elements.length > 0 &&
      elements.every((element) => stringLiteralValue(element) !== undefined)
  }
  return false
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
