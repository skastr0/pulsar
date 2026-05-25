import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  TEST_FILE_GLOBS,
  TRUST_SIGNAL_EXCLUDE_GLOBS,
  callName,
  isAnalyzableSourceFile,
  locationOf,
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

export const TsSl05: Signal<TsSl05Config, TsSl05Output, TsProjectTag> = {
  id: "TS-SL-05-phantom-tests",
  title: "Phantom tests",
  aliases: ["TS-SL-05"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
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
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsSl05Output => computePhantomTests(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-SL-05-phantom-tests",
            message: String(cause),
            cause,
          }),
      })
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

const computePhantomTests = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsSl05Config,
): TsSl05Output => {
  const findings: Array<PhantomTestFinding> = []
  let testFilesAnalyzed = 0
  let testBlocksAnalyzed = 0

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    if (!matchesAnyGlob(sourceFile.getFilePath(), config.test_globs)) continue
    testFilesAnalyzed += 1
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const testBlock = classifyTestBlock(call)
      if (testBlock === undefined) continue
      testBlocksAnalyzed += 1
      if (hasAssertionEvidence(testBlock.callback.getText())) continue
      findings.push({
        ...locationOf(call),
        testName: testBlock.name,
        runner: testBlock.runner,
        callbackText: testBlock.callback.getText().slice(0, 160),
      })
    }
  }

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

const classifyTestBlock = (
  call: CallExpression,
): { readonly runner: string; readonly name: string; readonly callback: Node } | undefined => {
  const runner = callName(call.getExpression())
  if (!/^(?:it|test)(?:\.(?:only|concurrent|each))?$/.test(runner)) return undefined
  const args = call.getArguments()
  if (args.length < 2) return undefined
  const callback = args[1]
  if (callback === undefined || (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback))) {
    return undefined
  }
  return {
    runner,
    name: testName(args[0]),
    callback,
  }
}

const testName = (node: Node | undefined): string => {
  if (node !== undefined && Node.isStringLiteral(node)) return node.getLiteralText()
  return node?.getText().slice(0, 80) ?? "<unnamed>"
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
