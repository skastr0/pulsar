# Community signal plugin interface exploration

**Status**: Exploratory — Phase 8 glyph TC-062  
**Date**: 2026-04-19  
**Scope**: Design community extensibility for Pulsar signals

---

## Context

The Pulsar signal interface (`Signal<Config, Output, R>`) is designed for composability, but currently signals ship only through core-maintained packs (`@skastr0/pulsar-ts-pack`, `@skastr0/pulsar-rs-pack`). The architecture calls for third-party packages to extend coverage beyond what the core team maintains.

---

## Exploration scope

Five open questions govern whether and how to enable community signals:

1. **Trust boundaries**: Signals execute in the same runtime as the Observer. A malicious signal can read arbitrary files, exfiltrate data, or slow down scoring.
2. **Versioning**: Core's signal interface will evolve. How do community signals stay compatible?
3. **Discovery**: Where do users find community signals?
4. **Quality gate**: How do users evaluate a community signal before adoption?
5. **Kill switch**: What happens when a community signal starts crashing the Observer?

---

## Survey of plugin ecosystems

### ESLint plugins (closest analog)

**Trust model**: No sandbox. Plugins are arbitrary JavaScript with full Node.js access.

**Mitigations**:
- npm's provenance attestation (supply chain)
- Package-lock checksums
- Manual audit for first-time installation
- `@eslint-community/` prefix as informal trust marker

**Discovery**: npm registry + curated "awesome-eslint" lists.

