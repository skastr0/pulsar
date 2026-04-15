import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
  buildRegistry,
  makeReferenceData,
  runSignal,
  type Diagnostic,
  type SignalRunResult,
} from "@taste-codec/core"
import { TS_PACK_SIGNALS, TsProjectLayer } from "@taste-codec/ts-pack"
import { Effect, Layer } from "effect"
import { simpleGit } from "simple-git"

export interface ScoreOptions {
  readonly signalId: string
  readonly repoPath: string
}

export const runScoreCommand = (opts: ScoreOptions) =>
  Effect.gen(function* () {
    const worktreePath = resolve(opts.repoPath)
    if (!existsSync(worktreePath)) {
      yield* Effect.logError(`Path does not exist: ${worktreePath}`)
      return
    }

    const git = simpleGit(worktreePath)
    const gitSha = yield* Effect.tryPromise({
      try: () => git.revparse(["HEAD"]),
      catch: (cause) => new Error(`git rev-parse failed: ${String(cause)}`),
    })

    const registry = yield* buildRegistry(TS_PACK_SIGNALS)

    const ContextLayer = Layer.succeed(SignalContextTag, {
      gitSha: gitSha.trim(),
      worktreePath,
      changedHunks: [],
    })
    const ReferenceLayer = Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(new Map()),
    )
    const EnvLayer = Layer.mergeAll(
      ContextLayer,
      ReferenceLayer,
      InMemoryCacheLayer,
      TsProjectLayer(worktreePath),
    )

    const provided = Effect.provide(runSignal(registry, opts.signalId), EnvLayer) as Effect.Effect<
      SignalRunResult,
      unknown,
      never
    >
    const result = yield* provided

    printResult(result.signalId, result.score, result.diagnostics, worktreePath, gitSha.trim())
  })

const printResult = (
  signalId: string,
  score: number,
  diagnostics: ReadonlyArray<Diagnostic>,
  repoPath: string,
  sha: string,
): void => {
  const scoreBar = renderScoreBar(score)
  console.log("")
  console.log(`  Repo:   ${repoPath}`)
  console.log(`  SHA:    ${sha}`)
  console.log(`  Signal: ${signalId}`)
  console.log(`  Score:  ${score.toFixed(3)}  ${scoreBar}`)
  console.log("")
  if (diagnostics.length === 0) {
    console.log("  (no diagnostics)")
    return
  }
  console.log(`  Diagnostics (${diagnostics.length}):`)
  for (const d of diagnostics) {
    const sev = d.severity === "block" ? "!" : d.severity === "warn" ? "⚠" : "·"
    const loc = d.location?.file
      ? ` ${d.location.file}${d.location.line !== undefined ? `:${d.location.line}` : ""}`
      : ""
    console.log(`    ${sev} ${d.message}${loc}`)
  }
  console.log("")
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.round(score * width)
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}
