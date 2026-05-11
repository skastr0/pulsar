/**
 * @skastr0/pulsar-core root.
 *
 * Use named entrypoints for subsystem APIs:
 * `/signal`, `/scoring`, `/observer`, `/vector`, `/calibration`,
 * `/factors`, `/reference-data`, `/routing`, `/time-series`,
 * `/backpressure`, `/shared-signals`, and `/elicitation`.
 */

export const CODEC_CORE_VERSION = "0.0.0" as const

export { buildRegistry, type Registry } from "./registry.js"
export { runSignal, type SignalRunResult } from "./runner.js"
export {
  ObserverOutput,
  observe,
  toObserverJson,
} from "./observer.js"
