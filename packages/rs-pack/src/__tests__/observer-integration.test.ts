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
})
