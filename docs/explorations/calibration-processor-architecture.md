# Calibration Processor Architecture

## Purpose

Pulsar needs to remove project-shaped and framework-shaped heuristics from source signal implementations without throwing away the knowledge those heuristics captured. The right layer is not "more vector numbers." Many current exceptions are executable signal processing: they classify evidence, resolve framework semantics, deweight clone groups, or change what counts as production source.

The architecture should therefore treat calibration as a deterministic processor layer between raw structural evidence and final scoring. The audio-unit metaphor is useful:

- **Sources / sensors:** language signals extract structural evidence from the repository.
- **Processors:** repo/org, ecosystem, technology, and framework modules transform or annotate evidence through typed slots.
- **Mixer:** the repo/org pulsar vector, aggregation policy, and baseline/ratchet resolve final meaning.

The mixer is the only place where the final song becomes meaningful. A processor can alter evidence interpretation, but it must not be an unbounded hidden scorer.

## Invariants

1. **Pulsar remains repo/org-owned.** There is no personal, per-agent, or task-local pulsar layer. Home-directory vectors are only org-standard fallback transport.
2. **Source signals should become stable sensors.** Once a source signal extracts the right raw evidence, later framework/project adaptation should happen in calibration processors unless the signal has a bug.
3. **Processors are typed audio units, not arbitrary patches.** Each processor attaches to a declared slot with declared input/output types.
4. **Every calibration decision is attributable.** A changed classification must carry pack id, processor id, rule id, version, confidence, and supporting evidence.
5. **Calibration participates in cache keys.** Changing active packs, processor rules, file taxonomy, or repo/org calibration must invalidate affected caches.
6. **Repo/org configuration wins over fallbacks.** Repository `.pulsar/*` artifacts override org fallback files. Private org packs and repo-local rules are valid for project-specific facts.

## Pipeline

```text
Repository files
  -> repo fact collectors
  -> source signals / sensors
  -> typed calibration processor slots
  -> signal score + diagnostics
  -> category mixer + repo/org pulsar vector
  -> baseline / ratchet comparison
```

### 1. Repo Fact Collectors

Repo facts are precomputed once per run and provided as services to signals and processors. They replace duplicated path and package inference inside signals.

Examples:

- File taxonomy: production, test, test utility, example, generated, tooling, declaration, build artifact.
- Package manifests and workspace graph.
- Framework/technology detections with evidence.
- Source language activation and source file extensions.
- Bundler and virtual-module conventions.

Repo facts are not pulsar. They are claims about the repository with provenance and a fingerprint.

### 2. Source Signals

Signals extract raw evidence with as little domain-specific interpretation as possible. For example:

- `TS-SL-04` should find empty/stub-like function candidates and structural context.
- `TS-SL-01` should find clone groups and clone member facts.
- `TS-DE-04` should find package imports, declarations, manifest data, and unresolved specifier candidates.
- `TS-LD-01` should compute structural complexity and callback context facts.

The source signal still owns the structural algorithm. Tarjan SCCs, tokenization, AST traversal, dependency graph construction, and raw metric extraction stay in signal/source code.

### 3. Calibration Processor Slots

Processors attach to slots. A slot is a stable contract around a narrow evidence domain.

Initial slot families:

| Slot | Processor Role | Current Hardcodes It Replaces |
|---|---|---|
| `taxonomy.file-classifier` | Classify files and paths once per run | Per-signal `exclude_globs`, `test_globs`, `isPulsarSource`, `ts-project.ts` production filtering |
| `typescript.noop-classifier` | Classify empty function candidates as intentional noops or stubs | SolidJS, React host config, yargs, projection adapters, console silencing, lifecycle noops |
| `typescript.clone-group-policy` | Exclude/deweight/keep clone groups | SolidJS adapters, Effect callbacks, AST predicate guards, migration/version families, cache mirrors |
| `typescript.dependency-resolver` | Resolve imports, virtual modules, bundler externals, host facade aliases | Docusaurus/SvelteKit virtual modules, bundled package config detection, package root config filenames |
| `typescript.suppression-justifier` | Classify suppression comments as justified, suspicious, or unjustified | Pulumi metadata access/assignment, trace/debug branches |
| `typescript.callback-context-namer` | Improve names for anonymous callbacks from structural context | Effect.tryPromise naming and similar callback object conventions |
| `language-pack-activation` | Decide which language packs and source extensions are active | Closed TS/Rust detection lists |
| `mixer.category-policy` | Shape aggregation behavior under explicit repo/org policy | Existing lowest-signal category shaping and future baseline policies |

