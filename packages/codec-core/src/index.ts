/**
 * @taste-codec/core — signal interface, registry, taste vector.
 *
 * The load-bearing contract. Real signals live in per-language packs
 * (`@taste-codec/ts-pack`, eventually `@taste-codec/rs-pack`).
 */

export const CODEC_CORE_VERSION = "0.0.0" as const

export * from "./category.js"
export * from "./tier.js"
export * from "./enforcement.js"
export * from "./diagnostic.js"
export * from "./errors.js"
export * from "./context.js"
export * from "./cache.js"
export * from "./cache-disk.js"
export * from "./distribution.js"
export * from "./shared-churn-01.js"
export * from "./shared-02-bus-factor.js"
export * from "./shared-03-churn-rate.js"
export * from "./signal.js"
export * from "./registry.js"
export * from "./vector.js"
export * from "./vector-composition.js"
export * from "./team-vector.js"
export * from "./vector-hierarchy.js"
export * from "./bypass.js"
export * from "./baseline.js"
export * from "./glossary.js"
export * from "./conventions.js"
export * from "./reference-data-loader.js"
export * from "./runner.js"
export * from "./scoring-engine.js"
export * from "./observer.js"
export * from "./time-series.js"
export * from "./goodhart.js"
export * from "./backpressure.js"
export * from "./epistemology-signals.js"
export * from "./routing.js"
export * from "./review-plan.js"
export * from "./presets.js"
export * from "./elicitation/proposals.js"
export * from "./elicitation/revealed-preference.js"
export * from "./elicitation/quiz.js"
