# Pulsar

**A library of provable preference signals with deterministic scoring for LLM-aligned decision-making**

*Architecture Document — v0.5 — April 2026*

---

## Thesis

Pulsar is an encoded n-dimensional decision function. It feels automatic and subconscious because the dimensions and weights are implicit. This system makes them explicit through **provable, computable signals**, not LLM vibes.

Three separable components:

- **Signals**: a growing library of grounded, verifiable checks organized by what they measure. Pure functions: artifact in, number out. Language-specific packs exploit each ecosystem's unique structural surface.
- **Pulsar Vector**: the repository or organization's shared configuration — which signals are active, how much each matters, what thresholds apply. Inspectable, diffable JSON. Presets are portable templates; active pulsar is shared by everyone evaluating the repo.
- **Observer**: the runtime that computes scores, routes reviews, tracks backpressure over time, and triggers agent constraints.

Two design rules govern the system:

1. **Provability determines enforcement, not preference.** A boundary violation is a hard CI gate regardless of its weight in the repo's pulsar vector. A naming inconsistency is a soft warning regardless of how much the repo weights naming. The provability tier sets the ceiling on enforcement policy. The effective repo/org pulsar vector adjusts sensitivity within that ceiling.

2. **Combinations beat individual metrics.** The strongest predictive signals in the research literature are compound: churn × complexity, duplication × inconsistency, coupling + boundary violations. Single metrics in isolation are weak predictors. The signal library formalizes compound signals as first-class.

The primary validation: **pulsar bisect**. Score a repo's commit history against a frozen reference, isolate the commits that introduced rot on specific dimensions. If maintainers confirm the result, the thesis holds.

---

## Provability Tiers

Every signal has a provability tier that determines its maximum enforcement level.

**Tier 1 — Pure Computation**

Zero cost, perfectly deterministic. Same input always produces same output. No LLM.

*Enforcement ceiling*: Hard CI gate for structural signals. Soft warning for legibility signals.

**Tier 1.5 — Derived/Compound Computation**

Takes other signal outputs as inputs. Still fully deterministic. Captures interaction effects that individual signals miss. This is where the strongest predictive power lives.

Examples: churn × complexity hotspots, duplication × inconsistency detection, coupling trend × boundary violation frequency.

*Enforcement ceiling*: Same as its input signals' tier. A compound of two Tier 1 signals is Tier 1.5. A compound involving Tier 3 inherits Tier 3's ceiling.

**Tier 2 — Computation + Reference Data**

Requires a maintained dataset (glossary, schema conventions, architectural rules). Deterministic given the reference. The reference itself has a maintenance cost.

*Enforcement ceiling*: Hard gate for structural checks (boundary violations against declared rules). Soft warning for convention checks. Reference data must be bootstrapped in Phase 1 — without it, the product is a Tier 1 linter wrapper.

**Tier 3 — LLM with Grounded Context**

The LLM has concrete reference material and performs comparison/classification. Input structured, output constrained, reasoning verifiable. Scores are ephemeral with confidence decay — never ground truth.

*Enforcement ceiling*: Soft warning only. Never a CI gate. Cached with staleness flag, re-evaluated after N days or model version change.

**Excluded — Ungrounded LLM Judgment**

"Rate the clarity." "Is this readable?" Not a pulsar input. Triggers downstream review that produces reasoning, not a float.

---

## Signal Taxonomy

Signals are organized by **what decays**, not by tool type. This taxonomy is drawn from decades of empirical research on software quality metrics. Flattening these into generic "quality" destroys their diagnostic value.

### Category 1: Architectural Drift

Divergence between the codebase's intended structure and its actual dependency/layering relationships. Often invisible in individual reviews — each change looks reasonable locally — but cumulatively erodes the structural contracts that make a system comprehensible.

