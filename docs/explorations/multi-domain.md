# Multi-domain packs exploration

**Status**: Exploratory — Phase 8 glyph TC-063  
**Date**: 2026-04-19  
**Scope**: Extend Pulsar beyond code (writing, marketing, design)

---

## Context

The architecture calls for extending the Pulsar beyond software: "Multi-domain packs (writing, marketing, design)." The thesis — pulsar as an encoded n-dimensional decision function — applies to any artifact where preference can be revealed through decision patterns.

---

## Thesis validation

Can the signal interface (`Signal<Config, Output, R>`) generalize to non-code domains?

### Current signal requirements

- `SignalContextTag`: `gitSha`, `worktreePath`, `changedHunks`
- `ReferenceDataTag`: glossary, boundary rules, schema conventions
- `SignalCacheTag`: read-through cache
- `compute`: Effect with arbitrary requirements `R`

### Analysis: Does this fit prose?

**Git context**: Writing also lives in git repos (docs, blog posts, marketing copy). ✓

**Reference data**: Replaces "glossary of domain terms" with "brand voice exemplars" or "campaign briefs". Same structure, different content. ✓

**Compute requirements**: Instead of `TsProjectTag` (ts-morph AST), prose signals need:
- Text analysis (tokenization, readability metrics)
- Pattern matching (brand voice consistency)
- Potentially LLM-based semantic analysis (Tier 3)

**Verdict**: The interface generalizes. The *services* provided to `compute` change, not the interface itself.

---

## Draft: 5 candidate writing signals

### 1. WR-LD-01: Vocabulary drift

**Category**: Legibility decay  
**Tier**: 1.5 (depends on reference corpus)  
**Input**: Reference corpus of "on-brand" text files  
**Computation**:
1. Build TF-IDF vectors from reference corpus (brand voice baseline)
2. Compute TF-IDF for target document
3. Measure cosine distance between document and baseline

**Score**: `1 - normalized_distance` (closer to brand voice = higher score)

**Diagnostic**: List of terms with high TF-IDF in document but low in reference (outlier vocabulary)

### 2. WR-LD-02: Structural complexity

**Category**: Legibility decay  
**Tier**: 1  
**Computation**:
- Sentence length distribution
- Paragraph nesting depth (for structured docs like technical specifications)
- Heading-to-content ratio

**Score**: Penalize high variance in sentence length, excessive nesting

### 3. WR-LD-03: Reader effort (Flesch-Kincaid adaptation)

**Category**: Legibility decay  
**Tier**: 1  
**Computation**: Flesch Reading Ease score adapted for technical writing

**Adjustment**: Technical docs get +10 point handicap (acknowledged difficulty)

### 4. WR-SL-01: Clone detection for prose

**Category**: Generated slop  
**Tier**: 1  
**Computation**: Fuzzy matching of sentence/paragraph fingerprints

**Use case**: Detect copy-paste boilerplate in documentation that may be outdated

### 5. WR-AB-01: Abstraction tax

**Category**: Abstraction bloat  
**Tier**: 2 (requires reference definitions)  
**Input**: Glossary of preferred terms  
**Computation**: Count circumlocutions where a glossary term would suffice

Example: "the system that manages user authentication" vs "auth service"

---

## Draft: 3 candidate marketing signals

### 1. MK-AD-01: Positioning consistency

**Category**: Architectural drift (conceptually — "message architecture")  
**Tier**: 2  
**Input**: Positioning statement, target audience definition  
**Computation**: LLM-based comparison of copy against positioning statement

### 2. MK-LD-01: CTA specificity

**Category**: Legibility decay  
**Tier**: 1  
**Computation**: Pattern matching for vague CTAs ("learn more", "click here") vs specific value CTAs ("see pricing", "start free trial")

### 3. MK-SL-01: Emotional register drift

**Category**: Generated slop  
**Tier**: 3 (semantic)  
**Input**: Brand voice emotional guidelines (e.g., "professional but approachable")  
**Computation**: LLM-based sentiment/tone analysis

---

## Prototype: Vocabulary drift signal

Implemented as an illustrative proof-of-concept in `docs/explorations/prototypes/wr-ld-01-vocabulary-drift.ts`.

The prototype uses:
- a small in-file TF / IDF sketch (no production NLP dependency)
- Simple text file discovery (markdown, .txt)
- No git dependency — works on any directory

