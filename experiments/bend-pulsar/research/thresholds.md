# Thresholds: evidence and recommended defaults

Clean-room: papers, official docs and tool documentation only. Companion to `composite-signals.md` (which ranks the signals themselves); this note fixes the numbers the engine rules carry. For every threshold: the value in use, what supports it, and how strong that support is. Where evidence is weak the detector should ship opt-in or as an informational finding, per `PRODUCT.md` guardrails.

Direction convention below: "flag > N" means a finding fires when the metric is strictly greater than N; N is the largest acceptable value.

## Cyclomatic complexity (CC = 1 + decisions)

**In use:**
- 10 — McCabe's own operational bound. In "A Complexity Measure" (TSE 1976) he reports an operational environment where "the particular upper bound that has been used for cyclomatic complexity is 10 which seems like a reasonable, but not magical, upper limit"; exceeding it required modularizing or redoing the module, with large `case`/`switch` statements excepted ([McCabe 1976 PDF](https://ccy05327.github.io/SDD/08-PDF/A%20Complexity%20Measure.pdf), [summary](http://literateprogramming.com/mccabe.pdf)). No empirical derivation — it is practice, not a fitted value.
- 10 — SonarQube/ sonar rule S1541 "Methods should not be too complex" ships default threshold 10 ([StackOverflow/Sonar docs](https://stackoverflow.com/questions/55227125/how-to-set-a-custom-complexity-limits-for-sonar-in-java), [EngiDock](https://www.engidock.com/course/sonarqube/03-quality-profiles-rules-engidock)).
- 20 — ESLint `complexity` rule default `max: 20` ([ESLint docs](https://eslint.org/docs/latest/rules/complexity)).
- 15 — Lizard default; OCLint 10 ([Feabhas](https://blog.feabhas.com/2018/07/code-quality-cyclomatic-complexity/)).
- Grades — radon: A 1–5, B 6–10, C 11–20, D 21–30, E 31–40, F 41+ ([radon docs](https://radon.readthedocs.io/en/stable/api.html)).

**What supports a defect link:**
- An NPS thesis on 8 programs (1,200–2,400 LOC each): modules with v(G) > 10 were 9% of modules but held 47% of errors — but LOC alone predicted faults equally well and no stronger CC–fault relationship was shown ([hdl.handle.net/10945/30720](http://hdl.handle.net/10945/30720)).
- Hassan 2009 (cited in `composite-signals.md`): CC largely tracks LOC.
- Polito ITSE study, 27,734 modules / 38 projects: no strong linear CC–defect correlation; Avg CC is an "effective indicator" only in medium/large projects via cluster analysis ([PDF](https://iris.polito.it/retrieve/e384c42e-1939-d4b2-e053-9f05fe0a1d67/ITSE%20%28Complexity%20metrics%20significance%20for%20defects%20An%20empirical%20view%29%20camera%20ready.pdf)).
- Controlled experiment, 54 subjects / 51 C programs: all program metrics together explain only 27.6% of defect-rate variability ([scialert](https://scialert.net/fulltext/?doi=jse.2013.114.120)).
- Kent repository study: CC "appears to have little if any utility as a predictor of defect over and above that contained in a count of the executable lines of code" ([PDF](https://kar.kent.ac.uk/24040/1/DefectHopkins.pdf)).

**Verdict:** the "10" is the canonical default (McCabe + SonarQube + radon B/C boundary all agree); the defect evidence behind any fixed CC threshold is weak because CC is confounded with size. **Recommended default: flag CC > 10.** Ship as core — the finding reports the number and a peer can check it — but treat the threshold itself as policy-overridable (`.pulsar/policy.toml`), which it already is by design.

## Nesting depth

**In use:**
- 3 — SonarQube javascript/TS rule S134 "Control flow statements should not be nested too deeply" default `maximumNestingLevel: 3` ([rule parameters](https://github.com/nielspeter/sonarlint-mcp-server/blob/main/docs/configurable-rules.md)).
- ≤3 OK / 4–5 review / 6+ refactor — Skylos SKY-Q302 ([docs](https://docs.skylos.dev/code-quality)); go_brrr: Good 1–3, Severe 8+ ([docs.rs](https://docs.rs/go-brrr/latest/src/go_brrr/metrics/nesting.rs.html)).
- 4 — Elvis `no_deep_nesting` default `level: 4` (was 3 until 1.0.0) ([docs](https://elvis-core.hexdocs.pm/no_deep_nesting.html)).
- Practice guides converge on "3 comfortable, 4 warning, 5+ restructure" ([Katabench](https://katabench.com/blog/measuring-code-quality), [Coderbuds](https://coderbuds.com/blog/understanding-code-complexity-practical-guide)).

**What supports it:** thin. Neil 1990 is cited as finding nesting depth "one of the most important dimensions that account for defect variability" ([scialert](https://scialert.net/fulltext/?doi=jse.2013.114.120)), but the Kent study found max nested-`if` depth *anti*-correlated with defects (significant at 1%), possibly because deeply nested code gets more care ([Kent PDF](https://kar.kent.ac.uk/24040/1/DefectHopkins.pdf)). SonarSource's answer to nesting is not a depth threshold at all: Cognitive Complexity adds +1 per nesting level inside a structure ([S3776 community post by G. Ann Campbell](https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103)).

**Verdict:** convention is max depth 3–4; evidence is anecdotal both ways. **Recommended default: flag nesting depth > 3** (S134's default; stricter than a 4). If composites prefers the placeholder >4, that is also defensible — the difference is one level. Report depth in the finding so the threshold is auditable.

## NPath (Nejmeh 1988)

**In use:**
- 200 — Nejmeh's CACM paper: "An NPATH threshold value of 200 has been established for a function. The value 200 is based on studies done at AT&T Bell Laboratories"; exceeding functions were candidates for redesign. Explicitly an informal design criterion ([CACM 1988](https://doi.org/10.1145/42372.42379), [PDF](https://dl.acm.org/doi/pdf/10.1145/42372.42379)).
- 200 — Checkstyle `NPathComplexity` default `max: 200`, docs repeat "informal NPATH limit of 200" and warn "do not be fanatic with limit 200" ([Checkstyle docs](https://checkstyle.org/checks/metrics/npathcomplexity.html)).
- 80 — HIS-SCM-2008, the software metrics standard of the Audi/BMW/Daimler/Porsche/VW working group, recommends NPath ≤ 80 — a stricter industrial bound ([ACPATH paper, arXiv 1610.07914](https://ar5iv.labs.arxiv.org/html/1610.07914)).

**Semantics caveat (load-bearing):** Nejmeh's NPATH is *not* the number of acyclic paths — the ACPATH paper shows it is neither a lower nor an upper bound even on trivial programs, and it can undercount vs. the true path count (example: NPATH=6 where 8 paths exist). If the engine computes "the number of acyclic paths" literally it will not reproduce the 200-calibrated metric; the rule must state which recurrence it implements ([ACPATH](https://ar5iv.labs.arxiv.org/html/1610.07914)).

**Later evidence:** essentially none for the threshold itself. arXiv 1912.01142 found path complexity correlates with complex real-world bugs better than CC or NPATH, but "not strong", and nothing for simple bugs ([arXiv](https://arxiv.org/abs/1912.01142)). No study links NPath > 200 to defects.

**Verdict:** 200 is the canonical value and matches the dominant tool default; the HIS 80 shows stricter is enforceable in industry. **Recommended default: flag NPath > 200**, policy-overridable; mark the detector's evidence as "metric defined, threshold unvalidated" — the weakest of the syntax set alongside CRAP.

## Function length (non-blank lines)

**In use:** practice guides suggest 30-line target / 50–60+ warning ([Coderbuds](https://coderbuds.com/blog/understanding-code-complexity-practical-guide)); SonarQube S138 caps at 200 lines/file-level function rule; ESLint `max-lines-per-function` commonly 50–100.

**What supports it:** LOC is the most replicated defect correlate in the literature (every study above uses it as the baseline CC fails to beat). A length threshold is therefore evidence-adjacent rather than evidence-backed: it flags the size proxy that everything else is confounded with.

**Verdict:** **flag length > 60 non-blank lines** is a reasonable, conservative default — high enough to avoid noise on idiomatic TS/React code, low enough to catch genuine outliers. Evidence weak; report `loc` in the finding (FACTS.md `FN loc` already carries it).

## CRAP (Savoia & Evans 2007)

**Formula:** `CRAP(m) = comp(m)² × (1 − cov(m))³ + comp(m)`, coverage as a fraction. FACTS.md fixes the integer form `c² × (coverable − covered)³ / coverable³ + c` — algebraically the same when coverage is line-based.

**The threshold:** 30, and it was always provisional. The authors: "the actual numerical values used in its calculation and interpretation should only be considered a starting point which we plan to refine" ([crap4j announcement](https://www.artima.com/weblogs/viewpost.jsp?thread=215899)). Their coverage table: CC 10 needs 42% coverage, CC 20 needs 71%, CC 30 needs 100%, CC 31+ can never score under 30 ([same source](https://www.artima.com/weblogs/viewpost.jsp?thread=215899)).

**Defect evidence: none found.** "Nineteen years of CRAP" (phpunit.expert, 2026): "to this day I am not aware of a single peer-reviewed empirical study that validates the CRAP index: nothing that correlates CRAP scores with actual defects or with maintenance effort, nothing that justifies the exponents in the formula or the threshold of 30"; crap4j was abandoned and the formula is unchanged since 2007 ([article](https://phpunit.expert/articles/nineteen-years-of-crap.html)). The ingredients are individually weakly evidenced (CC≈LOC; coverage correlates only weakly with fault detection). One longitudinal study (201 projects, 17 languages, Coveralls/Codecov) reports a *moderate correlation between CRAP and patch coverage* — circular, since coverage is an input, and not defect evidence ([Wits thesis](https://wiredspace.wits.ac.za/items/4264ef21-704b-41ee-9813-cb3816cfbe24)).

**Verdict:** **threshold 30** (the only published value; FACTS.md already assumes it). **This is the strongest candidate to ship opt-in**: the composite formula has never been validated against defects, and its inputs degrade differently across repos (coverage report quality varies). If shipped on by default, the finding must carry `c`, `covered`, `coverable` (FACTS.md already requires this) so a reviewer can see *why* it fired.

## Hotspots and churn (history lane)

**Hotspot definition.** Two evidenced forms:
- MSR 2026 (Muzammil, Rehman, Kotti, Spinellis; 91 repos, complete version histories, ≥10k commits each): a file is a hotspot host when its commit-modification count exceeds **μ + 3σ** AND its total changes exceed **1 per month of project lifetime** — both filters required; either alone gave excessive false positives. Result: 28,470 outlier files = 0.87% of 3.28M files. Line-level outliers use the same μ+3σ on per-line modification counts (observed min 3, median 11, max 1,864 modifications; median lifespan 3.3 years). Tracker accuracy ~90% on hand-checks ([arXiv:2602.13170](https://arxiv.org/abs/2602.13170), [HTML](https://arxiv.org/html/2602.13170v1)).
- CodeScene: change-frequency cutoff taken from the slope of the distribution, not a fixed percentile; hotspot = high change frequency AND low code health (<8 on their scale) ([composite-signals.md](composite-signals.md), [CodeScene help](https://helpcenter.codescene.com/en/articles/3440704-how-are-hotspots-selected-for-hotspot-code-health-analysis)).

**Churn window.** Evidence:
- MSR 2026 uses complete lifetimes, not windows.
- Nagappan & Ball (Windows Server 2003): *relative* churn — normalized by component size and temporal extent — predicts defect density at 89.0% accuracy while absolute churn is poor ([ICSE 2005](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/icse05churn.pdf)). Normalization, not window length, is the evidenced part.
- Practice windows: 90 days (repowise, aidd defaults), 6–12 months (Software Observatory "usually"), CodeScene distribution-driven. FACTS.md's default — **12 months or 2,000 commits, whichever binds, in `.pulsar/policy.toml`** — sits inside the practiced range and the commit cap keeps huge repos tractable.

**Bot exclusion (the MSR 2026 finding):** bots are 2.8% of hotspot committers (23 accounts) but authors of **73.9% of hotspot commits** (15,283/20,690); per-pattern: Metadata Change 95% bot, Pinned Version Bump 52%, Formatting Ping-Pong 46%, while five patterns are 100% human ([arXiv:2602.13170](https://arxiv.org/abs/2602.13170)). **Any churn count that does not exclude `A.bot = 1` authors measures automation, not risk.** FACTS.md's `A bot` flag exists for exactly this. Also: **53.6% of identified hotspots are in administrative files** (version bumps, metadata, formatting) — the `F prod` scope flag must gate churn findings to production files, or half of them are noise by construction.

**Recommended churn fact for composites:** count **distinct commits touching the function** (CFN rows per `fn` in the window), not summed touched lines. Rationale: the evidenced hotspot phenomenon is *repeated edits to the same entity* (MSR line-outlier min 3 modifications; D'Ambros/Zimmermann both work on commit transactions), and commit-count is robust to a single large rewrite. Touched-lines sum stays available as secondary evidence in the finding. Floor: require ≥3 commits touching the fn in the window (below that no study shows signal; MSR's own minimum outlier is 3 modifications). The exact floor is the least-evidenced number here — flag for corpus calibration by pulsar-fidelity rather than treating 3 as validated.

**Composite rule:** hotspot = (complexity finding on the fn) AND (churn floor met). Evidence for the *conjunction* specifically is thinner than for churn alone (`composite-signals.md` §2: no study tests the conjunction against churn alone) — report both components in the finding.

## Co-change (logical coupling)

**Mechanism evidence:** commits-as-transactions + association rules. Zimmermann et al. (ROSE, ICSE 2004 / TSE 2005): mined rules predicted 26% of follow-up files, top-3 suggestions hit 64%; better on stable systems (GCC ~40% precision) ([ICSE 2004 PDF](https://thomas-zimmermann.com/publications/files/zimmermann-icse-2004.pdf), [TSE 2005](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf)). Definitions: **support** = number of transactions the rule was mined from; **confidence** = P(consequent | antecedent) ([ICSE 2004](https://thomas-zimmermann.com/publications/files/zimmermann-icse-2004.pdf)).

**Thresholds in the literature:** there is no canonical pair — they are study parameters:
- SIGAR (tool built on this literature): minimum support 2 ([Lubsen MSc thesis](https://azaidman.github.io/MScThesis/ZeegerLubsen.pdf)).
- D'Ambros et al. WCRE 2009: dropped transactions touching >100 classes (bulk-commit filter); correlation with defects degraded once an entity's change count grew past roughly 3–10 ([composite-signals.md](composite-signals.md), [WCRE 2009 PDF](https://www.marcoagerosa.com/papers/changecoupling.pdf)).
- Mondal et al. ICPC 2013: adding a **Significance** measure (beyond support+confidence) improves precision/recall, catching infrequent-but-real couplings ([PDF](https://www.cs.usask.ca/~croy/papers/2013/Mondal_ICPC2013_EvolutionayCoupling.pdf)).
- Zimmermann's own guidance: pick confidence iteratively per study; "high" is subjective ([change-coupling chapter](https://www.marcoagerosa.com/papers/changecoupling.pdf)).

**Verdict:** support ≥ 3 commits and confidence ≥ 0.5 are defensible conservative starting points (above SIGAR's floor of 2, below typical ARM noise), with the bulk-commit filter (>100 entities per commit → drop) applied first. **Evidence for the exact cutoffs is weak** — the mechanism is well-evidenced, the numbers are not. Ship the "co-change not explained by imports" detector with these defaults but report `support` and `confidence` in the finding evidence so thresholds can be tuned per repo; consider it opt-in until fidelity measures the false-positive rate on corpora.

## Summary table

| Metric | Recommended default | Flag when | Evidence strength |
|---|---|---|---|
| Cyclomatic complexity | 10 | CC > 10 | Canonical value; defect link weak (CC≈LOC) |
| Nesting depth | 3 | depth > 3 | Convention only; counter-evidence exists |
| NPath | 200 | NPath > 200 | Canonical (Nejmeh/Checkstyle); no defect validation; semantics caveat |
| Function length | 60 non-blank lines | loc > 60 | LOC proxy; weakest direct evidence |
| CRAP | 30 | CRAP > 30 | No peer-reviewed validation → **opt-in candidate** |
| Churn (fn) | ≥3 commits in window | commits touching fn ≥ 3 | Mechanism strong; floor unvalidated |
| Hotspot | CC finding AND churn | conjunction | Conjunction itself untested → report components |
| Risky change | CRAP AND churn | conjunction | Same caveat |
| Co-change | support ≥3, confidence ≥0.5 | unexplained by imports | Mechanism strong; cutoffs weak → **opt-in candidate** |

## Method note

Sources fetched 2026-11-07 via web search/fetch; every link above resolves to a paper, official docs page or vendor documentation. No implementation source of any analysis tool was read (clean room). Claims about "no study exists" are bounded: I found none in targeted searches; absence of evidence, not proof of absence.
