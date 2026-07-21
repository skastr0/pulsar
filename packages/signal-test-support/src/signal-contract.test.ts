import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AnySignal } from "@skastr0/pulsar-core/signal"
import {
  REQUIRED_SIGNAL_CONTRACT_EVIDENCE,
  assertEvidenceClassContracts,
  assertKnownFailureModeReferences,
  assertSignalContractMatrix,
  type SignalContract,
  type SignalContractEvidence,
} from "./signal-contract.js"

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

  test("rejects a Tier-1 heuristic-pattern registration", () => {
    const signal = {
      ...exampleSignal(),
      tier: 1,
      evidenceClass: "heuristic-pattern",
    } as AnySignal

    expect(() => assertEvidenceClassContracts("sentinel", [signal])).toThrow()
  })

  test("known failure modes must cite an exact repository test title", () => {
    const root = mkdtempSync(join(tmpdir(), "pulsar-known-failure-"))
    tempRoots.push(root)
    const file = "signal.test.ts"
    writeFileSync(join(root, file), 'test("proves the boundary", () => {})\n')
    const signal = {
      ...exampleSignal(),
      knownFailureModes: [{
        description: "claim boundary",
        fixture: { file, testName: "proves the boundary" },
      }],
    } as AnySignal

    expect(() => assertKnownFailureModeReferences("sentinel", root, [signal])).not.toThrow()
    expect(() => assertKnownFailureModeReferences("sentinel", root, [{
      ...signal,
      knownFailureModes: [{
        description: "claim boundary",
        fixture: { file, testName: "missing title" },
      }],
    }])).toThrow()

    writeFileSync(join(root, file), '// test("comment-only title", () => {})\n')
    expect(() => assertKnownFailureModeReferences("sentinel", root, [{
      ...signal,
      knownFailureModes: [{
        description: "claim boundary",
        fixture: { file, testName: "comment-only title" },
      }],
    }])).toThrow()
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
