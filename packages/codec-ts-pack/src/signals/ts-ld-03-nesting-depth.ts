import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type SourceFile,
  ts,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  compilerPropertyNameText as propertyNameText,
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"

type MutableFunctionNesting = {
  file: string
  name: string
  line: number
  maxNesting: number
}

export const TsLd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_nesting: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsLd03Config = typeof TsLd03Config.Type

export interface FunctionNesting {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly maxNesting: number
}

export interface TsLd03Output {
  readonly byFunction: ReadonlyArray<FunctionNesting>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThreshold: ReadonlyArray<FunctionNesting>
  readonly threshold: number
  readonly totalFunctions: number
  readonly diagnosticLimit: number
}

export const TsLd03: Signal<TsLd03Config, TsLd03Output, TsProjectTag> = {
  id: "TS-LD-03",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd03Config,
  defaultConfig: {
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
      "**/.turbo/**",
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
    max_nesting: 4,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd03Output => {
          const byFunction: Array<FunctionNesting> = []
          const byFileValues = new Map<string, Array<number>>()

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            const values = byFileValues.get(file) ?? []
            for (const fn of collectFunctionNestings(sourceFile)) {
              byFunction.push(fn)
              values.push(fn.maxNesting)
            }
            byFileValues.set(file, values)
          }

          const byFile = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFileValues) {
            byFile.set(file, summarize(values))
          }

          const sorted = byFunction.slice().sort(compareNesting)
          return {
            byFunction: sorted,
            byFile,
            overThreshold: sorted.filter((entry) => entry.maxNesting > config.max_nesting),
            threshold: config.max_nesting,
            totalFunctions: sorted.length,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-03",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    return Math.max(0, 1 - out.overThreshold.length / out.totalFunctions)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: "warn" as const,
      message: `Function nesting depth \`${entry.name}\` reaches ${entry.maxNesting}`,
      location: { file: entry.file, line: entry.line },
      data: {
        ...entry,
        threshold: out.threshold,
      },
    })),
}

const collectFunctionNestings = (sourceFile: SourceFile): ReadonlyArray<FunctionNesting> => {
  const compilerSourceFile = sourceFile.compilerNode
  const file = sourceFile.getFilePath()
  const functions: Array<MutableFunctionNesting> = []

  const visit = (
    node: ts.Node,
    currentFunction: MutableFunctionNesting | undefined,
    depth: number,
  ): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(compilerSourceFile)
      const fn = {
        file,
        name: functionName(node),
        line: compilerSourceFile.getLineAndCharacterOfPosition(start).line + 1,
        maxNesting: 0,
      }
      functions.push(fn)
      ts.forEachChild(node, (child) => visit(child, fn, 0))
      return
    }

    const nextDepth =
      currentFunction !== undefined && isControlFlowNode(node) ? depth + 1 : depth
    if (currentFunction !== undefined && nextDepth > currentFunction.maxNesting) {
      currentFunction.maxNesting = nextDepth
    }

    ts.forEachChild(node, (child) => visit(child, currentFunction, nextDepth))
  }

  visit(compilerSourceFile, undefined, 0)
  return functions
}

const isControlFlowNode = (node: ts.Node): boolean =>
  ts.isIfStatement(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node) ||
  ts.isCatchClause(node)

const functionName = (fn: CompilerFunctionLike): string => {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn)
  ) {
    return fn.name === undefined ? "<anonymous>" : propertyNameText(fn.name)
  }
  if (ts.isConstructorDeclaration(fn)) return "constructor"

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (ts.isPropertyAssignment(parent)) {
    return propertyNameText(parent.name)
  }
  return "<anonymous>"
}

const compareNesting = (left: FunctionNesting, right: FunctionNesting): number => {
  if (right.maxNesting !== left.maxNesting) {
    return right.maxNesting - left.maxNesting
  }
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.line - right.line
}
