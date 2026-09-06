import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsAnalysisTag } from "../ts-analysis.js"
import { locationOf, textOf, walkDescendants } from "../ast.js"
import {
  isArrowFunction,
  isCallExpression,
  isFunctionExpression,
  isStringLiteral,
  type CallExpression,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  TEST_FILE_GLOBS,
  TRUST_SIGNAL_EXCLUDE_GLOBS,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsSl05Config = Schema.Struct({
  test_globs: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSl05Config = typeof TsSl05Config.Type

export interface PhantomTestFinding extends SourceLocation {
  readonly testName: string
  readonly runner: string
  readonly callbackText: string
}

export interface TsSl05Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly testFilesAnalyzed: number
  readonly testBlocksAnalyzed: number
  readonly findings: ReadonlyArray<PhantomTestFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsSl05: Signal<TsSl05Config, TsSl05Output, TsAnalysisTag> = {
  id: "TS-SL-05-phantom-tests",
  title: "Phantom tests",
  aliases: ["TS-SL-05"],
  tier: 2,
  category: "generated-slop",
  kind: "structural",
  evidenceClass: "heuristic-pattern",
  cacheVersion: "phantom-tests-v1",
  configSchema: TsSl05Config,
  defaultConfig: {
    test_globs: [...TEST_FILE_GLOBS],
    exclude_globs: [...TRUST_SIGNAL_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const fileOutputs = yield* analysis.mapFiles(async (context) =>
        analyzePhantomTests(context.sourceFile, context.file.path, config),
      ).pipe(Effect.mapError((cause) =>
        new SignalComputeError({
          signalId: "TS-SL-05-phantom-tests",
          message: cause.message,
          cause,
        }),
      ))
      return mergePhantomTests(fileOutputs, config)
    }),
  score: (out) =>
    out.state === "present" ? Math.max(0, 1 - out.findings.length / Math.max(1, out.testBlocksAnalyzed)) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message: `${finding.runner}(${JSON.stringify(finding.testName)}) has no assertion evidence`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.runner}:${finding.testName}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "add-test-oracle",
        title: "Add an assertion",
        summary:
          "Assert the observed behavior, expected throw/rejection, property check, or fixture contract so the test can fail for the right reason.",
        confidence: "high",
        autoApplicable: false,
        data: { runner: finding.runner, testName: finding.testName },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const analyzePhantomTests = (
  sourceFile: SourceFile,
  filePath: string,
  config: TsSl05Config,
): {
  readonly analyzed: boolean
  readonly testBlocksAnalyzed: number
  readonly findings: ReadonlyArray<PhantomTestFinding>
} => {
  if (isExcludedPath(filePath, config)) {
    return { analyzed: false, testBlocksAnalyzed: 0, findings: [] }
  }
  const findings: Array<PhantomTestFinding> = []
  let testBlocksAnalyzed = 0
  walkDescendants(sourceFile, (node) => {
    if (!isCallExpression(node)) return
    const testBlock = classifyTestBlock(node)
    if (testBlock === undefined) return
    testBlocksAnalyzed += 1
    if (hasAssertionEvidence(textOf(testBlock.callback))) return
    findings.push({
      ...locationOf(node, filePath),
      testName: testBlock.name,
      runner: testBlock.runner,
      callbackText: textOf(testBlock.callback).slice(0, 160),
    })
  })
  return { analyzed: true, testBlocksAnalyzed, findings }
}

const mergePhantomTests = (
  fileOutputs: ReadonlyArray<{
    readonly analyzed: boolean
    readonly testBlocksAnalyzed: number
    readonly findings: ReadonlyArray<PhantomTestFinding>
  }>,
  config: TsSl05Config,
): TsSl05Output => {
  const findings = fileOutputs.flatMap((output) => output.findings)
  const testFilesAnalyzed = fileOutputs.filter((output) => output.analyzed).length
  const testBlocksAnalyzed = fileOutputs.reduce((sum, output) => sum + output.testBlocksAnalyzed, 0)
  return {
    state: testFilesAnalyzed === 0 || testBlocksAnalyzed === 0
      ? "not_applicable"
      : findings.length === 0 ? "zero" : "present",
    testFilesAnalyzed,
    testBlocksAnalyzed,
    findings: findings.sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["AI hotspot likelihood", "agent trust readout"],
    cacheContributors: [
      "source tree",
      "config.test_globs",
      "config.exclude_globs",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.test_globs and config.exclude_globs",
    enforcementCeiling: ["review-route"],
  }
}

const isExcludedPath = (filePath: string, config: TsSl05Config): boolean =>
  config.exclude_globs.some((glob) => matchesAnyGlob(filePath, [glob])) ||
  !matchesAnyGlob(filePath, config.test_globs)

const classifyTestBlock = (
  call: CallExpression,
): { readonly runner: string; readonly name: string; readonly callback: Node } | undefined => {
  const runner = textOf(call.expression).replace(/\s+/g, " ").trim().replace(/\?./g, ".")
  if (!/^(?:it|test)(?:\.(?:only|concurrent|each))?$/.test(runner)) return undefined
  const args = call.arguments
  if (args.length < 2) return undefined
  const callback = args[1]
  if (callback === undefined || (!isArrowFunction(callback) && !isFunctionExpression(callback))) {
    return undefined
  }
  return {
    runner,
    name: testName(args[0]),
    callback,
  }
}

const testName = (node: Node | undefined): string => {
  if (node !== undefined && isStringLiteral(node)) return node.text
  return node === undefined ? "<unnamed>" : textOf(node).slice(0, 80)
}

const hasAssertionEvidence = (text: string): boolean =>
  /(?:^|[^\w$])expect\s*\(/.test(text) ||
  /(?:^|[^\w$])assert(?:\.[A-Za-z_$][\w$]*)?\s*\(/.test(text) ||
  /(?:^|[^\w$])fc\.assert\s*\(/.test(text) ||
  /\.(?:toThrow|rejects|resolves|toEqual|toBe|toContain|toMatch|toHave|toSatisfy)\b/.test(text) ||
  /(?:^|[^\w$])t\.(?:is|deepEqual|truthy|falsey|throws|notThrows)\s*\(/.test(text)

const compareFindings = (
  left: PhantomTestFinding,
  right: PhantomTestFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.testName.localeCompare(right.testName)
