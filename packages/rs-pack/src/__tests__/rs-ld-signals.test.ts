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
      cacheVersion: "unsafe-code-config-applicability-diagnostics-call-graph-density-v3",
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
          message: "Unsafe propagation in unsafe-propagation::crate::safe_zone: 100% functions, 0.33 unsafe sites/function",
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
      expect(RsLd01.diagnose(capped)).toHaveLength(1)
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
