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
import { RsAb04 } from "../signals/rs-ab-04-derive-density.js"
import { RsDe04 } from "../signals/rs-de-04-fan-in-fan-out.js"
import { RsLd01 } from "../signals/rs-ld-01-unsafe.js"
import { RsLd02 } from "../signals/rs-ld-02-lifetimes.js"
import { RsLd03 } from "../signals/rs-ld-03-match-catch-all.js"
import { RsLd04 } from "../signals/rs-ld-04-error-granularity.js"
import { RsLd05 } from "../signals/rs-ld-05-complexity.js"
import { RsLd06 } from "../signals/rs-ld-06-domain-terms.js"
import { RsSl01 } from "../signals/rs-sl-01-duplication.js"
import { RsSl02 } from "../signals/rs-sl-02-suppressions.js"
import { RsSl03 } from "../signals/rs-sl-03-unwrap-expect.js"
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

  test("observer path carries RS-LD-01 unsafe score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld01-", {
      "Cargo.toml": [
        "[package]",
        'name = "unsafe-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub unsafe fn raw_copy(src: *const u8) -> u8 {",
        "    unsafe { *src }",
        "}",
        "",
        "pub fn clean() -> u8 { 0 }",
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
      const unsafeCode = result.signalResults.get(RsLd01.id)

      expect(result.categories["legibility-decay"].signals[RsLd01.id]).toBe(0)
      expect(unsafeCode?.score).toBe(0)
      expect(unsafeCode?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Unsafe surface in unsafe-observer::crate: 50% functions, 1.00 unsafe sites/function",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-LD-02 lifetime score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld02-", {
      "Cargo.toml": [
        "[package]",
        'name = "lifetime-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn heavy<'a: 'b, 'b, 'c>(left: &'a str, right: &'b str) -> &'c str",
        "where",
        "    'a: 'b,",
        "    'b: 'c,",
        "{",
        "    let _ = (left, right);",
        "    unreachable!()",
        "}",
        "",
        "pub fn simple_a<'a>(value: &'a str) -> &'a str { value }",
        "pub fn simple_b<'a>(value: &'a str) -> &'a str { value }",
        "pub fn simple_c<'a>(value: &'a str) -> &'a str { value }",
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
      const lifetimeComplexity = result.signalResults.get(RsLd02.id)

      expect(result.categories["legibility-decay"].signals[RsLd02.id]).toBeCloseTo(0.5)
      expect(lifetimeComplexity?.score).toBeCloseTo(0.5)
      expect(lifetimeComplexity?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Lifetime complexity in heavy: 15 (params:3, bounds:5, in:2, out:1)",
        data: expect.objectContaining({
          complexity: 15,
          scoreMode: "double-weighted-over-threshold-lifetime-functions",
          scoreDenominator: "lifetime-bearing-functions",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-LD-03 catch-all score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld03-", {
      "Cargo.toml": [
        "[package]",
        'name = "catch-all-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn fallback(value: u8) -> u8 {",
        "    match value {",
        "        0 => 0,",
        "        other => other,",
        "    }",
        "}",
        "",
        "pub fn clean_a(value: u8) -> u8 {",
        "    match value {",
        "        0 => 0,",
        "        1 => 1,",
        "        2 => 2,",
        "    }",
        "}",
        "",
        "pub fn clean_b(value: u8) -> u8 {",
        "    match value {",
        "        3 => 3,",
        "        4 => 4,",
        "        5 => 5,",
        "    }",
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
      const matchCatchAll = result.signalResults.get(RsLd03.id)

      expect(result.categories["legibility-decay"].signals[RsLd03.id]).toBeCloseTo(1 / 3)
      expect(matchCatchAll?.score).toBeCloseTo(1 / 3)
      expect(matchCatchAll?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Match in fallback uses 1 catch-all arm(s)",
        data: expect.objectContaining({
          catchAllArmCount: 1,
          scoreMode: "double-weighted-catch-all-match-share",
          scoreDenominator: "analyzed-match-expressions",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-LD-04 error granularity score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld04-", {
      "Cargo.toml": [
        "[package]",
        'name = "error-granularity-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'anyhow = "1"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct DomainError;",
        "pub fn parse(value: &str) -> Result<(), DomainError> { let _ = value; Ok(()) }",
        "pub fn load(value: &str) -> anyhow::Result<()> { let _ = value; Ok(()) }",
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
      const errorGranularity = result.signalResults.get(RsLd04.id)

      expect(result.categories["legibility-decay"].signals[RsLd04.id]).toBeCloseTo(0.5)
      expect(errorGranularity?.score).toBeCloseTo(0.5)
      expect(errorGranularity?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Boundary function load returns collapsed error type anyhow::Error",
        data: expect.objectContaining({
          errorType: "anyhow::Error",
          classification: "collapsed",
          scoreMode: "granular-result-boundary-share",
          scoreDenominator: "public-result-boundary-functions",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-LD-05 cyclomatic complexity score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld05-", {
      "Cargo.toml": [
        "[package]",
        'name = "complexity-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn complex(value: u8) -> u8 {",
        "    if value > 0 && value < 10 {",
        "        1",
        "    } else {",
        "        match value {",
        "            0 => 0,",
        "            1 => 1,",
        "            2 => 2,",
        "            3 => 3,",
        "            4 => 4,",
        "            5 => 5,",
        "            6 => 6,",
        "            7 => 7,",
        "            8 => 8,",
        "            _ => 9,",
        "        }",
        "    }",
        "}",
        "",
        "pub fn simple_a(value: u8) -> u8 { value }",
        "pub fn simple_b(value: u8) -> u8 { value }",
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
      const cyclomaticComplexity = result.signalResults.get(RsLd05.id)

      expect(result.categories["legibility-decay"].signals[RsLd05.id]).toBeCloseTo(1 / 3)
      expect(cyclomaticComplexity?.score).toBeCloseTo(1 / 3)
      expect(cyclomaticComplexity?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Function complex has cyclomatic complexity 13",
        data: expect.objectContaining({
          complexity: 13,
          scoreMode: "double-weighted-over-threshold-functions",
          scoreDenominator: "analyzed-functions",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-LD-06 domain term score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ld06-", {
      "Cargo.toml": [
        "[package]",
        'name = "domain-terms-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub mod domain {",
        "    pub fn order_line(order_line: &str) -> usize {",
        "        order_line.len()",
        "    }",
        "",
        "    pub fn ordr_line(order_line: &str) -> usize {",
        "        order_line.len()",
        "    }",
        "",
        "    pub fn invoice_probe(invoice_probe: &str) -> usize {",
        "        invoice_probe.len()",
        "    }",
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
            terms: [{ canonical: "domain" }, { canonical: "order line" }],
          },
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
      const domainTermConsistency = result.signalResults.get(RsLd06.id)

      expect(result.categories["legibility-decay"].signals[RsLd06.id]).toBeCloseTo(1 - 1.2 / 7)
      expect(domainTermConsistency?.score).toBeCloseTo(1 - 1.2 / 7)
      expect(domainTermConsistency?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Identifier ordr_line classified as conflicts-with-canonical (suggested: order line)",
        data: expect.objectContaining({
          name: "ordr_line",
          kind: "function",
          scoreMode: "weighted-domain-term-drift-share",
          scoreDenominator: "classified-identifiers",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-SL-01 duplication score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-sl01-", {
      "Cargo.toml": [
        "[package]",
        'name = "duplication-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn first(values: &[i32]) -> i32 {",
        "    let mut total = 0;",
        "    for value in values {",
        "        if *value > 10 { total += *value } else { total -= *value }",
        "    }",
        "    if total > 100 { total } else { total + 1 }",
        "}",
        "",
        "pub fn second(values: &[i32]) -> i32 {",
        "    let mut total = 0;",
        "    for value in values {",
        "        if *value > 10 { total += *value } else { total -= *value }",
        "    }",
        "    if total > 100 { total } else { total + 1 }",
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
      const duplication = result.signalResults.get(RsSl01.id)

      expect(result.categories["generated-slop"].signals[RsSl01.id]).toBeCloseTo(0.99)
      expect(duplication?.score).toBeCloseTo(0.99)
      expect(duplication?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "exact duplicate group with 2 functions",
        data: expect.objectContaining({
          kind: "exact",
          scopeMode: "whole-tree",
          scoreMode: "bounded-duplicate-function-pressure",
          scoreDenominator: "analyzed-functions",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-SL-02 suppression score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-sl02-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(clippy::unwrap_used)]",
        "pub fn unguarded(value: Option<u32>) -> u32 { value.unwrap() }",
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
      const suppression = result.signalResults.get(RsSl02.id)

      expect(result.categories["generated-slop"].signals[RsSl02.id]).toBe(0)
      expect(suppression?.score).toBe(0)
      expect(suppression?.diagnostics[0]).toMatchObject({
        severity: "block",
        message: "Governed allow suppression for clippy::unwrap_used is missing",
        data: expect.objectContaining({
          lints: ["clippy::unwrap_used"],
          scoreMode: "governed-allow-debt",
          scoreDenominator: "governed-allow-attributes",
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)

  test("observer path carries RS-SL-03 unwrap expect score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-sl03-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn unwrapped(value: Option<u32>) -> u32 { value.unwrap() }",
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
      const panicUsage = result.signalResults.get(RsSl03.id)

      expect(result.categories["generated-slop"].signals[RsSl03.id]).toBeCloseTo(0.949)
      expect(panicUsage?.score).toBeCloseTo(0.949)
      expect(panicUsage?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "panic-observer::crate contains 1 unwrap/expect call sites",
        data: expect.objectContaining({
          unwrapExpectCalls: 1,
          density: 1,
          scoreMode: "bounded-unwrap-expect-density",
          scoreDenominator: "analyzed-functions-per-module",
        }),
      })
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

  test("observer path carries RS-AB-04 derive density score and diagnostics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-observer-ab04-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-observer"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Clean;",
        "#[derive(Clone, Debug, Default, Eq, PartialEq)]",
        "pub struct TotalHeavy;",
        "#[derive(Clone, Serialize, Deserialize)]",
        "pub struct CustomHeavy;",
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
      const deriveDensity = result.signalResults.get(RsAb04.id)

      expect(result.categories["abstraction-bloat"].signals[RsAb04.id]).toBeCloseTo(1 / 3)
      expect(deriveDensity?.score).toBeCloseTo(1 / 3)
      expect(deriveDensity?.diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "TotalHeavy derives 5 macros",
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
