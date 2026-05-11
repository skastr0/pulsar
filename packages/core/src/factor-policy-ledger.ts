import type { CalibrationDecision } from "./calibration-model.js"
import { makeFactorEntry } from "./factor-ledger.js"
import type { SignalFactorLedgerEntry } from "./signal-factor-model.js"

export const factorEntryForPolicyDecision = (
  input: {
    readonly decisions: ReadonlyArray<CalibrationDecision>
    readonly path: string
    readonly title: string
    readonly value: string | number | boolean
  },
): SignalFactorLedgerEntry => {
  const decision = [...input.decisions]
    .reverse()
    .find((item) => item.factorPaths?.includes(input.path))
  return makeFactorEntry({
    path: input.path,
    title: input.title,
    valueKind: typeof input.value === "number"
      ? "number"
      : typeof input.value === "boolean"
        ? "boolean"
        : "string",
    scoreRole: input.path.endsWith(".penalty_weight") ? "penalty" : "metadata",
  }, input.value, {
    source: decision === undefined ? "computed" : "module",
    ...(decision !== undefined
      ? {
          attribution: {
            moduleId: decision.moduleId,
            processorId: decision.processorId,
            ...(decision.ruleId !== undefined ? { ruleId: decision.ruleId } : {}),
            evidence: decision.evidence,
          },
        }
      : {}),
  })
}

export const factorPathSegment = (value: string): string =>
  value.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "_")

export const relativeFactorPath = (file: string, root: string): string =>
  root.length > 0 && file.startsWith(root) ? file.slice(root.length) : file

export const commonDirectoryPrefix = (files: ReadonlyArray<string>): string => {
  if (files.length === 0) return ""
  const normalized = files.map((file) => file.replaceAll("\\", "/"))
  const [first, ...rest] = normalized
  const firstParts = first!.split("/")
  let commonLength = firstParts.length - 1
  for (const file of rest) {
    const parts = file.split("/")
    let index = 0
    while (index < commonLength && firstParts[index] === parts[index]) {
      index += 1
    }
    commonLength = index
  }
  return commonLength <= 0 ? "" : `${firstParts.slice(0, commonLength).join("/")}/`
}
