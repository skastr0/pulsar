# Data-access and performance detectors: evidence and build notes

Clean-room: papers, docs and practitioner write-ups only; no implementation source read. Sources are tagged [Sn], listed at the end. "Inference" marks my reasoning, not a source claim.

## Ranking (evidence x fit with cheap facts)

1. Data-access call reachable from a loop (strong)
2. Blocking call in async/event-loop context (strong)
3. Foreign key with no covering index (strong, schema only)
4. Query predicate with no usable index (medium)
5. Static hot-path weighting, a multiplier not a finding (medium)
6. Loop-invariant linear scan (Clarity; strong, Java-only)
7. Unneeded work in loops (medium)
8. Unused retrieved columns, `SELECT *` (medium, noisy)
9. Unbounded fan-out (weak)
10. Wide JSON column, unused tables/columns (weak, taste-laden)

## 1. Query in a loop (N+1, one-by-one processing)

- **Rule.** Chen et al. flag a function called directly inside any loop kind (single or nested) if it accesses the database, and walk the call graph below each in-loop callee for a node that may access it; the call path is the finding [S1].
- **Facts.** Global call graph, database-accessing functions, ORM fetch annotations [S1]. For us: loops, call sites, call graph, plus a table of which calls are queries.
- **Results.** Pet Clinic: 0 one-by-one instances; Broadleaf: hundreds. Fixing detected anti-patterns improved response time by up to 98% [S1]. No precision or recall is reported; validation is by timing the fixes, not by labelling findings [S1].
- **False-positive sources.** The authors drop cases where ORM configuration (e.g. eager fetch) means the call does not hit the database [S1]. Analysis is path-insensitive and counts each loop once, so it ignores trip count [S3]. Static-only data-flow analysis is prone to false positives [S2]. Runtime detectors that flag any repeated query also fire on pagination and polling [S24].
- **Corroboration.** Sonar flags a `Statement` executed in a loop and recommends batching [S23]. Sentry's runtime N+1 rule needs at least five similar sequential spans, over 50ms in total [S22]. Same rule, different "is a query" mapping.
- **Generalises?** Yes. The rule names no technology. The only library-specific input is the query-call table, plus a "this call is a batch or cached read" exemption table (inference, from Chen's configuration exemption).

## 2. Blocking call in async or event-loop code

- **Rule.** A call from a catalogue of blocking operations inside an async function, or in any function transitively reached from one without crossing an offload boundary. Node: never block the event loop, including inside `await` and `then` callbacks, and avoid sync fs, crypto, zlib and child_process APIs on a server [S14]. asyncio: CPU-bound code must not be called directly, and callbacks over 100 ms are logged [S15]. Tokio: a rule of thumb of 10 to 100 microseconds between `.await`s [S16].
- **Catalogue as data is already how tools do it.** flake8-async ships a user-configured rule, ASYNC200, that does nothing until blocking calls are configured, beside built-in ones for HTTP, subprocess, `open`, `sleep` [S12]. JetBrains uses blocking and non-blocking annotation lists and an option to treat unknown contexts as blocking [S13]. BlockHound, the runtime counterpart, keeps a configurable list of blocking JVM methods and a per-thread "blocking allowed" flag [S17].
- **Offload boundaries (also data).** `spawn_blocking` [S16], `run_in_executor` [S15], a bounded-elastic scheduler or `Dispatchers.IO` [S13].
- **Evidence of yield.** PerfChecker (Soot-based, static) targeted lengthy main-thread operations, found 126 instances across 29 Android apps (two patterns combined), 68 confirmed by developers, 20 fixed [S10]. No per-pattern precision is given.
- **False-positive sources.** Blocking depends on arguments or runtime (a cached read, a tiny file); wrappers hide the offload; startup code is legitimately synchronous. Inference: ignore sync calls in module-init paths and mark blocking-ness per callee, not per library.
- **Generalises?** Yes, with per-runtime catalogues and boundaries.

## 3. Foreign key without a covering index

- **Rule.** An FK's column list is not a leading prefix of any index, primary key or unique constraint on the referencing table. Dialect matters. PostgreSQL does not create it: a delete or update on the referenced side needs a scan of the referencing table, and the docs say indexing is "often a good idea" [S18]. MySQL creates it automatically when missing [S19].
- **Facts.** Tables, columns, FKs, indexes. Nothing else.
- **Evidence.** Linting 6,008 public schemas: 45.1% of 73,520 checkable FKs lacked an index, with large differences by tool and ORM default [S20]. This is a vendor study; its first version overcounted (48.0%) because the parser missed some index syntaxes [S20]. Treat the figure as indicative, and treat missed index declarations as the main false-positive source. SQLCheck measured 142x faster updates after adding such an index in one case [S4]. pg-index-health lists the check as static [S21].
- **Other FPs (inference).** Tiny or write-only tables; indexes created outside migrations; partial or expression indexes.
- **Generalises?** Yes, with a dialect switch. It is the cheapest detector here.

## 4. Query that cannot use an index (scan risk)

- **Rule.** SQLCheck's Index Underuse and Nagy's schema-aware smells apply the schema as context to a query. Intra-query rules alone give low precision and recall; adding cross-query and schema context removes false positives [S4]. Nagy reports a certainty level per finding from schema facts (nullability, constraints) [S5].
- **Results.** SQLCheck covers 26 anti-patterns against 11 for dbdeo, with 48% fewer false positives and 20% fewer false negatives, measured on a manually checked subset of anti-patterns; Index Underuse was not in that subset [S4]. Its catalogue is rooted in Karwin's book [S27][S4].
- **Needs more than we have.** SQLCheck also profiles table data [S4]; we cannot, so precision will be lower. Selectivity and table size are unknown.
- **FP sources (inference).** Small tables, low-selectivity columns, composite-index prefixes, function-wrapped columns, leading-wildcard `LIKE`.
- **Use.** Report only with detector 1 or 5 (the query is hot); otherwise low severity.
- **Generalises?** Yes, once SQL text is extracted; dialect parsing is the cost. SQLCheck relies on a non-validating parser for dialect coverage [S4].

## 5. Hot path without profiling

- **Evidence.** Buse and Weimer estimate path frequency from source-level features. The model is over 90% accurate on benchmarks, and the top 5% of paths it selects account for over half of runtime [S11].
- **Use as a weight.** Findings in nested loops, or reachable from request handlers, rank higher. Jin's rules treat "f1 inside a loop" as statically checkable [S6]; CADO separates in-loop queries because they "may be repeatedly issued" [S3].
- **Limits.** Trip counts are unknowable statically, so use depth, not counts, and say so (inference).

## 6. Redundant traversal (Clarity)

- **Rule.** A loop traverses a data structure, and a loop-invariant lookup such as `contains` on a list performs a linear scan in each iteration [S7].
- **Results.** Across 1.6M lines of Java: 92 bugs, 72 new, 5 false positives; repaired programs were at least 2.45x faster at 50,000 inputs [S7].
- **Fit.** Needs types and a per-operation cost table (data). Generalises, but evaluated on Java only.

## 7. Unneeded work in loops

- Jin et al. extracted efficiency rules from 25 patches into 25 static checkers (14 LLVM, 11 Python). They found 332 previously unknown problems; 219 came from rules taken from a different application; 14 were confirmed and fixed [S6]. The LLVM checkers use intra-procedural data flow, which "may lead to false positives and negatives" [S6]. This supports rules-as-data.
- Caramel finds loops that keep running after a condition makes the rest wasted work. It found 61 new bugs in Java and 89 in C/C++, of which 51 and 65 were fixed [S8].
- Toddler is dynamic (instrumented loops, repeated memory-access patterns; 42 new bugs) and so outside our static-facts model [S9].

## 8. Unused retrieved data

- CADO statically found 63.4% of retrieved columns unused and 32.2% of eager joins unused across 27 Rails apps [S3]. Chen's excessive-data rule needs points-to and data flow on entity objects [S1]. Muse et al. found SQL smells such as Implicit Columns prevalent but only weakly associated with bugs [S28]. So `SELECT *` should be a low-severity hygiene finding, not a performance one. Needs ORM mapping data; costly.
- HBSniff detects 14 Hibernate smells without compiling; its validation covers six projects, so evidence is thin [S25].

## 9. Unbounded fan-out

- Only a practitioner write-up: mapping a large list to concurrent DB calls under `Promise.all` can overwhelm the system [S29]. I found no detector or precision data.
- Candidate rule (inference): an async spawn or `Promise.all`-style construct over a collection of unbounded size, containing a data-access or I/O call, with no limiter in scope. Limiter names are data. Ship as low confidence.

## 10. Schema design

- **Unused tables/columns.** Needs ORM mapping to code usage; pg-index-health marks unused indexes runtime-only [S21]. Not a static-core candidate.
- **Wide JSON column.** The evidence is opinion: a PostgreSQL practitioner calls JSON "the new EAV" and says it should not be the first choice [S26]; EAV is a Karwin entry [S27]; SQLCheck lists Data in Metadata and God Table [S4]. No precision data for a JSON rule. By the product rule this is taste: expose it as repo or framework calibration, not core.

## Recommendation (inference)

Build 1, 3 and 2 first: each is statable without naming a technology and needs only extracted facts plus data tables (query calls, blocking calls, offload wrappers, dialect). Then 5 as a ranking multiplier, 4 gated on hotness, 6 where types exist. 8 to 10 are hard to ground.

## Sources

S1 https://sailresearch.github.io/sail-website/data/pdfs/ICSE2014_DetectingPerformanceAnti-patternsForApplicationsDevelopedUsingObject-RelationalMapping.pdf
S2 https://petertsehsun.github.io/papers/peter_tse2016.pdf
S3 https://arxiv.org/abs/1607.02561
S4 https://arxiv.org/abs/2004.10232
S5 https://csnagy.github.io/research/pdfs/2017/Nagy-SCAM2017.pdf
S6 http://people.cs.uchicago.edu/~shanlu/preprint/pldi118-jin.pdf
S7 https://cs.utexas.edu/~lin/papers/pldi15.pdf
S8 http://cosmin.radoi.net/papers/caramel-icse15.pdf
S9 http://people.cs.uchicago.edu/~shanlu/preprint/icse13-preprint.pdf
S10 https://yepangliu.github.io/files/ICSE2014.pdf
S11 https://web.eecs.umich.edu/~weimerw/p/weimer-icse2009-path.pdf
S12 https://flake8-async.readthedocs.io/en/stable/rules.html
S13 https://jetbrains.com/help/inspectopedia/BlockingMethodInNonBlockingContext.html
S14 https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop
S15 https://docs.python.org/3/library/asyncio-dev.html
S16 https://ryhl.io/blog/async-what-is-blocking
S17 https://github.com/reactor/BlockHound/blob/master/docs/how_it_works.md
S18 https://www.postgresql.org/docs/current/ddl-constraints.html
S19 https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html
S20 https://blog.mcdview.dev/en/we-linted-6000-real-database-schemas
S21 https://github.com/mfvanek/pg-index-health/blob/master/doc/available_checks.md
S22 https://docs.sentry.io/product/issues/issue-details/performance-issues/n-one-queries
S23 https://rules.sonarsource.com/java/rspec-6912
S24 https://conf.researchr.org/details/splash-issta-2026/splash-issta-2026-posters-and-tool-demonstrations/6/Query-Analyzer-Framework-Agnostic-Confidence-Based-N-1-Detection-for-the-JVM
S25 https://hbsniff.github.io/paper.pdf
S26 https://www.enterprisedb.com/blog/postgresql-anti-patterns-unnecessary-jsonhstore-dynamic-columns
S27 http://media.pragprog.com/titles/bksqla/toc.pdf
S28 https://arxiv.org/abs/2201.02215
S29 https://www.mattburke.dev/promise-all-is-too-much-of-a-good-thing/
