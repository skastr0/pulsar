import {
  SignalContextTag,
  parseBypasses,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { relative } from "node:path"
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
  readonly justificationSource: "bypass" | "inline" | "contextual" | undefined
  readonly bypassTicket: string | undefined
}

export interface TsSl03Output {
  readonly suppressions: ReadonlyArray<Suppression>
  readonly unjustifiedCount: number
  readonly expiredCount: number
  readonly missingJustificationCount: number
  readonly diagnosticLimit: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analyzedFileCount: number
}

export const TsSl03: Signal<TsSl03Config, TsSl03Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-03",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "inline-block-reasons-and-test-helpers-v1",
  configSchema: TsSl03Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/Generated.ts",
      "**/Generated.tsx",
      "**/generated/**",
      "**/*.d.ts",
      "**/sst-env.d.ts",
      "docs/**",
      "**/docs/**",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
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
      "**/*test_helpers.ts",
      "**/*test_helpers.tsx",
      "**/*.test_helpers.ts",
      "**/*.test_helpers.tsx",
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

          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => {
              const path = sourceFile.getFilePath()
              const relativePath = relative(context.worktreePath, path).replace(/\\/g, "/")
              return (
                !matchesSourcePath(path, relativePath, config.exclude_globs) &&
                !matchesSourcePath(path, relativePath, config.test_globs)
              )
            })

          for (const sourceFile of sourceFiles) {
            const path = sourceFile.getFilePath()

            const sourceText = sourceFile.getFullText()
            const bypasses = parseBypasses(sourceText)

            const lines = sourceText.split("\n")
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!
              const lineNum = i + 1

              const suppression = extractSuppression(line)
              if (suppression === undefined) continue
              if (isBanTsCommentBridge(suppression, lines[i + 1])) continue

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

              const attachedBypass = bypasses.find((bypass) =>
                Math.abs(bypass.line - lineNum) <= 1,
              )
              const contextualJustification = contextualSuppressionJustification(lines, i)

              const justification: "active" | "expired" | "missing" =
                attachedBypass?.status ??
                (suppression.inlineJustification !== undefined || contextualJustification !== undefined ? "active" : "missing")
              const justificationSource =
                attachedBypass !== undefined
                  ? "bypass"
                  : suppression.inlineJustification !== undefined
                    ? "inline"
                    : contextualJustification !== undefined
                      ? "contextual"
                      : undefined

              suppressions.push({
                file: path,
                line: lineNum,
                kind: suppression.kind,
                rule: suppression.rule,
                justification,
                justificationSource,
                bypassTicket: attachedBypass?.ticket,
              })
            }
          }

          return {
            suppressions: suppressions.sort(compareSuppressions),
            unjustifiedCount: suppressions.filter((s) => s.justification === "missing" || s.justification === "expired").length,
            expiredCount: suppressions.filter((s) => s.justification === "expired").length,
            missingJustificationCount: suppressions.filter((s) => s.justification === "missing").length,
            diagnosticLimit: config.top_n_diagnostics,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
            analyzedFileCount: sourceFiles.length,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-03", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.suppressions.length === 0) return 1
    const penalty =
      out.expiredCount * 4 +
      out.missingJustificationCount +
      (out.suppressions.length - out.unjustifiedCount) * 0.25
    const denominator =
      out.scopeMode === "changed-hunks"
        ? 25
        : Math.max(100, (out.analyzedFileCount ?? out.suppressions.length) * 0.25)
    const maxPenalty = out.scopeMode === "changed-hunks" ? 1 : 0.65
    return Math.max(0, 1 - Math.min(maxPenalty, penalty / denominator))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.suppressions.slice(0, out.diagnosticLimit).map((suppression) => {
      const isUnjustified = suppression.justification === "missing" || suppression.justification === "expired"
      return {
        severity: suppression.justification === "expired"
          ? ("block" as const)
          : isUnjustified
            ? ("warn" as const)
            : ("info" as const),
        message: suppressionMessage(suppression),
        location: { file: suppression.file, line: suppression.line },
        data: {
          hash: computeDiagnosticHash(`${suppression.file}:${suppression.line}:${suppression.kind}`),
          kind: suppression.kind,
          rule: suppression.rule,
          justification: suppression.justification,
          justificationSource: suppression.justificationSource,
          bypassTicket: suppression.bypassTicket,
        },
      }
    }),
}

const compareSuppressions = (a: Suppression, b: Suppression): number =>
  suppressionPriority(a) - suppressionPriority(b) ||
  a.file.localeCompare(b.file) ||
  a.line - b.line

const matchesSourcePath = (
  absolutePath: string,
  relativePath: string,
  globs: ReadonlyArray<string>,
): boolean => isExcluded(absolutePath, globs) || matchesAnyGlob(relativePath, globs)

const isBanTsCommentBridge = (
  suppression: { readonly kind: Suppression["kind"]; readonly rule: string | undefined },
  nextLine: string | undefined,
): boolean =>
  suppression.kind === "eslint-disable" &&
  suppression.rule === "@typescript-eslint/ban-ts-comment" &&
  nextLine !== undefined &&
  /@ts-(?:ignore|expect-error)\b/.test(nextLine)

const suppressionPriority = (suppression: Suppression): number => {
  if (suppression.justification === "missing") return 0
  if (suppression.justification === "expired") return 1
  return 2
}

