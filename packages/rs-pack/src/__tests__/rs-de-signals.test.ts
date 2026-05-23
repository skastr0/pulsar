import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsDe01 } from "../signals/rs-de-01-trait-coupling.js"
import { RsDe02 } from "../signals/rs-de-02-dep-tree.js"
import { RsDe03 } from "../signals/rs-de-03-feature-flags.js"
import { RsDe04 } from "../signals/rs-de-04-fan-in-fan-out.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
} from "./helpers.js"

const rsDe01TraitWorkspaceFiles = (): Readonly<Record<string, string>> => ({
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
    "impl external_crate::ExternalTrait for external_crate::ExternalType {",
    "    fn adapter(&self) {}",
    "}",
    "",
  ].join("\n"),
})

const createRsDe01TraitWorkspace = () =>
  createRustWorkspace("pulsar-rs-de01-", rsDe01TraitWorkspaceFiles())

const createRsDe01CleanLocalWorkspace = () =>
  createRustWorkspace("pulsar-rs-de01-clean-", {
    "Cargo.toml": [
      "[package]",
      'name = "de-clean-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub struct LocalType;",
      "pub trait LocalTrait { fn render(&self) -> &'static str; }",
      "",
      "impl LocalTrait for LocalType {",
      "    fn render(&self) -> &'static str { \"local\" }",
      "}",
      "",
    ].join("\n"),
  })

const createRsDe01NoTraitWorkspace = () =>
  createRustWorkspace("pulsar-rs-de01-no-trait-", {
    "Cargo.toml": [
      "[package]",
      'name = "de-no-trait-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub struct LocalType;\npub fn build() {}\n",
  })

const createRsDe01OneConcerningWorkspace = () =>
  createRustWorkspace("pulsar-rs-de01-one-concerning-", {
    "Cargo.toml": [
      "[package]",
      'name = "de-one-concerning-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "impl external_crate::ExternalTrait for external_crate::ExternalType {",
      "    fn adapter(&self) {}",
      "}",
      "",
    ].join("\n"),
  })

const createRsDe01MultiModuleWorkspace = () =>
  createRustWorkspace("pulsar-rs-de01-multi-", {
    "Cargo.toml": [
      "[package]",
      'name = "de-multi-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "pub mod alpha {",
      "    impl external_crate::ExternalTrait for external_crate::AlphaType {",
      "        fn adapter(&self) {}",
      "    }",
      "}",
      "",
      "pub mod beta {",
      "    impl external_crate::ExternalTrait for external_crate::BetaType {",
      "        fn adapter(&self) {}",
      "    }",
      "}",
      "",
    ].join("\n"),
  })

const rsDe02ProblemWorkspaceFiles = (): Readonly<Record<string, string>> => ({
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
    "version = 3",
    "",
    "[[package]]",
    'name = "dep-tree-fixture"',
    'version = "0.1.0"',
    "dependencies = [",
    ' "bar 1.0.0",',
    ' "foo 1.0.0",',
    "]",
    "",
    "[[package]]",
    'name = "bar"',
    'version = "1.0.0"',
    "dependencies = [",
    ' "baz 2.0.0",',
    ' "qux",',
    "]",
    "",
    "[[package]]",
    'name = "foo"',
    'version = "1.0.0"',
    'dependencies = ["baz 1.0.0"]',
    "",
    "[[package]]",
    'name = "qux"',
    'version = "1.0.0"',
    'dependencies = ["baz 1.0.0"]',
    "",
    "[[package]]",
    'name = "baz"',
    'version = "1.0.0"',
    "",
    "[[package]]",
    'name = "baz"',
    'version = "2.0.0"',
    "",
  ].join("\n"),
  "src/lib.rs": "pub fn fixture() {}\n",
})

const createRsDe02ProblemWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-", rsDe02ProblemWorkspaceFiles())

