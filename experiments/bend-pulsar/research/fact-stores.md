# Fact stores and incremental analysis: what to copy for Pulsar Bend

Read from papers, specs, docs and design posts only. No implementation source was read. **(est.)** marks my estimates and inferences. Everything else carries its URL.

## What each system teaches

**CodeQL.**
- An extractor emits relational tuples (TRAP) conforming to a per-language `.dbscheme`. The CLI imports them into a database. (https://codeql.github.com/docs/codeql-overview/codeql-glossary)
- The `@` entity classes come from the extractor. (https://github.com/github/codeql/discussions/21739, community thread) Ids are database-local, not cross-commit stable **(est.)**.
- QL compiles to Datalog, evaluates bottom-up in layers, and rejects unbound (infinite) relations. (https://codeql.github.com/docs/ql-language-reference/evaluation-of-ql-programs)
- The QL paper writes package cycles as reflexive-transitive closure, picks the minimum name as representative, and says naive evaluation makes most queries intractable. (https://codeql.github.com/publications/ql-for-source-code-analysis.pdf)
- Per-commit reuse is overlay: a base database plus a `path -> git OID` map, a PR database for changed files only, and the CLI version in the cache key. (https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line/incremental-analysis)
- Measured gain: 4 to 70%. (https://github.blog/changelog/2026-03-24-faster-incremental-analysis-with-codeql-in-pull-requests/)
- GitHub's research prototype on VIATRA gave seconds per update, linear in commit size. It needed over an hour for the first run and tens of GB for projects under 10 KLoC. (https://githubnext.com/projects/incremental-codeql)
- TRAP caching used about 100 MB per run and exhausted one monorepo's cache in about a day. (https://github.com/github/codeql-action/issues/2030)

**Glean.**
- Typed predicates. Facts are unique, with a 64-bit fact ID and a key. A key-value predicate allows one value per key. (https://glean.software/docs/schema/basic/)
- Design advice: separate facts suit incrementality. Arrays are compact but force an order, and a non-deterministic order causes spurious diffs. (https://glean.software/docs/schema/design)
- Derived predicates are stored or on demand (like views). Versioned predicates plus derived back-compat predicates handle schema change. (https://glean.software/docs/derived)
- Incrementality (https://glean.software/docs/implementation/incrementality/):
  - Each fact has an owner, a "unit", usually a file or module.
  - Ownership propagates along references, so hiding a unit never leaves a dangling reference.
  - A derived fact's owner is the conjunction of its inputs' owners.
  - Facts outnumber ownership sets 10 to 100x, but only with coarse units.
  - Known gap: incremental re-derivation on stacked databases was unimplemented.
- Ownership adds about 7% to database size and 2 to 3% to indexing. Queries on a stack cost under 10% for typical ones, up to 3x for heavy ones. (https://glean.software/blog/incremental/)
- The goal is O(changes), but in practice O(fanout), e.g. C++ header dependents found by a query. (https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing)

**Doop, Soufflé, Flix.**
- Doop: a full points-to analysis in about 180 rules plus about 1,000 lines of relation declarations, up to 15x faster than Paddle. (http://martin.bravenboer.name/docs/oopsla09.pdf)
- Soufflé synthesizes specialized C++ and keeps relations in memory. (https://souffle-lang.github.io/pdf/cc.pdf) On its transitive-closure example, naive C++ took 2.0 s and 91 MB. The trie variant took 0.38 s and 3.5 MB. On an OpenJDK points-to run it went from about 850 s and 17 GB to under a minute. Data-structure choice dominated.
- Full provenance (proof trees) costs about 1.27x time and 1.45x memory. (https://souffle-lang.github.io/pdf/provenance-tr.pdf)
- Incremental Soufflé is elastic: recomputation can beat incrementalization for large updates. The code is not in main. (https://souffle-lang.github.io/ppdp21.html)
- Flix: Datalog constraints are first-class, composable values in a typed host language, with row-polymorphic predicate types. Stratified negation trades modularity against type complexity. (http://plg2.cs.uwaterloo.ca/~olhotak/pubs/oopsla20c.pdf) This is the closest model for "detector = function from facts to facts".

**Salsa, Adapton, differential dataflow, DDlog.**
- Salsa's red-green algorithm uses revisions, backdating (equal output means downstream is not re-run), and durability tiers. (https://salsa-rs.github.io/salsa/reference/algorithm.html)
- Early cutoff only works if volatile details such as positions stay out of derived values. With durability, a user edit skipped a 300 ms recheck of std. (https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)
- rust-analyzer's `ItemTree` is a summary that is stable over function-body edits. (https://rust-analyzer.github.io/book/contributing/architecture.html)
- Salsa identity fields are separate from tracked (mutable) fields. (https://salsa-rs.github.io/salsa/overview.html)
- A tracked-struct id is a 32-bit intern of query, hash of the identity fields, and a per-query counter disambiguator. (https://salsa-rs.github.io/salsa/plumbing/tracked_structs.html)
- Salsa has no garbage collection of old queries; LRU is the only bound. (https://salsa-rs.github.io/salsa/tuning.html)
- A user reported rust-analyzer memory going from 5 to 6 GB to 22 to 30 GB after the Salsa port. (https://github.com/rust-lang/rust-analyzer/issues/19402, one report)
- Adapton: on batch edits it got about half an eager baseline's speedup at 103 to 120% of its memory. (http://matthewhammer.org/adapton/adapton-pldi2014.pdf)
- Differential dataflow shares indexes ("arrangements"). (https://timelydataflow.github.io/differential-dataflow/chapter_5/chapter_5.html) Sharing cut memory 2 to 3x; a Graspan reimplementation was 24 to 650x faster but peaked near 30 GB. (https://www.vldb.org/pvldb/vol13/p1793-mcsherry.pdf)
- DDlog keeps everything in one machine's memory, with temporal indexes. (https://ceur-ws.org/Vol-2368/paper6.pdf) The repository is archived. (https://github.com/vmware-archive/differential-datalog)

## 1. Recommended v0 fact schema

All relations are fixed-arity tuples of U32. Strings are interned once per store into one byte blob plus an offset array, so no 16-byte-per-character lists exist at rest. Soufflé's 26x layout gap (above) is the evidence that layout dominates. Tuples are sorted by key, so output is canonical.

Base facts, emitted per file by the parser and containing only same-file references:

| Relation | Columns |
|---|---|
| `File` | path, blob OID |
| `Module` | file (1:1 in TS) |
| `Import` | file, ord, specifier, kind (static, dynamic, reexport, side-effect), type-only, span |
| `ImportBinding` | import, imported name, local name |
| `Export` | module, name, kind, type-only; symbol or `(from-spec, from-name)` for re-exports |
| `Symbol` | module, container, name, kind, ordinal |
| `Func` | symbol, span, measured metrics |
| `Touch` | commit, file (later) |

Derived facts, with rule id and provenance:

| Relation | Source |
|---|---|
| `Resolves(import, module or unresolved)` | `Import`, the file-path set and tsconfig facts |
| `Edge(module, module)` | `Resolves` |
| `Scc` | `Edge`, a built-in kernel |
| `Used(module, name)` | `ImportBinding`, `Resolves` |
| Findings | the detectors below |

- Cycle reads `Scc`. Boundary reads `Edge` plus repo policy. Coupling reads `Edge` and `Import`. Unused-export reads `Export` minus `Used`. None needs body facts, so `Func` lives in a separate volatile tier.
- Keep Glean's split: small stored facts, derived joins, no embedded arrays unless order matters.
- Provenance has two levels **(est., modelled on Glean ownership and Soufflé's overhead)**:
  - Every derived fact carries a coarse owner set of file units, which also drives invalidation.
  - Findings carry `rule id + input fact keys`, replayed on demand rather than stored for every intermediate fact.

## 2. Stable identity

- **Physical id:** dense U32 per store. It is never persisted across shas or exposed. Glean and Salsa both use database-local ids.
- **Logical key:** a hash of structured, content-free fields, as Glean does by making facts unique by key. Symbol key is `(module path, container chain, name, kind, ordinal among identical siblings)`. Module key is the repo-relative path.
- **Spans, line numbers and metrics are values, never key parts.** This is Salsa's identity versus tracked fields and matklad's rule on positions. An edit that shifts lines changes values only.
- **Finding id:** `hash(detector id, detector version, sorted subject keys)`. For a cycle, the subject is the SCC representative, the minimum member key (the QL paper's choice), plus size. Membership change then reads as an add plus a remove, and a later matching pass by member overlap can reconcile it **(est.)**.
- Renames show as remove plus add. Feed `git diff -M` renames in as a delta-side fact, never as identity **(est.)**.

## 3. Cheap per-sha delta

1. **Cache base facts per blob, not per sha.** The key is `(blob OID, adapter version, schema version)`. CodeQL overlay keys files by git OID (source above), and Glean units are files. A sha's store is a manifest of `path -> blob` plus derived layers. Two levels only.
2. **Derive in two tiers.** Interface facts (File, Import, Export, ImportBinding) feed the graph detectors. Body facts are the second tier. The tier digest is the early-cutoff shield (Salsa backdating, durability). A body-only edit touches no graph detector, and an unchanged import list stops propagation **(est. mapping)**.
3. **Fanout is two cases.** Content changes in a file affect its own facts. Added or removed paths and config files affect `Resolves` for any import whose candidate list includes them. Index imports by candidate path. Glean computes fanout the same way, by querying (engineering blog above).
4. **Recompute the global derived layer from the edge list; do not build an incremental evaluator in v0.** Soufflé's elastic paper says recompute can win. The CodeQL prototype above shows a general incremental engine costing hours and tens of GB, against a 234 MB budget. The prototype does a whole 33 MB repo in about 0.6 s (task brief), so a graph pass over edges should be a small fraction **(est.)**.
5. **Delta = merge-join of two sorted finding-key arrays.** Output is added and removed, linear in findings. Skip any detector whose input-slice digest is unchanged.

## 4. Pitfalls

- **Positions or ordinals leaking into keys or derived values.** This kills early cutoff (Salsa blog above).
- **Fine ownership units.** Per-function units blow up ownership sets (Glean doc above).
- **Deep stacks.** Glean's derived-fact fixup for stacked databases was unimplemented. Keep two levels.
- **Dangling cross-file references.** Base facts reference only same-file ids plus interned names. Cross-file links are derived.
- **Unbounded caches with no GC.** Salsa has none, the TRAP cache churned, and one rust-analyzer report quadrupled memory. Give the store a retention and eviction policy from day one, and measure per-sha store bytes in CI **(est.)**.
- **A general incremental or Datalog engine too early.** DDlog is in-memory with temporal indexes and is archived. VIATRA ran at tens of GB. Soufflé's own incrementalization never merged.
- **Full provenance everywhere.** About 1.45x memory (Soufflé paper above).
- **Negation without strata.** "Unused" is a set difference. Flix shows stratification is the hard part, so keep the detector DAG acyclic in v0. Recursion lives only in built-in kernels such as SCC.
- **Schema drift.** Version relations and add derived back-compat views, as Glean does. Include schema and adapter versions in cache keys, as CodeQL does with its CLI version.
