import {
  isActive as vectorIsActive,
  type PulsarVector,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import {
  buildRegistry,
  type Registry,
} from "@skastr0/pulsar-core/scoring"
import { RS_PACK_SIGNALS, isRustSignalPath } from "@skastr0/pulsar-rs-pack"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
import { Effect } from "effect"
import { simpleGit } from "simple-git"
import { resolveRepoRoot } from "./runtime-git.js"

/**
 * The pulsar registry ships both TS and Rust packs, but each repo only
 * activates the packs that have local source evidence.
 */
const PULSAR_SIGNALS = [...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]
const PULSAR_SHARED_SIGNALS = SHARED_SIGNALS

export const isReservedRustSignalId = (signalId: string): boolean => signalId.startsWith("RS-")

export const formatReservedRustSignalMessage = (signalId: string): string =>
  `Signal ${signalId} is not implemented yet. The Rust pack now supports RS-AD-* and RS-LD-* batch 1, but this signal still belongs to a later Rust glyph.`

export const buildPulsarRegistry = (repoPath?: string): Effect.Effect<Registry, Error, never> =>
  Effect.gen(function* () {
    if (repoPath === undefined) {
      return (yield* buildRegistry([...PULSAR_SHARED_SIGNALS, ...PULSAR_SIGNALS])) as Registry
    }

    const repoRoot = yield* resolveRepoRoot(repoPath)
    const signals = yield* detectPulsarSignals(repoRoot)
    return (yield* buildRegistry([...PULSAR_SHARED_SIGNALS, ...signals])) as Registry
  })

export const collectActiveLanguagePacks = (
  registry: Registry,
  vector: PulsarVector | undefined,
): { readonly typescript: boolean; readonly rust: boolean } => {
  let typescript = false
  let rust = false
  for (const signal of registry.sorted) {
    if (!vectorIsActive(signal, vector)) continue
    if (signal.id.startsWith("TS-")) typescript = true
    if (signal.id.startsWith("RS-")) rust = true
  }
  return { typescript, rust }
}

export const validateVectorAgainstPulsarSignals = (
  vector: PulsarVector,
  repoRoot?: string,
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    const fullRegistry = yield* buildRegistry([
      ...PULSAR_SHARED_SIGNALS,
      ...PULSAR_SIGNALS,
    ])
    yield* validateVectorAgainstRegistry(vector, fullRegistry)
  })

const detectPulsarSignals = (repoRoot: string) =>
  Effect.gen(function* () {
    const git = simpleGit(repoRoot)
    const raw = yield* Effect.tryPromise({
      try: () =>
        git.raw(["ls-files", "--cached", "--others", "--exclude-standard"]),
      catch: (cause) =>
        new Error(`Failed to list repo files for signal detection: ${String(cause)}`),
    })
    const files = raw
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file.length > 0)

    const hasTypeScript = files.some(
      (file) => file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith("tsconfig.json"),
    )
    const hasRust = files.some(isRustSignalPath)

    return [
      ...(hasTypeScript || hasRust ? PULSAR_SHARED_SIGNALS : []),
      ...(hasTypeScript ? TS_PACK_SIGNALS : []),
      ...(hasRust ? RS_PACK_SIGNALS : []),
    ]
  })
