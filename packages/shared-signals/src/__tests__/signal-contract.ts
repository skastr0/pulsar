import { expect } from "bun:test"
import type { AnySignal } from "@skastr0/pulsar-core/signal"

export const REQUIRED_SIGNAL_CONTRACT_EVIDENCE = [
  "identity",
  "config",
  "positiveFixture",
  "negativeFixture",
  "applicability",
  "score",
  "diagnostics",
  "factorLedger",
  "cacheSemantics",
] as const

export const CONDITIONAL_SIGNAL_CONTRACT_EVIDENCE = [
  "compoundInputs",
  "gitContext",
  "referenceData",
  "calibration",
  "integration",
] as const

export type SignalContractEvidence =
  | (typeof REQUIRED_SIGNAL_CONTRACT_EVIDENCE)[number]
  | (typeof CONDITIONAL_SIGNAL_CONTRACT_EVIDENCE)[number]

export interface SignalContract {
  readonly id: string
  readonly status: "pending" | "verified"
  readonly requiredEvidence?: ReadonlyArray<SignalContractEvidence>
  readonly evidence?: Partial<Record<SignalContractEvidence, string>>
  readonly pendingReason?: string
}

export const pendingSignalContract = (id: string): SignalContract => ({
  id,
  status: "pending",
  pendingReason: "waiting for the signal's dedicated correctness glyph",
})

export const assertSignalContractMatrix = (
  packName: string,
  signals: ReadonlyArray<AnySignal>,
  contracts: ReadonlyArray<SignalContract>,
): void => {
  const registeredIds = signals.map((signal) => signal.id).sort()
  const contractById = new Map(contracts.map((contract) => [contract.id, contract] as const))

  expect(contractById.size, `${packName} signal contracts must not contain duplicates`).toBe(
    contracts.length,
  )
  expect([...contractById.keys()].sort(), `${packName} signal contracts must cover registry`).toEqual(
    registeredIds,
  )

  for (const signal of signals) {
    const contract = contractById.get(signal.id)
    expect(contract, `${signal.id} must declare a correctness contract`).toBeDefined()
    if (contract === undefined) continue

    if (contract.status === "pending") {
      expect(
        contract.pendingReason,
        `${signal.id} pending contract must explain why it is not verified yet`,
      ).toBeTruthy()
      continue
    }

    const requiredEvidence = new Set<SignalContractEvidence>([
      ...REQUIRED_SIGNAL_CONTRACT_EVIDENCE,
      ...(contract.requiredEvidence ?? []),
    ])

    if (signal.kind === "compound" || signal.inputs.length > 0) {
      requiredEvidence.add("compoundInputs")
    }

    if (signal.cacheDependencies?.includes("git-revision-context")) {
      requiredEvidence.add("gitContext")
    }

    for (const category of requiredEvidence) {
      expectEvidence(signal.id, contract, category)
    }
  }
}

const expectEvidence = (
  signalId: string,
  contract: SignalContract,
  category: SignalContractEvidence,
): void => {
  const evidence = contract.evidence?.[category]
  expect(
    typeof evidence === "string" && evidence.trim().length > 0,
    `${signalId} verified contract must cite ${category} evidence`,
  ).toBe(true)
}
