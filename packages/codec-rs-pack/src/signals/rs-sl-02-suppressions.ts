import { readFile } from "node:fs/promises"
import {
  SignalContextTag,
  parseBypasses,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
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

export const RsSl02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsSl02Config = typeof RsSl02Config.Type

export interface RustSuppression {
  readonly file: string
  readonly module: string
  readonly line: number
  readonly lints: ReadonlyArray<string>
  readonly justification: "active" | "expired" | "missing"
}

export interface RsSl02Output {
  readonly suppressions: ReadonlyArray<RustSuppression>
  readonly missingJustificationCount: number
  readonly expiredJustificationCount: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analysisMode: "allow-attributes-with-taste-allow-attachment"
}

export const RsSl02: Signal<RsSl02Config, RsSl02Output, RustProjectTag | SignalContextTag> = {
  id: "RS-SL-02",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
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
                  lints,
                  justification:
                    attachedBypass === undefined ? "missing" : attachedBypass.status,
                })
              }
              void node
            })
          }

          return {
            suppressions: suppressions.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
            missingJustificationCount: suppressions.filter(
              (suppression) => suppression.justification === "missing",
            ).length,
            expiredJustificationCount: suppressions.filter(
              (suppression) => suppression.justification === "expired",
            ).length,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
            analysisMode: "allow-attributes-with-taste-allow-attachment",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-02", message: String(cause), cause }),
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
      message: `Allow suppression for ${suppression.lints.join(", ")} is ${suppression.justification}`,
      location: { file: suppression.file, line: suppression.line },
      data: {
        module: suppression.module,
        lints: suppression.lints,
        justification: suppression.justification,
        scopeMode: out.scopeMode,
        analysisMode: out.analysisMode,
      },
    })),
}

const extractAllowLints = (text: string): ReadonlyArray<string> => {
  const match = /#\s*\[\s*allow\s*\(([^\)]*)\)\s*\]/.exec(text)
  if (match === null) return []
  return match[1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}