This is intentionally a design-level exploration artifact, not a production signal implementation. The separate markdown prototype package from TC-062 is a second packaging example, not a validated text-pack runtime.

**Key learning**: The signal interface fits, but the *context tags* need extension. Prose signals need:
- `ProseCorpusTag` (reference documents)
- `TextAnalysisTag` (NLP utilities)

These can live in a new `@skastr0/pulsar-text-pack` package, mirroring `@skastr0/pulsar-ts-pack` structure.

---

## Recommendation: Extend vs. Fork

### Option A: Extend current architecture in-place

Add `@skastr0/pulsar-text-pack` as a peer to TS/Rust packs.

**Pros**:
- Unified codebase
- Shared tooling (bisect, backpressure, scoring engine)
- Registry composability: mix code + text signals in one run

**Cons**:
- Core team becomes bottleneck for text signal maintenance
- Risk of scope creep: "Pulsar" becomes "Pulsar Everything"

### Option B: Separate "Pulsar: Writing" product line

Fork the architecture into a dedicated writing-focused tool.

**Pros**:
- Clear brand positioning
- Can optimize for writing workflows (different CLI, different defaults)

**Cons**:
- Duplication of scoring engine, bisect, backpressure infrastructure
- Harder to maintain consistency across domains

### Recommendation: Option A with domain boundaries

Extend the current architecture, but enforce boundaries:

1. **Pack isolation**: Each domain is its own package (`@skastr0/pulsar-text-pack`, `@skastr0/pulsar-marketing-pack`)
2. **Optional loading**: Like Rust/TS packs, text packs only activate when source evidence detected (markdown files, not .rs/.ts)
3. **Signal ID prefixes**: `WR-*` for writing, `MK-*` for marketing (mirrors `TS-*`, `RS-*`)
4. **Separate governance**: Text/marketing signals can have different maintainers, same core

This keeps the infrastructure unified while allowing domain-specific evolution.

---

## Tooling requirements

| Domain | Current tooling | New tooling needed |
|--------|-----------------|-------------------|
| TypeScript | ts-morph, tree-sitter | — |
| Rust | tree-sitter-rust | — |
| Writing | — | spaCy (Python bridge?), textstat, custom NLP |
| Marketing | — | LLM APIs for semantic analysis |

**Decision**: Defer complex NLP tooling. Start with simple signals (readability metrics, pattern matching) that don't require heavy dependencies.

---

## Proposed follow-up work

### Text-pack scaffold
**Scope**: Create an exploratory `@skastr0/pulsar-text-pack` with minimal WR-LD-01 (vocabulary drift) and WR-LD-03 (Flesch-Kincaid) signals.
**Dependencies**: None.

### Prose context tags
**Scope**: Define `ProseCorpusTag` and `TextAnalysisTag` service interfaces in a text-focused pack (or in core only if reuse pressure appears).
**Dependencies**: Much easier once a text-pack scaffold exists.

### Domain auto-detection refinement
**Scope**: Update `detectPulsarSignals` in runtime to also check for `.md`, `.txt`, and common prose patterns if text packs graduate beyond exploration.
**Dependencies**: Should wait until a text-pack shape is proven worthwhile.

---

## Open questions remaining

1. **Tier 3 (LLM) signals for prose**: How do we ensure reproducibility? LLM-based "on-brand" scoring is inherently non-deterministic. Options:
   - Require temperature=0 + seeded runs
   - Restrict Tier 3 prose signals to advisory only (never hard gate)
   - Accept non-determinism and rely on human review

2. **Reference data for prose**: Brand voice exemplars are less structured than code glossaries. How do we version and validate them?

3. **Normalization across domains**: Is a "good" score in writing (0.8) comparable to a "good" score in code (0.8)? Or are domains incomparable?

---

## Summary

| Question | Finding |
|----------|---------|
| Interface fit? | Yes — same `Signal` interface, different service tags |
| Tooling ready? | Partial — simple metrics work, NLP deferred |
| Approach | Extend architecture, add domain-specific packs |
| Priority | After code-domain validation (TC-019) |

None of the prototype artifacts in this document should be read as production-ready text-pack code. They exist to test whether the current signal contract bends cleanly into prose domains.
