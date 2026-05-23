import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  computeInterfaceImplementationRatio,
  type DeadInterface,
  type SingleImplPair,
  type TsAb04Output,
} from "./ts-ab-04-analysis.js"
import { TsProjectTag } from "../ts-project.js"

const TsAb04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type TsAb04Config = typeof TsAb04Config.Type

export const TsAb04: Signal<TsAb04Config, TsAb04Output, TsProjectTag> = {
  id: "TS-AB-04-interface-implementation-ratio",
  title: "Interface implementation ratio",
  aliases: ["TS-AB-04"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "interface-implementation-ratio-v7-consumed-cast-usage-v1",
  configSchema: TsAb04Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    public_entry_globs: ["**/src/index.ts", "**/index.ts"],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb04Output => computeInterfaceImplementationRatio(project, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-04-interface-implementation-ratio",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) =>
    Math.max(
      0,
      1 - Math.max(out.singleImplementationPressure, out.deadInterfacePressure),
    ),
  outputMetadata: (out) =>
    out.totalInterfaces === 0 ? { applicability: "not_applicable" as const } : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    diagnostics.push(
      ...out.flaggedPairs.map((pair) => ({
        severity: "warn" as const,
        message:
          `Single-implementation interface ${pair.interfaceName} -> ${pair.implementationName}`,
        location: { file: pair.interfaceFile },
        data: {
          interfaceFile: pair.interfaceFile,
          interfaceName: pair.interfaceName,
          implementationFile: pair.implementationFile,
          implementationName: pair.implementationName,
        },
      })),
    )
    diagnostics.push(
      ...out.deadInterfaces.map((iface) => ({
        severity: "warn" as const,
        message: `Dead interface with no implementation: ${iface.interfaceName}`,
        location: { file: iface.interfaceFile, line: iface.line },
        data: {
          interfaceFile: iface.interfaceFile,
          interfaceName: iface.interfaceName,
        },
      })),
    )
    return diagnostics.slice(0, out.diagnosticLimit)
  },
}
