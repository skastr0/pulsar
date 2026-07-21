import { expect } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
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

/**
 * Evidence authority is independent of execution tier. Production signals
 * must declare it explicitly, and pure heuristic registrations may not claim
 * the proof-grade tiers that can influence headline authority.
 */
export const assertEvidenceClassContracts = (
  packName: string,
  signals: ReadonlyArray<AnySignal>,
): void => {
  const missing = signals
    .filter((signal) => signal.evidenceClass === undefined)
    .map((signal) => signal.id)
  expect(missing, `${packName}: every production signal must declare evidenceClass`).toEqual([])

  const tierWashed = signals
    .filter(
      (signal) =>
        signal.evidenceClass === "heuristic-pattern" &&
        (signal.tier === 1 || signal.tier === 1.5),
    )
    .map((signal) => `${signal.id} (tier ${signal.tier})`)
  expect(
    tierWashed,
    `${packName}: heuristic-pattern evidence may not claim tier 1 or 1.5`,
  ).toEqual([])
}

/**
 * Makes known failure modes greppable and executable: every declaration must
 * point at an exact test title in a repository-owned Bun test file. The pack
 * suites invoke this validator alongside those referenced test files.
 */
export const assertKnownFailureModeReferences = (
  packName: string,
  repoRoot: string,
  signals: ReadonlyArray<AnySignal>,
): void => {
  const root = resolve(repoRoot)
  const failures: string[] = []

  for (const signal of signals) {
    for (const mode of signal.knownFailureModes ?? []) {
      const file = resolve(root, mode.fixture.file)
      const repoRelative = relative(root, file)
      if (repoRelative.startsWith("..") || repoRelative === "") {
        failures.push(`${signal.id}: fixture path must stay inside the repository`)
        continue
      }
      if (!mode.description.trim()) {
        failures.push(`${signal.id}: failure-mode description must not be empty`)
      }
      if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) {
        failures.push(`${signal.id}: ${mode.fixture.file} is not a test file`)
        continue
      }
      if (!existsSync(file)) {
        failures.push(`${signal.id}: fixture file does not exist: ${mode.fixture.file}`)
        continue
      }
      const source = readFileSync(file, "utf8")
      if (!testDeclarationPattern(mode.fixture.testName).test(source)) {
        failures.push(
          `${signal.id}: test title not found in ${mode.fixture.file}: ${mode.fixture.testName}`,
        )
      }
    }
  }

  expect(failures, `${packName}: known failure modes must cite executable tests`).toEqual([])
}

const testDeclarationPattern = (testName: string): RegExp => {
  const doubleQuoted = JSON.stringify(testName)
  const singleQuoted = `'${testName.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`
  return new RegExp(
    `^\\s*(?:test|it)(?:\\.(?:only|skip|todo))?\\s*\\(\\s*(?:${escapeRegExp(doubleQuoted)}|${escapeRegExp(singleQuoted)})\\s*,`,
    "m",
  )
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

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
