# Rust-specific complexity metric exploration

**Status**: Exploratory — Open Question Q3, work item TC-064  
**Date**: 2026-04-19  
**Scope**: Research and prototype borrow-checker-aware complexity metrics

---

## Context

Standard cognitive complexity metrics undercount borrow-checker complexity. A function with low cyclomatic complexity can still be cognitively expensive due to:
- Lifetime annotation juggling
- Ownership transfer chains
- `&mut` reborrowing cascades
- Trait bound complexity

RS-LD-05 (standard cyclomatic) currently defaults to standard complexity. This exploration asks: Is there a Rust-specific extension warranted?

---

## What does "borrow-checker complexity" feel like?

### Example 1: Lifetime juggling

```rust
fn merge_refs<'a, 'b, T>(
    a: &'a T,
    b: &'b T,
) -> &'a T
where
    'b: 'a,  // 'b outlives 'a
    T: Clone,
{
    if a.clone() > b.clone() { a } else { b }
}
```

Cyclomatic complexity: 2 (one if/else)
Cognitive load: Understanding lifetime constraints across two input references and the where-clause bound.

### Example 2: Ownership refactor cascade

Changing a parameter from `&T` to `&mut T` often requires changing:
- The caller (now needs mutable access)
- The caller's caller (chain up 3-5 levels)
- All sibling calls that shared the same borrow

Cyclomatic complexity: Unchanged (no new branches)
Cognitive load: Understanding the borrow graph across multiple functions.

### Example 3: Complex trait bounds

```rust
fn process<T, E>(
    items: Vec<T>,
) -> Result<Vec<T::Output>, E>
where
    T: Iterator + Clone,
    T::Item: Serialize + DeserializeOwned,
    E: From<T::Error> + Debug,
{
    // ...
}
```

Cyclomatic complexity: Depends on body
Cognitive load: Understanding where-clause composition, associated types, and trait inheritance.

---

## Literature review

### Rust Foundation surveys (2022-2024)

Key findings relevant to complexity:
- "Understanding ownership and borrowing" remains the #1 learning obstacle for new Rust developers
- Lifetime elision is understood as a complexity reducer — when it works, comprehension is faster
- When lifetimes must be explicit, code review time increases ~40% (anecdotal, from RustConf talks)

### Academic papers

**"Ownership Types for Safe Region-Based Memory Management" (Grossman et al., 2002)**  
Theoretical foundation for ownership. Doesn't address complexity measurement.

**"RustBelt: Securing the Foundations of the Rust Programming Language" (Jung et al., 2017)**  
Formal semantics for unsafe Rust. Relevant for understanding *why* lifetimes matter, not for quantifying complexity.

**"Cognitive Dimensions of Notations" (Green & Petre, 1996)**  
Framework for evaluating cognitive load of programming constructs. Applicable but not Rust-specific.

**Conclusion**: No existing research directly addresses "borrow-checker complexity" as a measurable quantity. This is potentially novel work.

---

## Measurable proxies

Candidate metrics that correlate with borrow-checker cognitive load:

| Proxy | Measurement | Hypothesis |
|-------|-------------|------------|
| Lifetime annotation count | `<'a>` appearances in signature + body | More annotations = more tracking required |
| `&mut` reborrowing depth | Max nesting of `&mut` expressions | Deeper = harder to track exclusive access |
| `move` closure count | `move \|...\|` occurrences | Moves complicate ownership transfer |
| Trait bound clause count | Number of distinct bounds in `where` clauses | More bounds = more implicit constraints to remember |
| Lifetime constraint complexity | Count of `'a: 'b` outlives relationships | Directly measures lifetime reasoning |
| Reference parameter ratio | `(count of &T + &mut T) / total params` | Higher ratio = more borrow tracking |

---

## Hand-labeled corpus methodology

To validate which proxy best predicts "actual difficulty," we need human labels.

### Corpus construction

Target: 20-30 Rust functions from real codebases with variety in:
- Size (10 lines to 100 lines)
- Complexity (obvious to subtle)
- Domain (systems, web, embedded)

**Sources**:
- tokio-rs/tokio (async runtime, heavy lifetime usage)
- rust-lang/rust (compiler, complex trait bounds)
- hyperium/hyper (HTTP, ownership chains)
- selectel/rust-borrow-complexity-examples (created for this exploration)

### Labeling protocol

Ask experienced Rust developers: "On a scale of 1-5, how hard would this be to understand for a mid-level Rust programmer?"

Definitions:
- 1: Trivial — obvious at a glance
- 2: Easy — single concept to track
- 3: Moderate — 2-3 interacting concepts
- 4: Hard — requires careful tracing
- 5: Very hard — likely needs diagramming

### Current corpus status

*Exploratory only — not yet implemented*

Proposed entries:

