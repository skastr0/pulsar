import { Effect } from "effect"
import {
  compareByIdThenVersion,
  compareProcessor,
  computeResolvedCalibrationFingerprint,
} from "./calibration-fingerprint.js"
import {
  CALIBRATION_SLOT_IDS,
  unchangedCalibrationResult,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationProcessor,
  type CalibrationProcessorError,
  type CalibrationSlotId,
  type CalibrationSlotInput,
  type CalibrationSlotOutput,
  type RepoFacts,
  type ResolvedCalibrationContext,
} from "./calibration-model.js"

export const makeResolvedCalibrationContext = (input: {
  readonly activeModules?: ReadonlyArray<ActiveProjectModule>
  readonly repoFacts: RepoFacts
  readonly processors?: ReadonlyArray<AnyCalibrationProcessor>
}): ResolvedCalibrationContext => {
  const activeModules = [...(input.activeModules ?? [])].sort(compareByIdThenVersion)
  const processors = [...(input.processors ?? [])].sort(compareProcessor)
  const processorsBySlot = groupProcessorsBySlot(processors)

  const context: ResolvedCalibrationContext = {
    fingerprint: computeResolvedCalibrationFingerprint({
      activeModules,
      repoFacts: input.repoFacts,
      processors,
    }),
    activeModules,
    repoFacts: input.repoFacts,
    processors,
    runSlot: <Slot extends CalibrationSlotId>(
      slot: Slot,
      slotInput: CalibrationSlotInput<Slot>,
    ): Effect.Effect<CalibrationSlotOutput<Slot>, CalibrationProcessorError, never> =>
      Effect.gen(function* () {
        let current: CalibrationSlotOutput<Slot> = unchangedCalibrationResult(slotInput)
        const slotProcessors = processorsBySlot.get(slot) ?? []
        for (const processor of slotProcessors) {
          current = yield* runCalibrationProcessor(processor, current, context)
            .pipe(Effect.withSpan(`calibration.${slot}.${processor.moduleId}.${processor.id}`))
        }
        return current
      }),
  }

  return context
}

const groupProcessorsBySlot = (
  processors: ReadonlyArray<AnyCalibrationProcessor>,
): Map<CalibrationSlotId, ReadonlyArray<AnyCalibrationProcessor>> => {
  const processorsBySlot = new Map<CalibrationSlotId, ReadonlyArray<AnyCalibrationProcessor>>()
  for (const slot of CALIBRATION_SLOT_IDS) {
    processorsBySlot.set(
      slot,
      processors.filter((processor) => processor.slot === slot),
    )
  }
  return processorsBySlot
}

const runCalibrationProcessor = <Slot extends CalibrationSlotId>(
  processor: AnyCalibrationProcessor,
  current: CalibrationSlotOutput<Slot>,
  context: ResolvedCalibrationContext,
): Effect.Effect<CalibrationSlotOutput<Slot>, CalibrationProcessorError, never> => {
  const typedProcessor = processor as unknown as CalibrationProcessor<Slot>
  return typedProcessor.process(current, context)
}
