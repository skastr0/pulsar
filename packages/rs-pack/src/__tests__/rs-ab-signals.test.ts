import { describe, expect, test } from "bun:test"
import { RsAb01 } from "../signals/rs-ab-01-unused-pub.js"
import { RsAb02 } from "../signals/rs-ab-02-trait-object-depth.js"
import { RsAb03 } from "../signals/rs-ab-03-generic-proliferation.js"
import { RsAb04 } from "../signals/rs-ab-04-derive-density.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
} from "./helpers.js"

describe("RS-AB-* signals", () => {
  test("RS-AB-01 distinguishes exported API from internal over-public items", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app", "crates/tool"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core/Cargo.toml": [
        "[package]",
        'name = "core_lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core/src/lib.rs": [
        "pub struct Used;",
        "pub struct PublicApi;",
        "pub(crate) struct CrateOnly;",
        "mod internal {",
        "    pub struct Hidden;",
        "    pub struct ReExported;",
        "}",
        "pub mod api {",
        "    pub struct ApiUsed;",
        "    pub struct ExternalApi;",
        "}",
        "pub use internal::ReExported as ExportedAlias;",
        "",
      ].join("\n"),
      "crates/core/src/main.rs": [
        "pub fn binary_helper() {}",
        "",
      ].join("\n"),
      "crates/app/Cargo.toml": [
        "[package]",
        'name = "app_lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'core_lib = { path = "../core" }',
        "",
      ].join("\n"),
      "crates/app/src/lib.rs": [
        "use core_lib::api::ApiUsed;",
        "use core_lib::Used;",
        "pub fn use_items(_: Used, _: ApiUsed) {}",
        "",
      ].join("\n"),
      "crates/tool/Cargo.toml": [
        "[package]",
        'name = "tool_bin"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/tool/src/main.rs": [
        "mod cli;",
        "fn main() {}",
        "",
      ].join("\n"),
      "crates/tool/src/cli.rs": [
        "pub struct CliOnly;",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems.find((item) => item.name === "Hidden")?.surface).toBe(
        "internal-overpublic",
      )
      expect(out.deadPublicItems.some((item) => item.name === "PublicApi")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "ExternalApi")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "ReExported")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "CrateOnly")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "binary_helper")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "CliOnly")).toBe(false)
      expect(out.exportedApiItems.some((item) => item.name === "PublicApi")).toBe(true)
      expect(out.exportedApiItems.some((item) => item.name === "ExternalApi")).toBe(true)
      expect(out.exportedApiItems.find((item) => item.name === "ReExported")?.reexported).toBe(true)
      expect(out.nonLibraryPublicItems.some((item) => item.name === "binary_helper")).toBe(true)
      expect(out.nonLibraryPublicItems.some((item) => item.name === "CliOnly")).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 resolves hyphenated crates and dependency aliases as cross-crate uses", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-alias-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core-lib", "crates/hyphen-user", "crates/alias-user"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core-lib/Cargo.toml": [
        "[package]",
        'name = "core-lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core-lib/src/lib.rs": [
        "pub struct HyphenUsed;",
        "pub struct AliasUsed;",
        "pub struct UnusedRoot;",
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
      ].join("\n"),
      "crates/hyphen-user/Cargo.toml": [
        "[package]",
        'name = "hyphen-user"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'core-lib = { path = "../core-lib" }',
        "",
      ].join("\n"),
      "crates/hyphen-user/src/lib.rs": [
        "use core_lib::HyphenUsed;",
        "pub fn use_hyphen(_: HyphenUsed) {}",
        "",
      ].join("\n"),
      "crates/alias-user/Cargo.toml": [
        "[package]",
        'name = "alias-user"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'domain = { package = "core-lib", path = "../core-lib" }',
        "",
      ].join("\n"),
      "crates/alias-user/src/lib.rs": [
        "use domain::AliasUsed;",
        "pub fn use_alias(_: AliasUsed) {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.exportedApiItems.find((item) => item.name === "HyphenUsed")?.crossCrateUses).toBe(1)
      expect(out.exportedApiItems.find((item) => item.name === "AliasUsed")?.crossCrateUses).toBe(1)
      expect(out.deadPublicItems.map((item) => item.name)).toEqual(["Hidden"])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 classifies direct and wildcard public reexports as exported API", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-reexports-", {
      "Cargo.toml": [
        "[package]",
        'name = "reexported-api"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod direct {",
        "    pub struct DirectItem;",
        "}",
        "",
        "mod wildcard {",
        "    pub struct WildOne;",
        "    pub struct WildTwo;",
        "}",
        "",
        "pub use direct::DirectItem;",
        "pub use wildcard::*;",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems).toEqual([])
      expect(out.exportedApiItems.map((item) => item.name)).toEqual([
        "DirectItem",
        "WildOne",
        "WildTwo",
      ])
      expect(out.exportedApiItems.every((item) => item.reexported)).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 normalizes diagnostic caps and classifies config factors", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "unused-public"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    pub struct Alpha;",
        "    pub struct Beta;",
        "    pub struct Gamma;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsAb01,
        repo,
        { ...RsAb01.defaultConfig, top_n_diagnostics: 1.8 },
      )
      const hidden = await runSignalCompute(
        RsAb01,
        repo,
        { ...RsAb01.defaultConfig, top_n_diagnostics: Number.NaN },
      )
      const factorLedger = RsAb01.factorLedger?.(capped)

      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAb01.diagnose(capped)).toHaveLength(1)
      expect(RsAb01.diagnose(capped)[0]?.data?.name).toBe("Alpha")
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsAb01.diagnose(hidden)).toHaveLength(0)
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
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 measures local trait-object call-chain depth", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Display;",
        "pub fn leaf() -> Box<dyn Display> { Box::new(String::from(\"leaf\")) }",
        "pub fn middle() -> Box<dyn Display> { leaf() }",
        "pub fn top() -> Box<dyn Display> { middle() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)
      expect(out.functions.find((entry) => entry.name === "leaf")?.chainDepth).toBe(1)
      expect(out.functions.find((entry) => entry.name === "top")?.chainDepth).toBeGreaterThanOrEqual(3)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-03 summarizes generic parameter proliferation", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab03-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Pair<T, U>(pub T, pub U);",
        "pub fn process<T, U, V>(left: T, right: U) -> V",
        "where",
        "    T: Clone,",
        "    U: Into<V>,",
        "    V: Clone,",
        "{",
        "    right.into()",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(
        RsAb03,
        repo,
        { ...RsAb03.defaultConfig, max_generic_parameters: 2 },
      )
      expect(out.parameterDistribution.max).toBeGreaterThanOrEqual(3)
      expect(out.overThreshold.some((entry) => entry.declarationName === "process")).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 counts standard and custom derives per type", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab04-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[derive(Clone, Debug, Serialize, Deserialize)]",
        "pub struct Model { pub id: u32 }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb04, repo, RsAb04.defaultConfig)
      const model = out.types.find((entry) => entry.name === "Model")
      expect(model?.deriveCount).toBe(4)
      expect(model?.customDerives).toEqual(["Serialize", "Deserialize"])
    } finally {
      await cleanupWorkspace(repo)
    }
  })
})
