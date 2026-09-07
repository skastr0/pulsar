import { factorEntryForPolicyDecision, makeFactorLedger } from "@skastr0/pulsar-core/factors"
import type { SignalFactorLedgerEntry } from "@skastr0/pulsar-core/signal"
import type { TsLd02Output } from "./ts-ld-02-model.js"

const policyFields: Readonly<Record<string, string>> = {
  max_loc: "maxLoc",
  visible: "visible",
  severity: "severity",
  penalty_weight: "penaltyWeight",
}

/** Project existing decisions, including entities no longer emitting diagnostics. */
export const sizePolicyFactorLedger = (output: TsLd02Output) => {
  const entries = new Map<string, SignalFactorLedgerEntry>()
  for (const decision of output.calibrationDecisions) {
    if (decision.slot !== "typescript.size-policy" || decision.after === null || typeof decision.after !== "object") continue
    const after = decision.after as Readonly<Record<string, unknown>>
    for (const path of decision.factorPaths ?? []) {
      const suffix = path.slice(path.lastIndexOf(".") + 1)
      const field = policyFields[suffix]
      if (field === undefined) continue
      const value = after[field]
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue
      entries.set(path, {
        ...factorEntryForPolicyDecision({ decisions: [decision], path, title: `Size policy ${field}`, value }),
        affectsScore: suffix !== "severity",
        scoreRole: suffix === "max_loc" ? "threshold" : suffix === "penalty_weight" ? "penalty" : "metadata",
      })
    }
  }
  return makeFactorLedger("TS-LD-02-function-size-distribution", [...entries.values()])
}
