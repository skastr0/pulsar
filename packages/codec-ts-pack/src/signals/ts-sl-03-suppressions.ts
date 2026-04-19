import { readFile } from "node:fs/promises"
import {
  SignalContextTag,
  parseBypasses,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

export const TsSl03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSl03Config = typeof TsSl03Config.Type

export interface Suppression {
  readonly file: string
  readonly line: number
  readonly kind: "ts-ignore" | "ts-expect-error" | "eslint-disable"
  readonly rule: string | undefined
  readonly justification: "active" | "expired" | "missing"
  readonly bypassTicket: string | undefined
}

export interface TsSl03Output {
  readonly suppressions: ReadonlyArray<Suppression>
  readonly unjustifiedCount: number
  readonly expiredCount: number
  readonly missingJustificationCount: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
}

export const TsSl03: Signal<TsSl03Config, TsSl03Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-03",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  configSchema: TsSl03Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<TsSl03Output> => {
          const suppressions: Array<Suppression> = []

          for (const sourceFile of project.getSourceFiles()) {
            const path = sourceFile.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue

            const sourceText = await readFile(path, "utf8")
            const bypasses = parseBypasses(sourceText)

            const lines = sourceText.split("\n")
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!
              const lineNum = i + 1

              const suppression = extractSuppression(line)
              if (suppression === undefined) continue

              if (
                !lineOverlapsHunks(
                  path,
                  lineNum,
                  context.worktreePath,
                  context.changedHunks,
                )
              ) {
                continue
              }

              const isTestFile = matchesAnyGlob(path, config.test_globs)
              const attachedBypass = bypasses.find((bypass) =>
                Math.abs(bypass.line - lineNum) <= 1,
              )

              const justification: "active" | "expired" | "missing" =
                attachedBypass?.status ?? "missing"

              suppressions.push({
                file: path,
                line: lineNum,
                kind: suppression.kind,
                rule: suppression.rule,
                justification,
                bypassTicket: attachedBypass?.ticket,
              })

              if (isTestFile && justification === "missing") {
                void null
              }
            }
          }

          return {
            suppressions: suppressions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
            unjustifiedCount: suppressions.filter((s) => s.justification === "missing" || s.justification === "expired").length,
            expiredCount: suppressions.filter((s) => s.justification === "expired").length,
            missingJustificationCount: suppressions.filter((s) => s.justification === "missing").length,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-03", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.suppressions.length === 0) return 1
    if (out.unjustifiedCount > 0) return 0
    return Math.max(0, 1 - out.suppressions.length / 25)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.suppressions.slice(0, out.suppressions.length).map((suppression) => {
      const isUnjustified = suppression.justification === "missing" || suppression.justification === "expired"
      return {
        severity: isUnjustified ? ("block" as const) : ("info" as const),
        message: `${suppression.kind}${suppression.rule ? ` (${suppression.rule})` : ""} is ${suppression.justification}`,
        location: { file: suppression.file, line: suppression.line },
        data: {
          hash: computeDiagnosticHash(`${suppression.file}:${suppression.line}:${suppression.kind}`),
          kind: suppression.kind,
          rule: suppression.rule,
          justification: suppression.justification,
          bypassTicket: suppression.bypassTicket,
        },
      }
    }),
}

const extractSuppression = (line: string): { kind: "ts-ignore" | "ts-expect-error" | "eslint-disable"; rule: string | undefined } | undefined => {
  const trimmed = line.trim()

  const tsIgnoreMatch = /\B@ts-ignore\b/.exec(trimmed)
  if (tsIgnoreMatch) {
    return { kind: "ts-ignore", rule: undefined }
  }

  const tsExpectMatch = /\B@ts-expect-error\b/.exec(trimmed)
  if (tsExpectMatch) {
    return { kind: "ts-expect-error", rule: undefined }
  }

  const eslintDisableMatch = /eslint-disable(?:-next-line)?(?:-line)?\s*(.*)?/.exec(trimmed)
  if (eslintDisableMatch) {
    const rulePart = eslintDisableMatch[1]?.trim()
    const rule = rulePart && rulePart.length > 0 ? rulePart : undefined
    return { kind: "eslint-disable", rule }
  }

  return undefined
}

const lineOverlapsHunks = (
  filePath: string,
  line: number,
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): boolean => {
  if (hunks.length === 0) return true
  const absoluteFile = filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`

  for (const hunk of hunks) {
    const hunkFileAbsolute = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    if (hunkFileAbsolute !== absoluteFile) continue

    const hunkStart = hunk.newStart
    const hunkEnd = hunk.newStart + hunk.newLines

    if (line >= hunkStart && line < hunkEnd) {
      return true
    }
  }

  return false
}