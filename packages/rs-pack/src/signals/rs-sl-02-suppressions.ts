import {
  parseBypasses,
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { readFile } from "node:fs/promises"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
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

export interface RustSuppression {
  readonly file: string
  readonly module: string
  readonly line: number
  readonly lints: ReadonlyArray<string>
  readonly ordinaryLints: ReadonlyArray<string>
  readonly justification: "active" | "expired" | "missing"
  readonly classification: "requires-governance"
}

export interface RsSl02Output {
  readonly suppressions: ReadonlyArray<RustSuppression>
  readonly ordinaryAllowAttributeCount: number
  readonly ordinaryAllowLintCount: number
  readonly governedAllowAttributeCount: number
  readonly missingJustificationCount: number
  readonly expiredJustificationCount: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analysisMode: "allow-attributes-with-rust-lint-governance"
}

export const RsSl02: Signal<RsSl02Config, RsSl02Output, RustProjectTag | SignalContextTag> = {
  id: "RS-SL-02-suppressions",
  title: "Suppressions",
  aliases: ["RS-SL-02"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "unused-allows-ordinary-v1",
  configSchema: RsSl02Config,
  defaultConfig: {
    exclude_globs: ["**/target/**"],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl02Output> => {
          const suppressions: Array<RustSuppression> = []
          let ordinaryAllowAttributeCount = 0
          let ordinaryAllowLintCount = 0
          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const source = await readFile(file, "utf8")
            const bypasses = parseBypasses(source)
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, attachedAttributes }) => {
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
            suppressions: suppressions.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
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
    out.suppressions.slice(0, 20).map((suppression) => ({
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
      },
    })),
}

const extractAllowLints = (text: string): ReadonlyArray<string> => {
  const match = /#\s*!?\s*\[\s*allow\s*\(([^\)]*)\)\s*\]/.exec(text)
  if (match === null) return []
  return match[1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

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
