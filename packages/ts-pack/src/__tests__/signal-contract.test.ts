import { describe, expect, test } from "bun:test"
import type { AnySignal } from "@skastr0/pulsar-core/signal"
import { TS_PACK_SIGNALS } from "../pack.js"
import {
  REQUIRED_SIGNAL_CONTRACT_EVIDENCE,
  assertSignalContractMatrix,
  type SignalContract,
  type SignalContractEvidence,
} from "./signal-contract.js"
import { TS_SIGNAL_CONTRACTS } from "./signal-contracts.js"

describe("TypeScript signal correctness contracts", () => {
  test("every registered TypeScript signal is tracked by the contract matrix", () => {
    assertSignalContractMatrix("TypeScript", TS_PACK_SIGNALS, TS_SIGNAL_CONTRACTS)
  })

  test("verified contracts must cite every required evidence category", () => {
    const signal = firstSignal()
    const evidence = completeEvidence()
    delete evidence.positiveFixture

    expectContractFailure(signal, {
      id: signal.id,
      status: "verified",
      evidence,
    })
  })

  test("verified contracts honor explicitly required conditional evidence", () => {
    const signal = firstSignal()

    expectContractFailure(signal, {
      id: signal.id,
      status: "verified",
      requiredEvidence: ["referenceData"],
      evidence: completeEvidence(),
    })
  })
})

const firstSignal = (): AnySignal => {
  const signal = TS_PACK_SIGNALS[0]
  if (signal === undefined) throw new Error("TS pack has no signals")
  return signal
}

const completeEvidence = (): Partial<Record<SignalContractEvidence, string>> =>
  Object.fromEntries(
    REQUIRED_SIGNAL_CONTRACT_EVIDENCE.map((category) => [
      category,
      `${category} evidence`,
    ]),
  ) as Partial<Record<SignalContractEvidence, string>>

const expectContractFailure = (
  signal: AnySignal,
  contract: SignalContract,
): void => {
  let failed = false
  try {
    assertSignalContractMatrix("sentinel", [signal], [contract])
  } catch {
    failed = true
  }
  expect(failed).toBe(true)
}
