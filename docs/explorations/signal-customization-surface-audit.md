# Signal customization surface audit

Date: 2026-05-10

Purpose: identify whether every score-affecting finding can be handled through the right mechanism: better code, corrected generic signal logic, explicit technology/project module semantics, repo-owned reference data, or vector factor policy. This is not a license to suppress findings. Customization is legitimate only when changing code to satisfy the generic signal would make the repository worse.

## Current common surfaces

- Every TypeScript, Rust, and shared signal exported through the pack wrappers exposes `config.*` factor definitions in the factor ledger. These support vector-level thresholds, weights, limits, and metadata controls.
- `taxonomy.file-classifier` lets modules classify files before signals consume file taxonomy.
- `typescript.noop-classifier` lets modules classify TS-SL-04 empty-body candidates as intentional no-ops with rule attribution.
- `typescript.unfinished-implementation-policy` lets modules tune TS-SL-04 factor pressure for specific unfinished-implementation candidates while preserving visible findings.
- `typescript.export-reachability` lets modules mark TypeScript exports as reachable public/runtime entrypoints.
- `typescript.callback-context-namer` lets modules refine callback names used by TypeScript complexity and size diagnostics.

## TypeScript signals

| Signal | Score contributors | Diagnostics | Current control surface | Gap |
| --- | --- | --- | --- | --- |
| `TS-LD-01-cyclomatic-complexity` | per-function branch/path complexity above threshold | function/file locations | config factors; callback naming slot | missing per-function complexity policy slot for generated DSLs, framework callbacks, or domain-approved shapes |
| `TS-LD-02-function-size-distribution` | per-file and per-function effective LOC outliers | function/file locations | config factors; callback naming slot | missing per-function/per-file size policy slot |
| `TS-LD-03-nesting-depth` | per-function nesting depth above threshold | function/file locations | config factors | missing per-node nesting policy slot |
| `TS-LD-04-naming-conventions` | inferred naming convention outliers | identifier locations | config factors; repo conventions/reference data | mostly reference-backed; missing per-identifier policy slot for generated/domain APIs |
| `TS-LD-05-domain-term-consistency` | glossary mismatch / unknown domain terms | identifier/file locations | config factors; repo glossary/reference data | reference-backed; no immediate processor gap |
| `TS-LD-06-annotation-coverage` | exported/boundary declarations lacking explicit annotations | declaration locations | config factors | missing declaration-role policy slot for framework contracts and generated APIs |
| `TS-LD-07-unsafe-type-erosion` | weighted `any`/unsafe boundary occurrences | node/file locations | config factors | missing unsafe-occurrence policy slot |
| `TS-AD-01-boundary-violations` | package import/export edges violating conventions | import/export locations | config factors; repo conventions/reference data | reference-backed for package rules; missing per-edge module classifier for runtime/plugin edges |
| `TS-AD-02-circular-dependencies` | module-cycle participation and cycle severity | cycle/module locations | config factors | missing graph-edge/cycle policy slot |
| `TS-AD-03-reexport-depth` | barrel ratio, index reexports, reexport chain depth | file/export locations | config factors | missing export-edge/barrel policy slot |
| `TS-DE-01-type-level-coupling` | type reference coupling and module precision limits | module/type locations | config factors | missing symbol/type-reference policy slot |
| `TS-DE-02-fan-in-fan-out` | module fan-in/fan-out above hub thresholds | module locations | config factors | missing graph-node/edge policy slot |
| `TS-DE-03-propagation-cost` | transitive dependency impact and changed module reach | module graph diagnostics | config factors | missing graph-edge/module-role policy slot |
| `TS-DE-04-package-dependency-health` | undeclared, mis-scoped, unused, virtual, or aliased dependencies | import/package locations | config factors for aliases, dev-prod allowances, test/generated globs | missing dependency/specifier classifier slot; known framework virtual imports must move to technology packs |
| `TS-DE-05-duplicate-dependency-versions` | lockfile/package version multiplicity | package/version diagnostics | config factors | missing package-version policy slot for intentional runtime skew |
| `TS-AB-01-public-export-surface` | exported public symbol count/surface pressure | export locations | config factors | missing public API role classifier |
| `TS-AB-02-unused-exports` | exported declarations without local/runtime reachability | export locations | config factors; `typescript.export-reachability` slot | processor-backed; strongest current abstraction-signal surface |
| `TS-AB-03-type-indirection-depth` | type alias/interface indirection chain depth | type locations | config factors | missing type-indirection policy slot |
| `TS-AB-04-interface-implementation-ratio` | interfaces with low implementation count / dead abstraction pressure | interface locations | config factors | missing interface-role classifier |
| `TS-AB-05-generic-proliferation` | declarations with many type parameters | declaration locations | config factors | missing type-parameter role policy slot |
| `TS-SL-01-duplication` | normalized clone groups and duplicate token pressure | clone/file locations | config factors | missing clone-region classifier; also contains Effect-specific generic filtering that should move to the Effect pack |
| `TS-SL-02-inconsistent-clones` | divergent clone groups from duplication input | clone/file locations | config factors; upstream duplication input | missing clone-group policy slot |
| `TS-SL-03-suppressions` | suppression comments and missing/expired justifications | comment/file locations | config factors; generic file taxonomy | missing suppression policy slot for repo-owned allowed suppression taxonomies |
| `TS-SL-04-unfinished-implementations` | throw-not-implemented, empty body, TODO-only body, placeholder return factors | function/node locations | config factors; noop classifier; unfinished policy slot | strongest current per-finding surface |
| `TS-RP-01-hotspots` | churn times complexity pressure | file locations | config factors; upstream churn and complexity signals | composite; depends on upstream per-file controls |
| `TS-RP-02-pr-size` | changed files/lines/dependency deltas | diff diagnostics | config factors | missing diff-file classifier for generated/vendor/project-owned release artifacts |