**Versioning**: ESLint defines a [plugin API contract](https://eslint.org/docs/latest/extend/plugins) that's versioned independently. Plugins declare `peerDependency` on `eslint: ^8.x || ^9.x`.

**Lessons for Pulsar**:
- No-sandbox approach is the default in Node.js ecosystems
- Trust must be explicit (peer dependencies, provenance attestation)
- Discovery is a registry + curation problem, not a technical one

### ts-patch transformers

**Trust model**: Same as ESLint — full TypeScript compiler access.

**Mitigations**: Peer dependency declarations, limited curation.

**Discovery**: Less structured than ESLint — mostly GitHub search.

**Lessons**:
- Registry-first discovery matters for adoption
- Without curation, quality varies dramatically

### Rust proc macros

**Trust model**: Proc macros compile to WASM (or native code) and run during build. Same trust boundary as any build dependency.

**Mitigations**: 
- `cargo-audit` for known vulnerabilities
- `cargo-deny` for policy enforcement
- Crates.io has reverse-dependency counts and recent-download metrics

**Lessons**:
- Native/wasm compilation provides *some* isolation (separate process per macro invocation) but not security
- Reverse-dependency counts are quality signals

---

## Prototype: Minimal third-party signal package

A community signal package exports a set of `Signal` values and a `Layer` for any custom service requirements.

### Package: `pulsar-signal-markdown` (hypothetical)

```typescript
// src/index.ts
import type { AnySignal } from "@skastr0/pulsar-core"
import { MarkdownWordCount, MarkdownHeadingStructure } from "./signals/index.js"
import { MarkdownProjectLayer } from "./project.js"

export const MARKDOWN_SIGNALS: ReadonlyArray<AnySignal> = [
  MarkdownWordCount,
  MarkdownHeadingStructure,
]

export { MarkdownProjectLayer }
```

The consuming pulsar would load signals via `buildRegistry`:

```typescript
import { buildRegistry } from "@skastr0/pulsar-core"
import { MARKDOWN_SIGNALS } from "pulsar-signal-markdown"

const registry = await Effect.runPromise(buildRegistry([
  ...TS_PACK_SIGNALS,
  ...MARKDOWN_SIGNALS,
]))
```

This prototype suggests the current signal interface is sufficient for exploratory third-party packs without immediate core shape changes.

> **Prototype status**
> The package under `docs/explorations/prototypes/pulsar-signal-markdown/` is an illustrative exploration artifact only. It is not wired into the main runtime, not part of the workspace build, and should not be read as production-ready packaging.

---

## Trust model recommendations

### Recommendation 1: Documented trust, not technical enforcement

Pulsar signals run in the same Node.js process as the Observer. True sandboxing (workers, wasm, separate process) adds latency incompatible with the bisect workflow's requirement for ~500 commits scored in minutes.

**Adopt the ESLint/cargo model**: trust is explicit, verifiable, and audit-able, not enforced by runtime isolation.

### Recommendation 2: Signal provenance requirements

Community signals MUST:
- Ship via npm with `provenance: true` (attested build)
- Declare `@skastr0/pulsar-core` as a peer dependency
- Include `pulsar-signal` keyword for discovery

### Recommendation 3: Graduated trust tiers

| Tier | Verification | Discovery visibility |
|------|-------------|---------------------|
| **Core** | Core team authored, in `@skastr0/pulsar-*` packages | First-class, default-enabled |
| **Verified** | Peer-reviewed by core team, published under `@pulsar-community/*` | Listed, opt-in |
| **Community** | Meets provenance requirements only | Searchable, explicit install required |

### Recommendation 4: No automatic execution

Community signals are never auto-loaded. Users explicitly enable them in their pulsar vector:

```json
{
  "signal_overrides": {
    "COMMUNITY-MARKDOWN-01": {
      "active": true,
      "source": "npm:pulsar-signal-markdown@^1.0.0"
    }
  }
}
```

The Pulsar validates the package hash against a lockfile before execution.

---

## Versioning recommendations

### Interface contract

The `Signal<Config, Output, R>` interface is the load-bearing contract. Changes that break this shape require a major version bump of `@skastr0/pulsar-core`.

**Current stability**: The interface is intentionally minimal (`id`, `tier`, `category`, `kind`, `configSchema`, `defaultConfig`, `inputs`, `compute`, `score`, `diagnose`). It's been stable through Phase 1-6 implementation.

**Versioning policy**:
- Community signals declare `peerDependencies: { "@skastr0/pulsar-core": "^1.0.0" }` (or appropriate range)
- Core releases signal interface changes as breaking (major version bump)
- The Pulsar warns when a community signal's peer dependency range excludes the running core version

### Deprecation path

When a signal is deprecated:
1. Core marks it as deprecated (soft: warning, hard: ignored)
2. Deprecation notice includes migration path
3. One major version cycle (minimum 6 months) before removal

---

## Discovery recommendations

### Short-term: npm keywords

Community packages MUST include:
```json
{
  "keywords": ["pulsar", "pulsar-signal", "writing", "markdown"]
}
```

Users discover via `npm search pulsar-signal`.

### Medium-term: Curated registry

Maintain `pulsar/community-signals` GitHub repo with:
- Curated list of verified signals
- Automated CI testing of each signal against reference repos
- Quality badges (test coverage, last release, reverse dependencies)

This avoids the "awesome list" pattern where curation becomes stale.

---

## Kill switch design

When a signal crashes or times out during scoring, the Pulsar must isolate the failure without aborting the entire run.

### Isolation mechanism

The scoring engine already catches `SignalError` per signal. Extend with:

```typescript
interface SignalExecutionResult {
  readonly signalId: string
  readonly status: "ok" | "timeout" | "crash" | "quarantined"
  readonly output?: unknown
  readonly diagnostics: ReadonlyArray<Diagnostic>
}
```

### Quarantine policy

A signal that crashes in N consecutive runs (default: 3) is **quarantined**:
- Marked inactive in the registry for this scoring run
- Reported in the Observer output with a diagnostic
- Not retried until the next CLI invocation

Users can override with `--no-quarantine` for debugging.

---

## Proposed follow-up work

Based on this exploration, the most likely next implementation slices are:

### Community signal quarantine mechanism
**Scope**: Implement crash/timeout isolation and quarantine tracking in `ScoringEngine`.
**Dependencies**: None — can build against current core.

### Community signal registry manifest format
**Scope**: Define a `pulsar-community.json`-style manifest for third-party signals.
**Dependencies**: Ideally after quarantine semantics are settled.

### Verified community-signal CI lane
**Scope**: Add a CI path that tests submitted signals against reference repos and reports basic quality indicators.
**Dependencies**: Easier once the manifest/registration shape is defined.

---

## Summary

| Question | Recommendation |
|----------|----------------|
| Trust | Explicit provenance + opt-in loading, no sandbox |
| Versioning | Peer dependency on core, stable interface, major bump for breaks |
| Discovery | npm keywords short-term, curated registry medium-term |
| Quality | Automated testing + peer review for "verified" tier |
| Kill switch | Per-signal quarantine after N consecutive failures |

At the contract level, the signal interface looks sufficient for community experimentation. Production readiness still depends on unresolved operational work (provenance requirements, registry curation, quarantine logic, and rollout policy).
