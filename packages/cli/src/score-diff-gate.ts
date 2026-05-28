export type GateStatus = "pass" | "route" | "block"

export type GateDiagnosticRecord = {
  readonly category: string
  readonly tier: number
  readonly kind: string
  readonly enforcement_ceiling: ReadonlyArray<string>
  readonly diagnostic: { readonly severity: string }
}

export const decideGate = (
  allIntroducedDiagnostics: ReadonlyArray<GateDiagnosticRecord>,
  routedDiagnostics: ReadonlyArray<GateDiagnosticRecord>,
): {
  readonly status: GateStatus
  readonly reasons: ReadonlyArray<string>
} => {
  const blocking = allIntroducedDiagnostics.filter(
    (record) =>
      record.diagnostic.severity === "block" &&
      record.tier === 1 &&
      record.kind === "structural" &&
      record.enforcement_ceiling.includes("hard-gate"),
  )
  if (blocking.length > 0) {
    return {
      status: "block",
      reasons: [`${blocking.length} new Tier-1 structural hard-gate diagnostic(s).`],
    }
  }

  const trustRisk = routedDiagnostics.filter((record) =>
    record.category === "security-risk" ||
    record.category === "concurrency-safety" ||
    record.category === "behavior-preservation",
  )
  if (trustRisk.length > 0) {
    return {
      status: "route",
      reasons: [`${trustRisk.length} trust-domain diagnostic(s) need review routing.`],
    }
  }
  if (routedDiagnostics.length > 0) {
    return {
      status: "route",
      reasons: [`${routedDiagnostics.length} introduced diagnostic(s) need review routing.`],
    }
  }
  if (allIntroducedDiagnostics.length > 0) {
    return {
      status: "pass",
      reasons: [
        `No introduced diagnostics in the selected scope; ${allIntroducedDiagnostics.length} whole-repo introduced diagnostic(s) remain outside the changed-only guidance scope.`,
      ],
    }
  }
  return { status: "pass", reasons: ["No introduced diagnostics in the selected scope."] }
}
