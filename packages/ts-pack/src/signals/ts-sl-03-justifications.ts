import type { Suppression } from "./ts-sl-03-suppressions.js"

export const suppressionMessage = (suppression: Suppression): string => {
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

export const extractSuppression = (
  line: string,
): {
  kind: "ts-ignore" | "ts-expect-error" | "eslint-disable"
  rule: string | undefined
  inlineJustification: string | undefined
} | undefined => {
  const trimmed = line.trim()

  const tsIgnoreMatch = /^\/\/\s*@ts-ignore\b/.exec(trimmed)
  if (tsIgnoreMatch) {
    return {
      kind: "ts-ignore",
      rule: undefined,
      inlineJustification: inlineTextAfter(trimmed, tsIgnoreMatch.index + tsIgnoreMatch[0].length),
    }
  }

  const tsExpectMatch = /^\/\/\s*@ts-expect-error\b/.exec(trimmed)
  if (tsExpectMatch) {
    return {
      kind: "ts-expect-error",
      rule: undefined,
      inlineJustification: inlineTextAfter(trimmed, tsExpectMatch.index + tsExpectMatch[0].length),
    }
  }

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

export const contextualSuppressionJustification = (
  lines: ReadonlyArray<string>,
  suppressionIndex: number,
  suppression: { readonly kind: Suppression["kind"]; readonly rule: string | undefined },
): string | undefined => {
  const nearbyComment = nearbyPrecedingCommentJustification(lines, suppressionIndex)
  if (nearbyComment !== undefined) return nearbyComment

  const previous = lines[suppressionIndex - 1]
  if (previous === undefined || previous.trim() === "") return undefined

  const lineComment = contiguousLineCommentText(lines, suppressionIndex - 1)
  if (lineComment !== undefined) return lineComment

  const blockComment = precedingBlockCommentText(lines, suppressionIndex - 1)
  return blockComment
}

export const inheritedRecentJustification = (
  recentJustifications: ReadonlyMap<string, { readonly line: number; readonly text: string }>,
  suppression: { readonly kind: Suppression["kind"]; readonly rule: string | undefined },
  line: number,
): string | undefined => {
  const recent = recentJustifications.get(suppressionKey(suppression))
  if (recent === undefined) return undefined
  return line - recent.line <= 20 ? recent.text : undefined
}

export const suppressionKey = (
  suppression: { readonly kind: Suppression["kind"]; readonly rule: string | undefined },
): string => `${suppression.kind}:${suppression.rule ?? ""}`

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

const nearbyPrecedingCommentJustification = (
  lines: ReadonlyArray<string>,
  suppressionIndex: number,
): string | undefined => {
  for (let index = suppressionIndex - 1; index >= Math.max(0, suppressionIndex - 4); index--) {
    const trimmed = lines[index]?.trim()
    if (trimmed === undefined || trimmed.length === 0) return undefined
    if (trimmed.startsWith("//")) {
      if (extractSuppression(trimmed) !== undefined || trimmed.includes("pulsar-allow")) return undefined
      const text = contiguousLineCommentText(lines, index)
      return text !== undefined && interveningLinesAreExpressionScaffold(lines, index + 1, suppressionIndex - 1)
        ? text
        : undefined
    }
    if (trimmed.endsWith("*/")) {
      const text = precedingBlockCommentText(lines, index)
      return text !== undefined && interveningLinesAreExpressionScaffold(lines, index + 1, suppressionIndex - 1)
        ? text
        : undefined
    }
    if (!isExpressionScaffoldLine(trimmed)) return undefined
  }

  return undefined
}

const interveningLinesAreExpressionScaffold = (
  lines: ReadonlyArray<string>,
  startIndex: number,
  endIndex: number,
): boolean => {
  for (let index = startIndex; index <= endIndex; index++) {
    const trimmed = lines[index]?.trim()
    if (trimmed === undefined || trimmed.length === 0) return false
    if (!isExpressionScaffoldLine(trimmed)) return false
  }
  return true
}

const isExpressionScaffoldLine = (line: string): boolean =>
  /^[A-Za-z_$][\w$.'"\[\]!?:<>= ]*(?:&&|\|\||[({:,])$/.test(line) ||
  /^(?:if|return|const|let|var)\b.*[({:,]$/.test(line)

const contiguousLineCommentText = (lines: ReadonlyArray<string>, endIndex: number): string | undefined => {
  const comments: Array<string> = []
  for (let i = endIndex; i >= 0; i--) {
    const trimmed = lines[i]?.trim()
    if (trimmed === undefined || !trimmed.startsWith("//")) break
    if (extractSuppression(trimmed) !== undefined || trimmed.includes("pulsar-allow")) break
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