The first six are signal-adjacent processors. `mixer.category-policy` should be rare and more constrained because it changes final meaning directly.

Processor slots can be described by a small vocabulary:

- **Filters** remove or gate evidence from a signal's input set, usually through taxonomy.
- **Resolvers** turn ambiguous repo facts into concrete interpretation, such as virtual modules or active framework packs.
- **Normalizers** reclassify suspicious syntax as an intentional contract shape when evidence supports it.
- **Compressors / deweighters** keep evidence but reduce gain, such as clone families that are real but lower risk.
- **Enrichers** add labels used downstream without changing scores directly.
- **Mixer policies** combine processed evidence into final score and severity policy.

This vocabulary matters because different roles have different risk. Filters and resolvers can remove false positives before scoring; compressors preserve visibility; enrichers should be score-neutral; mixer policies are most sensitive because they alter final meaning.

### 4. Mixer

The mixer combines signal scores using the effective repo/org vector, category aggregation, hard gates, and baseline/ratchet policy. It resolves meaning at the end rather than baking meaning into every source signal.

The vector should remain mostly scalar and policy-oriented:

- Signal active/weight/config overrides.
- Review routing thresholds.
- Backpressure thresholds.
- Baseline/ratchet policy.
- Explicit modes such as AI-assisted mode.
- References to repo/org calibration artifacts or packs.

It should not become a dumping ground for personal preferences or opaque code.

## Pack Model

Calibration packs can be data-only or code-backed. Config-only rules are enough for many cases, but the current heuristics prove that some processors need real code. Code-backed packs are acceptable if they obey the same slot contracts and fingerprint rules.

Project-owned code-backed modules are first-class. **Project modules** are TypeScript modules, often Effect-based, that contribute processors through the same SDK as published calibration packs. This is the escape hatch for private frameworks, bespoke project layout, organization-owned technology, and patterns that will never justify a public pack.

This is deliberately more powerful than a config DSL. The trust boundary is the project/repository or organization: running a repo-local project module is like running repo-owned tests, linters, or build scripts. The result still must be deterministic, fingerprinted, and attributable.

```typescript
interface CalibrationPack {
  readonly id: string;
  readonly version: string;
  readonly scope: "core" | "language" | "ecosystem" | "technology" | "framework" | "organization" | "repository";
  readonly detection?: CalibrationDetection;
  readonly contributes: ReadonlyArray<CalibrationContribution>;
}

interface CalibrationContribution {
  readonly slot: CalibrationSlotId;
  readonly processorId: string;
  readonly priority: number;
  readonly configHash: string;
}
```

Activation can be explicit or evidence-based:

- Explicit repo/org activation is always allowed.
- Auto-activation requires repository evidence, such as dependency names, scripts, config files, imports, or framework markers.
- Auto-activation must be visible in the resolved calibration report and overrideable by repo/org config.

Repo-local project modules should be referenced explicitly from repo/org calibration artifacts. They may live under `.pulsar/modules/`, in a workspace package, or in a private package. Local TypeScript source modules need source-content hashes in the resolved calibration fingerprint because they may not have package versions.

## Processor Contract

Processors should operate on prepared evidence, not perform unbounded repository scans in hot loops.

```typescript
interface CalibrationProcessor<Input, Output> {
  readonly id: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly slot: CalibrationSlotId;
  readonly priority: number;
  readonly fingerprint: string;
  process(input: Input, context: CalibrationContext): Output;
}

interface CalibrationDecision {
  readonly processorId: string;
  readonly packId: string;
  readonly ruleId?: string;
  readonly action: string;
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evidence: ReadonlyArray<CalibrationEvidenceRef>;
}
```

