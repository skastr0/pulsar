import { describe, expect, test } from "bun:test"
import type { AnySignal } from "@skastr0/pulsar-core/signal"
import {
  REQUIRED_SIGNAL_CONTRACT_EVIDENCE,
  assertSignalContractMatrix,
  type SignalContract,
  type SignalContractEvidence,
} from "./signal-contract.js"

describe("signal contract test support", () => {
  test("requires every verified contract to cite required evidence", () => {
    const signal = exampleSignal()
    const evidence = completeEvidence()
    delete evidence.score

    expectContractFailure(signal, {
      id: signal.id,
      status: "verified",
      evidence,
    })
  })

  test("requires compound signals to cite compound input evidence", () => {
    const signal = { ...exampleSignal(), kind: "compound", inputs: [{ id: "input" }] } as AnySignal

    expectContractFailure(signal, {
      id: signal.id,
      status: "verified",
      evidence: completeEvidence(),
    })
  })
})

const exampleSignal = (): AnySignal =>
  ({
    id: "TEST-01-example",
    kind: "primitive",
    inputs: [],
  }) as unknown as AnySignal

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