```rust
// Entry 1: Simple (label 1)
fn add(a: i32, b: i32) -> i32 { a + b }

// Entry 2: Moderate (label 3)
fn find<'a>(haystack: &'a str, needle: &str) -> Option<&'a str> {
    haystack.find(needle).map(|i| &haystack[i..i+needle.len()])
}

// Entry 3: Hard (label 4)
fn parse_and_transform<'a, 'b, T>(
    input: &'a str,
    buffer: &'b mut String,
    transformer: impl Fn(&'a str) -> T,
) -> Result<T, ParseError>
where
    'a: 'b,
    T: Serialize,
{
    // ... complex body with multiple borrows
}
```

**Status**: Corpus not yet collected. This requires human labeling effort (2-3 hours per experienced Rust developer).

---

## Prototype metrics implementation

```typescript
// illustrative extension sketch — not committed to packages/codec-rs-pack

interface BorrowComplexityMetrics {
  readonly lifetimeAnnotationCount: number
  readonly mutReborrowDepth: number
  readonly moveClosureCount: number
  readonly traitBoundClauseCount: number
  readonly lifetimeConstraintCount: number
  readonly referenceParamRatio: number
}

function computeBorrowMetrics(fn: RustFunction): BorrowComplexityMetrics {
  return {
    lifetimeAnnotationCount: countLifetimeAnnotations(fn),
    mutReborrowDepth: computeMaxMutReborrowDepth(fn),
    moveClosureCount: countMoveClosures(fn),
    traitBoundClauseCount: fn.whereClauses.length,
    lifetimeConstraintCount: countLifetimeConstraints(fn.whereClauses),
    referenceParamRatio: computeReferenceRatio(fn.params),
  }
}

// Hypothetical combined metric
function borrowAdjustedCyclomatic(
  cyclomatic: number,
  metrics: BorrowComplexityMetrics,
): number {
  const borrowPenalty = 
    metrics.lifetimeAnnotationCount * 0.5 +
    metrics.mutReborrowDepth * 1.0 +
    metrics.moveClosureCount * 0.3 +
    metrics.traitBoundClauseCount * 0.4

  return cyclomatic + borrowPenalty
}
```

**Status**: This is an exploratory code sketch only. It is not committed production code, and it is not validated against a labeled corpus.

---

## Correlation analysis plan

Once the labeled corpus exists:

1. **Compute candidate metrics** on each function
2. **Calculate correlation** (Pearson r) between each metric and human difficulty labels
3. **Regression analysis**: Which combination best predicts labels?
4. **Cross-validation**: Does the metric generalize to held-out functions?

Hypothesis: A linear combination of `cyclomatic + 0.5*lifetime_annotations + 1.0*mut_depth` will outperform cyclomatic alone.

---

## Interim recommendation

**Do not replace RS-LD-05's standard cyclomatic yet.**

The borrow-checker complexity metric is promising but requires:
1. Labeled corpus collection (human effort)
2. Correlation validation (statistical analysis)
3. Community review (is this metric useful in practice?)

**Proposed path**:

1. **Phase 8**: Ship RS-LD-05 with standard cyclomatic (current behavior)
2. **Phase 9**: Add optional "borrow-aware" mode to RS-LD-05 via config flag
3. **Phase 10**: If validation succeeds, make borrow-aware the default

This keeps the architecture flexible without committing to an unproven metric.

---

## Metric proposal (draft)

```typescript
// Extends RsLd05Config
export const RsLd05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
  // New optional field
  complexity_mode: Schema.Literal("standard-cyclomatic", "borrow-aware").pipe(
    Schema.optionalWith({ default: () => "standard-cyclomatic" })
  ),
})
```

The `borrow-aware` mode would:
1. Compute standard cyclomatic
2. Add borrow-complexity penalties
3. Report both raw and adjusted scores in diagnostics

---

## Proposed follow-up work

### Rust complexity corpus labeling
**Scope**: Collect 20-30 Rust functions with human difficulty labels from 3+ experienced Rust developers.
**Dependencies**: None — requires human effort.

### Borrow-complexity metric implementation
**Scope**: Implement metric computation (lifetime annotations, mut depth, etc.) in tree-sitter Rust traversal.
**Dependencies**: Best done after the corpus/labeling plan is real enough to validate against.

### Optional RS-LD-05 borrow-aware mode
**Scope**: Add a `complexity_mode` config and integrate borrow metrics into RS-LD-05 only if the exploratory metric correlates better than standard cyclomatic.
**Dependencies**: The validation step should come first.

---

## Summary

| Question | Finding |
|----------|---------|
| Does borrow-checker complexity exist? | Yes — subjective but real |
| Can we measure it? | Probably — via proxies |
| Is it validated? | Not yet — needs labeled corpus |
| Should we ship now? | No — standard cyclomatic is the conservative default |
| Future path? | Optional borrow-aware mode, validate, then default |

**Confidence**: Medium — the proxies are plausible, but empirical validation is essential before betting the UX on this metric. Nothing in this document should be read as production-ready scoring logic.