A signal output that has been calibrated should preserve both the raw fact and the decision. For example, an empty function candidate should not disappear silently; it should become `intentional_noop` with the rule that classified it, or remain `stub` with no matching calibration.

## Effect Runtime Shape

This layer fits the existing Effect architecture well. Calibration should be provided as a normal service in the scoring environment, next to `SignalContextTag`, `ReferenceDataTag`, `SignalCacheTag`, and language-pack services.

```typescript
class CalibrationContextTag extends Context.Tag(
  "@skastr0/pulsar-core/CalibrationContext",
)<CalibrationContextTag, ResolvedCalibrationContext>() {}

interface ResolvedCalibrationContext {
  readonly fingerprint: string;
  readonly activePacks: ReadonlyArray<ActiveCalibrationPack>;
  readonly repoFacts: RepoFacts;
  readonly runSlot: <Slot extends CalibrationSlotId>(
    slot: Slot,
    input: CalibrationSlotInput<Slot>,
  ) => Effect.Effect<
    CalibrationSlotOutput<Slot>,
    CalibrationProcessorError,
    never
  >;
}
```

The important implementation detail is that pack discovery, rule decoding, glob compilation, regex compilation, and processor ordering happen once when building the runtime layer:

```typescript
const CalibrationContextLayer = (
  repoRoot: string,
  vector: PulsarVector | undefined,
): Layer.Layer<CalibrationContextTag, CalibrationConfigError> =>
  Layer.effect(
    CalibrationContextTag,
    Effect.gen(function* () {
      const repoFacts = yield* collectRepoFacts(repoRoot);
      const packs = yield* resolveActiveCalibrationPacks(repoRoot, vector, repoFacts);
      const processors = yield* compileCalibrationProcessors(packs, vector, repoFacts);
      return makeResolvedCalibrationContext(repoFacts, packs, processors);
    }),
  );
```

The hot path should then be a small typed pipeline:

```typescript
const classifyNoopCandidate = (
  candidate: EmptyFunctionCandidate,
) =>
  Effect.gen(function* () {
    const calibration = yield* CalibrationContextTag;
    return yield* calibration.runSlot("typescript.noop-classifier", candidate);
  });
```

The slot runner is deterministic and sequential by default because processor order is semantic. Independent repo-fact collectors can use `Effect.all` or `Effect.forEach` with bounded concurrency, but processors that refine the same evidence should behave like a stable pipeline:

```typescript
const runSlot = <Slot extends CalibrationSlotId>(
  slot: Slot,
  input: CalibrationSlotInput<Slot>,
) =>
  Effect.gen(function* () {
    let current: CalibrationSlotOutput<Slot> = initialSlotOutput(slot, input);
    for (const processor of processorsFor(slot)) {
      current = yield* processor.process(current).pipe(
        Effect.withSpan(`calibration.${slot}.${processor.id}`),
        Effect.mapError((cause) =>
          new CalibrationProcessorError({
            slot,
            processorId: processor.id,
            packId: processor.packId,
            cause,
          }),
        ),
      );
    }
    return current;
  });
```

Error policy should be strict at load time and attributable at run time:

- Invalid repo/org calibration config fails before scoring.
- Unknown slot ids, unknown rule ids, and schema decode failures fail before scoring.
- Processor execution errors fail the affected signal through the existing signal-error path; observer mode can surface that as a score-0 diagnostic, but the failure must not be silently ignored.
- A processor that declines to classify evidence returns an unchanged output, not an error.

This gives us type-safe composition, normal Effect tracing, bounded concurrency for discovery work, and one shared resolved calibration service per scoring engine instance.

## Resolution And Precedence

Precedence should be deterministic:

1. Core generic processors.
2. Language ecosystem processors, such as TypeScript/JavaScript tooling.
3. Technology/framework processors, such as Effect, Convex, React, SolidJS.
4. Private organization packs.
5. Repo-local calibration artifacts.
6. Repo/org pulsar vector mixer settings.

Higher-precedence layers can disable, replace, or refine lower-precedence rules by stable rule id. They should not silently mutate unrelated rules.

## Cache And Fingerprints

