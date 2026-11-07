# Rust type-lane sources: docs survey

Clean-room: official docs, rustc-dev-guide, rust-lang goals/issues, crates.io/docs.rs only. Written for pulsar-rs (#658); they measure RSS/wall and write `rust-types.md`. Question: how to get expression types, method-call resolution and the trait/impl graph out of Rust code within Pulsar's memory bar, on a stable toolchain.

## (a) `ra_ap_*` crates (rust-analyzer as a library)

**What they are.** rust-analyzer's internal crates are auto-published to crates.io under the `ra_ap_` prefix on every release (currently `0.0.358`, 2026-10-12; weekly cadence). They compile on **stable rustc** — no `rustc_private`, no nightly needed ([changelog #40](https://rust-analyzer.github.io/thisweek/2020/08/31/changelog-40.html), [lib/README](https://github.com/rust-lang/rust-analyzer/tree/master/lib), [crates.io/ra_ap_hir](https://crates.io/crates/ra_ap_hir)).

**Stability promise: none.** "Obey semver" is nominal — versions are `0.0.x`, so every release may break API. Explicit statements: changelog #40 — "we provide no backwards compatibility guarantees. Building external tooling on top of rust-analyzer libraries is a non-goal"; flodiebold on [issue #14466](https://github.com/rust-lang/rust-analyzer/issues/14466) — crates are provided "as-is" without any guarantees. A maintainer-endorsed crate selection ([StackOverflow](https://stackoverflow.com/questions/79819661/)) says depend on `syntax`, `hir`, `ide-db`, `ide`, `load-cargo`; **avoid `hir-ty`, `hir-def`, `hir-expand`, `base-db` — "API intentionally unstable."** For Pulsar that caveat matters: `InferenceResult` lives in `hir-ty`, so the type lane rides an explicitly unstable API. Mitigation: pin exact `=0.0.x` versions and treat upgrades as adapter work.

**Which crates for which job:**

| Need | Crate(s) | Entry points |
|---|---|---|
| Load a cargo workspace | `ra_ap_project_model`, `ra_ap_load_cargo` | `ProjectWorkspace::load(manifest, &CargoConfig, progress)` discovers via `cargo metadata` + `rustc --print sysroot` ([docs.rs](https://docs.rs/ra_ap_project_model/latest/ra_ap_project_model/struct.ProjectWorkspace.html), [workspace.rs source](https://docs.rs/ra_ap_project_model/latest/src/ra_ap_project_model/workspace.rs.html)); `load_workspace(ws, env, cfg) -> (RootDatabase, Vfs, Option<ProcMacroClient>)` is the one-call form ([docs.rs](https://docs.rs/ra_ap_load-cargo/latest/ra_ap_load_cargo/fn.load_workspace.html)). Proc macros need the `ProcMacroClient` (a server process) — it is `Option`, so a no-proc-macro lane exists but resolves fewer bodies. |
| Walk bodies | `ra_ap_hir` (+ `hir_def` types underneath) | `hir::DefWithBody::body(db)` → `Body` with `Arena<Expr>`/`Arena<Pat>`; `db.body_with_source_map(def)` maps HIR exprs back to AST spans. |
| Expression types | `ra_ap_hir_ty` | `db.infer(def) -> Arc<InferenceResult>`; `InferenceResult` fields include `type_of_expr: FxHashMap<ExprId, Ty>`, `type_of_pat`, `type_of_binding`, `method_resolutions: FxHashMap<ExprId, (Function, Substitution)>`, `field_resolutions`, `variant_resolutions`, `assoc_resolutions`, `expr_adjustments`, `pat_adjustments` ([docs.rs](https://docs.rs/ra_ap_hir_ty/latest/ra_ap_hir_ty/struct.InferenceResult.html)). |
| Method-call resolution | `ra_ap_hir_ty::method_resolution` | `lookup_method(db, ty, name, visible_from)`, `iterate_method_candidates`, `iterate_method_candidates_dyn`, `is_valid_candidate`. |
| Trait/impl graph | `ra_ap_hir` (`Trait`, `Impl`) | `Impl::all_for_trait(db, tr)`, `Impl::all_for_type(db, ty)`, `Impl::self_ty(db)`, `Trait::items(db)`, `Impl::items(db)`; crate-level queries `db.inherent_impls_in_crate(krate)` / `db.trait_impls_in_crate(krate)` return `InherentImpls`/`TraitImpls` keyed by type fingerprint. |
| `Result`-typed expressions | same | `type_of_expr` gives `Ty`; `Ty::as_adt()` yields the `Adt`; compare against `core::result::Result`'s `AdtId` resolved once per crate graph (via lang items / famous-defs paths). No first-class "is Result" predicate — the detector writes the comparison. |

**Cost caveat (from issue #14466, maintainer):** full analysis builds proc-macro deps and macro-expands + name-resolves the crate *and its dependencies* at item level; bodies are analyzed lazily per query. First load of a workspace with the sysroot is the expensive part — relevant to the memory bar; measure on corpora.

## (b) rust-analyzer SCIP output

**What it is.** `rust-analyzer scip` is a built-in CLI subcommand emitting a [SCIP](https://scip-code.org/docs.html) index (spec: [scip.proto](https://github.com/sourcegraph/scip/blob/main/scip.proto); emitter: [cli/scip.rs](https://rust-lang.github.io/rust-analyzer/src/rust_analyzer/cli/scip.rs.html)).

**Encodes:** per-package `Index` → `Document`s (one per file) → `SymbolInformation` (symbol string per the descriptor grammar, `kind` enum — Function/Method/Field/Module/Enum/Impl/Trait/…, `display_name`, docstrings, `enclosing_symbol`) and `Occurrence`s (symbol + range + `symbol_roles` bitfield: write/read/reference/import/export). `Relationship`s link symbols: `is_reference`, `is_implementation`, `is_type_definition`, `is_definition` — enough to reconstruct "impl method M implements trait method T" edges.

**Does not encode:** any type information. No expression types, no receiver types, no generic substitutions, no inference results, no CFG. A call-site `Occurrence` records *which symbol the reference resolved to* — so you learn the resolved `Function`/`Method` symbol — but not *how* it resolved (trait vs inherent is only recoverable indirectly via the symbol's own relationships/kind). Symbol occurrences are per-document; cross-crate resolution is only as good as what the indexer emitted.

**Verdict for Pulsar:** SCIP covers the *reference* half of the fact model (definitions + resolved references + impl↔trait edges) with a stable, tool-agnostic format — but the type-aware detectors (inferred `any` analogue, `Result` channels, exact Effect-style requirement tracking) get nothing from it. It is a fallback for "names and edges only," not a type lane.

## (c) rustc side

| Option | Status | What it gives | Stable toolchain? |
|---|---|---|---|
| **rustdoc JSON** (`cargo rustdoc -- -Zunstable-options --output-format json`) | Nightly-only flag; format versioned by `format_version` field; schema published as the `rustdoc-types` crate ([docs](https://doc.rust-lang.org/stable/nightly-rustc/rustdoc_json_types/index.html)). Contents: crate root, `index` (DefIndex → item), `paths`, `external_crates`, spans, impls, trait impls, generics, predicates, **item signatures/types — but no function bodies**. In-file disclaimer added June 2026: format "not stable, may change without notice" ([PR #157278](https://github.com/rust-lang/rust/pull/157278)). docs.rs hosts prebuilt per-crate JSON ([docs.rs/about/rustdoc-json](https://docs.rs/about/rustdoc-json)); `migrate_rustdoc_json` migrates between format versions (v41–v46 as of v0.5). | Public API surface: items, signatures, impl/trait structure, generics — **not** bodies or expression types. | Requires nightly (or a pinned nightly toolchain just for doc builds). |
| **rustc_driver** (external driver crate) | Needs `rustc-dev` + `llvm-tools` components and `#![feature(rustc_private)]` ([rustc-dev-guide](https://rustc-dev-guide.rust-lang.org/rustc-driver/external-rustc-drivers.html), [unstable book](https://doc.rust-lang.org/unstable-book/language-features/rustc-private.html)). Tracking issue [#27812](https://doc.rust-lang.org/unstable-book/language-features/rustc-private.html) still open. | Full compiler internals: HIR, ty, MIR, everything rustc knows. | Only via `RUSTC_BOOTSTRAP=1` on stable — perma-unstable, officially "strongly discouraged," opts out of stability guarantees, viral dylib linkage ([unstable book](https://doc.rust-lang.org/stable/unstable-book/compiler-environment-variables/RUSTC_BOOTSTRAP.html)). |
| **`-Zunpretty`** | Nightly `-Z` flag; dumps HIR/MIR/THIR/etc. as text. | Debugging-grade dumps, not a library interface. | No (nightly only). |
| **stable_mir → `rustc_public`** | Renamed project; MIR-based SemVer API in development. **Not on crates.io** — consumed via `extern crate` + feature inside the compiler tree. 2026–2027 goal: publish v0.1 ([goals.rust-lang.org/2026/rustc-public](https://goals.rust-lang.org/2026/rustc-public.html), [compiler-team#949](https://github.com/rust-lang/compiler-team/issues/949) open). | MIR with types for compiled crates — post-monomorphization-ish view, spans present. | Not yet, on any channel. |

**What works on a stable toolchain today:** nothing first-party gives body-level types. Realistic lanes:
1. **`ra_ap_*` crates** — the only option delivering inference results (`type_of_expr`, `method_resolutions`) plus the trait/impl graph in-process on stable rustc. Costs: unstable API (pin `=0.0.x`), heavy first load (sysroot + deps expansion), proc-macro server optional.
2. **rustdoc JSON on a pinned nightly** — fine for *published* crates via docs.rs, useless for bodies; cannot see uncommitted/local code without building docs.
3. **`RUSTC_BOOTSTRAP=1` + rustc_private** — technically runs on stable but is unsupported and couples Pulsar to a specific rustc build; the rustc-dev-guide itself frames it as a bootstrap hack.
4. **SCIP index** — stable-ish format, names/edges only, no types.

**Recommendation shape for #658:** if the type lane needs expression types and `Result` detection, `ra_ap_hir` + `ra_ap_hir_ty` (+ `ra_ap_project_model`/`ra_ap_load_cargo` for loading) is the only surveyed path that stays in-process on stable. Measure its RSS/wall on the two corpora before committing — the sysroot load is the risk to the memory bar. SCIP is the cheaper fallback if only reference facts are needed.
