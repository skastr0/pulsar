import { IDENTIFIER_PATTERN, scanStructuralSource, TS_KEYWORDS } from "./ts-sl-01-structural-lex.js"

export const analyzeStructuralSource = (
  source: string,
): { readonly tokenCount: number; readonly structuralHash: string } => {
  const state: StructuralScanState = {
    hash: 0,
    tokenCount: 0,
    segmentHasQuestion: false,
    pending: undefined,
    pendingColonWasTernary: false,
    pendingPrev: undefined,
    pendingPrevColonWasTernary: false,
    pendingPrevPrev: undefined,
  }

  scanStructuralSource(source, (token) => {
    acceptStructuralToken(state, token)
  })
  flushPendingStructuralToken(state, undefined)

  return {
    tokenCount: state.tokenCount,
    structuralHash: Math.abs(state.hash).toString(36),
  }
}

type StructuralScanState = {
  hash: number
  tokenCount: number
  segmentHasQuestion: boolean
  pending: string | undefined
  pendingColonWasTernary: boolean
  pendingPrev: string | undefined
  pendingPrevColonWasTernary: boolean
  pendingPrevPrev: string | undefined
}

const acceptStructuralToken = (
  state: StructuralScanState,
  token: string,
): void => {
  const colonWasTernary = structuralTokenColonWasTernary(state, token)
  state.tokenCount += 1
  flushPendingStructuralToken(state, token)
  state.pendingPrevPrev = state.pendingPrev
  state.pendingPrev = state.pending
  state.pendingPrevColonWasTernary = state.pendingColonWasTernary
  state.pending = token
  state.pendingColonWasTernary = colonWasTernary
}

const structuralTokenColonWasTernary = (
  state: StructuralScanState,
  token: string,
): boolean => {
  if (token === ";" || token === "," || token === "{" || token === "}") {
    state.segmentHasQuestion = false
    return false
  }
  if (token === "?") {
    state.segmentHasQuestion = true
    return false
  }
  if (token === ":" && state.segmentHasQuestion) {
    state.segmentHasQuestion = false
    return true
  }
  return false
}

const flushPendingStructuralToken = (
  state: StructuralScanState,
  nextToken: string | undefined,
): void => {
  const token = state.pending
  if (token === undefined) return

  state.hash = appendTokenHash(
    state.hash,
    structuralTokenFor(
      token,
      nextToken,
      state.pendingPrev,
      state.pendingPrevColonWasTernary,
      state.pendingPrevPrev,
    ),
  )
}

const structuralTokenFor = (
  token: string,
  nextToken: string | undefined,
  previousToken: string | undefined,
  previousColonWasTernary: boolean,
  previousPreviousToken: string | undefined,
): string => {
  if (isStringLiteralToken(token)) {
    return isObjectPropertyValue(
      previousToken,
      previousColonWasTernary,
      previousPreviousToken,
    ) ? `STR:${token}` : "STR"
  }

  if (IDENTIFIER_PATTERN.test(token) && !TS_KEYWORDS.has(token)) {
    return nextToken === ":" ? `KEY:${token}` : "ID"
  }

  return token
}

const appendTokenHash = (hash: number, token: string): number => {
  let next = hash
  for (let index = 0; index < token.length; index++) {
    const charCode = token.charCodeAt(index)
    next = ((next << 5) - next) + charCode
    next = next & next
  }
  return next
}

const isStringLiteralToken = (token: string): boolean =>
  (token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))

const isObjectPropertyValue = (
  previousToken: string | undefined,
  previousColonWasTernary: boolean,
  previousPreviousToken: string | undefined,
): boolean => {
  if (previousToken !== ":" || previousColonWasTernary) return false
  return previousPreviousToken !== undefined &&
    (IDENTIFIER_PATTERN.test(previousPreviousToken) || isStringLiteralToken(previousPreviousToken))
}
