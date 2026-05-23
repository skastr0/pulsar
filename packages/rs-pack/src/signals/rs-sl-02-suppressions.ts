import {
  parseBypasses,
  SignalContextTag,
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { readFile } from "node:fs/promises"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  lineRangeOverlapsChangedHunks,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsSl02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsSl02Config = typeof RsSl02Config.Type

interface RustSuppression {
  readonly file: string
  readonly module: string
  readonly line: number
  readonly lints: ReadonlyArray<string>
  readonly ordinaryLints: ReadonlyArray<string>
  readonly justification: "active" | "expired" | "missing"
  readonly classification: "requires-governance"
}

interface RsSl02Output {
  readonly suppressions: ReadonlyArray<RustSuppression>
  readonly ordinaryAllowAttributeCount: number
  readonly ordinaryAllowLintCount: number
  readonly governedAllowAttributeCount: number
  readonly missingJustificationCount: number
  readonly expiredJustificationCount: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analysisMode: "allow-attributes-with-rust-lint-governance"
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "governed-allow-debt"
  readonly scoreDenominator: "governed-allow-attributes"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 20
const RS_SL_02_SCORE_MODE = "governed-allow-debt" as const
const RS_SL_02_SCORE_DENOMINATOR = "governed-allow-attributes" as const

const RsSl02FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsSl02: Signal<RsSl02Config, RsSl02Output, RustProjectTag | SignalContextTag> = {
  id: "RS-SL-02-suppressions",
  title: "Suppressions",
  aliases: ["RS-SL-02"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "unused-allows-ordinary-diagnostics-cfg-attr-v3",
  configSchema: RsSl02Config,
  factorDefinitions: RsSl02FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsSl02Config(config)
      const project = yield* RustProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl02Output> => {
          const suppressions: Array<RustSuppression> = []
          let ordinaryAllowAttributeCount = 0
          let ordinaryAllowLintCount = 0
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )

          for (const file of analyzedSourceFiles) {
            const source = await readFile(file, "utf8")
            const bypasses = parseBypasses(source)
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, attachedAttributes, testGated }) => {
              if (testGated) return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              for (const attribute of attachedAttributes) {
                const lints = extractAllowLints(attribute.text)
                if (lints.length === 0) continue
                const classified = classifyAllowLints(lints)
                ordinaryAllowLintCount += classified.ordinary.length
                if (classified.governed.length === 0) {
                  ordinaryAllowAttributeCount += 1
                  continue
                }
                const line = attribute.startPosition.row + 1
                if (
                  !lineRangeOverlapsChangedHunks(
                    file,
                    line,
                    line,
                    context.worktreePath,
                    context.changedHunks,
                  )
                ) {
                  continue
                }
                const attachedBypass = bypasses.find(
                  (bypass) => Math.abs(bypass.line - line) <= 1,
                )
                suppressions.push({
                  file,
                  module: modulePath,
                  line,
                  lints: classified.governed,
                  ordinaryLints: classified.ordinary,
                  justification:
                    attachedBypass === undefined ? "missing" : attachedBypass.status,
                  classification: "requires-governance",
                })
              }
              void node
            })
          }

          return {
            suppressions: suppressions.sort(
              (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
            ),
            ordinaryAllowAttributeCount,
            ordinaryAllowLintCount,
            governedAllowAttributeCount: suppressions.length,
            missingJustificationCount: suppressions.filter(
              (suppression) => suppression.justification === "missing",
            ).length,
            expiredJustificationCount: suppressions.filter(
              (suppression) => suppression.justification === "expired",
            ).length,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
            analysisMode: "allow-attributes-with-rust-lint-governance",
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_SL_02_SCORE_MODE,
            scoreDenominator: RS_SL_02_SCORE_DENOMINATOR,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-02-suppressions", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.suppressions.length === 0) return 1
    if (out.missingJustificationCount > 0 || out.expiredJustificationCount > 0) return 0
    return Math.max(0, 1 - out.suppressions.length / 25)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.sourceFileCount === 0
      ? [{
        severity: "warn" as const,
        message: "RS-SL-02 found no Rust source files for suppression analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
      : out.suppressions.slice(0, out.diagnosticLimit).map((suppression) => ({
        severity:
          suppression.justification === "active"
            ? ("info" as const)
            : ("block" as const),
        message: `Governed allow suppression for ${suppression.lints.join(", ")} is ${suppression.justification}`,
        location: { file: suppression.file, line: suppression.line },
        data: {
          module: suppression.module,
          lints: suppression.lints,
          ordinaryLints: suppression.ordinaryLints,
          justification: suppression.justification,
          classification: suppression.classification,
          requiresJustification: true,
          scopeMode: out.scopeMode,
          analysisMode: out.analysisMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      })),
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsSl02FactorLedger(),
}

type NormalizedRsSl02Config = RsSl02Config

const normalizeRsSl02Config = (config: RsSl02Config): NormalizedRsSl02Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsSl02FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-SL-02-suppressions",
    RsSl02FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const extractAllowLints = (text: string): ReadonlyArray<string> => {
  const stripped = stripRustComments(text)
  return extractCallArguments(stripped, "allow")
    .flatMap(splitAllowLintList)
    .filter((value) => value.length > 0)
}

const stripRustComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const extractCallArguments = (source: string, callee: string): ReadonlyArray<string> => {
  const pattern = new RegExp(`\\b${callee}\\s*\\(`, "g")
  const matches: Array<string> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const argsStart = pattern.lastIndex
    let depth = 1
    for (let index = argsStart; index < source.length; index += 1) {
      const char = source[index]
      if (char === "(") {
        depth += 1
      } else if (char === ")") {
        depth -= 1
        if (depth === 0) {
          matches.push(source.slice(argsStart, index))
          pattern.lastIndex = index + 1
          break
        }
      }
    }
  }
  return matches
}

const splitAllowLintList = (raw: string): ReadonlyArray<string> =>
  raw
    .split(",")
    .map((value) => value.trim())

interface ClassifiedAllowLints {
  readonly ordinary: ReadonlyArray<string>
  readonly governed: ReadonlyArray<string>
}

const classifyAllowLints = (lints: ReadonlyArray<string>): ClassifiedAllowLints => {
  const ordinary: Array<string> = []
  const governed: Array<string> = []

  for (const lint of lints) {
    if (requiresPulsarAllow(lint)) {
      governed.push(lint)
    } else {
      ordinary.push(lint)
    }
  }

  return { ordinary, governed }
}

const broadlyScopedLintNames = new Set([
  "warnings",
  "future_incompatible",
  "keyword_idents",
  "nonstandard_style",
  "rust_2018_idioms",
  "rust_2021_compatibility",
  "clippy::all",
  "clippy::cargo",
  "clippy::complexity",
  "clippy::correctness",
  "clippy::nursery",
  "clippy::pedantic",
  "clippy::perf",
  "clippy::restriction",
  "clippy::style",
  "clippy::suspicious",
])

const slopHidingLintNames = new Set([
  "unsafe_code",
  "unreachable_code",
  "unused_must_use",
  "clippy::allow_attributes",
  "clippy::allow_attributes_without_reason",
  "clippy::dbg_macro",
  "clippy::expect_used",
  "clippy::indexing_slicing",
  "clippy::panic",
  "clippy::print_stderr",
  "clippy::print_stdout",
  "clippy::todo",
  "clippy::unimplemented",
  "clippy::unreachable",
  "clippy::unwrap_in_result",
  "clippy::unwrap_used",
])

const requiresPulsarAllow = (lint: string): boolean => {
  const normalized = lint.replace(/\s+/g, "")
  if (broadlyScopedLintNames.has(normalized)) return true
  if (slopHidingLintNames.has(normalized)) return true
  return false
}
