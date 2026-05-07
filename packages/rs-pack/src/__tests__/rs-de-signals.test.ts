import { describe, expect, test } from "bun:test"
import { RsDe01 } from "../signals/rs-de-01-trait-coupling.js"
import { RsDe02 } from "../signals/rs-de-02-dep-tree.js"
import { RsDe03 } from "../signals/rs-de-03-feature-flags.js"
import { RsDe04 } from "../signals/rs-de-04-fan-in-fan-out.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
} from "./helpers.js"

describe("RS-DE-* signals", () => {
  test("RS-DE-01 classifies ordinary and concerning foreign trait implementations", async () => {
    const repo = await createRustWorkspace("pulsar-rs-de01-", {
      "Cargo.toml": [
        "[package]",
        'name = "de-trait-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::{Display, Formatter, Result as FmtResult};",
        "",
        "pub struct LocalType;",
        "pub trait LocalTrait { fn render(&self) -> &'static str; }",
        "",
        "impl Display for LocalType {",
        "    fn fmt(&self, _f: &mut Formatter<'_>) -> FmtResult { Ok(()) }",
        "}",
        "",
        "impl LocalTrait for LocalType {",
        "    fn render(&self) -> &'static str { \"local\" }",
        "}",
        "",
        "impl std::fmt::Debug for LocalType {",
        "    fn fmt(&self, _f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { Ok(()) }",
        "}",
        "",
        "impl serde::Serialize for LocalType {",
        "    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>",
        "    where",
        "        S: serde::Serializer,",
        "    {",
        "        unimplemented!()",
        "    }",
        "}",
        "",
        "impl axum::response::IntoResponse for LocalType {",
        "    fn into_response(self) -> axum::response::Response {",
        "        unimplemented!()",
        "    }",
        "}",
        "",
        "impl external_crate::ExternalTrait for LocalType {",
        "    fn external(&self) {}",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsDe01, repo, RsDe01.defaultConfig)
      const module = out.byModule.get("de-trait-fixture::crate")
      expect(out.totalForeignTraitImpls).toBeGreaterThanOrEqual(4)
      expect(out.totalConcerningForeignTraitImpls).toBe(1)
      expect(module?.ordinaryForeignTraitImpls).toBeGreaterThanOrEqual(3)
      expect(module?.concerningForeignTraitImpls).toBe(1)
      expect(module?.details.find((detail) => detail.trait === "std::fmt::Debug")?.family).toBe(
        "standard-library-ergonomic",
      )
      expect(module?.details.find((detail) => detail.trait === "serde::Serialize")?.family).toBe(
        "serialization",
      )
      expect(module?.details.find((detail) => detail.trait === "axum::response::IntoResponse")?.family).toBe(
        "framework-adapter",
      )
      expect(module?.details.find((detail) => detail.trait === "external_crate::ExternalTrait")?.family).toBe(
        "application-external",
      )
      expect(out.analysisMode).toBe("syntax-and-local-name-resolution")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-02 reports duplicate versions and dependency depth from Cargo.lock", async () => {
    const repo = await createRustWorkspace("pulsar-rs-de02-", {
      "Cargo.toml": [
        "[package]",
        'name = "dep-tree-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'foo = "1"',
        'bar = "1"',
        "",
      ].join("\n"),
      "Cargo.lock": [
        'version = 3',
        '',
        '[[package]]',
        'name = "dep-tree-fixture"',
        'version = "0.1.0"',
        'dependencies = [',
        ' "foo 1.0.0",',
        ' "bar 1.0.0",',
        ']',
        '',
        '[[package]]',
        'name = "foo"',
        'version = "1.0.0"',
        'dependencies = ["baz 1.0.0"]',
        '',
        '[[package]]',
        'name = "bar"',
        'version = "1.0.0"',
        'dependencies = [',
        ' "baz 2.0.0",',
        ' "qux 1.0.0",',
        ']',
        '',
        '[[package]]',
        'name = "qux"',
        'version = "1.0.0"',
        'dependencies = ["baz 1.0.0"]',
        '',
        '[[package]]',
        'name = "baz"',
        'version = "1.0.0"',
        '',
        '[[package]]',
        'name = "baz"',
        'version = "2.0.0"',
        '',
      ].join("\n"),
      "src/lib.rs": "pub fn fixture() {}\n",
    })

    try {
      const out = await runSignalCompute(RsDe02, repo, RsDe02.defaultConfig)
      expect(out.lockfileStatus).toBe("loaded")
      expect(out.duplicates.find((group) => group.name === "baz")?.versions).toEqual(["1.0.0", "2.0.0"])
      expect(out.topLevelDependencies.find((entry) => entry.name === "bar")?.maxDepth).toBe(2)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-03 counts feature flags and cross-crate propagation", async () => {
    const repo = await createRustWorkspace("pulsar-rs-de03-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core/Cargo.toml": [
        "[package]",
        'name = "core"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[features]",
        'serde = []',
        "",
      ].join("\n"),
      "crates/core/src/lib.rs": [
        "#[cfg(feature = \"serde\")]",
        "pub fn encoded() {}",
        "",
      ].join("\n"),
      "crates/app/Cargo.toml": [
        "[package]",
        'name = "app"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'core = { path = "../core", optional = true }',
        "",
        "[features]",
        'json = ["core?/serde"]',
        'full = ["json", "core"]',
        "",
      ].join("\n"),
      "crates/app/src/lib.rs": [
        "#[cfg(feature = \"json\")]",
        "pub fn json_mode() {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsDe03, repo, RsDe03.defaultConfig)
      expect(out.metadataStatus).toBe("loaded")
      expect(out.crates.find((entry) => entry.crate === "app")?.featureCount).toBe(3)
      expect(out.propagationByCrate.get("app")?.some((entry) => entry.targetCrate === "core")).toBe(true)
      expect(out.totalConditionalCompilationSites).toBeGreaterThanOrEqual(2)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-04 measures explicit module fan-in and fan-out", async () => {
    const repo = await createRustWorkspace("pulsar-rs-de04-", {
      "Cargo.toml": [
        "[package]",
        'name = "fan-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub mod api { pub struct Thing; }",
        "pub mod left { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "pub mod right { use crate::api::Thing; pub fn go(_: Thing) {} }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsDe04, repo, RsDe04.defaultConfig)
      expect(out.byModule.get("fan-fixture::crate::api")?.fanIn).toBe(2)
      expect(out.byModule.get("fan-fixture::crate::left")?.fanOut).toBe(1)
    } finally {
      await cleanupWorkspace(repo)
    }
  })
})
