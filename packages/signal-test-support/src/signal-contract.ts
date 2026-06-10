import { expect } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
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

/**
 * Tier honesty floor: a signal whose compute consumes reference data is not
 * pure computation, so it may not claim tier 1 or 1.5 — the tiers that
 * carry proof-grade authority (headline poison; hard gates for structural
 * kind without the "given reference data" condition).
 *
 * Detection scans the pack's signal sources for ReferenceDataTag usage and
 * checks the declared tier of every signal registered from a matching file.
 */
export const assertReferenceDataTierFloor = (
  packName: string,
  signalsDir: string,
  signals: ReadonlyArray<AnySignal>,
): void => {
  const offenders: string[] = []
  for (const entry of readdirSync(signalsDir)) {
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue
    const source = readFileSync(join(signalsDir, entry), "utf8")
    if (!source.includes("ReferenceDataTag")) continue
    for (const signal of signals) {
      if (!source.includes(`id: "${signal.id}"`)) continue
      if (signal.tier < 2) {
        offenders.push(
          `${signal.id} (${entry}) declares tier ${signal.tier} but consumes reference data`,
        )
      }
    }
  }
  expect(
    offenders,
    `${packName}: signals consuming reference data must declare tier >= 2`,
  ).toEqual([])
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
