import { describe, expect, test } from "bun:test"
import { RsLd01 } from "../signals/rs-ld-01-unsafe.js"
import { RsLd02 } from "../signals/rs-ld-02-lifetimes.js"
import { RsLd03 } from "../signals/rs-ld-03-match-catch-all.js"
import { RsLd04 } from "../signals/rs-ld-04-error-granularity.js"
import { RsLd05 } from "../signals/rs-ld-05-complexity.js"
import { RsLd06 } from "../signals/rs-ld-06-domain-terms.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
} from "./helpers.js"

const createLegibilityWorkspace = () =>
  createRustWorkspace("taste-codec-rs-ld-", {
    "Cargo.toml": [
      "[package]",
      'name = "legibility-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'anyhow = "1"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub struct ParseError;",
      "",
      "pub mod safe_zone {",
      "    pub fn raw_deref(ptr: *const u8) -> u8 {",
      "        unsafe { *ptr }",
      "    }",
      "}",
      "",
      "pub mod ffi {",
      "    pub unsafe fn raw_copy<'a: 'b, 'b>(src: *const u8) -> &'a u8 {",
      "        unsafe { &*src }",
      "    }",
      "}",
      "",
      "pub mod parser {",
      "    use super::ParseError;",
      "",
      "    pub fn parse<'a: 'b, 'b>(value: &'a str) -> Result<(), ParseError> {",
      "        match value.len() {",
      "            0 => Ok(()),",
      "            _ => Err(ParseError),",
      "        }",
      "    }",
      "",
      "    pub fn parse_anyhow(value: &str) -> Result<(), anyhow::Error> {",
      "        if value.is_empty() || value.starts_with('x') {",
      "            Err(anyhow::anyhow!(\"x\"))",
      "        } else if value.len() > 3 {",
      "            Ok(())",
      "        } else {",
      "            Ok(())",
      "        }",
      "    }",
      "}",
      "",
      "pub mod domain {",
      "    pub fn order_line(order_line: &str) -> usize {",
      "        order_line.len()",
      "    }",
      "",
      "    pub fn line_order(order_line: &str) -> usize {",
      "        order_line.len()",
      "    }",
      "",
      "    pub fn ordr_line(order_line: &str) -> usize {",
      "        order_line.len()",
      "    }",
      "",
      "    pub fn telemetry_probe(order_line: &str) -> usize {",
      "        if order_line.is_empty() {",
      "            0",
      "        } else if order_line.len() > 2 && order_line.len() < 5 {",
      "            1",
      "        } else {",
      "            2",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n"),
  })

describe("RS-LD-* signals", () => {
  test("RS-LD-01 reports unsafe density and safe-only violations", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(
        RsLd01,
        repo,
        {
          ...RsLd01.defaultConfig,
          safe_only_modules: ["legibility-fixture::crate::safe_zone"],
        },
      )

      expect(out.totalUnsafeBlocks).toBe(2)
      expect(out.totalUnsafeFunctions).toBe(1)
      expect(out.propagationMode).toBe("local-signature-only")
      expect(out.safeOnlyViolations.map((module) => module.module)).toContain(
        "legibility-fixture::crate::safe_zone",
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-02 counts lifetime parameters, bounds, and positions", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(RsLd02, repo, RsLd02.defaultConfig)
      const parse = out.functions.find((fn) => fn.name === "parse")

      expect(parse).toBeDefined()
      expect(parse?.lifetimeParams).toBe(2)
      expect(parse?.lifetimeBounds).toBeGreaterThanOrEqual(1)
      expect(parse?.inputPositions).toBeGreaterThanOrEqual(1)
      expect(parse?.outputPositions).toBe(0)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-03 measures catch-all usage in match expressions", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(RsLd03, repo, RsLd03.defaultConfig)
      expect(out.totalMatches).toBe(1)
      expect(out.matchesWithCatchAll).toBe(1)
      expect(out.totalCatchAllArms).toBe(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-04 distinguishes granular and collapsed boundary errors", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(RsLd04, repo, RsLd04.defaultConfig)
      expect(out.totalBoundaryResults).toBe(2)
      expect(out.granularCount).toBe(1)
      expect(out.collapsedCount).toBe(1)
      expect(out.boundaryFunctions.find((fn) => fn.name === "parse_anyhow")?.classification).toBe(
        "collapsed",
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-05 computes standard cyclomatic complexity", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(
        RsLd05,
        repo,
        { ...RsLd05.defaultConfig, max_complexity: 3 },
      )
      const telemetry = out.functions.find((fn) => fn.name === "telemetry_probe")
      expect(telemetry).toBeDefined()
      expect(telemetry?.complexity).toBeGreaterThan(3)
      expect(out.analysisMode).toBe("standard-cyclomatic")
      expect(out.overThresholdCount).toBeGreaterThanOrEqual(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-06 classifies identifier glossary drift", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(RsLd06, repo, RsLd06.defaultConfig, {
        glossary: {
          terms: [
            { canonical: "order line" },
            { canonical: "parse" },
            { canonical: "value" },
            { canonical: "raw copy" },
          ],
        },
      })

      expect(out.referenceDataStatus).toBe("loaded")
      expect(out.identifiers.find((item) => item.name === "order_line")?.classification).toBe(
        "matches-glossary",
      )
      expect(out.identifiers.find((item) => item.name === "line_order")?.classification).toBe(
        "duplicates-canonical",
      )
      expect(out.identifiers.find((item) => item.name === "ordr_line")?.classification).toBe(
        "conflicts-with-canonical",
      )
      expect(
        out.identifiers.find((item) => item.name === "telemetry_probe")?.classification,
      ).toBe("new-unique")
    } finally {
      await cleanupWorkspace(repo)
    }
  })
})