const createRsDe02CleanWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-clean-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-clean-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'foo = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-clean-fixture"',
      'version = "0.1.0"',
      'dependencies = ["foo"]',
      "",
      "[[package]]",
      'name = "foo"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02NoDependencyWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-no-deps-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-no-deps-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-no-deps-fixture"',
      'version = "0.1.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02WorseWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-worse-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-worse-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'foo = "1"',
      'bar = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-worse-fixture"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "bar 1.0.0",',
      ' "foo 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "bar"',
      'version = "1.0.0"',
      "dependencies = [",
      ' "mid1 1.0.0",',
      ' "zap 2.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "foo"',
      'version = "1.0.0"',
      "dependencies = [",
      ' "baz 1.0.0",',
      ' "zap 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "mid1"',
      'version = "1.0.0"',
      'dependencies = ["mid2 1.0.0"]',
      "",
      "[[package]]",
      'name = "mid2"',
      'version = "1.0.0"',
      'dependencies = ["mid3 1.0.0"]',
      "",
      "[[package]]",
      'name = "mid3"',
      'version = "1.0.0"',
      'dependencies = ["baz 2.0.0"]',
      "",
      "[[package]]",
      'name = "baz"',
      'version = "1.0.0"',
      "",
      "[[package]]",
      'name = "baz"',
      'version = "2.0.0"',
      "",
      "[[package]]",
      'name = "zap"',
      'version = "1.0.0"',
      "",
      "[[package]]",
      'name = "zap"',
      'version = "2.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02BroaderWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-broader-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-broader-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'bar = "1"',
      'foo = "1"',
      'leaf1 = "1"',
      'leaf2 = "1"',
      'leaf3 = "1"',
      'leaf4 = "1"',
      'leaf5 = "1"',
      'leaf6 = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-broader-fixture"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "bar 1.0.0",',
      ' "foo 1.0.0",',
      ' "leaf1 1.0.0",',
      ' "leaf2 1.0.0",',
      ' "leaf3 1.0.0",',
      ' "leaf4 1.0.0",',
      ' "leaf5 1.0.0",',
      ' "leaf6 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "bar"',
      'version = "1.0.0"',
      "dependencies = [",
      ' "baz 2.0.0",',
      ' "qux",',
      "]",
      "",
      "[[package]]",
      'name = "foo"',
      'version = "1.0.0"',
      'dependencies = ["baz 1.0.0"]',
      "",
      "[[package]]",
      'name = "qux"',
      'version = "1.0.0"',
      'dependencies = ["baz 1.0.0"]',
      "",
      "[[package]]",
      'name = "baz"',
      'version = "1.0.0"',
      "",
      "[[package]]",
      'name = "baz"',
      'version = "2.0.0"',
      "",
      ...[1, 2, 3, 4, 5, 6].flatMap((index) => [
        "[[package]]",
        `name = "leaf${index}"`,
        'version = "1.0.0"',
        "",
      ]),
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02SourceCollisionWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-source-collision-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-source-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'foo = "1"',
      'bar = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-source-fixture"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "bar 1.0.0",',
      ' "foo 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "foo"',
      'version = "1.0.0"',
      'dependencies = ["shared 1.0.0 (registry+https://example.invalid/index)"]',
      "",
      "[[package]]",
      'name = "bar"',
      'version = "1.0.0"',
      'dependencies = ["shared 1.0.0 (git+https://example.invalid/shared)"]',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "registry+https://example.invalid/index"',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "git+https://example.invalid/shared"',
      'dependencies = ["git-leaf 1.0.0"]',
      "",
      "[[package]]",
      'name = "git-leaf"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02DirectSourceCollisionWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-direct-source-collision-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-direct-source-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'shared = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-direct-source-fixture"',
      'version = "0.1.0"',
      'dependencies = ["shared 1.0.0 (registry+https://example.invalid/index)"]',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "registry+https://example.invalid/index"',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "git+https://example.invalid/shared"',
      'dependencies = ["git-leaf 1.0.0"]',
      "",
      "[[package]]",
      'name = "git-leaf"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02AmbiguousDirectSourceWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-ambiguous-direct-source-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-ambiguous-source-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'shared = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-ambiguous-source-fixture"',
      'version = "0.1.0"',
      'dependencies = ["shared 1.0.0"]',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "registry+https://example.invalid/index"',
      "",
      "[[package]]",
      'name = "shared"',
      'version = "1.0.0"',
      'source = "git+https://example.invalid/shared"',
      'dependencies = ["git-leaf 1.0.0"]',
      "",
      "[[package]]",
      'name = "git-leaf"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02EqualDepthWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-equal-depth-", {
    "Cargo.toml": [
      "[package]",
      'name = "dep-tree-equal-depth-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'beta = "1"',
      'alpha = "1"',
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-equal-depth-fixture"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "beta 1.0.0",',
      ' "alpha 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "beta"',
      'version = "1.0.0"',
      'dependencies = ["leaf-b 1.0.0"]',
      "",
      "[[package]]",
      'name = "alpha"',
      'version = "1.0.0"',
      'dependencies = ["leaf-a 1.0.0"]',
      "",
      "[[package]]",
      'name = "leaf-a"',
      'version = "1.0.0"',
      "",
      "[[package]]",
      'name = "leaf-b"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn fixture() {}\n",
  })

const createRsDe02WorkspaceInheritedWorkspace = () =>
  createRustWorkspace("pulsar-rs-de02-workspace-inherited-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/app"]',
      'resolver = "2"',
      "",
      "[workspace.dependencies]",
      'serde_alias = { package = "serde", version = "1" }',
      'bar = "1"',
      "",
      "[workspace.dependencies.renamed_table]",
      'package = "renamed"',
      'version = "1"',
      "",
    ].join("\n"),
    "crates/app/Cargo.toml": [
      "[package]",
      'name = "dep-tree-workspace-inherit-fixture"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'serde_alias = { workspace = true }',
      'bar = { workspace = true }',
      "",
      "[dependencies.renamed_table]",
      "workspace = true",
      "",
    ].join("\n"),
    "Cargo.lock": [
      "version = 3",
      "",
      "[[package]]",
      'name = "dep-tree-workspace-inherit-fixture"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "bar 1.0.0",',
      ' "renamed 1.0.0",',
      ' "serde 1.0.0",',
      "]",
      "",
      "[[package]]",
      'name = "bar"',
      'version = "1.0.0"',
      'dependencies = ["leaf 1.0.0"]',
      "",
      "[[package]]",
      'name = "renamed"',
      'version = "1.0.0"',
      'dependencies = ["leaf 1.0.0"]',
      "",
      "[[package]]",
      'name = "serde"',
      'version = "1.0.0"',
      "",
      "[[package]]",
      'name = "leaf"',
      'version = "1.0.0"',
      "",
    ].join("\n"),
    "crates/app/src/lib.rs": "pub fn fixture() {}\n",
  })