## Shared signals

| Signal | Score contributors | Diagnostics | Current control surface | Gap |
| --- | --- | --- | --- | --- |
| `SHARED-02-bus-factor` | author concentration per file | file/author diagnostics | config factors | missing ownership policy/reference-data surface for generated, vendored, or intentionally single-owner files |
| `SHARED-03-churn-rate` | recent line/file churn and survival | file/history diagnostics | config factors | missing churn-file classifier for generated or expected migration churn |
| `SHARED-CHURN-01-recent-churn` | provider recent-change facts | file/history facts | config factors | source fact provider; no immediate processor gap except file taxonomy |
| `SHARED-05-suppression-governance` | aggregate suppression health from language signals | aggregate diagnostics | config factors; upstream suppression signals | depends on upstream suppression policy slots |
| `SHARED-06-pr-dependency-delta` | dependency change pressure in PR/range | package/diff diagnostics | config factors; upstream PR-size signals | missing dependency-delta policy slot |

## Rust signals

Rust signals currently expose config factors through the pack wrapper, but no Rust project-module processor slots. That is acceptable for threshold-only policy, but not enough for per-finding technology or repo semantics.

| Signal | Score contributors | Diagnostics | Current control surface | Gap |
| --- | --- | --- | --- | --- |
| `RS-AD-01-visibility-surface` | public visibility breadth | item/file diagnostics | config factors | missing Rust item role classifier |
| `RS-AD-02-crate-boundaries` | crate boundary violations | dependency/path diagnostics | config factors | missing crate-edge policy slot |
| `RS-AD-03-circular-crate-dependencies` | crate dependency cycles | cycle diagnostics | config factors | missing crate-cycle policy slot |
| `RS-DE-01-trait-coupling` | trait dependency/coupling pressure | trait/file diagnostics | config factors | missing trait role classifier |
| `RS-DE-02-dependency-tree` | dependency tree breadth/depth | package diagnostics | config factors | missing dependency classifier |
| `RS-DE-03-feature-flags` | feature flag count and complexity | manifest diagnostics | config factors | missing feature policy slot |
| `RS-DE-04-fan-in-fan-out` | crate/module fan-in/fan-out | graph diagnostics | config factors | missing graph-node/edge slot |
| `RS-AB-01-unused-public-items` | unused public items | item/file diagnostics | config factors | missing item reachability/public API slot |
| `RS-AB-02-trait-object-depth` | trait object nesting/depth | type diagnostics | config factors | missing type-shape policy slot |
| `RS-AB-03-generic-proliferation` | generic parameter pressure | item diagnostics | config factors | missing generic role slot |
| `RS-AB-04-derive-density` | derive macro density | item diagnostics | config factors | missing macro/derive policy slot |
| `RS-LD-01-unsafe-code` | unsafe block/item pressure | node/file diagnostics | config factors | missing unsafe-occurrence policy slot |
| `RS-LD-02-lifetime-complexity` | lifetime parameter and annotation pressure | item diagnostics | config factors | missing lifetime role slot |
| `RS-LD-03-match-catch-all` | broad catch-all match arms | match diagnostics | config factors | missing match-arm policy slot |
| `RS-LD-04-error-granularity` | broad/stringly error shapes | error diagnostics | config factors | missing error-type role classifier |
| `RS-LD-05-cyclomatic-complexity` | function complexity | function/file diagnostics | config factors | missing function complexity policy slot |
| `RS-LD-06-domain-term-consistency` | glossary/domain term mismatch | identifier diagnostics | config factors; glossary/reference data | reference-backed; no immediate processor gap |
| `RS-SL-01-duplication` | clone groups | clone/file diagnostics | config factors | missing clone-region classifier |
| `RS-SL-02-suppressions` | allow/expect/lint suppression health | attribute/comment diagnostics | config factors | missing suppression policy slot |
| `RS-SL-03-unwrap-expect` | unwrap/expect usage | call diagnostics | config factors | missing call-site policy slot |
| `RS-SL-04-clone-abuse` | clone call pressure | call diagnostics | config factors | missing call-site ownership/policy slot |
| `RS-RP-01-hotspots` | churn times complexity pressure | file diagnostics | config factors; upstream churn/complexity | composite; depends on upstream controls |
| `RS-RP-02-compile-time` | compile-time pressure | crate/build diagnostics | config factors | missing build-target policy slot |
| `RS-RP-03-pr-size` | diff size pressure | diff diagnostics | config factors | missing diff-file classifier |

