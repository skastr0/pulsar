import { describe, expect, test } from "bun:test"
import { RsSl01 } from "../signals/rs-sl-01-duplication.js"
import { RsSl02 } from "../signals/rs-sl-02-suppressions.js"
import { RsSl03 } from "../signals/rs-sl-03-unwrap-expect.js"
import { RsSl04 } from "../signals/rs-sl-04-clone-abuse.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
} from "./helpers.js"

describe("RS-SL-* signals", () => {
  test("RS-SL-01 finds exact and structural duplication", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl01-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn first(input: i32) -> i32 { if input > 10 { input + 1 } else { input - 1 } }",
        "pub fn second(value: i32) -> i32 { if value > 10 { value + 1 } else { value - 1 } }",
        "pub fn third(input: i32) -> i32 { if input > 10 { input + 1 } else { input - 1 } }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl01, repo, RsSl01.defaultConfig)
      expect(out.groups.length).toBeGreaterThanOrEqual(1)
      expect(out.groups.some((group) => group.kind === "structural")).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-01 does not let structural-only boilerplate collapse whole-tree score", () => {
    const score = RsSl01.score({
      groups: Array.from({ length: 50 }, (_, index) => ({
        kind: "structural" as const,
        tokenCount: 12,
        members: [
          { file: "src/lib.rs", module: "crate", name: `getter_${index}`, line: index + 1 },
          { file: "src/lib.rs", module: "crate", name: `accessor_${index}`, line: index + 101 },
        ],
      })),
      scopeMode: "whole-tree",
      analysisMode: "function-body-normalization",
    })

    expect(score).toBeGreaterThan(0.8)
  })

  test("RS-SL-01 treats helper-scale exact clones as low whole-tree pressure", () => {
    const score = RsSl01.score({
      groups: Array.from({ length: 25 }, (_, index) => ({
        kind: "exact" as const,
        tokenCount: 12,
        members: [
          { file: "src/lib.rs", module: "crate", name: `helper_${index}`, line: index + 1 },
          { file: "src/lib.rs", module: "crate", name: `helper_copy_${index}`, line: index + 101 },
        ],
      })),
      scopeMode: "whole-tree",
      analysisMode: "function-body-normalization",
    })

    expect(score).toBe(1)
  })

  test("RS-SL-02 enforces pulsar-allow governance on suspicious allow attributes", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "// pulsar-allow ENG-123 until:2099-01-01 tracked lint debt",
        "#[allow(dead_code, clippy::unwrap_used)]",
        "pub fn guarded(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
        "#[allow(warnings)]",
        "pub fn unguarded() {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, repo, RsSl02.defaultConfig)
      expect(out.governedAllowAttributeCount).toBe(2)
      expect(out.ordinaryAllowAttributeCount).toBe(0)
      expect(out.ordinaryAllowLintCount).toBe(1)
      expect(out.missingJustificationCount).toBe(1)
      expect(out.expiredJustificationCount).toBe(0)
      expect(out.suppressions.map((suppression) => suppression.lints)).toEqual([
        ["clippy::unwrap_used"],
        ["warnings"],
      ])
      expect(out.suppressions[0]?.ordinaryLints).toEqual(["dead_code"])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 treats narrow ordinary Rust allow attributes as non-governed", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-ordinary-", {
      "Cargo.toml": [
        "[package]",
        'name = "ordinary-allow-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(dead_code)]",
        "const RESERVED_PROTOCOL_VERSION: u32 = 1;",
        "",
        "#[allow(clippy::too_many_arguments)]",
        "pub fn api_shape(_a: u32, _b: u32, _c: u32, _d: u32, _e: u32, _f: u32, _g: u32) -> u32 { 1 }",
        "",
        "#[allow(clippy::large_enum_variant)]",
        "pub enum WireEvent { Small(u8), Large([u8; 512]) }",
        "",
        "#[allow(unused)]",
        "pub fn future_hook() {}",
        "",
        "#[allow(unused_variables)]",
        "pub fn platform_hook(data: u32) {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, repo, RsSl02.defaultConfig)
      expect(out.suppressions).toEqual([])
      expect(out.governedAllowAttributeCount).toBe(0)
      expect(out.ordinaryAllowAttributeCount).toBe(5)
      expect(out.ordinaryAllowLintCount).toBe(5)
      expect(RsSl02.score(out)).toBe(1)
      expect(RsSl02.diagnose(out)).toEqual([])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-03 excludes unwrap/expect inside cfg(test) blocks", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl03-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn prod() { let _ = Some(1).unwrap(); }",
        "",
        "#[cfg(test)]",
        "mod tests {",
        "    #[test]",
        "    fn uses_expect() { let _ = Some(1).expect(\"x\"); }",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl03, repo, RsSl03.defaultConfig)
      expect(out.totalCalls).toBe(1)
      expect(out.modules[0]?.unwrapExpectCalls).toBe(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-03 scales repo-wide unwrap pressure without automatic zero score", () => {
    const score = RsSl03.score({
      modules: Array.from({ length: 10 }, (_, index) => ({
        module: `crate::module_${index}`,
        file: "src/lib.rs",
        unwrapExpectCalls: 5,
        density: 0.5,
      })),
      totalCalls: 50,
      analysisMode: "call-expression-field-scan",
    })

    expect(score).toBeGreaterThan(0.7)
  })

  test("RS-SL-04 highlights syntax-likely expensive clone patterns", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl04-", {
      "Cargo.toml": [
        "[package]",
        'name = "clone-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn clones() {",
        "    let _copied = String::from(\"hello\").clone();",
        "    let arc = std::sync::Arc::new(1);",
        "    let _shared = arc.clone();",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl04, repo, RsSl04.defaultConfig)
      expect(out.totalCloneCalls).toBe(2)
      expect(out.modules[0]?.likelyExpensiveClones).toBeGreaterThanOrEqual(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-04 scores likely expensive clones, not every clone call", () => {
    const cheapOnly = RsSl04.score({
      modules: [
        {
          module: "crate::shared",
          file: "src/lib.rs",
          cloneCalls: 100,
          likelyExpensiveClones: 0,
        },
      ],
      totalCloneCalls: 100,
      analysisMode: "syntax-heuristic-clone-scan",
    })

    expect(cheapOnly).toBe(1)
    expect(RsSl04.diagnose({
      modules: [
        {
          module: "crate::shared",
          file: "src/lib.rs",
          cloneCalls: 100,
          likelyExpensiveClones: 0,
        },
      ],
      totalCloneCalls: 100,
      analysisMode: "syntax-heuristic-clone-scan",
    })).toEqual([])
  })
})
