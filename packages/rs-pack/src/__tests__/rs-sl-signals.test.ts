import { describe, expect, test } from "bun:test"
import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { Effect, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsSl01 } from "../signals/rs-sl-01-duplication.js"
import { RsSl02 } from "../signals/rs-sl-02-suppressions.js"
import { RsSl03 } from "../signals/rs-sl-03-unwrap-expect.js"
import { RsSl04 } from "../signals/rs-sl-04-clone-abuse.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
  runSignalComputeWithContext,
} from "./helpers.js"

describe("RS-SL-* signals", () => {
  test("RS-SL-01 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsSl01.id),
        { ...RsSl01, cacheVersion: `${RsSl01.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-SL-01")
    const decoded = Schema.decodeUnknownSync(RsSl01.configSchema)(RsSl01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsSl01.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsSl01.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsSl01.id, registry, {
      id: "rs-sl-01-contract",
      domain: "test",
      signal_overrides: {
        [RsSl01.id]: {
          config: {
            ...RsSl01.defaultConfig,
            min_tokens: 20,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsSl01).toMatchObject({
      id: "RS-SL-01-duplication",
      aliases: ["RS-SL-01"],
      title: "Duplication",
      tier: 1,
      category: "generated-slop",
      kind: "legibility",
      cacheVersion: "advisory-rust-duplication-cfg-test-diagnostics-changed-hunks-body-v5",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      min_tokens: 12,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsSl01.id)
    expect(registered?.cacheVersion).toBe(RsSl01.cacheVersion)
    expect(registry.byId.get("RS-SL-01")?.id).toBe(RsSl01.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_tokens",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

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
      expect(out.groups.find((group) => group.kind === "exact")?.members.map((member) => member.name)).toEqual([
        "first",
        "third",
      ])
      expect(out.groups.some((group) => group.kind === "structural")).toBe(true)
      expect(out.scopeMode).toBe("whole-tree")
      expect(out.analysisMode).toBe("function-body-normalization")
      expect(out.analyzedFunctionCount).toBe(3)
      expect(RsSl01.outputMetadata?.(out)).toBeUndefined()
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
          { file: "src/lib.rs", module: "crate", name: `getter_${index}`, line: index + 1, changed: false },
          { file: "src/lib.rs", module: "crate", name: `accessor_${index}`, line: index + 101, changed: false },
        ],
      })),
      scopeMode: "whole-tree",
      analysisMode: "function-body-normalization",
      sourceFileCount: 1,
      analyzedSourceFileCount: 1,
      analyzedFunctionCount: 100,
      exactGroupCount: 0,
      structuralGroupCount: 50,
      duplicateGroupCount: 50,
      diagnosticLimit: 10,
      minTokens: 12,
      scoreMode: "bounded-duplicate-function-pressure",
      scoreDenominator: "analyzed-functions",
    })

    expect(score).toBeGreaterThan(0.8)
  })

  test("RS-SL-01 treats helper-scale exact clones as low whole-tree pressure", () => {
    const score = RsSl01.score({
      groups: Array.from({ length: 25 }, (_, index) => ({
        kind: "exact" as const,
        tokenCount: 12,
        members: [
          { file: "src/lib.rs", module: "crate", name: `helper_${index}`, line: index + 1, changed: false },
          { file: "src/lib.rs", module: "crate", name: `helper_copy_${index}`, line: index + 101, changed: false },
        ],
      })),
      scopeMode: "whole-tree",
      analysisMode: "function-body-normalization",
      sourceFileCount: 1,
      analyzedSourceFileCount: 1,
      analyzedFunctionCount: 50,
      exactGroupCount: 25,
      structuralGroupCount: 0,
      duplicateGroupCount: 25,
      diagnosticLimit: 10,
      minTokens: 12,
      scoreMode: "bounded-duplicate-function-pressure",
      scoreDenominator: "analyzed-functions",
    })

    expect(score).toBe(1)
  })

  test("RS-SL-01 scores large exact duplicate pressure monotonically", () => {
    const small = RsSl01.score(rsSl01Output([
      {
        kind: "exact",
        tokenCount: 40,
        members: [
          { file: "src/lib.rs", module: "crate", name: "first", line: 1, changed: true },
          { file: "src/lib.rs", module: "crate", name: "second", line: 20, changed: true },
        ],
      },
    ], 2))
    const larger = RsSl01.score(rsSl01Output([
      {
        kind: "exact",
        tokenCount: 40,
        members: Array.from({ length: 20 }, (_, index) => ({
          file: "src/lib.rs",
          module: "crate",
          name: `clone_${index}`,
          line: index * 10 + 1,
          changed: true,
        })),
      },
    ], 20))

    expect(small).toBeGreaterThan(larger)
    expect(larger).toBeGreaterThanOrEqual(0.5)
  })

  test("RS-SL-01 normalizes diagnostics and applicability evidence", async () => {
    const duplicate = await createRustWorkspace("pulsar-rs-sl01-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-diagnostics"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn first(input: i32) -> i32 { if input > 10 { input + 1 } else { input - 1 } }",
        "pub fn second(value: i32) -> i32 { if value > 10 { value + 1 } else { value - 1 } }",
        "pub fn third(other: i32) -> i32 { if other > 10 { other + 1 } else { other - 1 } }",
        "",
      ].join("\n"),
    })
    const missing = await createRustWorkspace("pulsar-rs-sl01-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noFunctions = await createRustWorkspace("pulsar-rs-sl01-no-functions-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-no-functions"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Data;",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-sl01-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn first(input: i32) -> i32 { if input > 10 { input + 1 } else { input - 1 } }",
        "pub fn second(value: i32) -> i32 { if value > 10 { value + 1 } else { value - 1 } }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(
        RsSl01,
        duplicate,
        { ...RsSl01.defaultConfig, min_tokens: Number.NaN, top_n_diagnostics: 1.8 },
      )
      const missingOut = await runSignalCompute(RsSl01, missing, RsSl01.defaultConfig)
      const noFunctionOut = await runSignalCompute(RsSl01, noFunctions, RsSl01.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsSl01,
        excluded,
        { ...RsSl01.defaultConfig, exclude_globs: ["**/src/**"] },
      )
      const noDiagnosticOut = await runSignalCompute(
        RsSl01,
        duplicate,
        { ...RsSl01.defaultConfig, top_n_diagnostics: Number.NaN },
      )

      expect(out.minTokens).toBe(12)
      expect(out.diagnosticLimit).toBe(1)
      expect(RsSl01.diagnose(out)).toHaveLength(1)
      expect(RsSl01.diagnose(out)[0]).toMatchObject({
        severity: "info",
        message: "structural duplicate group with 3 functions",
        data: expect.objectContaining({
          scopeMode: "whole-tree",
          analysisMode: "function-body-normalization",
          minTokens: 12,
          scoreMode: "bounded-duplicate-function-pressure",
          scoreDenominator: "analyzed-functions",
        }),
      })

      expect(missingOut.sourceFileCount).toBe(0)
      expect(missingOut.analyzedSourceFileCount).toBe(0)
      expect(missingOut.analyzedFunctionCount).toBe(0)
      expect(RsSl01.score(missingOut)).toBe(1)
      expect(RsSl01.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsSl01.diagnose(missingOut)[0]).toMatchObject({
        severity: "warn",
        message: "RS-SL-01 found no Rust source files for duplication analysis",
      })

      expect(noFunctionOut.sourceFileCount).toBe(1)
      expect(noFunctionOut.analyzedSourceFileCount).toBe(1)
      expect(noFunctionOut.analyzedFunctionCount).toBe(0)
      expect(RsSl01.score(noFunctionOut)).toBe(1)
      expect(RsSl01.outputMetadata?.(noFunctionOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsSl01.diagnose(noFunctionOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.analyzedFunctionCount).toBe(0)
      expect(RsSl01.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsSl01.diagnose(excludedOut)).toEqual([])

      expect(noDiagnosticOut.diagnosticLimit).toBe(0)
      expect(RsSl01.diagnose(noDiagnosticOut)).toEqual([])
    } finally {
      await cleanupWorkspace(duplicate)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noFunctions)
      await cleanupWorkspace(excluded)
    }
  })

  test("RS-SL-01 changed-hunk scope keeps unchanged duplicate evidence", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl01-changed-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-changed"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn existing(input: i32) -> i32 {",
        "    if input > 10 { input + 1 } else { input - 1 }",
        "}",
        "",
        "pub fn changed(value: i32) -> i32 {",
        "    if value > 10 { value + 1 } else { value - 1 }",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalComputeWithContext(
        RsSl01,
        repo,
        RsSl01.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [{ file: "src/lib.rs", oldStart: 5, oldLines: 3, newStart: 5, newLines: 3 }],
        },
      )
      const group = out.groups.find((item) => item.kind === "structural")

      expect(out.scopeMode).toBe("changed-hunks")
      expect(group?.members.map((member) => ({
        name: member.name,
        changed: member.changed,
      }))).toEqual([
        { name: "existing", changed: false },
        { name: "changed", changed: true },
      ])
      expect(RsSl01.diagnose(out)[0]).toMatchObject({
        severity: "info",
        message: "structural duplicate group with 2 functions",
        data: expect.objectContaining({
          scopeMode: "changed-hunks",
          members: expect.arrayContaining([
            expect.objectContaining({ name: "existing", changed: false }),
            expect.objectContaining({ name: "changed", changed: true }),
          ]),
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-01 excludes cfg-test-gated duplicate functions", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl01-cfg-", {
      "Cargo.toml": [
        "[package]",
        'name = "dup-cfg"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn production(input: i32) -> i32 {",
        "    if input > 10 { input + 1 } else { input - 1 }",
        "}",
        "",
        "#[cfg(test)]",
        "pub fn test_clone(input: i32) -> i32 {",
        "    if input > 10 { input + 1 } else { input - 1 }",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl01, repo, RsSl01.defaultConfig)

      expect(out.analyzedFunctionCount).toBe(1)
      expect(out.groups).toEqual([])
      expect(RsSl01.score(out)).toBe(1)
      expect(RsSl01.diagnose(out)).toEqual([])
    } finally {
      await cleanupWorkspace(repo)
    }
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
        "// pulsar-allow ENG-OLD until:2000-01-01 stale lint debt",
        "#[allow(clippy::todo)]",
        "pub fn expired() {}",
        "",
        "#[allow(warnings)]",
        "pub fn unguarded() {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, repo, RsSl02.defaultConfig)
      expect(out.governedAllowAttributeCount).toBe(3)
      expect(out.ordinaryAllowAttributeCount).toBe(0)
      expect(out.ordinaryAllowLintCount).toBe(1)
      expect(out.missingJustificationCount).toBe(1)
      expect(out.expiredJustificationCount).toBe(1)
      expect(out.suppressions.map((suppression) => suppression.lints)).toEqual([
        ["clippy::unwrap_used"],
        ["clippy::todo"],
        ["warnings"],
      ])
      expect(out.suppressions[0]?.ordinaryLints).toEqual(["dead_code"])
      expect(out.suppressions.map((suppression) => suppression.justification)).toEqual([
        "active",
        "expired",
        "missing",
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsSl02.id),
        { ...RsSl02, cacheVersion: `${RsSl02.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-SL-02")
    const decoded = Schema.decodeUnknownSync(RsSl02.configSchema)(RsSl02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsSl02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsSl02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsSl02.id, registry, {
      id: "rs-sl-02-contract",
      domain: "test",
      signal_overrides: {
        [RsSl02.id]: {
          config: {
            ...RsSl02.defaultConfig,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsSl02).toMatchObject({
      id: "RS-SL-02-suppressions",
      aliases: ["RS-SL-02"],
      title: "Suppressions",
      tier: 1,
      category: "generated-slop",
      kind: "structural",
      cacheVersion: "unused-allows-ordinary-diagnostics-cfg-attr-span-v4",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      top_n_diagnostics: 20,
    })
    expect(registered?.id).toBe(RsSl02.id)
    expect(registered?.cacheVersion).toBe(RsSl02.cacheVersion)
    expect(registry.byId.get("RS-SL-02")?.id).toBe(RsSl02.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-SL-02 normalizes diagnostics and applicability evidence", async () => {
    const governed = await createRustWorkspace("pulsar-rs-sl02-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-diagnostics"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(clippy::unwrap_used)]",
        "pub fn first(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
        "#[allow(warnings)]",
        "pub fn second() {}",
        "",
      ].join("\n"),
    })
    const noSource = await createRustWorkspace("pulsar-rs-sl02-empty-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-empty"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-sl02-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(warnings)]",
        "pub fn hidden() {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, governed, {
        ...RsSl02.defaultConfig,
        top_n_diagnostics: 1.8,
      })
      const hiddenOut = await runSignalCompute(RsSl02, governed, {
        ...RsSl02.defaultConfig,
        top_n_diagnostics: Number.NaN,
      })
      const noSourceOut = await runSignalCompute(RsSl02, noSource, RsSl02.defaultConfig)
      const excludedOut = await runSignalCompute(RsSl02, excluded, {
        ...RsSl02.defaultConfig,
        exclude_globs: ["**/src/**"],
      })
      const diagnostics = RsSl02.diagnose(out)

      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedSourceFileCount).toBe(1)
      expect(out.diagnosticLimit).toBe(1)
      expect(out.scoreMode).toBe("governed-allow-debt")
      expect(out.scoreDenominator).toBe("governed-allow-attributes")
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "block",
        message: "Governed allow suppression for clippy::unwrap_used is missing",
        data: expect.objectContaining({
          scopeMode: "whole-tree",
          analysisMode: "allow-attributes-with-rust-lint-governance",
          scoreMode: "governed-allow-debt",
          scoreDenominator: "governed-allow-attributes",
        }),
      })
      expect(hiddenOut.diagnosticLimit).toBe(0)
      expect(RsSl02.diagnose(hiddenOut)).toEqual([])
      expect(noSourceOut.sourceFileCount).toBe(0)
      expect(RsSl02.outputMetadata?.(noSourceOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsSl02.diagnose(noSourceOut)[0]).toMatchObject({
        severity: "warn",
        message: "RS-SL-02 found no Rust source files for suppression analysis",
      })
      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(RsSl02.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(governed)
      await cleanupWorkspace(noSource)
      await cleanupWorkspace(excluded)
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

  test("RS-SL-02 excludes cfg-test-gated allow attributes", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-cfg-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-cfg"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(clippy::unwrap_used)]",
        "pub fn production(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
        "#[cfg(any(test, feature = \"fixture\"))]",
        "#[allow(warnings)]",
        "pub fn test_only() {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, repo, RsSl02.defaultConfig)

      expect(out.governedAllowAttributeCount).toBe(1)
      expect(out.missingJustificationCount).toBe(1)
      expect(out.suppressions.map((suppression) => suppression.lints)).toEqual([
        ["clippy::unwrap_used"],
      ])
      expect(out.suppressions[0]?.line).toBe(1)
      expect(RsSl02.diagnose(out)).toHaveLength(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 parses cfg_attr and commented allow lint syntax", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-cfg-attr-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-cfg-attr"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[cfg_attr(feature = \"compat\", allow(warnings))]",
        "pub fn compat() {}",
        "",
        "#[cfg_attr(test, allow(clippy::todo))]",
        "pub fn test_compat() {}",
        "",
        "#[allow(clippy::unwrap_used /* inherited Option contract */)]",
        "pub fn commented(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl02, repo, RsSl02.defaultConfig)

      expect(out.governedAllowAttributeCount).toBe(3)
      expect(out.suppressions.map((suppression) => suppression.lints)).toEqual([
        ["warnings"],
        ["clippy::todo"],
        ["clippy::unwrap_used"],
      ])
      expect(out.suppressions[2]?.ordinaryLints).toEqual([])
      expect(RsSl02.diagnose(out).map((diagnostic) => diagnostic.message)).toEqual([
        "Governed allow suppression for warnings is missing",
        "Governed allow suppression for clippy::todo is missing",
        "Governed allow suppression for clippy::unwrap_used is missing",
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 changed-hunk scope keeps only changed allow evidence", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-changed-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-changed"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(warnings)]",
        "pub fn first() {}",
        "",
        "#[allow(clippy::unwrap_used)]",
        "pub fn second(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalComputeWithContext(
        RsSl02,
        repo,
        RsSl02.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [{ file: "src/lib.rs", oldStart: 4, oldLines: 1, newStart: 4, newLines: 1 }],
        },
      )

      expect(out.scopeMode).toBe("changed-hunks")
      expect(out.governedAllowAttributeCount).toBe(1)
      expect(out.suppressions.map((suppression) => suppression.lints)).toEqual([
        ["clippy::unwrap_used"],
      ])
      expect(RsSl02.diagnose(out)[0]).toMatchObject({
        location: { line: 4 },
        data: expect.objectContaining({ scopeMode: "changed-hunks" }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 changed-hunk scope uses full multiline attribute spans", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl02-multiline-hunk-", {
      "Cargo.toml": [
        "[package]",
        'name = "suppression-multiline-hunk"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[allow(",
        "    warnings,",
        "    clippy::unwrap_used,",
        ")]",
        "pub fn multiline(value: Option<u32>) -> u32 { value.unwrap() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalComputeWithContext(
        RsSl02,
        repo,
        RsSl02.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [{ file: "src/lib.rs", oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 }],
        },
      )

      expect(out.scopeMode).toBe("changed-hunks")
      expect(out.governedAllowAttributeCount).toBe(1)
      expect(out.suppressions[0]).toMatchObject({
        line: 1,
        lints: ["warnings", "clippy::unwrap_used"],
      })
      expect(RsSl02.diagnose(out)[0]).toMatchObject({
        location: { line: 1 },
        data: expect.objectContaining({ scopeMode: "changed-hunks" }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-02 scores governed allow pressure and failed governance monotonically", () => {
    const oneActive = RsSl02.score(rsSl02Output([
      {
        file: "src/lib.rs",
        module: "crate",
        line: 1,
        lints: ["clippy::unwrap_used"],
        ordinaryLints: [],
        justification: "active",
        classification: "requires-governance",
      },
    ]))
    const manyActive = RsSl02.score(rsSl02Output(
      Array.from({ length: 10 }, (_, index) => ({
        file: "src/lib.rs",
        module: "crate",
        line: index + 1,
        lints: ["clippy::unwrap_used"],
        ordinaryLints: [],
        justification: "active",
        classification: "requires-governance",
      })),
    ))
    const missing = RsSl02.score(rsSl02Output([
      {
        file: "src/lib.rs",
        module: "crate",
        line: 1,
        lints: ["warnings"],
        ordinaryLints: [],
        justification: "missing",
        classification: "requires-governance",
      },
    ]))
    const expired = RsSl02.score(rsSl02Output([
      {
        file: "src/lib.rs",
        module: "crate",
        line: 1,
        lints: ["clippy::todo"],
        ordinaryLints: [],
        justification: "expired",
        classification: "requires-governance",
      },
    ]))

    expect(oneActive).toBeGreaterThan(manyActive)
    expect(oneActive).toBeLessThan(1)
    expect(manyActive).toBeGreaterThan(0.5)
    expect(missing).toBe(0)
    expect(expired).toBe(0)
  })

  test("RS-SL-03 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsSl03.id),
        { ...RsSl03, cacheVersion: `${RsSl03.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-SL-03")
    const decoded = Schema.decodeUnknownSync(RsSl03.configSchema)(RsSl03.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsSl03.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsSl03.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsSl03.id, registry, {
      id: "rs-sl-03-contract",
      domain: "test",
      signal_overrides: {
        [RsSl03.id]: {
          config: {
            ...RsSl03.defaultConfig,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsSl03).toMatchObject({
      id: "RS-SL-03-unwrap-expect",
      aliases: ["RS-SL-03"],
      title: "Unwrap/expect usage",
      tier: 1,
      category: "generated-slop",
      kind: "legibility",
      cacheVersion: "advisory-density-scaled-cfg-test-gating-diagnostics-denominator-v4",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsSl03.id)
    expect(registered?.cacheVersion).toBe(RsSl03.cacheVersion)
    expect(registry.byId.get("RS-SL-03")?.id).toBe(RsSl03.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
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
      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedSourceFileCount).toBe(1)
      expect(out.scoreMode).toBe("bounded-unwrap-expect-density")
      expect(out.scoreDenominator).toBe("analyzed-functions-per-module")
      expect(RsSl03.outputMetadata?.(out)).toBeUndefined()
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-03 excludes cfg-test-gated functions from density denominator", async () => {
    const repo = await createRustWorkspace("pulsar-rs-sl03-density-cfg-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-density-cfg"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn prod() { let _ = Some(1).unwrap(); }",
        "",
        "#[cfg(any(test, feature = \"fixture\"))]",
        "pub fn helper_one() {}",
        "",
        "#[cfg(test)]",
        "pub fn helper_two() { let _ = Some(1).expect(\"x\"); }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsSl03, repo, RsSl03.defaultConfig)

      expect(out.totalCalls).toBe(1)
      expect(out.analyzedFunctionCount).toBe(1)
      expect(out.modules[0]).toMatchObject({
        unwrapExpectCalls: 1,
        density: 1,
      })
      expect(RsSl03.diagnose(out)[0]?.severity).toBe("warn")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-SL-03 normalizes diagnostics and applicability evidence", async () => {
    const risky = await createRustWorkspace("pulsar-rs-sl03-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-diagnostics"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn first(value: Option<u32>) -> u32 { value.unwrap() }",
        "pub fn second(value: Option<u32>) -> u32 { value.expect(\"ready\") }",
        "",
      ].join("\n"),
    })
    const noSource = await createRustWorkspace("pulsar-rs-sl03-empty-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-empty"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-sl03-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub fn hidden(value: Option<u32>) -> u32 { value.unwrap() }\n",
    })
    const noFunctions = await createRustWorkspace("pulsar-rs-sl03-no-functions-", {
      "Cargo.toml": [
        "[package]",
        'name = "panic-no-functions"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub const READY: bool = true;\n",
    })

    try {
      const out = await runSignalCompute(RsSl03, risky, {
        ...RsSl03.defaultConfig,
        top_n_diagnostics: 1.8,
      })
      const hiddenOut = await runSignalCompute(RsSl03, risky, {
        ...RsSl03.defaultConfig,
        top_n_diagnostics: Number.NaN,
      })
      const noSourceOut = await runSignalCompute(RsSl03, noSource, RsSl03.defaultConfig)
      const excludedOut = await runSignalCompute(RsSl03, excluded, {
        ...RsSl03.defaultConfig,
        exclude_globs: ["**/src/**"],
      })
      const noFunctionsOut = await runSignalCompute(RsSl03, noFunctions, RsSl03.defaultConfig)
      const diagnostics = RsSl03.diagnose(out)

      expect(out.analyzedFunctionCount).toBe(2)
      expect(out.diagnosticLimit).toBe(1)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "panic-diagnostics::crate contains 2 unwrap/expect call sites",
        data: expect.objectContaining({
          unwrapExpectCalls: 2,
          density: 1,
          analysisMode: "call-expression-field-scan",
          scoreMode: "bounded-unwrap-expect-density",
          scoreDenominator: "analyzed-functions-per-module",
        }),
      })
      expect(hiddenOut.diagnosticLimit).toBe(0)
      expect(RsSl03.diagnose(hiddenOut)).toEqual([])
      expect(noSourceOut.sourceFileCount).toBe(0)
      expect(RsSl03.outputMetadata?.(noSourceOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsSl03.diagnose(noSourceOut)[0]).toMatchObject({
        severity: "warn",
        message: "RS-SL-03 found no Rust source files for unwrap/expect analysis",
      })
      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(RsSl03.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(noFunctionsOut.sourceFileCount).toBe(1)
      expect(noFunctionsOut.analyzedFunctionCount).toBe(0)
      expect(RsSl03.outputMetadata?.(noFunctionsOut)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(risky)
      await cleanupWorkspace(noSource)
      await cleanupWorkspace(excluded)
      await cleanupWorkspace(noFunctions)
    }
  })

  test("RS-SL-03 scales repo-wide unwrap pressure without automatic zero score", () => {
    const score = RsSl03.score(rsSl03Output({
      modules: Array.from({ length: 10 }, (_, index) => ({
        module: `crate::module_${index}`,
        file: "src/lib.rs",
        unwrapExpectCalls: 5,
        density: 0.5,
      })),
    }))

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

const rsSl01Output = (
  groups: ReadonlyArray<Parameters<typeof RsSl01.score>[0]["groups"][number]>,
  analyzedFunctionCount: number,
): Parameters<typeof RsSl01.score>[0] => ({
  groups,
  scopeMode: "whole-tree",
  analysisMode: "function-body-normalization",
  sourceFileCount: 1,
  analyzedSourceFileCount: 1,
  analyzedFunctionCount,
  exactGroupCount: groups.filter((group) => group.kind === "exact").length,
  structuralGroupCount: groups.filter((group) => group.kind === "structural").length,
  duplicateGroupCount: groups.length,
  diagnosticLimit: 10,
  minTokens: 12,
  scoreMode: "bounded-duplicate-function-pressure",
  scoreDenominator: "analyzed-functions",
})

const rsSl02Output = (
  suppressions: ReadonlyArray<Parameters<typeof RsSl02.score>[0]["suppressions"][number]>,
): Parameters<typeof RsSl02.score>[0] => ({
  suppressions,
  ordinaryAllowAttributeCount: 0,
  ordinaryAllowLintCount: 0,
  governedAllowAttributeCount: suppressions.length,
  missingJustificationCount: suppressions.filter((suppression) => suppression.justification === "missing").length,
  expiredJustificationCount: suppressions.filter((suppression) => suppression.justification === "expired").length,
  scopeMode: "whole-tree",
  analysisMode: "allow-attributes-with-rust-lint-governance",
  sourceFileCount: 1,
  analyzedSourceFileCount: 1,
  diagnosticLimit: 20,
  scoreMode: "governed-allow-debt",
  scoreDenominator: "governed-allow-attributes",
})

const rsSl03Output = ({
  modules,
}: {
  readonly modules: ReadonlyArray<Parameters<typeof RsSl03.score>[0]["modules"][number]>
}): Parameters<typeof RsSl03.score>[0] => ({
  modules,
  totalCalls: modules.reduce((sum, module) => sum + module.unwrapExpectCalls, 0),
  analysisMode: "call-expression-field-scan",
  sourceFileCount: 1,
  analyzedSourceFileCount: 1,
  analyzedFunctionCount: modules.length,
  diagnosticLimit: 10,
  scoreMode: "bounded-unwrap-expect-density",
  scoreDenominator: "analyzed-functions-per-module",
})
