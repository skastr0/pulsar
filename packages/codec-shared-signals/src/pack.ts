import {
  Shared02BusFactor,
  Shared03ChurnRate,
  SharedChurn01,
  type AnySignal,
} from "@taste-codec/core"
import { Shared05Suppression } from "./shared-05-suppression.js"
import { Shared06PrDepDelta } from "./shared-06-pr-dep-delta.js"

export const SHARED_SIGNALS: ReadonlyArray<AnySignal> = [
  SharedChurn01,
  Shared02BusFactor,
  Shared03ChurnRate,
  Shared05Suppression,
  Shared06PrDepDelta,
]