const rsDe03FeatureWorkspaceFiles = (): Readonly<Record<string, string>> => ({
  "Cargo.toml": [
    "[workspace]",
    'members = ["crates/core", "crates/renamed-dep", "crates/app"]',
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
  "crates/renamed-dep/Cargo.toml": [
    "[package]",
    'name = "renamed-dep"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[features]",
    'derive = []',
    "",
  ].join("\n"),
  "crates/renamed-dep/src/lib.rs": [
    "#[cfg(feature = \"derive\")]",
    "pub fn derived() {}",
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
    'renamed_alias = { package = "renamed-dep", path = "../renamed-dep", optional = true }',
    "",
    "[features]",
    'default = ["json"]',
    'json = ["core?/serde"]',
    'local = ["json"]',
    'storage = ["dep:renamed_alias"]',
    'derive = ["renamed_alias/derive"]',
    'full = ["local", "core"]',
    "",
  ].join("\n"),
  "crates/app/src/lib.rs": [
    "#[cfg(feature = \"json\")]",
    "pub fn json_mode() {}",
    "",
    "pub fn runtime() -> bool {",
    "    cfg!(feature = \"storage\")",
    "}",
    "",
  ].join("\n"),
})

const createRsDe03FeatureWorkspace = () =>
  createRustWorkspace("pulsar-rs-de03-", rsDe03FeatureWorkspaceFiles())

const createRsDe03CleanWorkspace = () =>
  createRustWorkspace("pulsar-rs-de03-clean-", {
    "Cargo.toml": [
      "[package]",
      'name = "feature-clean"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": "pub fn plain() {}\n",
  })

const createRsDe03CommentOnlyWorkspace = () =>
  createRustWorkspace("pulsar-rs-de03-comment-only-", {
    "Cargo.toml": [
      "[package]",
      'name = "feature-comment-only"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "src/lib.rs": [
      "// #[cfg(feature = \"ghost\")]",
      "// let _ = cfg!(feature = \"ghost\");",
      "/// #[cfg(feature = \"doc_ghost\")]",
      "pub const TEXT: &str = \"#[cfg(feature = \\\"string_ghost\\\")] cfg!(feature = \\\"string_ghost\\\")\";",
      "pub fn plain() {}",
      "",
    ].join("\n"),
  })

const createRsDe03MoreComplexWorkspace = () =>
  createRustWorkspace("pulsar-rs-de03-complex-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/core", "crates/renamed-dep", "crates/app"]',
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
    "crates/renamed-dep/Cargo.toml": [
      "[package]",
      'name = "renamed-dep"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[features]",
      'derive = []',
      "",
    ].join("\n"),
    "crates/renamed-dep/src/lib.rs": [
      "#[cfg(feature = \"derive\")]",
      "pub fn derived() {}",
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
      'renamed_alias = { package = "renamed-dep", path = "../renamed-dep", optional = true }',
      "",
      "[features]",
      'default = ["f1"]',
      'f1 = ["core?/serde"]',
      'f2 = ["core?/serde"]',
      'f3 = ["dep:core"]',
      'f4 = ["renamed_alias/derive"]',
      'f5 = ["dep:renamed_alias"]',
      'f6 = ["f1", "f2"]',
      'f7 = []',
      'f8 = []',
      'f9 = []',
      'f10 = []',
      "",
    ].join("\n"),
    "crates/app/src/lib.rs": [
      "#[cfg(feature = \"f1\")]",
      "pub fn f1() {}",
      "#[cfg(feature = \"f2\")]",
      "pub fn f2() {}",
      "#[cfg(feature = \"f3\")]",
      "pub fn f3() {}",
      "#[cfg(feature = \"f4\")]",
      "pub fn f4() {}",
      "pub fn runtime() -> bool { cfg!(feature = \"f5\") || cfg!(feature = \"f6\") }",
      "",
    ].join("\n"),
  })