Existing cache keys include signal cache version and resolved vector config. Calibration requires an additional resolved context fingerprint:

```text
signal cache version
+ resolved signal config
+ active calibration pack ids and versions
+ active processor fingerprints for that signal's slots
+ repo fact taxonomy fingerprint
+ repo/org vector id/hash
```

Observer cache keys need the full resolved calibration fingerprint because category aggregation can depend on active processors and file taxonomy. Single-signal cache keys can include only the slots that the target signal declares.

## Performance Constraints

1. Resolve pack activation once per run.
2. Compile glob/regex/pattern rules once per run.
3. Build file taxonomy once per run and query it through O(1)-ish classification helpers.
4. Keep processors slot-local and pass prepared facts instead of raw full-project handles where possible.
5. Avoid plugin discovery in AST loops.
6. Make processor execution deterministic and side-effect-free.
7. Preserve the ability to cache raw source outputs separately from calibrated outputs when practical.

The runtime target is not "free abstraction." The target is equivalent hot-path work to today's hardcoded `if` branches, moved behind precompiled processor arrays and shared repo facts.

## Initial Pack Boundaries

### TypeScript / JavaScript Ecosystem Pack

This is a core calibration pack, not optional trivia. It should cover common JS/TS tooling conventions:

- Source file extensions and language activation for `.ts`, `.tsx`, `.js`, `.jsx`, config files, and Deno/Bun/Node evidence.
- File taxonomy for generated files, declarations, stories, config tooling, tests, examples, build artifacts.
- Package root dependency config filenames.
- Bundler config conventions and external package extraction.
- `@types/*` package mapping.
- TypeScript AST predicate guard conventions.

### Effect Pack

Effect should be a technology pack because the current code already learned real Effect semantics:

- `Effect.gen` small callback clone deweighting.
- `Effect.tryPromise` callback context naming.
- Expected fallback/noop patterns around `orElseSucceed`, interruption, cleanup, and scoped resources.
- Potential future processor rules around layers, services, tags, and managed resources.

### Convex Pack

Convex is a good early validation pack because it has framework-specific file layout, generated API files, server/client boundaries, and function conventions:

- File taxonomy for `_generated/`, `convex/_generated/`, generated API files, and server function files.
- Dependency/import resolver behavior for generated Convex modules.
- Boundary classification for queries, mutations, actions, internal APIs, and client imports.
- Noop or placeholder semantics only where Convex contracts genuinely imply them.

### Rust Pack Follow-Up

Rust should get the same treatment after the TypeScript path is proven. The first likely layers are standard library/Tokio/Serde/Axum-style conventions, generated build outputs, macro-generated code boundaries, and crate workspace taxonomy. Core Rust structural metrics should remain source signals.

## Migration Plan

1. **Define contracts only.** Add `CalibrationContext`, pack manifest, slot ids, fingerprint shape, and decision attribution types without changing behavior.
2. **Extract file taxonomy first.** It is cross-cutting, easy to test, and removes duplicated globs from many signals.
3. **Make `TS-SL-04` a candidate classifier.** Preserve current behavior by loading equivalent built-in/repo calibration rules, then remove hardcoded `is*Noop` branches.
4. **Move `TS-DE-04` ecosystem knowledge into dependency resolver processors.** Start with package config filenames, virtual modules, bundler externals, and host facade aliases.
5. **Move `TS-SL-01` clone deweights into clone-group policy processors.**
6. **Create first published/internal packs.** Start with TypeScript ecosystem, Effect, and Convex. Do not prioritize incidental Docusaurus/SvelteKit packs unless validation repos demand them.
7. **Validate on real repos.** Use repo/org calibration and baseline/ratchet to establish truthful current-state baselines, then prove forward-looking regressions and improvements are detected.

## Non-Goals

- No personal or per-agent pulsar.
- No processor that directly writes final signal scores without a typed slot and visible decision.
- No framework-specific source-signal branches after the matching processor slot exists.
- No attempt to make every possible AST predicate configurable before extracting the first useful layer.
- No guarantee that every project-specific rule becomes a public pack; repo/org calibration and private org packs are first-class.
