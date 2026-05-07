# Calibration Layer Requirements: Extracted from Signal Poisoning Analysis

> **Context:** The last 98 commits included many "fix: ignore X" and "fix: deweight Y" patches that encoded project-shaped, framework-shaped, and tooling-shaped assumptions directly into signal source code. This document treats those patches not as throwaway code, but as **extensive leads** for what a proper calibration layer must support. The hardcoded heuristics represent real patterns that exist in the wild—they just need to be properly layered.

> **Update:** The architecture has since settled on **project modules** as the primary abstraction: project-owned TypeScript/Effect modules that contribute typed calibration processors. Data-only rules and JSON helpers are still useful convenience APIs, but they are not the foundation. Where this document says "config" or "rule," read it as a requirement that may be implemented by a code-backed project module, a reusable technology/framework module, or a helper that compiles data into a processor.

---

## 1. The Core Insight: Signal Poisoning as Requirements Elicitation

When we hardcode `isServerReactiveContractNoop` (SolidJS) or `isDocusaurusApp` (Docusaurus) into signal logic, we're not writing bad code—we're **discovering calibration requirements in the wrong layer**. Each hardcoded heuristic is a prototype of a calibration processor or helper-backed rule that should be:

1. **Expressible outside generic signal source code** (usually as a code-backed project module or reusable calibration module)
2. **Overridable per repository or organization** (via the effective repo/org vector and calibration artifacts)
3. **Sharable as packs** (framework addons, ecosystem packs)
4. **Versioned independently** (so framework pack updates don't require signal cache bumps)

The 98 commits show this pattern repeatedly: we encounter a false positive, write a hardcoded carve-out, and move on. The correct pattern is: encounter a false positive, **express it as a typed calibration processor**, and ship it in the appropriate project, organization, technology, or framework module.

---

## 2. Taxonomy of Hardcoded Assumptions by Layer

### 2.1 Project Layout Conventions (Repo/Org Calibration)

These vary by organization and should be configurable per-repo:

| Current Hardcode | What It Assumes | Calibration Primitive |
|---|---|---|
| `test-utils/`, `test-helpers/`, `test-mocks/`, `test-harness/`, `test-support/` | Specific test utility directory naming | `file_taxonomy.test_utility_globs` |
| `example/`, `examples/`, `demo/`, `demos/`, `private-demos/`, `sample/`, `samples/`, `sdk-samples/`, `google_samples/` | Specific example/demo directory naming | `file_taxonomy.example_globs` |
| `playground/`, `playground-*/`, `playgrounds/` | Specific experimentation directory naming | `file_taxonomy.playground_globs` |
| `fixture/`, `fixtures/`, `template/`, `templates/` | Specific fixture/template directory naming | `file_taxonomy.fixture_globs` |
| `packages/` as monorepo root | Specific monorepo layout | `monorepo.root_segments` |
| `src/cli/`, `src/bundler/`, `cli/`, `bundler/` | Specific CLI source layout | `bundled_cli.source_paths` |
| `.opencode/`, `.pi/` | Organization-specific tooling paths | `file_taxonomy.hidden_tooling_globs` |
| `prototypes/`, `explorations/` | Organization-specific scratch directories | `file_taxonomy.prototype_globs` |
| `Icon[A-Z]` naming for SVG components | Project-specific component naming | `clone_deweight.icon_family_patterns` |
| `cache/` sibling mirroring | Project-specific caching architecture | `clone_deweight.mirror_patterns` |
| `host/plugin-sdk` → `*/plugin-sdk` facade | Project-specific plugin SDK architecture | `dependency.host_facade_aliases` |

### 2.2 Framework-Specific Patterns (Framework Calibration Packs)

These should live in per-framework addon packs:

| Framework | Current Hardcode | Signal | Calibration Pack |
|---|---|---|---|
| **SolidJS** | `server/reactive.tsx` contracts (`cancelCallback`, `createEffect`, `enableExternalSource`, `fn`, `onMount`) | TS-SL-04 | `calibration-solid-js` |
| **SolidJS** | `server/rendering.tsx` hooks (`enableHydration`, `enableScheduling`, `f callback`, `resetErrorBoundaries`) | TS-SL-04 | `calibration-solid-js` |
| **SolidJS** | `splitProps` + `classList` JSX adapters | TS-SL-01 | `calibration-solid-js` |
| **React** | Reconciler host config (`supportsMutation`, `supportsPersistence`, `getRootHostContext`, `createInstance`, etc.) | TS-SL-04 | `calibration-react` |
| **Effect-TS** | `Effect.gen` callbacks ≤3 statements | TS-SL-01 | `calibration-effect-ts` |
| **Effect-TS** | `Effect.orElseSucceed` fallback noops | TS-SL-04 | `calibration-effect-ts` |
| **Effect-TS** | `Effect.tryPromise` contextual callback naming | TS-LD-01 | `calibration-effect-ts` |
| **Pulumi** | `__pulumiType` metadata assignment/access suppression | TS-SL-03 | `calibration-pulumi` |
| **yargs** | Parent command `handler` + `builder` object shape | TS-SL-04 | `calibration-node-cli` |
| **Docusaurus** | `@theme/`, `@site/`, `@generated/`, `@docusaurus/*` virtual modules | TS-DE-04 | `calibration-docusaurus` |
| **SvelteKit** | `$app/`, `$env/`, `$lib`, `$service-worker` virtual modules | TS-DE-04 | `calibration-sveltekit` |
| **Cloudflare** | `DurableObject` method contracts (`alarm`, `fetch`, `webSocketClose`) | TS-LD-06 | `calibration-cloudflare` |
| **VS Code** | `extension.tsx` + `deactivate` lifecycle noop | TS-SL-04 | `calibration-vscode` |
| **SST** | `sst-env.d.ts` generated file | taxonomy | `calibration-sst` |

### 2.3 Tooling & Ecosystem Conventions (Ecosystem Calibration Packs)

These should live in language-ecosystem packs that track the JS/TS tooling landscape:

| Ecosystem | Current Hardcode | Signal | Calibration Pack |
|---|---|---|---|
| **JS Bundlers** | tsup, esbuild, rollup, webpack, `@vercel/ncc`, bun config detection | TS-DE-04 | `calibration-js-tooling` |
| **JS Bundlers** | `bundle: true` + `external: [...]` extraction | TS-DE-04 | `calibration-js-tooling` |
| **JS Frameworks** | 60+ config filenames (astro, drizzle, eslint, next, nuxt, playwright, postcss, sst, svelte, tailwind, vite) | TS-DE-04 | `calibration-js-tooling` |
| **JS Frameworks** | Bundled app framework detection (`vite`, `next`, `astro`, `svelte-kit`, `electron-vite`, `tauri`) | TS-DE-04 | `calibration-js-tooling` |
| **JS Frameworks** | Bundled CLI pipeline detection | TS-DE-04 | `calibration-js-tooling` |
| **TypeScript AST** | `ts.is[A-Z]` / `Node.is[A-Z]` predicate union guards | TS-SL-01 | `calibration-ts-morph` |
| **DefinitelyTyped** | `@types/` auto-mapping | TS-DE-04 | `calibration-js-tooling` |
| **Storybook** | `*.stories.ts`, `*.stories.tsx`, `.storybook/` | taxonomy | `calibration-js-tooling` |
| **Happy DOM** | `happydom.ts` | taxonomy | `calibration-js-tooling` |

### 2.4 Generic Patterns (Built-in Signal Logic)

These are truly general and should remain in core signal logic, but with **configurable parameters**:

| Pattern | Current Hardcode | What Should Be Configurable |
|---|---|---|
| Empty lifecycle object pairs | `isObjectLifecycleNoop` (create/remove, setup/stop siblings) | `noop_rules.lifecycle_pairs` |
| Promise swallow handlers | `isPromiseSwallowHandler` (`.catch`, `.finally`, `.then`) | `noop_rules.promise_chain_methods` |
| Console silencing | `isConsoleMethodSilencingNoop` | `noop_rules.console_methods` |
| Timer keep-alive | `isTimerKeepAliveNoop` | `noop_rules.timer_functions` |
| Interface reset noops | `isInterfaceResetNoop` | `noop_rules.interface_reset_names` |
| Protected hook noops | `isProtectedHookNoop` | `noop_rules.access_modifier_patterns` |
| Deferred resolver placeholders | `isDeferredResolverPlaceholder` | `noop_rules.resolver_names` |
| Null-object lifecycle fallback | `isNullObjectLifecycleFallback` | `noop_rules.null_object_shapes` |
| Common empty callbacks | `COMMON_EMPTY_CONTRACT_CALLBACKS` | `noop_rules.empty_callback_names` |
| Complexity branching | `BRANCHING_KINDS` (If, For, While, Case, Catch, Conditional) | `complexity.branch_kinds` |
| Complexity operators | `&&`, `\|\|`, `??` | `complexity.operators` |
| Nesting control flow | `isControlFlowNode` | `nesting.control_flow_kinds` |
| Circular dependency severity | cycles ≥20 modules → block, ≥10 cycles → block | `cycles.block_threshold_modules` |
| Bus factor silo threshold | 1 author = silo | `bus_factor.silo_author_count` |
| Churn target rate | 30% churn = target | `churn.target_rate` |
| Propagation cost target | 30% propagation cost = target | `propagation.target_cost` |

---

## 3. Required Calibration Primitives

Based on the 41 `is*Noop` functions, 17 clone/dependency heuristics, and 25 signals' worth of exclusion patterns, the calibration layer needs these **config schema primitives**:

### 3.1 File Taxonomy Primitives

```typescript
// Central classifier, applied once per scoring run
interface FileTaxonomyConfig {
  categories: Array<{
    id: SourceCategory;
    globs: ReadonlyArray<string>;
    regexes?: ReadonlyArray<string>;
    directory_names?: ReadonlyArray<string>;
    file_suffixes?: ReadonlyArray<string>;
    precedence: number; // for overlapping matches
  }>;
  
  // Framework packs can inject contributions
  framework_contributions?: Array<{
    framework_id: string;
    detection: {
      dependency_names?: ReadonlyArray<string>;
      script_regexes?: ReadonlyArray<string>;
    };
    taxonomy_additions: Array<{
      category: SourceCategory;
      globs: ReadonlyArray<string>;
    }>;
  }>;
}

type SourceCategory =
  | "production_source"
  | "test_code"
  | "test_utility"
  | "example"
  | "generated"
  | "config_tooling"
  | "declaration"
  | "build_artifact"
  | "dependency"
  | "hidden_tooling"
  | "documentation"
  | "stories"
  | "unknown";
```

### 3.2 Noop/Stub Pattern Primitives

```typescript
interface NoopPatternConfig {
  id: string;
  name: string;
  description?: string;
  
  // Matching criteria (AND-combined)
  match: {
    // Node type of the function
    node_types?: Array<
      | "ArrowFunction"
      | "FunctionExpression"
      | "FunctionDeclaration"
      | "MethodDeclaration"
      | "ConstructorDeclaration"
    >;
    
    // Name patterns
    function_name_regex?: string;
    function_name_allowlist?: ReadonlyArray<string>;
    property_name_regex?: string;
    property_name_allowlist?: ReadonlyArray<string>;
    
    // Parameter constraints
    parameter_pattern?: {
      max_count?: number;
      min_count?: number;
      all_ignored?: boolean;
    };
    
    // File path
    file_path_regex?: string;
    
    // Parent node
    parent_node_type?: string;
    is_body_of_parent?: boolean;
    
    // Call site (when function is an argument)
    call_site_pattern?: {
      callee_regex?: string;
      callee_names?: ReadonlyArray<string>;
      argument_index?: number;
      sibling_argument_regex?: string;
      sibling_argument_index?: number;
    };
    
    // Assignment target
    assignment_target?: {
      object_name?: string;
      property_name_allowlist?: ReadonlyArray<string>;
      variable_name_regex?: string;
      declaration_kind?: "let" | "const" | "var";
    };
    
    // Object literal member shape
    object_member_pattern?: {
      member_name_regex?: string;
      member_name_allowlist?: ReadonlyArray<string>;
      required_siblings?: ReadonlyArray<string>;
      required_sibling_set?: ReadonlyArray<string>;
      all_members_match_allowlist?: ReadonlyArray<string>;
      required_sibling_properties?: Array<{
        name: string;
        value_regex: string;
      }>;
    };
    
    // Class context
    class_pattern?: {
      class_name_regex?: string;
      implements_interface?: boolean;
      extends_class_regex?: string;
    };
    
    // Access modifier
    access_modifier?: ReadonlyArray<string>;
    
    // Ancestor context
    ancestor_in_fallback_branch?: boolean;
    ancestor_variable_name_regex?: string;
    ancestor_function_name_regex?: string;
    
    // Binary operator context
    binary_operator_pattern?: {
      operator: string;
      ancestor_variable_name_regex?: string;
    };
    
    // JSX context
    jsx_attribute_pattern?: {
      attribute_name_regex: string;
    };
    
    // Source text inspection
    preceding_text_pattern?: {
      regex: string;
      lookback_chars: number;
    };
  };
  
  result: "intentional_noop" | "stub";
  confidence?: "high" | "medium" | "low";
}
```

### 3.3 Clone Deweight Pattern Primitives

```typescript
interface CloneDeweightPatternConfig {
  id: string;
  kind: "adapter" | "icon_family" | "monadic_callback" | "ast_predicate"
       | "mirror" | "variant_family" | "parallel_package" | "versioned_compat";
  enabled?: boolean;
  
  // AST-level matchers
  function_name_regex?: string;
  body_regex?: string;
  return_regex?: string;
  required_tokens?: ReadonlyArray<string>;
  max_statements?: number;
  max_parameters?: number;
  parent_call_regex?: string;
  
  // Path-level matchers
  path_regex?: string;
  mirror_path_template?: string;
  
  // Family detection
  family_detection?: {
    monorepo_root_segments?: ReadonlyArray<string>;
    variant_family_depth?: number;
    migration_path_segments?: ReadonlyArray<string>;
    versioned_file_regex?: string;
  };
  
  severity: "exclude" | "deweight";
}
```

### 3.4 Dependency Health Primitives

```typescript
interface DependencyHealthCalibrationConfig {
  // Framework virtual modules
  framework_virtual_modules?: Array<{
    framework_id: string;
    detection: {
      dependency_names?: ReadonlyArray<string>;
      script_regexes?: ReadonlyArray<string>;
    };
    virtual_module_prefixes: ReadonlyArray<string>;
    virtual_module_exact?: ReadonlyArray<string>;
    virtual_module_subpath_prefixes?: ReadonlyArray<string>;
  }>;
  
  // Bundler config detection
  bundler_configs?: Array<{
    bundler_id: string;
    config_file_globs: ReadonlyArray<string>;
    bundle_detection_regex: string;
    external_extraction_regex: string;
    external_string_regex: string;
  }>;
  
  // Config file patterns for root dependency analysis
  config_file_patterns?: ReadonlyArray<string>;
  
  // Bundled app frameworks
  bundled_app_frameworks?: Array<{
    framework_id: string;
    script_regexes: ReadonlyArray<string>;
    allows_dev_in_prod: boolean;
    requires_private: boolean;
  }>;
  
  // Bundled CLI pipeline
  bundled_cli_pipeline?: {
    build_script_regexes: ReadonlyArray<string>;
    bundler_dev_dependencies: ReadonlyArray<string>;
    cli_source_path_prefixes: ReadonlyArray<string>;
  };
  
  // Low-signal package patterns
  low_signal_package_patterns?: {
    path_segments: ReadonlyArray<string>;
    package_name_regexes: ReadonlyArray<string>;
  };
  
  // Host facade aliases
  host_facade_aliases?: Array<{
    host_package: string;
    alias_package: string;
    condition: "dev_dependency_declared" | "always";
  }>;
}
```

### 3.5 Score Formula & Severity Primitives

```typescript
interface ScoreCalibrationConfig {
  // Per-signal score curve parameters
  score_formula?: {
    kind: "linear" | "logarithmic" | "exponential" | "clamped_linear";
    multiplier?: number;
    divisor?: number;
    target?: number;
    scale?: number;
    min_score?: number;
    max_score?: number;
  };
  
  // Severity thresholds
  severity_thresholds?: {
    block?: number;
    warn?: number;
    info?: number;
  };
  
  // Evidence/diagnostic weights
  evidence_weights?: Record<string, number>;
  
  // Penalty weights
  penalty_weights?: Record<string, number>;
}
```

---

## 4. Proposed Calibration Layer Architecture

### 4.1 Layer Hierarchy (outermost → innermost)

```
Userland Pulsar Vector (.pulsar/vector.json)
    ↓ overrides
Project Layout Conventions (.pulsar/layout.json)
    ↓ extends
Ecosystem Calibration Pack (e.g., @skastr0/pulsar-calibration-js-tooling)
    ↓ extends
Framework Calibration Pack (e.g., @skastr0/pulsar-calibration-solid-js)
    ↓ extends
Core Signal Logic (generic engines only)
```

### 4.2 Resolution Rules

1. **Core signal logic** defines generic engines and built-in default rules (generic noop patterns, standard complexity branching, etc.).
2. **Framework packs** contribute framework-specific rules (SolidJS server contracts, React reconciler hooks, Effect-TS patterns). They are **only active** when the framework is detected in the repo.
3. **Ecosystem packs** contribute tooling conventions (bundler configs, virtual modules, config filename lists). They are **always active** for the language pack.
4. **Project layout conventions** override file taxonomy categories (test utility names, example directory names, monorepo root segments).
5. **Pulsar vector** overrides any scalar config value (thresholds, weights, active flags).

### 4.3 New Core Services

#### `SourceTaxonomyService` (replaces per-signal exclude_globs)

```typescript
interface SourceTaxonomyService {
  // Classify a file path once per scoring run
  classify(filePath: string): SourceClassification;
  
  // Query methods used by signals
  isProductionSource(filePath: string): boolean;
  isTestCode(filePath: string): boolean;
  isTestUtility(filePath: string): boolean;
  isExample(filePath: string): boolean;
  isGenerated(filePath: string): boolean;
  isConfigTooling(filePath: string): boolean;
  isBuildArtifact(filePath: string): boolean;
  
  // Framework packs contribute taxonomy rules
  registerContribution(pack: CalibrationPack, contribution: TaxonomyContribution): void;
}
```

**Impact:** Replaces 25+ signals' individual `exclude_globs` and `test_globs` with a single, consistent classification system. Signals specify which categories they care about instead of copying glob lists.

#### `CalibrationPackRegistry` (replaces hardcoded framework detection)

```typescript
interface CalibrationPackRegistry {
  // Discover and load packs
  loadPack(packId: string, manifest: PackageManifest): Promise<CalibrationPack>;
  
  // Query active packs for a repo
  getActivePacks(repoRoot: string, manifests: PackageManifest[]): ReadonlyArray<CalibrationPack>;
  
  // Merge pack contributions into signal config
  resolveSignalConfig<Config>(
    signalId: string,
    coreDefaultConfig: Config,
    tasteVectorOverride: Partial<Config>
  ): Config;
}
```

**Impact:** Framework detection moves from inline `if (isSvelteKitApp(manifest))` to pack-level `detection_rules`. Virtual modules, noop patterns, and clone deweights are contributed by packs.

#### `NoopPatternEngine` (replaces ~40 hardcoded is*Noop functions)

```typescript
interface NoopPatternEngine {
  // Load rules from core + active packs + userland config
  loadRules(rules: ReadonlyArray<NoopPatternConfig>): void;
  
  // Test a function against all rules
  classifyFunction(
    fn: FnLike,
    filePath: string,
    bodyText: string
  ): { kind: "intentional_noop" | "stub"; confidence: string; ruleId: string } | undefined;
}
```

**Impact:** `ts-sl-04` shrinks from 1,245 lines of hardcoded heuristics to a generic engine that evaluates configurable rules. Framework-specific rules live in packs.

#### `CloneDeweightEngine` (replaces hardcoded clone exemptions)

```typescript
interface CloneDeweightEngine {
  loadPatterns(patterns: ReadonlyArray<CloneDeweightPatternConfig>): void;
  
  evaluateCloneGroup(
    group: CloneGroup,
    projectContext: ProjectContext
  ): { action: "exclude" | "deweight" | "keep"; factor: number; ruleId: string };
}
```

**Impact:** `ts-sl-01` no longer hardcodes SolidJS adapters, Effect.gen callbacks, or cache mirrors. It loads patterns from packs and evaluates them generically.

### 4.4 Signal Config Schema Changes

**Before (hardcoded):**
```typescript
// TS-SL-04 has ~40 hardcoded is*Noop functions
// TS-SL-01 has ~8 hardcoded is*Eligible functions
// TS-DE-04 has hardcoded framework lists
```

**After (calibrated):**
```typescript
// TS-SL-04 config
interface TsSl04Config {
  exclude_categories: ReadonlyArray<SourceCategory>;
  test_categories: ReadonlyArray<SourceCategory>;
  top_n_diagnostics: number;
  hard_gate_production: boolean;
  include_test_stubs: boolean;
  
  // Calibration rules (merged from core + packs + userland)
  noop_rules: ReadonlyArray<NoopPatternConfig>;
  stub_classification: StubClassificationConfig;
}

// TS-SL-01 config
interface TsSl01Config {
  exclude_categories: ReadonlyArray<SourceCategory>;
  test_categories: ReadonlyArray<SourceCategory>;
  min_tokens: number;
  top_n_diagnostics: number;
  
  // Calibration patterns (merged from core + packs + userland)
  deweight_patterns: ReadonlyArray<CloneDeweightPatternConfig>;
  family_detection: FamilyDetectionConfig;
}

// TS-DE-04 config
interface TsDe04Config {
  exclude_categories: ReadonlyArray<SourceCategory>;
  test_categories: ReadonlyArray<SourceCategory>;
  top_n_diagnostics: number;
  dependency_aliases: Record<string, string>;
  allow_dev_dependency_in_prod: ReadonlyArray<string>;
  
  // Calibration (merged from ecosystem pack + userland)
  framework_virtual_modules: ReadonlyArray<FrameworkVirtualModuleRule>;
  bundler_configs: ReadonlyArray<BundlerConfigRule>;
  config_file_patterns: ReadonlyArray<string>;
  bundled_app_frameworks: ReadonlyArray<string>;
  low_signal_package_patterns: LowSignalPackagePatterns;
  host_facade_aliases: ReadonlyArray<HostFacadeAlias>;
}
```

---

## 5. Migration Path

### Phase 1: Extract Source Taxonomy (Week 1–2)

1. Create `SourceTaxonomyService` in `ts-pack`.
2. Define default categories with the union of all current exclude/test globs.
3. Refactor `ts-project.ts` to use taxonomy for production filtering.
4. Refactor `isPulsarSource` in `scoring-engine.ts` to use taxonomy.
5. Migrate 2–3 signals to consume taxonomy instead of globs (e.g., TS-LD-01, TS-AD-02).
6. **Preserve exact behavior:** The default taxonomy must reproduce every current exclusion.

### Phase 2: Extract Tooling Conventions (Week 3–4)

1. Create `calibration-js-tooling` pack structure.
2. Move `PACKAGE_ROOT_DEPENDENCY_FILES` into pack config.
3. Move bundler detection (tsup, esbuild, webpack, etc.) into pack config.
4. Move `isDocusaurusApp` / `isSvelteKitApp` detection into pack-level `framework_detection`.
5. Move virtual module specifiers into pack-level `virtual_module_specifiers`.
6. Update `TS-DE-04` to load these from `CalibrationPackRegistry`.
7. **Preserve exact behavior:** The pack defaults must reproduce current dependency health scoring.

### Phase 3: Extract Noop Patterns (Week 5–6)

1. Create `NoopPatternEngine`.
2. Extract generic patterns from `ts-sl-04` (Promise handlers, console silencing, lifecycle pairs, etc.) into built-in `noop_rules`.
3. Create `calibration-solid-js`, `calibration-react`, `calibration-effect-ts` packs with framework-specific rules.
4. Refactor `ts-sl-04` to use `NoopPatternEngine`.
5. **Preserve exact behavior:** Built-in + pack rules must reproduce current stub detection.

### Phase 4: Extract Clone Deweights (Week 7–8)

1. Create `CloneDeweightEngine`.
2. Extract generic patterns from `ts-sl-01` (versioned siblings, migration paths) into built-in `deweight_patterns`.
3. Move framework-specific patterns (SolidJS adapters, Effect.gen callbacks) into framework packs.
4. Refactor `ts-sl-01` to use `CloneDeweightEngine`.
5. **Preserve exact behavior:** Built-in + pack patterns must reproduce current duplication scoring.

### Phase 5: Extract Score Formula & Severity Calibration (Week 9–10)

1. Parameterize score formulas in all signals.
2. Make severity thresholds configurable per signal.
3. Move hardcoded constants (30% churn target, 20 module cycle block, etc.) into default configs.
4. Allow repo/org configuration to tune score thresholds only after comparability is proven; keep raw score curves code-owned initially.

---

## 6. Risk Acknowledgments & Limits

### 6.1 Not Everything Should Be Configurable

Some hardcoded logic is genuinely structural and should remain in core:

- **Graph algorithms** (Tarjan SCC for cycles, bitset reachability, Levenshtein matching)
- **Tokenization** (the duplication tokenizer's lexer is a generic algorithm)
- **AST traversal** (walking ts-morph nodes is structural)
- **Git operations** (parsing diffs, computing churn)

The boundary is: **structural algorithms stay in core; domain-specific pattern matching moves to calibration**.

### 6.2 The AST Pattern Primitives Have Limits

The `NoopPatternEngine` config schema is powerful but not Turing-complete. Some current heuristics are extremely specific:

- `isCapabilityAbsentContractStub` inspects preceding source text (400 chars)
- `isEventDeltaProjectionNoop` checks exact call expression text (`SyncEvent.project`) and argument index
- `isReactHostConfigOptionalNoop` requires sibling set intersection (`supportsMutation` AND `getRootHostContext` AND `createInstance`)

These are expressible in the proposed schema, but the schema might need **extension hooks** for edge cases. That's acceptable—95% of patterns fit the schema; the remaining 5% can use a `"custom"` node type or require a pack code contribution.

### 6.3 Calibration Drift Is Real

Once rules move to packs, a pack update can change signal behavior without a signal code change. The cache key must include:

- Signal cache version
- Calibration pack IDs and versions
- Pulsar vector hash
- Source taxonomy hash

This ensures calibration changes invalidate caches correctly.

### 6.4 Framework Packs Require Maintenance

A `calibration-docusaurus` pack must be maintained as Docusaurus evolves. This is **better** than hardcoding in signals because:
- The pack can be versioned independently
- Community contributors can maintain framework packs without touching core
- A missing framework pack results in **safe defaults** (stricter scoring) rather than false positives

### 6.5 There's a Limit to Generalization

Some patterns are so project-specific that they may never justify a pack:

- `isProjectionAdapterFinishNoop` (`appendMessage` + `updateAssistant` / `updateCompaction` / `updateShell`)
- `isEventDeltaProjectionNoop` (`SyncEvent.project` + `.Delta.Sync`)
- `isEventMatchNoopBranch` (`Event.All.match` + `.delta` / `.retried`)
- `isOptionalProtectedFrameworkHookNoop` (`buildWrangler`, `normalizeBuildCommand`, `validate`)

These appear to be **custom patterns from the specific projects that built this tool**. The right layer for these is **repo/org calibration config** (or a private org pack), not a published framework pack. The calibration layer must support arbitrary custom rules so these don't need to be hardcoded.

---

## 7. Summary: From Poisoning to Calibration

| Current Problem | Calibration Layer Solution |
|---|---|
| 25 signals each copy-pasting `exclude_globs` | `SourceTaxonomyService` — classify once, consume everywhere |
| `ts-sl-04` has 1,245 lines of framework-specific noop logic | `NoopPatternEngine` — generic engine + pack-contributed rules |
| `ts-sl-01` hardcodes SolidJS/Effect clone exemptions | `CloneDeweightEngine` — pattern-based evaluation |
| `ts-de-04` lists 60+ config filenames | `calibration-js-tooling` pack — ecosystem-contributed conventions |
| Docusaurus/SvelteKit virtual modules hardcoded | Framework packs — `framework_virtual_modules` config |
| `.opencode/`, `.pi/`, `private-demos/` in generic pack | Project layout conventions — userland taxonomy overrides |
| `isPulsarSource` hardcodes `.ts`/`.tsx`/`.rs` | Pack-contributed source extensions via taxonomy |
| Score formulas use magic constants (×2, ×3, /0.3) | `ScoreCalibrationConfig` — parameterized curves per signal |
| Severity thresholds hardcoded (20 modules → block) | `severity_thresholds` — configurable per signal |
| Every framework addition requires signal code change | Add a calibration pack — no signal code touched |

The hardcoded assumptions discovered in the last 98 commits (and pre-existing in the codebase) are **not waste**—they are the **training data** for the calibration layer. The next step is to systematically extract them into the architecture described above.