describe("RS-DE-* signals", () => {
  test("RS-DE-01 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(buildRegistry([
      ...SHARED_SIGNALS,
      ...RS_PACK_SIGNALS.map((signal) =>
        signal.id === RsDe01.id
          ? { ...RsDe01, cacheVersion: `${RsDe01.cacheVersion}-changed` }
          : signal,
      ),
    ]))
    const registered = registry.byId.get("RS-DE-01")
    const decoded = Schema.decodeUnknownSync(RsDe01.configSchema)(RsDe01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({} as never)
    const baseCacheHash = computeConfigHash(RsDe01.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsDe01.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsDe01.id, registry, {
      id: "rs-de-01-contract",
      domain: "test",
      signal_overrides: {
        [RsDe01.id]: {
          config: {
            ...RsDe01.defaultConfig,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsDe01).toMatchObject({
      id: "RS-DE-01-trait-coupling",
      aliases: ["RS-DE-01"],
      title: "Trait coupling",
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "trait-coupling-config-applicability-diagnostics-v1",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsDe01.id)
    expect(registered?.cacheVersion).toBe(RsDe01.cacheVersion)
    expect(registry.byId.get("RS-DE-01")?.id).toBe(RsDe01.id)
    expect(versionedCacheHash).not.toBe(baseCacheHash)
    expect(configuredCacheHash).not.toBe(baseCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-DE-01 classifies ordinary and concerning foreign trait implementations", async () => {
    const repo = await createRsDe01TraitWorkspace()

    try {
      const out = await runSignalCompute(RsDe01, repo, RsDe01.defaultConfig)
      const module = out.byModule.get("de-trait-fixture::crate")
      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedFileCount).toBe(1)
      expect(out.totalTraitImpls).toBe(7)
      expect(out.totalForeignTraitImpls).toBe(5)
      expect(out.totalConcerningForeignTraitImpls).toBe(2)
      expect(module?.ordinaryForeignTraitImpls).toBe(3)
      expect(module?.concerningForeignTraitImpls).toBe(2)
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
      expect(RsDe01.score(out)).toBe(0)
      expect(RsDe01.outputMetadata?.(out)).toBeUndefined()

      const diagnostics = RsDe01.diagnose(out)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Module de-trait-fixture::crate implements 2 concerning foreign traits (3 ordinary)",
        data: {
          module: "de-trait-fixture::crate",
          foreignTraitImpls: 5,
          concerningForeignTraitImpls: 2,
          ordinaryForeignTraitImpls: 3,
          orphanWorkaroundCandidates: 1,
          analysisMode: "syntax-and-local-name-resolution",
        },
      })
      expect(diagnostics[0]?.location?.file).toEndWith("/src/lib.rs")
      expect(typeof diagnostics[0]?.location?.line).toBe("number")
      expect(typeof diagnostics[0]?.data?.hash).toBe("string")
      expect(diagnostics[0]?.data?.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            trait: "external_crate::ExternalTrait",
            type: "LocalType",
            relativeFile: "src/lib.rs",
            family: "application-external",
            orphanWorkaroundCandidate: false,
          }),
          expect.objectContaining({
            trait: "external_crate::ExternalTrait",
            type: "external_crate::ExternalType",
            relativeFile: "src/lib.rs",
            family: "application-external",
            orphanWorkaroundCandidate: true,
          }),
        ]),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-01 keeps diagnostic hashes stable across checkout roots", async () => {
    const firstRepo = await createRsDe01TraitWorkspace()
    const secondRepo = await createRsDe01TraitWorkspace()

    try {
      const first = await runSignalCompute(RsDe01, firstRepo, RsDe01.defaultConfig)
      const second = await runSignalCompute(RsDe01, secondRepo, RsDe01.defaultConfig)

      expect(firstRepo).not.toBe(secondRepo)
      expect(RsDe01.diagnose(first)[0]?.data?.hash).toBe(
        RsDe01.diagnose(second)[0]?.data?.hash,
      )
    } finally {
      await cleanupWorkspace(firstRepo)
      await cleanupWorkspace(secondRepo)
    }
  })

  test("RS-DE-01 keeps local-only, no-source, no-trait, and excluded source cases neutral", async () => {
    const cleanRepo = await createRsDe01CleanLocalWorkspace()
    const noSourceRepo = await createRustWorkspace("pulsar-rs-de01-no-source-", {
      "README.md": "# no rust here\n",
    })
    const noTraitRepo = await createRsDe01NoTraitWorkspace()
    const excludedRepo = await createRsDe01TraitWorkspace()

    try {
      const clean = await runSignalCompute(RsDe01, cleanRepo, RsDe01.defaultConfig)
      const noSource = await runSignalCompute(RsDe01, noSourceRepo, RsDe01.defaultConfig)
      const noTrait = await runSignalCompute(RsDe01, noTraitRepo, RsDe01.defaultConfig)
      const excluded = await runSignalCompute(RsDe01, excludedRepo, {
        ...RsDe01.defaultConfig,
        exclude_globs: ["**/src/**"],
      })

      expect(clean.sourceFileCount).toBe(1)
      expect(clean.analyzedFileCount).toBe(1)
      expect(clean.totalTraitImpls).toBe(1)
      expect(clean.modules).toEqual([])
      expect(RsDe01.score(clean)).toBe(1)
      expect(RsDe01.diagnose(clean)).toEqual([])
      expect(RsDe01.outputMetadata?.(clean)).toBeUndefined()

      expect(noSource.sourceFileCount).toBe(0)
      expect(noSource.analyzedFileCount).toBe(0)
      expect(RsDe01.score(noSource)).toBe(1)
      expect(RsDe01.outputMetadata?.(noSource)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsDe01.diagnose(noSource)[0]).toMatchObject({
        severity: "warn",
        data: {
          sourceFileCount: 0,
          analyzedFileCount: 0,
          totalTraitImpls: 0,
        },
      })

      expect(noTrait.sourceFileCount).toBe(1)
      expect(noTrait.analyzedFileCount).toBe(1)
      expect(noTrait.totalTraitImpls).toBe(0)
      expect(RsDe01.score(noTrait)).toBe(1)
      expect(RsDe01.diagnose(noTrait)).toEqual([])
      expect(RsDe01.outputMetadata?.(noTrait)).toEqual({
        applicability: "not_applicable",
      })

      expect(excluded.sourceFileCount).toBe(1)
      expect(excluded.analyzedFileCount).toBe(0)
      expect(excluded.totalTraitImpls).toBe(0)
      expect(RsDe01.score(excluded)).toBe(1)
      expect(RsDe01.diagnose(excluded)).toEqual([])
      expect(RsDe01.outputMetadata?.(excluded)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(cleanRepo)
      await cleanupWorkspace(noSourceRepo)
      await cleanupWorkspace(noTraitRepo)
      await cleanupWorkspace(excludedRepo)
    }
  })

  test("RS-DE-01 normalizes diagnostic limits and trait-coupling score pressure", async () => {
    const oneConcerningRepo = await createRsDe01OneConcerningWorkspace()
    const multiModuleRepo = await createRsDe01MultiModuleWorkspace()

    try {
      const oneConcerning = await runSignalCompute(RsDe01, oneConcerningRepo, RsDe01.defaultConfig)
      const capped = await runSignalCompute(RsDe01, multiModuleRepo, {
        ...RsDe01.defaultConfig,
        top_n_diagnostics: 1.9,
      })
      const hiddenNegative = await runSignalCompute(RsDe01, multiModuleRepo, {
        ...RsDe01.defaultConfig,
        top_n_diagnostics: -1,
      })
      const hiddenNaN = await runSignalCompute(RsDe01, multiModuleRepo, {
        ...RsDe01.defaultConfig,
        top_n_diagnostics: Number.NaN,
      })

      expect(capped.totalConcerningForeignTraitImpls).toBe(2)
      expect(capped.modules.map((module) => module.module)).toEqual([
        "de-multi-fixture::crate::alpha",
        "de-multi-fixture::crate::beta",
      ])
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsDe01.diagnose(capped)).toHaveLength(1)
      expect(RsDe01.diagnose(capped)[0]?.data?.module).toBe("de-multi-fixture::crate::alpha")
      expect(hiddenNegative.diagnosticLimit).toBe(0)
      expect(hiddenNaN.diagnosticLimit).toBe(0)
      expect(RsDe01.diagnose(hiddenNegative)).toEqual([])
      expect(RsDe01.diagnose(hiddenNaN)).toEqual([])
      expect(oneConcerning.totalConcerningForeignTraitImpls).toBe(1)
      expect(RsDe01.score(capped)).toBeLessThan(RsDe01.score(oneConcerning))
    } finally {
      await cleanupWorkspace(oneConcerningRepo)
      await cleanupWorkspace(multiModuleRepo)
    }
  })

  test("RS-DE-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(buildRegistry([
      ...SHARED_SIGNALS,
      ...RS_PACK_SIGNALS.map((signal) =>
        signal.id === RsDe02.id
          ? { ...RsDe02, cacheVersion: `${RsDe02.cacheVersion}-changed` }
          : signal,
      ),
    ]))
    const registered = registry.byId.get("RS-DE-02")
    const decoded = Schema.decodeUnknownSync(RsDe02.configSchema)(RsDe02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({} as never)
    const baseCacheHash = computeConfigHash(RsDe02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsDe02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsDe02.id, registry, {
      id: "rs-de-02-contract",
      domain: "test",
      signal_overrides: {
        [RsDe02.id]: {
          config: {
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsDe02).toMatchObject({
      id: "RS-DE-02-dependency-tree",
      aliases: ["RS-DE-02"],
      title: "Dependency tree",
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "cargo-lock-dependency-tree-workspace-deps-v1",
      inputs: [],
    })
    expect(decoded).toEqual({ top_n_diagnostics: 10 })
    expect(registered?.id).toBe(RsDe02.id)
    expect(registered?.cacheVersion).toBe(RsDe02.cacheVersion)
    expect(registry.byId.get("RS-DE-02")?.id).toBe(RsDe02.id)
    expect(versionedCacheHash).not.toBe(baseCacheHash)
    expect(configuredCacheHash).not.toBe(baseCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-DE-02 reports duplicate versions and dependency depth from Cargo.lock", async () => {
    const repo = await createRsDe02ProblemWorkspace()

    try {
      const out = await runSignalCompute(RsDe02, repo, RsDe02.defaultConfig)
      expect(out.lockfileStatus).toBe("loaded")
      expect(out.packageCount).toBe(6)
      expect(out.dependencyPackageCount).toBe(5)
      expect(out.manifestCount).toBe(1)
      expect(out.directDependencyCount).toBe(2)
      expect(out.duplicateCount).toBe(1)
      expect(out.duplicates).toEqual([
        {
          name: "baz",
          versions: ["1.0.0", "2.0.0"],
          instanceCount: 2,
        },
      ])
      expect(out.topLevelDependencies.map((entry) => entry.name)).toEqual(["bar", "foo"])
      expect(out.topLevelDependencies.find((entry) => entry.name === "bar")).toMatchObject({
        maxDepth: 2,
        reachablePackages: 4,
        rootInstances: 1,
      })
      expect(out.topLevelDependencies.find((entry) => entry.name === "foo")?.maxDepth).toBe(1)
      expect(RsDe02.score(out)).toBeCloseTo(0.8)
      expect(RsDe02.outputMetadata?.(out)).toBeUndefined()

      const diagnostics = RsDe02.diagnose(out)
      expect(diagnostics).toHaveLength(3)
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Duplicate crate versions for baz: 1.0.0, 2.0.0",
        location: { file: "Cargo.lock" },
        data: {
          name: "baz",
          versions: ["1.0.0", "2.0.0"],
          instanceCount: 2,
        },
      })
      expect(diagnostics[1]).toMatchObject({
        severity: "info",
        message: "Top-level dependency bar reaches depth 2",
        data: {
          name: "bar",
          maxDepth: 2,
          reachablePackages: 4,
          rootInstances: 1,
        },
      })
      expect(typeof diagnostics[0]?.data?.hash).toBe("string")
      expect(typeof diagnostics[1]?.data?.hash).toBe("string")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-02 keeps clean, missing, and no-dependency lockfiles neutral", async () => {
    const cleanRepo = await createRsDe02CleanWorkspace()
    const missingRepo = await createRustWorkspace("pulsar-rs-de02-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "dep-tree-missing-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'foo = "1"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub fn fixture() {}\n",
    })
    const noDependencyRepo = await createRsDe02NoDependencyWorkspace()

    try {
      const clean = await runSignalCompute(RsDe02, cleanRepo, RsDe02.defaultConfig)
      const missing = await runSignalCompute(RsDe02, missingRepo, RsDe02.defaultConfig)
      const noDependency = await runSignalCompute(RsDe02, noDependencyRepo, RsDe02.defaultConfig)

      expect(clean.lockfileStatus).toBe("loaded")
      expect(clean.packageCount).toBe(2)
      expect(clean.directDependencyCount).toBe(1)
      expect(clean.duplicateCount).toBe(0)
      expect(clean.topLevelDependencies).toEqual([
        {
          name: "foo",
          rootInstances: 1,
          maxDepth: 0,
          reachablePackages: 1,
        },
      ])
      expect(RsDe02.score(clean)).toBe(1)
      expect(RsDe02.diagnose(clean)).toEqual([])
      expect(RsDe02.outputMetadata?.(clean)).toBeUndefined()

      expect(missing.lockfileStatus).toBe("missing")
      expect(missing.packageCount).toBe(0)
      expect(missing.dependencyPackageCount).toBe(0)
      expect(missing.directDependencyCount).toBe(1)
      expect(RsDe02.score(missing)).toBe(1)
      expect(RsDe02.outputMetadata?.(missing)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsDe02.diagnose(missing)[0]).toMatchObject({
        severity: "warn",
        data: {
          lockfileStatus: "missing",
          directDependencyCount: 1,
          packageCount: 0,
        },
      })

      expect(noDependency.lockfileStatus).toBe("loaded")
      expect(noDependency.packageCount).toBe(1)
      expect(noDependency.dependencyPackageCount).toBe(0)
      expect(noDependency.directDependencyCount).toBe(0)
      expect(RsDe02.score(noDependency)).toBe(1)
      expect(RsDe02.diagnose(noDependency)).toEqual([])
      expect(RsDe02.outputMetadata?.(noDependency)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(cleanRepo)
      await cleanupWorkspace(missingRepo)
      await cleanupWorkspace(noDependencyRepo)
    }
  })

  test("RS-DE-02 normalizes diagnostic limits and dependency score pressure", async () => {
    const problemRepo = await createRsDe02ProblemWorkspace()
    const worseRepo = await createRsDe02WorseWorkspace()
    const broaderRepo = await createRsDe02BroaderWorkspace()
    const equalDepthRepo = await createRsDe02EqualDepthWorkspace()
    const firstProblemRoot = await createRsDe02ProblemWorkspace()
    const secondProblemRoot = await createRsDe02ProblemWorkspace()

    try {
      const problem = await runSignalCompute(RsDe02, problemRepo, RsDe02.defaultConfig)
      const worse = await runSignalCompute(RsDe02, worseRepo, RsDe02.defaultConfig)
      const broader = await runSignalCompute(RsDe02, broaderRepo, RsDe02.defaultConfig)
      const equalDepth = await runSignalCompute(RsDe02, equalDepthRepo, {
        top_n_diagnostics: 2.9,
      })
      const capped = await runSignalCompute(RsDe02, problemRepo, {
        top_n_diagnostics: 1.9,
      })
      const hiddenNegative = await runSignalCompute(RsDe02, problemRepo, {
        top_n_diagnostics: -1,
      })
      const hiddenNaN = await runSignalCompute(RsDe02, problemRepo, {
        top_n_diagnostics: Number.NaN,
      })
      const firstRoot = await runSignalCompute(RsDe02, firstProblemRoot, RsDe02.defaultConfig)
      const secondRoot = await runSignalCompute(RsDe02, secondProblemRoot, RsDe02.defaultConfig)

      expect(worse.duplicateCount).toBe(2)
      expect(worse.topLevelDependencies.find((entry) => entry.name === "bar")?.maxDepth).toBe(4)
      expect(RsDe02.score(worse)).toBeLessThan(RsDe02.score(problem))
      expect(broader.dependencyPackageCount).toBeGreaterThan(problem.dependencyPackageCount)
      expect(broader.duplicateCount).toBe(problem.duplicateCount)
      expect(broader.topLevelDependencies.find((entry) => entry.name === "bar")?.maxDepth).toBe(
        problem.topLevelDependencies.find((entry) => entry.name === "bar")?.maxDepth,
      )
      expect(RsDe02.score(broader)).toBeLessThan(RsDe02.score(problem))
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsDe02.diagnose(capped)).toHaveLength(1)
      expect(RsDe02.diagnose(capped)[0]?.data?.name).toBe("baz")
      expect(equalDepth.diagnosticLimit).toBe(2)
      expect(RsDe02.diagnose(equalDepth).map((diagnostic) => diagnostic.data?.name)).toEqual([
        "alpha",
        "beta",
      ])
      expect(hiddenNegative.diagnosticLimit).toBe(0)
      expect(hiddenNaN.diagnosticLimit).toBe(0)
      expect(RsDe02.diagnose(hiddenNegative)).toEqual([])
      expect(RsDe02.diagnose(hiddenNaN)).toEqual([])
      expect(RsDe02.diagnose(firstRoot).map((diagnostic) => diagnostic.data?.hash)).toEqual(
        RsDe02.diagnose(secondRoot).map((diagnostic) => diagnostic.data?.hash),
      )
    } finally {
      await cleanupWorkspace(problemRepo)
      await cleanupWorkspace(worseRepo)
      await cleanupWorkspace(broaderRepo)
      await cleanupWorkspace(equalDepthRepo)
      await cleanupWorkspace(firstProblemRoot)
      await cleanupWorkspace(secondProblemRoot)
    }
  })

  test("RS-DE-02 distinguishes same-name same-version packages from different sources", async () => {
    const repo = await createRsDe02SourceCollisionWorkspace()
    const directRepo = await createRsDe02DirectSourceCollisionWorkspace()
    const ambiguousDirectRepo = await createRsDe02AmbiguousDirectSourceWorkspace()

    try {
      const out = await runSignalCompute(RsDe02, repo, RsDe02.defaultConfig)
      const direct = await runSignalCompute(RsDe02, directRepo, RsDe02.defaultConfig)
      const ambiguousDirect = await runSignalCompute(
        RsDe02,
        ambiguousDirectRepo,
        RsDe02.defaultConfig,
      )

      expect(out.topLevelDependencies.find((entry) => entry.name === "foo")).toMatchObject({
        maxDepth: 1,
        reachablePackages: 2,
      })
      expect(out.topLevelDependencies.find((entry) => entry.name === "bar")).toMatchObject({
        maxDepth: 2,
        reachablePackages: 3,
      })
      expect(direct.topLevelDependencies).toEqual([
        {
          name: "shared",
          rootInstances: 1,
          maxDepth: 0,
          reachablePackages: 1,
        },
      ])
      expect(ambiguousDirect.topLevelDependencies).toEqual([])
      expect(RsDe02.score(ambiguousDirect)).toBe(1)
      expect(RsDe02.outputMetadata?.(ambiguousDirect)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsDe02.diagnose(ambiguousDirect)[0]).toMatchObject({
        severity: "warn",
        message: "RS-DE-02 could not resolve direct Cargo.lock dependencies",
        data: {
          directDependencyCount: 1,
          packageCount: 4,
          dependencyPackageCount: 3,
        },
      })
    } finally {
      await cleanupWorkspace(repo)
      await cleanupWorkspace(directRepo)
      await cleanupWorkspace(ambiguousDirectRepo)
    }
  })

  test("RS-DE-02 resolves workspace-inherited dependency aliases before lock matching", async () => {
    const repo = await createRsDe02WorkspaceInheritedWorkspace()

    try {
      const out = await runSignalCompute(RsDe02, repo, RsDe02.defaultConfig)

      expect(out.lockfileStatus).toBe("loaded")
      expect(out.manifestCount).toBe(2)
      expect(out.packageCount).toBe(5)
      expect(out.dependencyPackageCount).toBe(4)
      expect(out.directDependencyCount).toBe(3)
      expect(out.topLevelDependencies).toEqual([
        {
          name: "bar",
          rootInstances: 1,
          maxDepth: 1,
          reachablePackages: 2,
        },
        {
          name: "renamed",
          rootInstances: 1,
          maxDepth: 1,
          reachablePackages: 2,
        },
        {
          name: "serde",
          rootInstances: 1,
          maxDepth: 0,
          reachablePackages: 1,
        },
      ])
      expect(RsDe02.score(out)).toBeCloseTo(0.95)
      expect(RsDe02.outputMetadata?.(out)).toBeUndefined()
      expect(RsDe02.diagnose(out).map((diagnostic) => diagnostic.message)).toEqual([
        "Top-level dependency bar reaches depth 1",
        "Top-level dependency renamed reaches depth 1",
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-03 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(buildRegistry([
      ...SHARED_SIGNALS,
      ...RS_PACK_SIGNALS.map((signal) =>
        signal.id === RsDe03.id
          ? { ...RsDe03, cacheVersion: `${RsDe03.cacheVersion}-changed` }
          : signal,
      ),
    ]))
    const registered = registry.byId.get("RS-DE-03")
    const decoded = Schema.decodeUnknownSync(RsDe03.configSchema)(RsDe03.defaultConfig)
    const factorLedger = registered?.factorLedger?.({} as never)
    const baseCacheHash = computeConfigHash(RsDe03.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsDe03.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsDe03.id, registry, {
      id: "rs-de-03-contract",
      domain: "test",
      signal_overrides: {
        [RsDe03.id]: {
          config: {
            ...RsDe03.defaultConfig,
            warn_feature_count: 2,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsDe03).toMatchObject({
      id: "RS-DE-03-feature-flags",
      aliases: ["RS-DE-03"],
      title: "Feature flag complexity",
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "cargo-feature-flags-config-propagation-v1",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      warn_feature_count: 8,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsDe03.id)
    expect(registered?.cacheVersion).toBe(RsDe03.cacheVersion)
    expect(registry.byId.get("RS-DE-03")?.id).toBe(RsDe03.id)
    expect(versionedCacheHash).not.toBe(baseCacheHash)
    expect(configuredCacheHash).not.toBe(baseCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.warn_feature_count",
        source: "signal-default",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-DE-03 counts feature flags, cfg sites, and Cargo feature propagation", async () => {
    const repo = await createRsDe03FeatureWorkspace()

    try {
      const out = await runSignalCompute(RsDe03, repo, RsDe03.defaultConfig)
      const app = out.crates.find((entry) => entry.crate === "app")
      const appPropagations = out.propagationByCrate.get("app") ?? []

      expect(out.metadataStatus).toBe("loaded")
      expect(out.packageCount).toBe(3)
      expect(out.sourceFileCount).toBe(3)
      expect(out.analyzedSourceFileCount).toBe(3)
      expect(out.featureDefinitionCount).toBe(9)
      expect(out.propagationCount).toBe(4)
      expect(out.totalConditionalCompilationSites).toBe(4)
      expect(app).toMatchObject({
        crate: "app",
        featureCount: 7,
        conditionalCompilationSites: 2,
        propagatedFeatures: 4,
      })
      expect(appPropagations).toHaveLength(4)
      expect(appPropagations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          feature: "core",
          dependencyAlias: "core",
          targetCrate: "core",
          targetFeature: undefined,
          optional: true,
          activationKind: "optional-dependency",
        }),
        expect.objectContaining({
          feature: "json",
          dependencyAlias: "core",
          targetCrate: "core",
          targetFeature: "serde",
          optional: true,
          activationKind: "weak-dependency-feature",
        }),
        expect.objectContaining({
          feature: "storage",
          dependencyAlias: "renamed_alias",
          targetCrate: "renamed-dep",
          targetFeature: undefined,
          optional: true,
          activationKind: "optional-dependency",
        }),
        expect.objectContaining({
          feature: "derive",
          dependencyAlias: "renamed_alias",
          targetCrate: "renamed-dep",
          targetFeature: "derive",
          optional: true,
          activationKind: "dependency-feature",
        }),
      ]))
      expect(appPropagations.map((entry) => entry.targetCrate)).not.toContain("json")
      expect(RsDe03.score(out)).toBeCloseTo(0.8)
      expect(RsDe03.outputMetadata?.(out)).toBeUndefined()

      const diagnostics = RsDe03.diagnose(out)
      expect(diagnostics).toHaveLength(3)
      expect(diagnostics[0]).toMatchObject({
        severity: "info",
        message: "Crate app defines 7 features (4 cross-crate propagations, 2 cfg sites)",
        data: {
          crate: "app",
          featureCount: 7,
          conditionalCompilationSites: 2,
          propagatedFeatures: 4,
          warnFeatureCount: 8,
        },
      })
      expect(diagnostics[0]?.location?.file).toEndWith("crates/app/Cargo.toml")
      expect(typeof diagnostics[0]?.data?.hash).toBe("string")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-DE-03 keeps clean, missing, and excluded feature evidence honest", async () => {
    const cleanRepo = await createRsDe03CleanWorkspace()
    const commentOnlyRepo = await createRsDe03CommentOnlyWorkspace()
    const missingRepo = await createRustWorkspace("pulsar-rs-de03-missing-", {
      "README.md": "# no cargo metadata here\n",
    })
    const excludedRepo = await createRsDe03FeatureWorkspace()

    try {
      const clean = await runSignalCompute(RsDe03, cleanRepo, RsDe03.defaultConfig)
      const commentOnly = await runSignalCompute(RsDe03, commentOnlyRepo, RsDe03.defaultConfig)
      const missing = await runSignalCompute(RsDe03, missingRepo, RsDe03.defaultConfig)
      const excluded = await runSignalCompute(RsDe03, excludedRepo, {
        ...RsDe03.defaultConfig,
        exclude_globs: ["**/crates/app/src/**"],
      })
      const measured = await runSignalCompute(RsDe03, excludedRepo, RsDe03.defaultConfig)

      expect(clean.metadataStatus).toBe("loaded")
      expect(clean.packageCount).toBe(1)
      expect(clean.featureDefinitionCount).toBe(0)
      expect(clean.propagationCount).toBe(0)
      expect(clean.totalConditionalCompilationSites).toBe(0)
      expect(RsDe03.score(clean)).toBe(1)
      expect(RsDe03.diagnose(clean)).toEqual([])
      expect(RsDe03.outputMetadata?.(clean)).toEqual({
        applicability: "not_applicable",
      })

      expect(commentOnly.metadataStatus).toBe("loaded")
      expect(commentOnly.packageCount).toBe(1)
      expect(commentOnly.featureDefinitionCount).toBe(0)
      expect(commentOnly.totalConditionalCompilationSites).toBe(0)
      expect(RsDe03.score(commentOnly)).toBe(1)
      expect(RsDe03.diagnose(commentOnly)).toEqual([])
      expect(RsDe03.outputMetadata?.(commentOnly)).toEqual({
        applicability: "not_applicable",
      })

      expect(missing.metadataStatus).toBe("missing")
      expect(missing.packageCount).toBe(0)
      expect(RsDe03.score(missing)).toBe(1)
      expect(RsDe03.outputMetadata?.(missing)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsDe03.diagnose(missing)[0]).toMatchObject({
        severity: "warn",
        message: "RS-DE-03 could not load cargo metadata for feature analysis",
        data: {
          metadataStatus: "missing",
          packageCount: 0,
        },
      })

      expect(excluded.sourceFileCount).toBe(3)
      expect(excluded.analyzedSourceFileCount).toBe(2)
      expect(excluded.totalConditionalCompilationSites).toBe(2)
      expect(excluded.propagationCount).toBe(measured.propagationCount)
      expect(RsDe03.score(excluded)).toBeGreaterThan(RsDe03.score(measured))
      expect(RsDe03.outputMetadata?.(excluded)).toBeUndefined()
    } finally {
      await cleanupWorkspace(cleanRepo)
      await cleanupWorkspace(commentOnlyRepo)
      await cleanupWorkspace(missingRepo)
      await cleanupWorkspace(excludedRepo)
    }
  })

  test("RS-DE-03 normalizes config and scores feature complexity monotonically", async () => {
    const repo = await createRsDe03FeatureWorkspace()
    const complexRepo = await createRsDe03MoreComplexWorkspace()
    const firstRoot = await createRsDe03FeatureWorkspace()
    const secondRoot = await createRsDe03FeatureWorkspace()

    try {
      const base = await runSignalCompute(RsDe03, repo, RsDe03.defaultConfig)
      const strict = await runSignalCompute(RsDe03, repo, {
        ...RsDe03.defaultConfig,
        warn_feature_count: 2.9,
        top_n_diagnostics: 1.9,
      })
      const hiddenNegative = await runSignalCompute(RsDe03, repo, {
        ...RsDe03.defaultConfig,
        top_n_diagnostics: -1,
      })
      const hiddenNaN = await runSignalCompute(RsDe03, repo, {
        ...RsDe03.defaultConfig,
        warn_feature_count: Number.NaN,
        top_n_diagnostics: Number.NaN,
      })
      const complex = await runSignalCompute(RsDe03, complexRepo, RsDe03.defaultConfig)
      const first = await runSignalCompute(RsDe03, firstRoot, RsDe03.defaultConfig)
      const second = await runSignalCompute(RsDe03, secondRoot, RsDe03.defaultConfig)

      expect(strict.warnFeatureCount).toBe(2)
      expect(strict.diagnosticLimit).toBe(1)
      expect(RsDe03.score(strict)).toBeLessThan(RsDe03.score(base))
      expect(RsDe03.diagnose(strict)).toHaveLength(1)
      expect(RsDe03.diagnose(strict)[0]?.severity).toBe("warn")
      expect(hiddenNegative.diagnosticLimit).toBe(0)
      expect(hiddenNaN.warnFeatureCount).toBe(8)
      expect(hiddenNaN.diagnosticLimit).toBe(0)
      expect(RsDe03.diagnose(hiddenNegative)).toEqual([])
      expect(RsDe03.diagnose(hiddenNaN)).toEqual([])
      expect(complex.featureDefinitionCount).toBeGreaterThan(base.featureDefinitionCount)
      expect(complex.propagationCount).toBeGreaterThan(base.propagationCount)
      expect(complex.totalConditionalCompilationSites).toBeGreaterThan(
        base.totalConditionalCompilationSites,
      )
      expect(RsDe03.score(complex)).toBeLessThan(RsDe03.score(base))
      expect(RsDe03.diagnose(first).map((diagnostic) => diagnostic.data?.hash)).toEqual(
        RsDe03.diagnose(second).map((diagnostic) => diagnostic.data?.hash),
      )
    } finally {
      await cleanupWorkspace(repo)
      await cleanupWorkspace(complexRepo)
      await cleanupWorkspace(firstRoot)
      await cleanupWorkspace(secondRoot)
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
