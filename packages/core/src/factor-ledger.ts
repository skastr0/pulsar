import type {
  SignalFactorDefinition,
  SignalFactorLedger,
  SignalFactorLedgerEntry,
  SignalFactorValue,
} from "./signal.js"

const FACTOR_PATH_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

export interface FactorDefinitionValidationIssue {
  readonly path: string
  readonly message: string
}

export const validateFactorDefinitions = (
  definitions: ReadonlyArray<SignalFactorDefinition>,
): ReadonlyArray<FactorDefinitionValidationIssue> => {
  const issues: Array<FactorDefinitionValidationIssue> = []
  const seen = new Set<string>()

  for (const definition of definitions) {
    if (!FACTOR_PATH_PATTERN.test(definition.path)) {
      issues.push({
        path: definition.path,
        message:
          "Factor paths must be stable lowercase dot/underscore/hyphen paths.",
      })
    }
    if (seen.has(definition.path)) {
      issues.push({
        path: definition.path,
        message: "Factor path is declared more than once.",
      })
    }
    seen.add(definition.path)
  }

  return issues
}

export const assertValidFactorDefinitions = (
  definitions: ReadonlyArray<SignalFactorDefinition>,
): void => {
  const issues = validateFactorDefinitions(definitions)
  if (issues.length === 0) return
  const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")
  throw new Error(`Invalid signal factor definitions: ${detail}`)
}

export const makeFactorEntry = (
  definition: SignalFactorDefinition,
  value: SignalFactorValue,
  options?: {
    readonly source?: SignalFactorLedgerEntry["source"]
    readonly affectsScore?: boolean
    readonly attribution?: SignalFactorLedgerEntry["attribution"]
  },
): SignalFactorLedgerEntry => ({
  path: definition.path,
  title: definition.title,
  scoreRole: definition.scoreRole,
  value,
  source: options?.source ?? "computed",
  affectsScore: options?.affectsScore ?? definition.scoreRole !== "metadata",
  ...(options?.attribution !== undefined ? { attribution: options.attribution } : {}),
})

export const makeFactorLedger = (
  signalId: string,
  entries: ReadonlyArray<SignalFactorLedgerEntry>,
): SignalFactorLedger => ({
  signalId,
  entries: [...entries].sort((left, right) => left.path.localeCompare(right.path)),
})
