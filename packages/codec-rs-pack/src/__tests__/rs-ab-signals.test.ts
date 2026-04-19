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
  test("RS-AB-01 finds dead public items across workspace crates", async () => {
    const repo = await createRustWorkspace("taste-codec-rs-ab01-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app"]',
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
        "pub struct ReExported;",
        "pub struct Dead;",
        "pub mod api { pub struct ApiUsed; }",
        "pub use ReExported as ExportedAlias;",
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
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems.some((item) => item.name === "Dead")).toBe(true)
      expect(out.deadPublicItems.some((item) => item.name === "ReExported")).toBe(false)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 measures local trait-object call-chain depth", async () => {
    const repo = await createRustWorkspace("taste-codec-rs-ab02-", {
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
    const repo = await createRustWorkspace("taste-codec-rs-ab03-", {
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
    const repo = await createRustWorkspace("taste-codec-rs-ab04-", {
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