## Immediate follow-on slot families

1. Candidate policy slots for TypeScript legibility signals: function complexity, function/file size, nesting, annotations, and unsafe type erosion.
2. Graph policy slots for module/crate edges, cycles, fan-in/fan-out, propagation, and boundaries.
3. Dependency/specifier policy slots for package health, duplicate versions, virtual modules, and PR dependency deltas.
4. Public API/abstraction policy slots for export surface, unused/export reachability, type indirection, interface roles, and generic roles.
5. Clone/suppression policy slots for duplicate regions, inconsistent clone groups, and suppression governance.
6. Rust processor primitives mirroring the TypeScript families for items, calls, match arms, crate edges, dependencies, and unsafe occurrences.

## Technology-assumption cleanup notes

- TS-SL-04 no longer carries built-in React host config, VS Code extension lifecycle, yargs handler, optional protected framework hook, or project-specific projection/event no-op semantics. Those are now explicit technology-pack or repo-module candidates.
- TS-SL-01 still contains an Effect-specific small `Effect.gen` callback clone filter in generic TypeScript duplication logic. That should move to the Effect technology pack through a clone-region classifier.
- TS-DE-04 still contains framework virtual module/package assumptions. These should move behind a dependency/specifier classifier.
- TS-LD-06 still contains framework method-contract annotation exemptions. These should move behind a declaration-role policy slot.
