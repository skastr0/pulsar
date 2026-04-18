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
export * from "./distribution.js"
export * from "./signal.js"
export * from "./registry.js"
export * from "./vector.js"
export * from "./runner.js"
export * from "./scoring-engine.js"