Architectural drift signals have the **lowest false positive rates** and are the strongest candidates for hard CI gates because violations are typically binary (a dependency either exists or doesn't) and intent is explicitly declared by the team.

### Category 2: Dependency and Structural Entropy

The thermodynamic tendency of dependency graphs to become tangled over time. Beyond boundary violations, these capture coupling, hub formation, propagation cost, and orphaned modules.

Coupling Between Objects (CBO) is the **single strongest OO metric for fault prediction** across multiple independent studies. Fan-in/fan-out, instability metrics, and cycle analysis all fall here.

### Category 3: Abstraction Bloat and Dead Weight

Code that exists but serves no purpose, or serves a purpose so indirect it impedes rather than aids comprehension. Public API surface growth, indirection creep, wrapper inflation, dead exports.

Indirection depth is the **least tooled category** in the research — a significant gap and an opportunity for novel signals, especially in TypeScript where type-level indirection is measurable.

### Category 4: Legibility Decay

Whether code is becoming harder for humans and AI reviewers to read and understand. Complexity metrics, naming quality, size drift, readability scores.

Key nuance from the research: cognitive complexity and cyclomatic complexity correlate with comprehension difficulty but **only explain ~30% of variance**. They are useful directional indicators, not precise predictors. Best used as **trend signals and soft warnings**, not hard gates.

### Category 5: Generated-Code Slop Patterns

AI coding tools introduce specific, measurable degradation patterns. Duplication explosion (documented as 4x more cloning and 8x more duplicate blocks in AI-assisted code). Persistent complexity inflation (+41% cognitive complexity growth in AI-adopting repos, per CMU study). Style drift. Empty implementations.

These patterns can be caught by existing signal types (duplication, complexity, boundary enforcement) but benefit from AI-specific calibration and threshold adjustment.

### Category 6: Review Pain and Maintenance Burden

Composite signals that correlate with practical difficulty of reviewing, understanding, and modifying code. Churn × complexity coupling is one of the **best-validated combinations in the entire metrics literature** (Pearson correlation 0.889 with defect density). PR size, change scope, knowledge concentration.

---

## Signal Catalog: TypeScript Pack

Organized by taxonomy category. Each signal describes *what to measure* and *why*, not specific implementation details.

### Architectural Drift

**TS-AD-01: Module boundary violations**
Detect when imports cross declared architectural boundaries — when code reaches into the internals of a module that exposes a public barrel export. TypeScript's module system plus path aliases provide a rich surface for this. The import path is in the AST; the boundary rules are in the reference data.
*Tier*: 2 (requires declared boundary rules)
*Enforcement*: Hard gate on new violations. Ratchet existing.

**TS-AD-02: Circular module dependencies**
Detect cycles in the module import graph. Not all cycles are equally harmful — a cycle between tightly related utility modules matters less than a cycle spanning architectural layers. Severity should incorporate the architectural distance of the cycle.
*Tier*: 1
*Enforcement*: Hard gate on new cycles.

**TS-AD-03: Re-export depth and barrel file complexity**
Track how deep re-export chains go and whether barrel files are re-exporting from other barrels. Deep re-export chains obscure the true dependency graph and make dead export detection unreliable.
*Tier*: 1
*Enforcement*: Soft warning. Trend.

### Dependency and Structural Entropy

**TS-DE-01: Type-level coupling (CBO equivalent)**
Count how many external types a module references and how many of its types are referenced externally. TypeScript's type checker provides exact answers here — this isn't heuristic. Measures true semantic coupling, not just import presence.
*Tier*: 1
*Enforcement*: Soft warning. Trend per module.

**TS-DE-02: Fan-in / fan-out per module**
Direct dependency count in both directions. Modules with high fan-out are fragile (depend on many things). Modules with high fan-in and high fan-out are coupling hubs — unintentional hubs in non-core areas are the danger signal.
*Tier*: 1
*Enforcement*: Soft warning on new hub emergence outside declared core modules.

**TS-DE-03: Dependency graph propagation cost**
How far a change can propagate through the dependency graph. Transitive closure depth from a given module. Rising propagation cost means increasing entanglement.
*Tier*: 1
*Enforcement*: Trend metric.

**TS-DE-04: Package/dependency health**
Mismatches between declared and actual dependencies — missing, unused, transitive used directly, misplaced dev dependencies. Binary checks with low false positive rates.
*Tier*: 1
*Enforcement*: Hard gate on missing/unused deps. Warn on transitive usage.

**TS-DE-05: Duplicate dependency versions**
Multiple versions of the same package in the resolved dependency tree. Each duplicate increases bundle size and risks subtle behavioral differences.
*Tier*: 1
*Enforcement*: Soft warning. Trend.

### Abstraction Bloat

**TS-AB-01: Public export surface area**
Count of exported symbols (functions, classes, types, interfaces) per module. Track growth over time. Distinguish intentional public API from "everything is exported because nobody configured it."
*Tier*: 1
*Enforcement*: Trend. Warn on sudden spikes.

**TS-AB-02: Unused exports with boundary-aware reachability**
Exports referenced only within their own module boundary aren't truly public — they're API surface leaks. Distinguish "unused entirely" from "used only internally" from "used across boundaries."
*Tier*: 1 (Tier 2 if boundary definitions required)
*Enforcement*: Soft warning. Ratchet on new unused exports.

**TS-AB-03: Type indirection depth**
Measure how many type alias / mapped type / conditional type layers you traverse before reaching a concrete type. `Extract<Awaited<ReturnType<typeof handler>>, { status: "ok" }>` has measurable type indirection. This is a novel signal — nobody measures it today.
*Tier*: 1
*Enforcement*: Soft warning above threshold. Trend.

**TS-AB-04: Interface-to-implementation ratio**
Interfaces with exactly one implementation and no test substitution are abstraction overhead. Track the ratio across modules. A module with 15 interfaces each with one concrete class is a warning sign.
*Tier*: 1
*Enforcement*: Trend. Soft warning for egregious patterns in new code.

**TS-AB-05: Generic type parameter proliferation**
Functions or types with many generic parameters, especially with complex constraint bounds. Each generic parameter is a comprehension cost. Track the distribution of generic parameter counts.
*Tier*: 1
*Enforcement*: Soft warning above threshold.

### Legibility Decay

**TS-LD-01: Cognitive / cyclomatic complexity per function**
Standard flow-complexity metrics. Best used as a trend indicator. A single complex function is not necessarily a problem; a steadily rising average is.
*Tier*: 1
*Enforcement*: Soft warning on new functions above threshold. Trend overall.

**TS-LD-02: Function and file size distribution**
Track the distribution (median, 95th percentile) of function lengths and file sizes over time. Catch bloat as a trend rather than individual violations.
*Tier*: 1
*Enforcement*: Soft warning on new extreme outliers. Trend.

**TS-LD-03: Nesting depth**
Maximum nesting depth per function. Deeply nested code is harder to follow regardless of total complexity score.
*Tier*: 1
*Enforcement*: Soft warning above threshold.

**TS-LD-04: Naming convention consistency**
Violations of configured naming rules — casing patterns per identifier type (camelCase functions, PascalCase types, UPPER_SNAKE constants). Track violation count over time as a canary for style drift, especially from AI-generated code.
*Tier*: 2 (requires convention config)
*Enforcement*: Soft warning. Trend.

**TS-LD-05: Domain term consistency**
Identifiers that don't match the project glossary. New terms that duplicate or conflict with existing canonical terms. The glossary is the reference data; the check is deterministic given the glossary.
*Tier*: 2 (requires glossary)
*Enforcement*: Soft warning. Key input to bisect.

**TS-LD-06: Type annotation coverage**
Percentage of function parameters and return types with explicit annotations vs inferred. Inferred types are fine locally but create comprehension gaps at module boundaries. Measure coverage at export boundaries specifically.
*Tier*: 1
*Enforcement*: Trend. Soft warning for public API without explicit types.

### Generated-Code Slop

**TS-SL-01: Duplication on new code**
Duplicated blocks/lines in changed or added code. Scoped to production code (exclude tests, generated files). Track both exact and near-duplicates.
*Tier*: 1
*Enforcement*: Soft warning on new duplication above budget. Ratchet overall.

**TS-SL-02: Inconsistent clone detection**
Near-duplicate code groups that have diverged — same structure, different specifics, changed inconsistently over time. Higher signal than raw duplication because inconsistent clones are empirically fault-linked.
*Tier*: 1.5 (derived from duplication + change history)
*Enforcement*: Trend + prioritized review list.

**TS-SL-03: Suppression/ignore growth**
New `@ts-ignore`, `@ts-expect-error`, `eslint-disable` annotations introduced. Track count over time. Growth indicates either tool noise or declining discipline.
*Tier*: 1
*Enforcement*: Hard gate on new suppressions without structured justification (ticket + expiry).

**TS-SL-04: Empty implementations and stubs**
Function bodies that are `throw new Error("not implemented")`, empty blocks, TODO-only implementations. Common AI pattern.
*Tier*: 1
*Enforcement*: Soft warning. Hard gate if in production paths.

### Review Pain

**TS-RP-01: Churn × complexity hotspots**
Files that change frequently AND have high complexity. The single best-validated compound metric in the literature. Plot the top N hotspots monthly. Files in the top-right quadrant of churn × complexity are highest-priority refactoring targets.
Small-repo calibration lever: keep `min_churn` and `min_complexity`, but apply them through soft threshold weighting (`threshold_softness`) and continuous top-right pressure (`peer_percentile_floor`) instead of a hard binary cliff.
*Tier*: 1.5 (derived from git history + complexity)
*Enforcement*: Trend metric. Dashboard. Input to review routing.

**TS-RP-02: PR size and dependency delta**
Lines changed, files touched, new cross-boundary import edges introduced per change. Directly limits review surface area and architectural shock.
*Tier*: 1
*Enforcement*: Soft warning with escalation. Budget per PR.

**TS-RP-03: Knowledge concentration**
From git history: how many developers have touched each module in the last N days. Modules with a bus factor of 1 are organizational risk.
*Tier*: 1.5 (derived from git history)
*Enforcement*: Trend. Dashboard.

**TS-RP-04: Code churn rate**
Percentage of code reverted or substantially modified within 14 days of introduction. Rising churn indicates instability or over-acceptance of low-quality contributions.
*Tier*: 1.5 (derived from git history)
*Enforcement*: Trend.

---

## Signal Catalog: Rust Pack

Rust's ownership system, trait system, and explicit visibility provide signals that don't exist in other languages.

### Architectural Drift

**RS-AD-01: Module visibility surface area**
Ratio of `pub` to `pub(crate)` to private items per module. A crate where everything is `pub` has no encapsulation. Track the distribution and trend over time. Rust's visibility is explicit in the AST — this is a pure Tier 1 signal.
*Tier*: 1
*Enforcement*: Trend. Warn on new `pub` items in internal modules.

**RS-AD-02: Crate boundary violations**
Imports that bypass the intended public API of a workspace crate. In a workspace, each crate's `pub` items are its API. Track whether downstream crates reach into `pub(crate)` internals via re-exports or feature-gated visibility escalation.
*Tier*: 2 (requires declared crate roles)
*Enforcement*: Hard gate on new violations.

**RS-AD-03: Circular crate dependencies**
Cycles in the workspace crate graph. Cargo enforces no cycles between crates, but feature-flag combinations and dev-dependency paths can create effective cycles in the build graph.
*Tier*: 1
*Enforcement*: Hard gate.

### Dependency and Structural Entropy

**RS-DE-01: Trait implementation coupling**
When a module implements external traits on external types (orphan rule workarounds via newtype pattern), that's a coupling signal. Count foreign trait implementations per module.
*Tier*: 1
*Enforcement*: Soft warning. Trend.

**RS-DE-02: Dependency tree depth and duplicate versions**
Full dependency graph from the lock file. Duplicate versions of the same crate are a concrete health signal — they increase binary size and risk behavioral divergence. Track total dependency count, maximum depth, and duplicate count.
*Tier*: 1
*Enforcement*: Soft warning on new duplicates. Trend overall.

**RS-DE-03: Feature flag combinatorics**
Count of feature flags per crate and their interactions. Feature flags create conditional compilation paths — each flag doubles the potential compilation space. Track flag count and especially cross-crate feature propagation.
*Tier*: 1
*Enforcement*: Trend. Warn on rapid growth.

**RS-DE-04: Fan-in / fan-out per module**
Same concept as TypeScript but measured at the module (`mod`) and crate level. Rust's explicit module hierarchy makes this precise.
*Tier*: 1
*Enforcement*: Soft warning on new hubs.

### Abstraction Bloat

**RS-AB-01: Unused public items**
`pub` items with no external references. Rust's compiler can warn about some of these, but workspace-level analysis across crates catches more.
*Tier*: 1
*Enforcement*: Soft warning. Ratchet.

**RS-AB-02: Trait object indirection depth**
Chains of trait objects (`Box<dyn Foo>` returning `Box<dyn Bar>`) that create runtime indirection without clear benefit. Measure maximum trait object chain depth in call graphs.
*Tier*: 1
*Enforcement*: Soft warning above threshold.

**RS-AB-03: Generic parameter proliferation**
Functions or types with many generic parameters and complex where-clause bounds. `fn process<T, U, V, W>(a: T, b: U) where T: Into<V> + AsRef<W>, U: TryFrom<V>, V: Clone + Send + 'static` has measurable comprehension cost.
*Tier*: 1
*Enforcement*: Soft warning above threshold. Trend.

**RS-AB-04: Derive macro density**
Heavy use of derive macros can obscure what's actually implemented on a type. Track derive count per type and especially custom derive usage that generates non-trivial code.
*Tier*: 1
*Enforcement*: Trend. Informational.

### Legibility Decay

**RS-LD-01: Unsafe block density and propagation**
`unsafe` blocks are explicitly marked in Rust. Measure density per module, propagation through call chains (does an unsafe block's unsafety leak through the call graph?), and whether unsafe usage is increasing over time. Rust's safety guarantees erode proportionally to unsafe usage.
*Tier*: 1
*Enforcement*: Soft warning on new unsafe. Trend. Hard gate on unsafe in designated safe-only modules.

**RS-LD-02: Lifetime complexity**
Functions with multiple lifetime parameters, especially with complex bounds and relationships. Lifetime parameter count, bound depth, and variance (covariant/contravariant/invariant positions) are all AST-computable.
*Tier*: 1
*Enforcement*: Soft warning above threshold. Trend.

**RS-LD-03: Match arm exhaustiveness exploitation**
Patterns where match arms use catch-all `_` instead of exhaustive variants. The catch-all compiles but silently swallows new variants added later. Track the ratio of exhaustive to catch-all matches.
*Tier*: 1
*Enforcement*: Soft warning on new catch-all in core logic. Trend.

**RS-LD-04: Error type granularity**
Are errors specific (`ParseError`, `IoError`) or collapsed (`anyhow::Error`, `Box<dyn Error>`)? Track the ratio at module boundaries. Overly generic error types at API surfaces reduce debuggability.
*Tier*: 1
*Enforcement*: Soft warning at crate boundaries. Trend.

**RS-LD-05: Cognitive / cyclomatic complexity**
Same concept as TypeScript. Rust's ownership system adds complexity that standard metrics may undercount (borrow checker gymnastics, lifetime annotations). Language-specific calibration needed.
*Tier*: 1
*Enforcement*: Soft warning. Trend.

**RS-LD-06: Domain term consistency**
Same concept as TypeScript. Identifiers checked against project glossary.
*Tier*: 2
*Enforcement*: Soft warning. Key input to bisect.

### Generated-Code Slop

**RS-SL-01: Duplication on new code**
Same concept as TypeScript. Track duplicated blocks in changed/added code.
*Tier*: 1
*Enforcement*: Soft warning. Ratchet.

**RS-SL-02: Allow/clippy suppression growth**
`#[allow(clippy::...)]` and `#[allow(unused_...)]` annotations. Same governance signal as TypeScript's ts-ignore growth.
*Tier*: 1
*Enforcement*: Hard gate on new suppressions without justification.

**RS-SL-03: Unwrap/expect density**
`.unwrap()` and `.expect()` in production code (not tests). These are explicit panic points. Track density and whether it's increasing.
*Tier*: 1
*Enforcement*: Soft warning in production paths. Trend.

**RS-SL-04: Clone abuse**
Excessive `.clone()` calls, especially on large types, as a way to avoid borrow checker complexity. Common AI pattern — cloning is the easiest way to make the compiler happy. Track clone density per module.
*Tier*: 1
*Enforcement*: Soft warning. Trend.

### Review Pain

**RS-RP-01: Churn × complexity hotspots**
Same concept as TypeScript. Files with high change frequency and high complexity.
*Tier*: 1.5
*Enforcement*: Trend. Dashboard.

**RS-RP-02: Compile time contribution**
Which crates/modules contribute most to compile time? Rust's incremental compilation means some modules are bottlenecks. Track per-crate compile time and identify which changes cause cascade recompilation.
*Tier*: 1
*Enforcement*: Trend. Informational.

**RS-RP-03: PR size and crate boundary delta**
Lines changed, crates touched, new cross-crate dependencies introduced.
*Tier*: 1
*Enforcement*: Soft warning with budget.

---

## Shared Signals (Language-Agnostic)

These apply to both TypeScript and Rust (and any future language packs).

**SHARED-01: Churn × complexity**
The best-validated compound metric. Combine git change frequency with per-file complexity score.
*Tier*: 1.5

**SHARED-02: Knowledge concentration / bus factor**
From git history. Modules touched by only one contributor.
*Tier*: 1.5

**SHARED-03: Code churn rate (14-day revert window)**
Percentage of code substantially modified or reverted within 14 days.
*Tier*: 1.5

**SHARED-04: Domain glossary match rate**
Percentage of new identifiers that match the project glossary. The headline signal for bisect.
*Tier*: 2

**SHARED-05: Suppression/waiver governance**
Cross-language pattern: track ignore/suppress/allow annotations as a time series. Growth = standards erosion.
*Tier*: 1

**SHARED-06: PR dependency delta**
New dependency edges introduced per change. Cross-boundary imports, new crate/package dependencies.
*Tier*: 1

---

## Score Output: Vector + Minimum

The primary output is a **dimension vector grouped by taxonomy category**, plus the minimum dimension. Never a single scalar headline.

```json
{
  "observer_semantics": "applicability-aware-readiness-v2",
  "categories": {
    "architectural-drift": { "score": 0.92, "signals": { "TS-AD-01": 1.0, "TS-AD-02": 0.85 } },
    "dependency-entropy": { "score": 0.71, "signals": { "TS-DE-01": 0.65, "TS-DE-02": 0.78 } },
    "abstraction-bloat": { "score": 0.83, "signals": { "TS-AB-01": 0.90, "TS-AB-03": 0.76 } },
    "legibility-decay": { "score": 0.68, "signals": { "TS-LD-01": 0.72, "TS-LD-05": 0.43 } },
    "generated-slop": { "score": 0.88, "signals": { "TS-SL-01": 0.85, "TS-SL-03": 0.91 } },
    "review-pain": { "score": 0.75, "signals": { "TS-RP-01": 0.62, "TS-RP-02": 0.88 } }
  },
  "minimum": { "signal": "TS-LD-05", "category": "legibility-decay", "score": 0.43,
               "detail": "Domain term consistency — 7 new identifiers not in glossary" },
  "weighted_mean": 0.79,
  "hard_gate_status": "pass",
  "hard_gate_violations": []
}
```

`observer_semantics` is part of the public contract. `applicability-aware-readiness-v2` means: `weighted_mean` and `minimum` are computed from applicable evidence instead of treating missing or failed evidence as healthy scalar data; readiness pressure is `max(p-norm, poison grade, hard-gate pressure)` where the poison grade is a continuous ramp computed only over signals with poison authority (proof-grade tier and hard-gate ceiling — see Enforcement Policy Matrix); signal failures degrade `status` (never `green`) but never zero the score — the score keeps describing what WAS measured, and `band` is omitted when nothing applicable was measured (consumers must treat a missing band as "no verdict", not healthy). The aggregation block names its `dominant_pressure_source` and exposes `band_margin` so thin band decisions are visible. Decoders accept v1 documents for persisted history. The minimum signal is often more actionable than any aggregate. Hard gate status is computed separately from the pulsar-weighted score — structural violations fail the gate regardless of weight.

---

## Enforcement Policy Matrix

Provability tier and taxonomy category together determine the enforcement ceiling. Pulsar vector weights adjust sensitivity **within** the ceiling, never above it.

| Category | Structural signals (boundaries, cycles, deps) | Legibility signals (complexity, naming, size) | Compound signals (churn×complexity, clone inconsistency) |
|---|---|---|---|
| Tier 1 | Hard gate (new violations) | Soft warning + trend | Trend + dashboard |
| Tier 1.5 | n/a | n/a | Trend + review routing input |
| Tier 2 | Hard gate (given reference data) | Soft warning + trend | Trend |
| Tier 3 | n/a (structural signals are never Tier 3) | Soft warning only, ephemeral | n/a |

The ratcheting pattern applies to all hard gates: record existing violations as baseline, only block new introductions. This is the same pattern as pulsar bisect's "freeze reference at a healthy commit."

**Headline poison authority is stricter than gate authority.** A hard gate blocks with cited violations and fix hints, and Tier 2 structural signals earn it conditionally — "given reference data" means the signal must withhold block findings when its reference data is missing or stale. Single-handedly setting the repo-level readiness or category headline (the observer's poison rule) is a silent verdict with no citation obligation, so it requires both proof-grade evidence (Tier 1/1.5) **and** a hard-gate enforcement ceiling — a signal whose ceiling is soft-warning cannot block a single diff, and letting it red an entire repo alone would invert the enforcement ladder (`hasPoisonAuthority` in `packages/core/src/enforcement.ts`). Heuristic, reference-backed, and legibility signals still contribute to the p-norm, evidence mean, minimum line, and top pressures; they cannot be the verdict alone. A companion contract test (`assertReferenceDataTierFloor`) keeps tiers honest: a signal that consumes reference data may not declare Tier 1 or 1.5.

---

## Pulsar Bisect

Before building elicitation, routing, or agent constraints — validate the thesis.

### Workflow

1. Check out a known-healthy commit
2. Auto-extract glossary, schema conventions, boundary declarations from code at that SHA
3. Human confirms the reference
4. Freeze as reference data tagged to that SHA
5. Replay every subsequent commit — only re-score changed hunks, inherit cached scores
6. The score trajectory per taxonomy category is the rot curve

### Multiple Anchors

Pick several "healthy" commits across the project's history. The Pulsar interpolates reference data between anchors. Drift between anchors is expected evolution. Drift away from the interpolated reference is rot.

### Refactor Awareness

Legitimate renames look like drift. Defenses: user-marked "refactor anchor" commits that re-baseline the reference, plus heuristic rename detection (old term disappears, new term appears in same positions).

### Dimension-Specific Bisect

Bisect per taxonomy category and per individual signal. "When did domain coherence drift? When did type coupling spike? When did unsafe density start climbing?" Each has its own trajectory, its own culprit commits. The aggregate hides the mechanism; per-signal bisect exposes it.

### Feasibility

Tier 1 and 1.5 signals are deterministic and cacheable. Scoring N commits is O(N) once, then free. Incremental per-hunk. Parallelizable via git worktree. A 500-commit history bisects in minutes on a laptop.

---

## Review Routing

The Observer's diff-time output. Research shows that surfacing signals during review (not as a batch report) increases fix rates from near-zero to 70%+.

### Routing Logic

**Hard gate violations** → block merge. Structural signals only.

**Score-based routing** → category scores below threshold trigger specialist review. "Domain coherence at 0.43 — route to domain reviewer with pre-computed context."

**Structural pattern routing** → certain signal results trigger mandatory specialist review regardless of score:
- New migration/table → data model reviewer
- Auth paths touched → security reviewer
- New domain term → domain reviewer
- Public API surface change → API design reviewer
- New unsafe block (Rust) → safety reviewer

Specialist reviewers receive pre-computed context from the signals that triggered routing. They focus on contextual judgment the Pulsar can't provide.

---

## Backpressure

Score time series tracked per commit. Nothing else on the market measures codebase backpressure — the system's capacity to absorb new complexity without quality degradation.

### Agent Constraints

- **Green**: Full autonomy. New abstractions, new patterns allowed.
- **Yellow**: Must reuse existing domain terms. New structures require justification.
- **Red**: Restricted to modifications within existing patterns. Structural changes escalate to human.

### Goodhart Defenses

The moment agent autonomy depends on scores, agents optimize scores. Defenses:

- **Hidden holdout signals**: subset not visible to the generating agent. Divergence between visible and hidden scores = gaming.
- **Adversarial rotation**: periodically swap which signals carry high weight.
- **Score velocity meta-check**: scores improving faster than underlying signals justify = gaming.
- **Diagnostic not evaluative**: agent sees "these 4 identifiers don't match the glossary" — never "your domain score is 0.43."

---

## Pulsar Vector

### Structure

```json
{
  "id": "guilherme-code-v1",
  "domain": "typescript",
  "signal_overrides": {
    "TS-LD-05": { "active": true, "weight": 0.9, "config": { "glossary_path": "./glossary.json" } },
    "TS-LD-01": { "active": true, "weight": 0.5, "config": { "max_complexity": 20 } },
    "TS-AB-03": { "active": true, "weight": 0.7, "config": { "max_depth": 4 } }
  }
}
```

Signals not listed inherit default activation and weight. Weight adjusts sensitivity (how much a signal contributes to category score). It does **not** override enforcement policy — a Tier 1 structural signal remains a hard gate even at weight 0.1.

### Resolution and Precedence

Pulsar is repo-level, always. Everyone and every agent evaluating a repository uses one effective vector.

Resolution order:

1. Explicit `--vector` path for controlled runs.
2. Repo-local `.pulsar/vector.json`.
3. Organization-standard fallback at `~/.config/pulsar/vector.json`.
4. Built-in defaults.

The home-directory fallback is a transport location for an organization-standard vector shared across repos. It is not personal pulsar. A repo-local vector always overrides it.

### Elicitation

**Default path**: Revealed preference bootstrap — score last N commits, infer weights from merge/revise/reject patterns.

**Fast path**: Presets — "strict type safety" / "domain purist" / "velocity-first" / "security-paranoid." Presets are starting templates for repo/org vectors, not active personal pulsar.

**Explicit path**: Pairwise tradeoff quiz — ~15-20 targeted comparisons. Past that, noise dominates.

**Passive evolution**: Extract preference signals from natural work. Each proposed change is explicit, auditable, requires confirmation.

---

## Ecosystem Integration

### Epistemology Framework → Pulsar

Epistemology hooks are binary, per-action guardrails (AST pattern match → guideline injection). The Pulsar adds scored, aggregate steering using the same pattern-matching machinery. They coexist. Hook triggers are consumable as Tier 1 signal inputs.

### Probe → Pulsar

Observer scores each code change during Probe sessions. Backpressure green/yellow/red maps to agent autonomy. Pre-computed codebase health snapshot shapes agent behavior before it writes anything.

### TypeScript Compiler Tools → Pulsar

ts-morph type graph queries provide Tier 1 signal inputs: type-level coupling, unused exports with full reachability, type indirection depth, generic complexity. All deterministic compiler queries.

### Metrix → Pulsar

Category scores feed as gauges and counters. Backpressure thresholds surface through the agent hierarchy channels alongside operational metrics.

### Agent Hierarchy → Pulsar

Agents operating in the same repository share the same effective repo/org vector. Per-agent scoring can feed Metrix for accountability, but per-agent pulsar cannot change how the repository is scored.

---

## Defensive Positioning

### vs. Linters

Linters are binary pass/fail on individual rules. The Pulsar **aggregates signals too granular for individual linter rules** and adds compound signals (churn × complexity) that no linter computes. It operates between "too granular for a linter" and "too subjective for a deterministic tool."

### vs. Reward Models

A reward model captures nonlinear interactions in one forward pass. More expressive. The Pulsar is interpretable, editable, composable, mostly zero-inference-cost, provides per-signal diagnostics, can bisect, can route reviews. Total cost of ownership is much lower.

### vs. SonarQube / CodeScene

These are production systems that implement subsets of this taxonomy. SonarQube covers complexity, duplication, and some structural checks. CodeScene covers churn × complexity hotspots and Code Health scores. The Pulsar differentiates by: pulsar-weighted scoring across the full taxonomy, language-specific signal packs exploiting type system depth, bisect across commit history, agent-aware backpressure, and portable preference vectors.

### The Honest Pitch

"A library of provable, deterministic signals organized by what they measure — architectural drift, dependency entropy, abstraction bloat, legibility decay, generated-code slop, and review pain — with language-specific packs for TypeScript and Rust that exploit type system depth. Configured through preference elicitation, producing per-signal diagnostic scores, intelligent review routing, commit-level backpressure, and codebase rot bisection. Enforcement policy is determined by provability tier, not preference weight. Model-agnostic, inspectable, zero-training-cost, validates itself on your commit history."

---

## Prior Art

**GATE (ICLR 2025)**: Conversational elicitation. No portable deterministic vector.
**LLM-Rubric (Microsoft, ACL 2024)**: Multi-dimensional rubrics. Neural calibration, not inspectable.
**Autorubric (2026)**: Weighted criteria scored independently. Static framework, no bisect/routing/backpressure.
**VARS (2026)**: Preference vectors from feedback. Gradient-updated, not explicit deterministic weights.
**CodeScene**: Churn × complexity hotspots, Code Health. Commercial, no pulsar vectors, no bisect, no agent backpressure.
**SonarQube**: Complexity, duplication, some structural. No compound signals, no preference weighting, no bisect.
**ArchUnit / Dependency Cruiser / Packwerk**: Boundary enforcement. Point tools, not unified taxonomy.

The gap: provable signals organized by rot taxonomy + type-system-exploiting language packs + explicit preference vectors + compound signals + bisect + agent backpressure. No existing system combines these.

---

## Implementation Plan

### Phase 1 — Validate the Thesis (2 weeks)

1. ~15 Tier 1 signals from the TypeScript pack (TS-AD-02, TS-DE-01, TS-DE-02, TS-DE-04, TS-AB-01, TS-AB-02, TS-AB-03, TS-LD-01, TS-LD-02, TS-LD-05, TS-SL-01, TS-SL-03, TS-RP-01, TS-RP-02)
2. Glossary auto-extraction from a given SHA
3. Commit-level scoring engine with hunk-level incremental cache
4. `pulsar bisect` CLI
5. Run on a real repo. Show the trajectory to a maintainer. Does it match?

### Phase 2 — Scoring MVP

6. Pulsar vector schema (signal activation + weights + config)
7. Observer (category vector + minimum output + hard gate status)
8. `pulsar score` CLI
9. Effect TypeScript throughout

### Phase 3 — Domain Backend + Compound Signals

10. Schema convention detection
11. ts-morph type-level signals (TS-DE-01, TS-AB-03, TS-AB-05, TS-LD-06)
12. Compound signal framework (Tier 1.5 — signals that take other signals as input)
13. Tiered caching with confidence decay

### Phase 4 — Elicitation

14. Revealed preference bootstrap
15. Persona presets
16. Passive signal extraction
17. Pairwise quiz generator

### Phase 5 — Review Routing

18. Structural pattern detection
19. Review plan generation with pre-computed context
20. Diff-time integration (surface during review, not as batch report)

### Phase 6 — Backpressure + Agent Integration

21. Score time series → Metrix integration
22. Backpressure thresholds → agent constraint levels
23. Goodhart defenses
24. Epistemology framework integration
25. Probe session constraints

### Phase 7 — Rust Pack

26. Rust signal implementations (RS-* catalog)
27. Cargo/rustc integration for dependency and compilation signals
28. Unsafe propagation analysis
29. Cross-language shared signal unification

### Phase 8 — Team and Composition

30. Team vector aggregation
31. Vector inheritance with conflict resolution
32. Plugin interface for community signals
33. Multi-domain packs (writing, marketing, design)

---

## Open Questions

1. **Type-level signal calibration**: Type indirection depth and generic proliferation are novel signals. What thresholds correlate with actual comprehension difficulty? Need empirical validation against real developer experience.

2. **Compound signal design**: The Tier 1.5 framework needs a clean interface — signals that compose other signals. How deep can composition go before it becomes opaque? Probably limit to two levels.

3. **Rust-specific complexity**: Standard cognitive complexity metrics undercount borrow-checker complexity. Is there a Rust-specific complexity metric that accounts for lifetime annotations and ownership transfers?

4. **Cross-language normalization**: When a project uses both TypeScript and Rust, how do you normalize scores across language packs? A complexity score of 0.7 in TypeScript and 0.7 in Rust may represent very different levels of actual difficulty.

5. **Bisect at scale**: For large monorepos with thousands of commits, full bisect may be impractical even with caching. Need a sampling strategy — bisect on merge commits only, or adaptive sampling based on score deltas.

6. **Signal interaction with AI-specific patterns**: The CMU +41% complexity growth finding suggests AI-specific thresholds. Should the Pulsar have an "AI-assisted mode" with tighter thresholds on duplication and complexity?
