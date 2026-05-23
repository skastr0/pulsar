import { describe, expect, test } from "bun:test"
import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { Effect, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
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
  createRustWorkspace("pulsar-rs-ld-", {
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

const createUnsafePropagationWorkspace = () =>
  createRustWorkspace("pulsar-rs-ld01-propagation-", {
    "Cargo.toml": [
      "[package]",
      'name = "unsafe-propagation"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub mod safe_zone {",
      "    pub fn raw_deref(ptr: *const u8) -> u8 {",
      "        unsafe { *ptr }",
      "    }",
      "",
      "    pub fn wrapper(ptr: *const u8) -> u8 {",
      "        raw_deref(ptr)",
      "    }",
      "",
      "    pub fn api(ptr: *const u8) -> u8 {",
      "        wrapper(ptr)",
      "    }",
      "",
      "    #[cfg(test)]",
      "    pub fn test_only(ptr: *const u8) -> u8 {",
      "        unsafe { *ptr }",
      "    }",
      "",
      "    #[cfg(any(test, feature = \"probe\"))]",
      "    pub fn composite_test_only(ptr: *const u8) -> u8 {",
      "        unsafe { *ptr }",
      "    }",
      "}",
      "",
    ].join("\n"),
  })

const createQualifiedUnsafePropagationWorkspace = () =>
  createRustWorkspace("pulsar-rs-ld01-qualified-propagation-", {
    "Cargo.toml": [
      "[package]",
      'name = "qualified-propagation"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub mod safe_zone {",
      "    pub fn raw_deref(ptr: *const u8) -> u8 {",
      "        unsafe { *ptr }",
      "    }",
      "}",
      "",
      "pub mod alt {",
      "    pub fn raw_deref(_: *const u8) -> u8 { 0 }",
      "}",
      "",
      "pub mod wrapper {",
      "    pub fn api(ptr: *const u8) -> u8 {",
      "        super::safe_zone::raw_deref(ptr)",
      "    }",
      "}",
      "",
      "pub mod ambiguous {",
      "    pub fn api(ptr: *const u8) -> u8 {",
      "        raw_deref(ptr)",
      "    }",
      "}",
      "",
    ].join("\n"),
  })

const createUnsafeScoreWorkspace = (
  name: string,
  sourceLines: ReadonlyArray<string>,
) =>
  createRustWorkspace(`pulsar-rs-ld01-score-${name}-`, {
    "Cargo.toml": [
      "[package]",
      `name = "unsafe-score-${name}"`,
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [...sourceLines, ""].join("\n"),
  })

const createUnsafeDeclarationWorkspace = () =>
  createRustWorkspace("pulsar-rs-ld01-declarations-", {
    "Cargo.toml": [
      "[package]",
      'name = "unsafe-declarations"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub unsafe trait Dangerous {",
      "    unsafe fn touch(&self);",
      "}",
      "",
      "pub struct Local;",
      "",
      "unsafe impl Dangerous for Local {",
      "    unsafe fn touch(&self) {}",
      "}",
      "",
      "extern \"C\" {",
      "    pub fn ffi_call(ptr: *const u8) -> u8;",
      "}",
      "",
      "pub static mut GLOBAL: u8 = 0;",
      "",
    ].join("\n"),
  })

const createSafeOnlySelectorWorkspace = () =>
  createRustWorkspace("pulsar-rs-ld01-safe-only-", {
    "Cargo.toml": [
      "[package]",
      'name = "safe-selector-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub mod safe_zone {",
      "    pub mod child {",
      "        pub fn raw_leaf(ptr: *const u8) -> u8 {",
      "            unsafe { *ptr }",
      "        }",
      "    }",
      "",
      "    pub mod api {",
      "        pub fn expose(ptr: *const u8) -> u8 {",
      "            super::child::raw_leaf(ptr)",
      "        }",
      "    }",
      "}",
      "",
      "pub mod outside {",
      "    pub fn ordinary() -> u8 { 0 }",
      "}",
      "",
    ].join("\n"),
    "tests/excluded.rs": [
      "pub fn excluded_unsafe(ptr: *const u8) -> u8 {",
      "    unsafe { *ptr }",
      "}",
      "",
    ].join("\n"),
  })

describe("RS-LD-* signals", () => {
  test("RS-LD-01 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsLd01.id),
        { ...RsLd01, cacheVersion: `${RsLd01.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-LD-01")
    const decoded = Schema.decodeUnknownSync(RsLd01.configSchema)(RsLd01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsLd01.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsLd01.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsLd01.id, registry, {
      id: "rs-ld-01-contract",
      domain: "test",
      signal_overrides: {
        [RsLd01.id]: {
          config: {
            ...RsLd01.defaultConfig,
            safe_only_modules: ["legibility-fixture::crate::safe_zone"],
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsLd01).toMatchObject({
      id: "RS-LD-01-unsafe-code",
      aliases: ["RS-LD-01"],
      title: "Unsafe code",
      tier: 1,
      category: "legibility-decay",
      kind: "legibility",
      cacheVersion: "unsafe-code-config-applicability-diagnostics-call-graph-density-sites-safe-only-qualified-v6",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      safe_only_modules: [],
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsLd01.id)
    expect(registered?.cacheVersion).toBe(RsLd01.cacheVersion)
    expect(registry.byId.get("RS-LD-01")?.id).toBe(RsLd01.id)
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
        path: "config.safe_only_modules",
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

  test("RS-LD-01 reports unsafe pressure and safe-only violations", async () => {
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
      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedSourceFileCount).toBe(1)
      expect(out.functionCount).toBeGreaterThan(0)
      expect(out.diagnosticLimit).toBe(10)
      expect(out.propagationMode).toBe("local-call-graph")
      expect(out.scoreMode).toBe("one-minus-max-propagation-share-or-capped-site-share")
      expect(out.safeOnlySelectorMode).toBe("module-subtree")
      expect(out.diagnosticCapPolicy).toBe("safe-only-blocks-uncapped-warnings-capped")
      expect(out.sitePressureScoreCap).toBe(1)
      expect(out.safeOnlyViolations.map((module) => module.module)).toContain(
        "legibility-fixture::crate::safe_zone",
      )
      expect(RsLd01.outputMetadata?.(out)).toBeUndefined()
      expect(RsLd01.score(out)).toBe(0)
      expect(RsLd01.diagnose(out)[0]).toMatchObject({
        severity: "block",
        message: "Unsafe usage in safe-only module legibility-fixture::crate::safe_zone",
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-01 applies safe-only module subtree selectors and keeps block diagnostics uncapped", async () => {
    const repo = await createSafeOnlySelectorWorkspace()
    try {
      const parentSelector = "safe-selector-fixture::crate::safe_zone"
      const childSelector = "safe-selector-fixture::crate::safe_zone::child"
      const parentOut = await runSignalCompute(
        RsLd01,
        repo,
        {
          ...RsLd01.defaultConfig,
          safe_only_modules: [parentSelector],
          top_n_diagnostics: 0,
        },
      )
      const childOnlyOut = await runSignalCompute(
        RsLd01,
        repo,
        {
          ...RsLd01.defaultConfig,
          safe_only_modules: [childSelector],
          top_n_diagnostics: 0,
        },
      )

      expect(parentOut.sourceFileCount).toBe(2)
      expect(parentOut.analyzedSourceFileCount).toBe(1)
      expect(parentOut.safeOnlySelectorMode).toBe("module-subtree")
      expect(parentOut.diagnosticCapPolicy).toBe("safe-only-blocks-uncapped-warnings-capped")
      expect(parentOut.safeOnlyViolations.map((module) => module.module)).toEqual([
        "safe-selector-fixture::crate::safe_zone::child",
        "safe-selector-fixture::crate::safe_zone::api",
      ])
      expect(parentOut.safeOnlyViolations[0]?.safeOnlyMatchedSelectors).toEqual([parentSelector])
      expect(parentOut.safeOnlyViolations[1]?.safeOnlyMatchedSelectors).toEqual([parentSelector])
      expect(parentOut.safeOnlyViolations[0]?.sites).toContainEqual(
        expect.objectContaining({
          kind: "unsafe_block",
          functionName: "raw_leaf",
          line: 4,
        }),
      )
      expect(parentOut.safeOnlyViolations[1]).toMatchObject({
        unsafeSiteCount: 0,
        propagatingFunctionCount: 1,
      })
      expect(RsLd01.score(parentOut)).toBe(0)

      const cappedDiagnostics = RsLd01.diagnose(parentOut)
      expect(cappedDiagnostics).toHaveLength(2)
      expect(cappedDiagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
        "block",
        "block",
      ])
      expect(cappedDiagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        "Unsafe usage in safe-only module safe-selector-fixture::crate::safe_zone::child",
        "Unsafe usage in safe-only module safe-selector-fixture::crate::safe_zone::api",
      ])
      expect(cappedDiagnostics[0]?.data).toMatchObject({
        safeOnlyMatchedSelectors: [parentSelector],
        safeOnlySelectorMode: "module-subtree",
        diagnosticCapPolicy: "safe-only-blocks-uncapped-warnings-capped",
      })
      expect(cappedDiagnostics[0]?.data?.sites).toContainEqual(
        expect.objectContaining({
          kind: "unsafe_block",
          functionName: "raw_leaf",
          module: "safe-selector-fixture::crate::safe_zone::child",
        }),
      )

      expect(childOnlyOut.safeOnlyViolations.map((module) => module.module)).toEqual([
        "safe-selector-fixture::crate::safe_zone::child",
      ])
      expect(childOnlyOut.safeOnlyViolations[0]?.safeOnlyMatchedSelectors).toEqual([
        childSelector,
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-01 propagates unsafe usage through local call chains and excludes cfg-test functions", async () => {
    const repo = await createUnsafePropagationWorkspace()
    try {
      const out = await runSignalCompute(RsLd01, repo, RsLd01.defaultConfig)
      const safeZone = out.modules.find(
        (module) => module.module === "unsafe-propagation::crate::safe_zone",
      )

      expect(safeZone).toMatchObject({
        totalFunctions: 3,
        unsafeSiteCount: 1,
        unsafeBlockCount: 1,
        unsafeFunctionCount: 0,
        propagatingFunctionCount: 3,
        unsafePropagationShare: 1,
        unsafeSitesPerFunction: 1 / 3,
        cappedUnsafeSiteShare: 1 / 3,
        unsafePressure: 1,
      })
      expect(out.totalUnsafeBlocks).toBe(1)
      expect(out.totalUnsafeFunctions).toBe(0)
      expect(out.totalUnsafeSites).toBe(1)
      expect(out.totalPropagatingFunctions).toBe(3)
      expect(out.functionCount).toBe(3)
      expect(out.repositoryUnsafePropagationShare).toBe(1)
      expect(out.repositoryUnsafeSitesPerFunction).toBe(1 / 3)
      expect(out.repositoryCappedUnsafeSiteShare).toBe(1 / 3)
      expect(out.repositoryUnsafePressure).toBe(1)
      expect(out.propagationMode).toBe("local-call-graph")
      expect(RsLd01.score(out)).toBe(0)
      expect(RsLd01.diagnose(out)).toContainEqual(
        expect.objectContaining({
          message: "Unsafe surface in unsafe-propagation::crate::safe_zone: 100% functions, 0.33 unsafe sites/function",
          data: expect.objectContaining({
            propagationMode: "local-call-graph",
            propagatingFunctionCount: 3,
            unsafePropagationShare: 1,
            unsafeSitesPerFunction: 1 / 3,
          }),
        }),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-01 resolves qualified unsafe calls before ambiguous bare-name fallback", async () => {
    const repo = await createQualifiedUnsafePropagationWorkspace()
    try {
      const out = await runSignalCompute(RsLd01, repo, RsLd01.defaultConfig)
      const safeZone = out.modules.find(
        (module) => module.module === "qualified-propagation::crate::safe_zone",
      )
      const wrapper = out.modules.find(
        (module) => module.module === "qualified-propagation::crate::wrapper",
      )
      const ambiguous = out.modules.find(
        (module) => module.module === "qualified-propagation::crate::ambiguous",
      )

      expect(safeZone).toMatchObject({
        propagatingFunctionCount: 1,
        unsafeSiteCount: 1,
      })
      expect(wrapper).toMatchObject({
        propagatingFunctionCount: 1,
        unsafeSiteCount: 0,
        unsafePropagationShare: 1,
      })
      expect(ambiguous).toMatchObject({
        totalFunctions: 1,
        propagatingFunctionCount: 0,
        unsafeSiteCount: 0,
      })
      expect(RsLd01.diagnose(out)).toContainEqual(
        expect.objectContaining({
          message: "Unsafe surface in qualified-propagation::crate::wrapper: 100% functions, 0.00 unsafe sites/function",
          data: expect.objectContaining({
            propagatingFunctionCount: 1,
            unsafeSiteCount: 0,
          }),
        }),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-01 scores unsafe propagation and unsafe site pressure monotonically", async () => {
    const clean = await createUnsafeScoreWorkspace("clean", [
      "pub fn a() -> u8 { 0 }",
      "pub fn b() -> u8 { 0 }",
      "pub fn c() -> u8 { 0 }",
      "pub fn d() -> u8 { 0 }",
    ])
    const oneUnsafe = await createUnsafeScoreWorkspace("one", [
      "pub fn a(ptr: *const u8) -> u8 { unsafe { *ptr } }",
      "pub fn b() -> u8 { 0 }",
      "pub fn c() -> u8 { 0 }",
      "pub fn d() -> u8 { 0 }",
    ])
    const twoUnsafe = await createUnsafeScoreWorkspace("two", [
      "pub fn a(ptr: *const u8) -> u8 { unsafe { *ptr } }",
      "pub fn b(ptr: *const u8) -> u8 { unsafe { *ptr } }",
      "pub fn c() -> u8 { 0 }",
      "pub fn d() -> u8 { 0 }",
    ])
    const siteHeavy = await createUnsafeScoreWorkspace("sites", [
      "pub fn a(ptr: *const u8) -> u8 {",
      "    let one = unsafe { *ptr };",
      "    let two = unsafe { *ptr };",
      "    let three = unsafe { *ptr };",
      "    let four = unsafe { *ptr };",
      "    let five = unsafe { *ptr };",
      "    one + two + three + four + five",
      "}",
      "pub fn b() -> u8 { 0 }",
      "pub fn c() -> u8 { 0 }",
      "pub fn d() -> u8 { 0 }",
    ])

    try {
      const cleanOut = await runSignalCompute(RsLd01, clean, RsLd01.defaultConfig)
      const oneOut = await runSignalCompute(RsLd01, oneUnsafe, RsLd01.defaultConfig)
      const twoOut = await runSignalCompute(RsLd01, twoUnsafe, RsLd01.defaultConfig)
      const siteHeavyOut = await runSignalCompute(RsLd01, siteHeavy, RsLd01.defaultConfig)

      expect(RsLd01.score(cleanOut)).toBe(1)
      expect(oneOut.repositoryUnsafePropagationShare).toBe(0.25)
      expect(oneOut.repositoryUnsafeSitesPerFunction).toBe(0.25)
      expect(oneOut.repositoryUnsafePressure).toBe(0.25)
      expect(RsLd01.score(oneOut)).toBe(0.75)
      expect(twoOut.repositoryUnsafePropagationShare).toBe(0.5)
      expect(twoOut.repositoryUnsafeSitesPerFunction).toBe(0.5)
      expect(twoOut.repositoryUnsafePressure).toBe(0.5)
      expect(RsLd01.score(twoOut)).toBe(0.5)
      expect(siteHeavyOut.repositoryUnsafePropagationShare).toBe(0.25)
      expect(siteHeavyOut.repositoryUnsafeSitesPerFunction).toBe(1.25)
      expect(siteHeavyOut.repositoryCappedUnsafeSiteShare).toBe(1)
      expect(siteHeavyOut.repositoryUnsafePressure).toBe(1)
      expect(RsLd01.score(siteHeavyOut)).toBe(0)
      expect(RsLd01.score(cleanOut)).toBeGreaterThan(RsLd01.score(oneOut))
      expect(RsLd01.score(oneOut)).toBeGreaterThan(RsLd01.score(twoOut))
      expect(RsLd01.score(twoOut)).toBeGreaterThan(RsLd01.score(siteHeavyOut))
      expect(RsLd01.diagnose(siteHeavyOut)[0]?.message).toContain(
        "1.25 unsafe sites/function",
      )
      expect(RsLd01.diagnose(siteHeavyOut)[0]?.message).not.toContain("125%")
    } finally {
      await cleanupWorkspace(clean)
      await cleanupWorkspace(oneUnsafe)
      await cleanupWorkspace(twoUnsafe)
      await cleanupWorkspace(siteHeavy)
    }
  })

  test("RS-LD-01 extracts unsafe API and declaration sites", async () => {
    const repo = await createUnsafeDeclarationWorkspace()
    try {
      const out = await runSignalCompute(RsLd01, repo, RsLd01.defaultConfig)
      const module = out.modules.find(
        (entry) => entry.module === "unsafe-declarations::crate",
      )
      const siteKinds = out.unsafeSites.map((site) => site.kind).sort()

      expect(out.totalUnsafeBlocks).toBe(0)
      expect(out.totalUnsafeFunctions).toBe(1)
      expect(out.totalUnsafeSites).toBe(6)
      expect(out.unsafeSiteKindCounts).toMatchObject({
        foreign_function: 1,
        static_mut: 1,
        unsafe_function: 1,
        unsafe_function_signature: 1,
        unsafe_impl: 1,
        unsafe_trait: 1,
      })
      expect(siteKinds).toEqual([
        "foreign_function",
        "static_mut",
        "unsafe_function",
        "unsafe_function_signature",
        "unsafe_impl",
        "unsafe_trait",
      ])
      expect(module).toMatchObject({
        unsafeSiteCount: 6,
        unsafeSitesPerFunction: 6,
        cappedUnsafeSiteShare: 1,
        unsafePressure: 1,
      })
      expect(module?.unsafeSiteKindCounts).toEqual(expect.objectContaining({
        foreign_function: 1,
        static_mut: 1,
        unsafe_function: 1,
        unsafe_function_signature: 1,
        unsafe_impl: 1,
        unsafe_trait: 1,
      }))
      expect(out.unsafeSites).toContainEqual(
        expect.objectContaining({
          kind: "unsafe_trait",
          name: "Dangerous",
          module: "unsafe-declarations::crate",
          line: 1,
        }),
      )
      expect(out.unsafeSites).toContainEqual(
        expect.objectContaining({
          kind: "foreign_function",
          name: "ffi_call",
          functionName: "ffi_call",
          module: "unsafe-declarations::crate",
        }),
      )
      expect(out.unsafeSites).toContainEqual(
        expect.objectContaining({
          kind: "static_mut",
          name: "GLOBAL",
          module: "unsafe-declarations::crate",
        }),
      )
      expect(RsLd01.score(out)).toBe(0)
      expect(RsLd01.diagnose(out)).toContainEqual(
        expect.objectContaining({
          message: "Unsafe surface in unsafe-declarations::crate: 100% functions, 6.00 unsafe sites/function",
          data: expect.objectContaining({
            unsafeSiteKindCounts: expect.objectContaining({
              foreign_function: 1,
              static_mut: 1,
              unsafe_function_signature: 1,
              unsafe_trait: 1,
            }),
            sites: expect.arrayContaining([
              expect.objectContaining({ kind: "unsafe_trait", name: "Dangerous" }),
              expect.objectContaining({ kind: "unsafe_impl" }),
              expect.objectContaining({ kind: "foreign_function", name: "ffi_call" }),
              expect.objectContaining({ kind: "static_mut", name: "GLOBAL" }),
            ]),
          }),
        }),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-01 normalizes diagnostics and applicability evidence", async () => {
    const unsafe = await createLegibilityWorkspace()
    const missing = await createRustWorkspace("pulsar-rs-ld01-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "unsafe-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noFunction = await createRustWorkspace("pulsar-rs-ld01-no-function-", {
      "Cargo.toml": [
        "[package]",
        'name = "unsafe-no-function"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Marker;",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ld01-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "unsafe-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn raw_deref(ptr: *const u8) -> u8 {",
        "    unsafe { *ptr }",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsLd01,
        unsafe,
        {
          ...RsLd01.defaultConfig,
          safe_only_modules: ["legibility-fixture::crate::safe_zone"],
          top_n_diagnostics: 1.8,
        },
      )
      const hidden = await runSignalCompute(
        RsLd01,
        unsafe,
        { ...RsLd01.defaultConfig, top_n_diagnostics: Number.NaN },
      )
      const missingOut = await runSignalCompute(RsLd01, missing, RsLd01.defaultConfig)
      const noFunctionOut = await runSignalCompute(RsLd01, noFunction, RsLd01.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsLd01,
        excluded,
        { ...RsLd01.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(capped.diagnosticLimit).toBe(1)
      expect(RsLd01.diagnose(capped)).toHaveLength(2)
      expect(RsLd01.diagnose(capped).map((diagnostic) => diagnostic.severity)).toEqual([
        "block",
        "warn",
      ])
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsLd01.diagnose(hidden)).toHaveLength(0)

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsLd01.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsLd01.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-LD-01 found no Rust source files for unsafe code analysis",
          data: expect.objectContaining({
            sourceFileCount: 0,
            analyzedSourceFileCount: 0,
            functionCount: 0,
            propagationMode: "local-call-graph",
            scoreMode: "one-minus-max-propagation-share-or-capped-site-share",
          }),
        }),
      ])

      expect(noFunctionOut.sourceFileCount).toBe(1)
      expect(noFunctionOut.functionCount).toBe(0)
      expect(RsLd01.outputMetadata?.(noFunctionOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsLd01.diagnose(noFunctionOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.functionCount).toBe(0)
      expect(RsLd01.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsLd01.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(unsafe)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noFunction)
      await cleanupWorkspace(excluded)
    }
  })

  test("RS-LD-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsLd02.id),
        { ...RsLd02, cacheVersion: `${RsLd02.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-LD-02")
    const decoded = Schema.decodeUnknownSync(RsLd02.configSchema)(RsLd02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsLd02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsLd02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsLd02.id, registry, {
      id: "rs-ld-02-contract",
      domain: "test",
      signal_overrides: {
        [RsLd02.id]: {
          config: {
            ...RsLd02.defaultConfig,
            max_lifetime_complexity: 2,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsLd02).toMatchObject({
      id: "RS-LD-02-lifetime-complexity",
      aliases: ["RS-LD-02"],
      title: "Lifetime complexity",
      tier: 1,
      category: "legibility-decay",
      kind: "legibility",
      cacheVersion: "lifetime-complexity-config-applicability-diagnostics-v1",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      max_lifetime_complexity: 4,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsLd02.id)
    expect(registered?.cacheVersion).toBe(RsLd02.cacheVersion)
    expect(registry.byId.get("RS-LD-02")?.id).toBe(RsLd02.id)
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
        path: "config.max_lifetime_complexity",
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

  test("RS-LD-02 counts lifetime parameters, bounds, and positions", async () => {
    const repo = await createLegibilityWorkspace()
    try {
      const out = await runSignalCompute(
        RsLd02,
        repo,
        { ...RsLd02.defaultConfig, max_lifetime_complexity: 3 },
      )
      const parse = out.functions.find((fn) => fn.name === "parse")

      expect(parse).toBeDefined()
      expect(parse?.lifetimeParams).toBe(2)
      expect(parse?.lifetimeBounds).toBeGreaterThanOrEqual(1)
      expect(parse?.inputPositions).toBeGreaterThanOrEqual(1)
      expect(parse?.outputPositions).toBe(0)
      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedSourceFileCount).toBe(1)
      expect(out.totalAnalyzedFunctions).toBeGreaterThan(out.lifetimeFunctionCount)
      expect(out.lifetimeFunctionCount).toBe(out.functions.length)
      expect(out.totalFunctions).toBe(out.lifetimeFunctionCount)
      expect(out.maxLifetimeComplexity).toBe(3)
      expect(out.diagnosticLimit).toBe(10)
      expect(out.overThresholdCount).toBeGreaterThanOrEqual(1)
      expect(RsLd02.outputMetadata?.(out)).toBeUndefined()
      expect(RsLd02.diagnose(out)[0]).toMatchObject({
        severity: "warn",
        message: expect.stringContaining("Lifetime complexity"),
        data: expect.objectContaining({
          maxLifetimeComplexity: 3,
        }),
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-LD-02 normalizes diagnostics and applicability evidence", async () => {
    const lifetime = await createLegibilityWorkspace()
    const missing = await createRustWorkspace("pulsar-rs-ld02-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "lifetime-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noLifetime = await createRustWorkspace("pulsar-rs-ld02-no-lifetime-", {
      "Cargo.toml": [
        "[package]",
        'name = "lifetime-none"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn clean(value: &str) -> usize {",
        "    value.len()",
        "}",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ld02-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "lifetime-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn parse<'a: 'b, 'b>(value: &'a str) -> &'a str",
        "where",
        "    'a: 'b,",
        "{",
        "    value",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsLd02,
        lifetime,
        { ...RsLd02.defaultConfig, max_lifetime_complexity: 1.8, top_n_diagnostics: 1.8 },
      )
      const hidden = await runSignalCompute(
        RsLd02,
        lifetime,
        { ...RsLd02.defaultConfig, max_lifetime_complexity: Number.NaN, top_n_diagnostics: Number.NaN },
      )
      const missingOut = await runSignalCompute(RsLd02, missing, RsLd02.defaultConfig)
      const noLifetimeOut = await runSignalCompute(RsLd02, noLifetime, RsLd02.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsLd02,
        excluded,
        { ...RsLd02.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(capped.maxLifetimeComplexity).toBe(1)
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsLd02.diagnose(capped)).toHaveLength(1)
      expect(RsLd02.diagnose(capped)[0]?.data).toMatchObject({
        maxLifetimeComplexity: 1,
      })
      expect(hidden.maxLifetimeComplexity).toBe(4)
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsLd02.diagnose(hidden)).toHaveLength(0)

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsLd02.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsLd02.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-LD-02 found no Rust source files for lifetime analysis",
          data: expect.objectContaining({
            sourceFileCount: 0,
            analyzedSourceFileCount: 0,
            totalAnalyzedFunctions: 0,
            lifetimeFunctionCount: 0,
          }),
        }),
      ])

      expect(noLifetimeOut.sourceFileCount).toBe(1)
      expect(noLifetimeOut.totalAnalyzedFunctions).toBe(1)
      expect(noLifetimeOut.lifetimeFunctionCount).toBe(0)
      expect(RsLd02.outputMetadata?.(noLifetimeOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsLd02.score(noLifetimeOut)).toBe(1)
      expect(RsLd02.diagnose(noLifetimeOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.totalAnalyzedFunctions).toBe(0)
      expect(excludedOut.lifetimeFunctionCount).toBe(0)
      expect(RsLd02.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsLd02.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(lifetime)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noLifetime)
      await cleanupWorkspace(excluded)
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
