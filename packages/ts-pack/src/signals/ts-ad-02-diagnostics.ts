import { hasSuppressingBypass, toExpiredBypassDiagnostic } from "@skastr0/pulsar-core/signal"
import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import {
  formatBreakEdge,
  formatCycleSpan,
  type Cycle,
} from "./ts-ad-02-cycle-graph.js"
import type { TsAd02Output } from "./ts-ad-02-circular-deps.js"

export const diagnoseCircularDependencies = (
  out: TsAd02Output,
): ReadonlyArray<Diagnostic> => {
  const expired = out.expiredBypasses.map(({ file, bypass }) =>
    toExpiredBypassDiagnostic("TS-AD-02", file, bypass),
  )
  const cycles = out.cycles
    .filter((cycle) => !hasSuppressingBypass(cycle.suppressingBypasses))
    .slice(0, out.diagnosticLimit)

  return [
    ...expired,
    ...cycles.map((cycle) => toCycleDiagnostic(cycle, out)),
  ]
}

const toCycleDiagnostic = (
  cycle: Cycle,
  out: TsAd02Output,
): Diagnostic => {
  const members = formatCycleSpan(cycle)
  const breakEdge = formatBreakEdge(cycle)
  const location = cycle.minBreakEdge?.from ?? cycle.modules[0]
  const severity = cycleSeverity(cycle, out)
  return {
    severity,
    message:
      `Circular dependency cluster (${cycle.modules.length} modules; ` +
      (breakEdge === undefined ? "" : `candidate break ${breakEdge}; `) +
      `sample ${members})`,
    ...(location !== undefined ? { location: { file: location } } : {}),
    data: {
      hash: cycle.identityHash,
      size: cycle.modules.length,
      modules: cycle.modules.slice(),
      architecturalSpan: cycle.architecturalSpan,
      minBreakEdge: cycle.minBreakEdge,
      severityReason:
        severity === "block"
          ? "large-or-broad-runtime-cycle"
          : "local-runtime-cycle",
    },
  }
}

const cycleSeverity = (
  cycle: Cycle,
  out: TsAd02Output,
): Diagnostic["severity"] => {
  if (cycle.modules.length >= 20) return "block"
  if (out.cycleCount >= 10) return "block"
  return "warn"
}