const suppressionMessage = (suppression: Suppression): string => {
  const subject = `${suppression.kind}${suppression.rule ? ` (${suppression.rule})` : ""}`
  if (suppression.justification === "missing") {
    return `${subject} is missing justification`
  }
  if (suppression.justification === "expired") {
    return `${subject} justification expired`
  }
  if (suppression.justificationSource === "inline") {
    return `${subject} has inline justification`
  }
  if (suppression.justificationSource === "contextual") {
    return `${subject} has contextual justification`
  }
  return `${subject} has active bypass${suppression.bypassTicket ? ` ${suppression.bypassTicket}` : ""}`
}

const extractSuppression = (
  line: string,
): {
  kind: "ts-ignore" | "ts-expect-error" | "eslint-disable"
  rule: string | undefined
  inlineJustification: string | undefined
} | undefined => {
  const trimmed = line.trim()

  const tsIgnoreMatch = /\B@ts-ignore\b/.exec(trimmed)
  if (tsIgnoreMatch) {
    return {
      kind: "ts-ignore",
      rule: undefined,
      inlineJustification: inlineTextAfter(trimmed, tsIgnoreMatch.index + tsIgnoreMatch[0].length),
    }
  }

  const tsExpectMatch = /\B@ts-expect-error\b/.exec(trimmed)
  if (tsExpectMatch) {
    return {
      kind: "ts-expect-error",
      rule: undefined,
      inlineJustification: inlineTextAfter(trimmed, tsExpectMatch.index + tsExpectMatch[0].length),
    }
  }

  // Require comment syntax to avoid matching "eslint-disable" inside strings/test descriptions.
  const eslintDisableMatch = /^\s*(?:\/\/\s*|\/\*\s*)eslint-disable(?:-next-line|-line)?\b/.exec(trimmed)
  if (eslintDisableMatch) {
    const rule = eslintRuleAfterMarker(trimmed, eslintDisableMatch[0].length)
    return {
      kind: "eslint-disable",
      rule,
      inlineJustification: inlineEslintJustification(trimmed),
    }
  }

  return undefined
}

const eslintRuleAfterMarker = (line: string, markerEnd: number): string | undefined => {
  const rest = line
    .slice(markerEnd)
    .replace(/\s*\*\/\s*$/, "")
    .trim()
  const reasonMarker = rest.indexOf("--")
  const rule = (reasonMarker === -1 ? rest : rest.slice(0, reasonMarker))
    .replace(/\s*\*\/.*$/, "")
    .trim()
  return rule.length > 0 ? rule : undefined
}

const inlineTextAfter = (line: string, index: number): string | undefined => {
  const text = line
    .slice(index)
    .replace(/^\s*[:,-]?\s*/, "")
    .replace(/\s*\*\/\s*$/, "")
    .trim()
  return isMeaningfulInlineJustification(text) ? text : undefined
}

const inlineEslintJustification = (line: string): string | undefined => {
  const marker = line.indexOf("--")
  const trailingBlockCommentMarker = line.indexOf("*/")
  const trailingLineCommentMarker =
    trailingBlockCommentMarker === -1
      ? -1
      : line.indexOf("//", trailingBlockCommentMarker + 2)
  if (marker === -1 && trailingLineCommentMarker === -1) return undefined
  const start = marker === -1 ? trailingLineCommentMarker + 2 : marker + 2
  const text = line.slice(start).replace(/\s*\*\/\s*$/, "").trim()
  return isMeaningfulInlineJustification(text) ? text : undefined
}

const isMeaningfulInlineJustification = (text: string): boolean => {
  if (text.length < 8) return false
  return /[A-Za-z]{3,}/.test(text)
}

const contextualSuppressionJustification = (lines: ReadonlyArray<string>, suppressionIndex: number): string | undefined => {
  const previous = lines[suppressionIndex - 1]
  if (previous === undefined || previous.trim() === "") return undefined

  const lineComment = contiguousLineCommentText(lines, suppressionIndex - 1)
  if (lineComment !== undefined) return lineComment

  const blockComment = precedingBlockCommentText(lines, suppressionIndex - 1)
  return blockComment
}

const contiguousLineCommentText = (lines: ReadonlyArray<string>, endIndex: number): string | undefined => {
  const comments: Array<string> = []
  for (let i = endIndex; i >= 0; i--) {
    const trimmed = lines[i]?.trim()
    if (trimmed === undefined || !trimmed.startsWith("//")) break
    if (extractSuppression(trimmed) !== undefined || trimmed.includes("taste-allow")) break
    comments.unshift(trimmed.replace(/^\/\/\s?/, "").trim())
  }

  const text = comments.join(" ").trim()
  return isMeaningfulInlineJustification(text) ? text : undefined
}

const precedingBlockCommentText = (lines: ReadonlyArray<string>, endIndex: number): string | undefined => {
  const last = lines[endIndex]?.trim()
  if (last === undefined || !last.endsWith("*/")) return undefined

  const comments: Array<string> = []
  for (let i = endIndex; i >= 0; i--) {
    const trimmed = lines[i]?.trim()
    if (trimmed === undefined) break
    comments.unshift(
      trimmed
        .replace(/^\/\*\*?\s?/, "")
        .replace(/\*\/$/, "")
        .replace(/^\*\s?/, "")
        .trim(),
    )
    if (trimmed.startsWith("/*")) {
      const text = comments.join(" ").trim()
      return isMeaningfulInlineJustification(text) ? text : undefined
    }
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
