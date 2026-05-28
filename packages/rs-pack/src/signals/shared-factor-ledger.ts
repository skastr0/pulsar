import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorDefinition,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"

export const makeDefaultSignalFactorLedger = (
  signalId: string,
  definitions: ReadonlyArray<SignalFactorDefinition>,
): SignalFactorLedger =>
  makeFactorLedger(
    signalId,
    definitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )
