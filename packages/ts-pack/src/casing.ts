export const CASING_PATTERNS = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  UPPER_SNAKE_CASE: /^[A-Z][A-Z0-9_]*$/,
  snake_case: /^[a-z][a-z0-9_]*$/,
  "kebab-case": /^[a-z][a-z0-9-]*$/,
} as const

export type RecognizedCasingPattern = keyof typeof CASING_PATTERNS
export type IdentifierPattern = RecognizedCasingPattern | "unrecognized"

export const inferCasingPattern = (name: string): IdentifierPattern => {
  for (const [pattern, regex] of Object.entries(CASING_PATTERNS)) {
    if (regex.test(name)) return pattern as RecognizedCasingPattern
  }
  return "unrecognized"
}

export const splitIdentifierTokens = (name: string): ReadonlyArray<string> =>
  name
    .replace(/[_-]+/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0 && /[a-z]/.test(token))

export const matchesCasingPattern = (
  name: string,
  pattern: RecognizedCasingPattern,
): boolean => CASING_PATTERNS[pattern].test(name)

export const isRecognizedCasingPattern = (
  value: string,
): value is RecognizedCasingPattern => value in CASING_PATTERNS

export const parseCasingPatternAlternatives = (
  value: string,
): ReadonlyArray<RecognizedCasingPattern> =>
  value
    .split("|")
    .map((pattern) => pattern.trim())
    .filter(isRecognizedCasingPattern)
