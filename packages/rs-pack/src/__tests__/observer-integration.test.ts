import {
  InMemoryCacheLayer,
  SignalContextTag,
} from "@skastr0/pulsar-core/signal"
import {
  buildRegistry,
  observe,
  type ObserverOutput,
} from "@skastr0/pulsar-core/scoring"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RustProjectLayer } from "../project.js"
import { RsAb01 } from "../signals/rs-ab-01-unused-pub.js"
import { RsAb02 } from "../signals/rs-ab-02-trait-object-depth.js"
import { RsAb03 } from "../signals/rs-ab-03-generic-proliferation.js"
import { RsDe04 } from "../signals/rs-de-04-fan-in-fan-out.js"
import { cleanupWorkspace, createRustWorkspace, referenceLayer } from "./helpers.js"

describe("rs-pack integration", () => {
  test("observes a real Rust repo with plausible architectural and legibility output", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-", {
      "Cargo.toml": [
        "[package]",
        'name = "observer-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'anyhow = "1"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub mod api {",
        "    pub struct PublicType;",
        "}",
        "",
        "pub unsafe fn raw_copy<'a: 'b, 'b>(src: *const u8) -> &'a u8 {",
        "    unsafe { &*src }",
        "}",
        "",
        "pub struct ParseError;",
        "",
        "pub fn parse<'a: 'b, 'b>(value: &'a str) -> Result<(), ParseError> {",
        "    match value.len() {",
        "        0 => Ok(()),",
        "        _ => Err(ParseError),",
        "    }",
        "}",
        "",
        "pub fn parse_anyhow(value: &str) -> Result<(), anyhow::Error> {",
        "    if value.is_empty() || value.starts_with('x') {",
        "        Err(anyhow::anyhow!(\"x\"))",
        "    } else {",
        "        Ok(())",
        "    }",
        "}",
        "",
        "pub fn order_line(order_line: &str) -> usize {",
        "    order_line.len()",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
      const EnvLayer = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
        referenceLayer({
          glossary: {
            terms: [{ canonical: "order line" }, { canonical: "parse" }, { canonical: "value" }],
          },
          "schema-conventions": { rust_crate_boundaries: {} },
        }),
        InMemoryCacheLayer,
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )

      expect(result.hard_gate_status).toBe("pass")
      expect(result.categories["architectural-drift"].signalCount).toBe(5)
      expect(result.categories["dependency-entropy"].signalCount).toBe(4)
      expect(result.categories["abstraction-bloat"].signalCount).toBe(5)
      expect(result.categories["legibility-decay"].signalCount).toBe(6)
      expect(result.categories["generated-slop"].signalCount).toBe(5)
      expect(result.categories["review-pain"].signalCount).toBe(11)
      expect(result.categories["legibility-decay"].score).toBeLessThan(1)
      expect(result.minimum?.signal).toBeDefined()
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-AB-01 unused public item score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ab01-", {
      "Cargo.toml": [
        "[package]",
        'name = "unused-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Api;",
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
      const EnvLayer = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
        referenceLayer(),
        InMemoryCacheLayer,
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )
      const unusedPublic = result.signalResults.get(RsAb01.id)

      expect(result.categories["abstraction-bloat"].signals[RsAb01.id]).toBeCloseTo(0.5)
      expect(unusedPublic?.score).toBeCloseTo(0.5)
      expect(unusedPublic?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Public struct Hidden is not referenced from other workspace crates",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-AB-02 trait-object depth score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ab02-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub fn leaf() -> Box<dyn Debug> { Box::new(1_u8) }",
        "pub fn middle() -> Box<dyn Debug> { leaf() }",
        "pub fn top() -> Box<dyn Debug> { middle() }",
        "",
      ].join("\n"),
    })

    try {
      const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
      const EnvLayer = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
        referenceLayer(),
        InMemoryCacheLayer,
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )
      const traitObjectDepth = result.signalResults.get(RsAb02.id)

      expect(result.categories["abstraction-bloat"].signals[RsAb02.id]).toBeCloseTo(1 / 3)
      expect(traitObjectDepth?.score).toBeCloseTo(1 / 3)
      expect(traitObjectDepth?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Trait-object chain depth 3 in top",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-AB-03 generic proliferation score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ab03-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Clean<T>(pub T);",
        "pub fn bound_heavy<T>(value: T)",
        "where",
        "    T: Clone + Send + Sync + Default + 'static + Into<String> + AsRef<str>,",
        "{",
        "    let _ = value;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
      const EnvLayer = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
        referenceLayer(),
        InMemoryCacheLayer,
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )
      const genericProliferation = result.signalResults.get(RsAb03.id)

      expect(result.categories["abstraction-bloat"].signals[RsAb03.id]).toBeCloseTo(0.5)
      expect(genericProliferation?.score).toBeCloseTo(0.5)
      expect(genericProliferation?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "bound_heavy has generic signature complexity 9",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-DE-04 fan-in/fan-out score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-de04-", {
      "Cargo.toml": [
        "[package]",
        'name = "fan-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub mod dep_a { pub struct A; }",
        "pub mod dep_b { pub struct B; }",
        "pub mod dep_c { pub struct C; }",
        "pub mod dep_d { pub struct D; }",
        "",
        "pub mod api {",
        "    use crate::{dep_a::A, dep_b::B, dep_c::C, dep_d::D};",
        "    pub struct Thing;",
        "    pub fn build(_: A, _: B, _: C, _: D) -> Thing { Thing }",
        "}",
        "",
        "pub mod user_one { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod user_two { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod user_three { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod user_four { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod user_five { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod user_six { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "",
      ].join("\n"),
    })

    try {
      const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
      const EnvLayer = Layer.mergeAll(
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        }),
        referenceLayer(),
        InMemoryCacheLayer,
        RustProjectLayer(repo),
      )

      const result = await Effect.runPromise(
        Effect.provide(observe(registry, undefined), EnvLayer) as Effect.Effect<
          ObserverOutput,
          never,
          never
        >,
      )
      const fanInFanOut = result.signalResults.get(RsDe04.id)

      expect(result.categories["dependency-entropy"].signals[RsDe04.id]).toBeCloseTo(0.8166666667)
      expect(fanInFanOut?.score).toBeCloseTo(0.8166666667)
      expect(fanInFanOut?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Module fan-observer::crate::api is a coupling hub (fanIn=6, fanOut=4)",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)
})
