# Project Module SDK Requirements

## Decision

Calibration must support real project-owned TypeScript modules, including Effect code. A limited JSON or config DSL is useful for simple rules, but it cannot cover private frameworks, bespoke repository structure, organization-owned technology, or project-specific semantics that Taste Codec cannot know in advance.

The module system should therefore make code-backed calibration first-class.

**Project modules** are project-owned code units that contribute typed calibration processors to Taste Codec. They can be committed directly in a repo, shared across an organization, or published as reusable technology/framework modules, but their semantic ownership remains project/repo/org scoped.

## Why A Code SDK

The hardcoded heuristics in source signals are not all scalar tweaks. Many are small programs:

- Inspect AST context.
- Resolve package and workspace conventions.
- Classify framework contracts.
- Deweight clone families.
- Explain generated or intentionally empty code.
- Attach domain labels used by downstream diagnostics.

Trying to express all of that as a config DSL would either become too weak or accidentally become a worse programming language. Real TypeScript modules give maintainers the flexibility to teach Taste Codec their technology directly.

## Trust Boundary

Project modules are project-owned code. Running them is equivalent in trust posture to running repo-owned tests, linters, build scripts, or custom static-analysis plugins.

The architecture still needs guardrails:

1. Modules must be explicitly discoverable through repo/org calibration, not inferred from arbitrary files.
2. The resolved module list must be printed in calibration reports and included in cache fingerprints.
3. Every processor contribution must attach to a typed slot.
4. Every changed classification must carry module id, processor id, version, rule id when applicable, confidence, and evidence.
5. A module can be powerful, but it cannot silently bypass the mixer and write final scores unless it implements an explicit mixer-policy slot.

This preserves the key invariant: project maintainers can encode anything they need, but Taste Codec users can still see what code shaped the result.

## Ownership Levels

Project modules can live at several layers:

- **Repo-local project modules:** committed inside the repository under `.taste-codec/modules/` or a configured path.
- **Org-private project modules:** shared packages for internal frameworks or company architecture.
- **Published technology/framework project modules:** reusable packs for TypeScript tooling, Effect, Convex, React, Rust ecosystems, and similar public technologies.
- **Core project modules:** built-in generic processors shipped with Taste Codec.

The effective repo/org vector and calibration manifest resolve which modules are active. Repo-local configuration overrides org fallback configuration.

## Module Shape

The SDK should make the simple path small while allowing full Effect programs when needed.

```typescript
import {
  defineProjectModule,
  defineProcessor,
  classification,
} from "@taste-codec/project-module-sdk";
import { Effect } from "effect";

export default defineProjectModule({
  id: "acme.convex-contracts",
  version: "1.0.0",
  scope: "repository",
  slots: [
    defineProcessor({
      id: "convex-generated-api-taxonomy",
      slot: "taxonomy.file-classifier",
      process: Effect.fn("convex-generated-api-taxonomy")(function* (input, context) {
        if (!input.path.includes("/convex/_generated/")) return input;

        return input.addClassification(
          classification({
            category: "generated",
            confidence: "high",
            reason: "Convex generated API output",
            evidence: [{ kind: "path", value: input.path }],
          }),
        );
      }),
    }),
  ],
});
```

For simple data rules, the SDK can provide helpers that compile config into processors. Those helpers are convenience APIs, not the foundation.

## Effect Runtime Requirements

Project modules should run inside the same Effect environment as the scoring engine.

Required runtime behavior:

1. Import module code once during calibration context construction.
2. Decode module configuration with Effect Schema.
3. Run module setup once per scoring runtime, not inside AST loops.
4. Allow modules to provide scoped resources with `Layer` and `Effect.acquireRelease`.
5. Compile globs, regexes, and AST matchers during setup.
6. Execute processors through `Effect.fn` so spans include module id, processor id, and slot id.
7. Convert processor failures into typed `CalibrationProcessorError` values.

The runtime shape should look like:

```typescript
const ProjectModuleLayer = (
  repoRoot: string,
  moduleRefs: ReadonlyArray<ProjectModuleRef>,
): Layer.Layer<ProjectModuleRegistryTag, ProjectModuleLoadError> =>
  Layer.effect(
    ProjectModuleRegistryTag,
    Effect.gen(function* () {
      const modules = yield* Effect.forEach(
        moduleRefs,
        (ref) => loadProjectModule(ref),
        { concurrency: 4 },
      );

      const initialized = yield* Effect.forEach(
        modules,
        (module) => initializeProjectModule(module, repoRoot),
        { concurrency: 4 },
      );

      return compileProjectModuleRegistry(initialized);
    }),
  );
```

Then scoring receives a single resolved calibration service:

```typescript
const EnvLayer = Layer.mergeAll(
  SignalContextLayer,
  ReferenceDataLayer,
  SignalCacheLayer,
  ProjectModuleLayer(repoRoot, moduleRefs),
  CalibrationContextLayer(repoRoot, vector),
  LanguagePackLayer,
);
```

## Slot Discipline

Full code flexibility should happen behind narrow slot contracts:

| Slot Family | Project Module Capability |
|---|---|
| `taxonomy.file-classifier` | Add/refine file categories and source inclusion facts |
| `language-pack-activation` | Contribute source extensions and pack activation evidence |
| `typescript.noop-classifier` | Classify empty function candidates as intentional contracts or stubs |
| `typescript.clone-group-policy` | Exclude, deweight, keep, or label clone groups |
| `typescript.dependency-resolver` | Resolve virtual modules, aliases, bundled externals, and facade packages |
| `typescript.suppression-justifier` | Justify or flag suppression comments |
| `typescript.callback-context-namer` | Add semantic names to anonymous callback contexts |
| `mixer.category-policy` | Apply explicit repo/org score-shaping policy |

The SDK can add new slots over time, but modules should not patch arbitrary source-signal internals.

## Fingerprints And Cache Keys

Each module must contribute a stable fingerprint:

- Module id.
- Module version.
- Source path or package version.
- Module config hash.
- Exported processor ids and fingerprints.
- Active rule ids and hashes when using rule helpers.

Signal caches include only fingerprints for slots the signal uses. Observer caches include the full resolved calibration fingerprint.

Local TypeScript source modules need a source-content hash because there may be no package version.

## Error Policy

- Invalid explicit module references fail before scoring.
- Schema decode failures fail before scoring.
- Module import/setup failures fail before scoring.
- Processor failures fail the affected signal through typed signal errors.
- A processor that does not match returns unchanged evidence.
- Auto-detected optional modules may be disabled by repo/org config, but they should not fail silently when explicitly enabled.

## Portability

The first implementation can target the repository's existing Bun/TypeScript runtime. The SDK boundary should avoid Bun-only APIs so modules can later be packaged for other runners.

Portable module rules:

- Use ESM exports.
- Use SDK-provided filesystem/repo-fact services where possible.
- Keep module setup deterministic.
- Avoid network access in processor execution.
- Treat non-deterministic inputs as explicit repo facts with provenance.

## Documentation And Skill Requirements

Writing project modules is important enough to deserve a dedicated authoring guide or skill. That guide should teach:

1. How to choose the correct slot.
2. How to write a data-only rule versus a code-backed processor.
3. How to use Effect services, `Effect.fn`, `Layer`, and scoped setup.
4. How to attach attribution and evidence.
5. How to fingerprint module behavior.
6. How to test a module against fixture repositories.
7. How to avoid hidden scoring and signal poisoning.
8. How repo-local modules, org modules, and published packs compose.

The goal is not to restrict project maintainers. The goal is to give them full capability while keeping Taste Codec's results explainable and trustworthy.
