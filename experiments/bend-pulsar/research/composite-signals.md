# Composite and cross-cutting signals: evidence ranking

Clean-room: papers, abstracts and vendor docs only. "S+G" = needs syntax plus git facts only. "Types" = needs type or symbol resolution. S+G/Types calls are my inference unless stated. Corpus sizes are as reported by each paper.

## Ranking (strongest evidence first)

### 1. Churn and change-history concentration (process metrics) — S+G
- **Facts + rule:** per file, count commits, lines added/deleted, distinct authors in a window; normalise by size. Finding: file is in the top change-frequency tail.
- **Evidence:**
  - Moser et al., 3 Eclipse releases: change metrics gave >75% correct, recall >80%, FPR <30%, and a combined model was not significantly better ([Moser 2008](https://hiper.cis.udel.edu/lp/lib/exe/fetch.php/courses/icse08-moser-defectpredict.pdf)). The code-metric baseline had recall below 0.4 ([Moser 2008, via ACM](https://dl.acm.org/doi/10.1145/1368088.1368114)).
  - Rahman and Devanbu, 85 releases of 12 projects: code metrics are generally less useful, and have high stasis (they keep flagging the same files, which are comparatively less defect-dense) ([ICSE 2013](https://2013.icse-conferences.org/content/how-and-why-process-metrics-are-better.html)).
  - Majumder et al., 722,471 commits across 700 GitHub projects: process metrics beat product metrics (recall 98% vs 44%, AUC 95% vs 54%, medians), but metric-importance rankings from small studies did not survive scaling up ([arXiv 2008.09569](https://arxiv.org/abs/2008.09569)).
  - Nagappan and Ball, Windows Server 2003: absolute churn is a poor predictor, relative churn (churn normalised by size and time) is highly predictive, 89.0% accuracy ([ICSE 2005](https://microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density)).
  - Ostrand et al., industrial system: the top 20% of files by a fault model held 71–92% of faults (average 83%) ([Ostrand et al.](https://cs.virginia.edu/woda/papers/ostrand.pdf)).
  - Hassan: entropy of the change process beat prior modifications and prior faults, 6 open-source projects ([ICSE 2009](https://sail.cs.queensu.ca/data/pdfs/ICSE2009_PredictingFaultsUsingTheComplexityOfCodeChanges.pdf)).
- **Generalisation:** best of any signal here: independent corpora, industrial and open source, 2005 to 2020.
- **Failure modes:** bots dominate hotspot edits (74%) and over half of hotspots sit in administrative files (53.6%); the top patterns are version bumps, long-line rewrites and formatting ping-pong ([Muzammil et al., MSR 2026, 91 repos](https://arxiv.org/abs/2602.13170)). Filter bots, lockfiles, manifests, formatting-only and bulk commits. Predictors of "where bugs were" also have the stasis problem above.

### 2. Hotspot = high change frequency AND low code quality — S+G
- **Facts + rule:** change-frequency tail (git) intersected with a per-file complexity or smell measure (syntax). CodeScene selects the hotspot cut-off from the slope of the change-frequency distribution, not a fixed percentile, then inspects Code Health, where below 8 is worth a look ([CodeScene help](https://helpcenter.codescene.com/en/articles/3440704-how-are-hotspots-selected-for-hotspot-code-health-analysis)). Its biomarkers include Nested Complexity, Brain Method and Developer Congestion ([CodeScene docs](https://docs.enterprise.codescene.io/versions/3.6.9/guides/technical/biomarkers.html)).
- **Evidence (the quality half):** Tornhill and Borg, 39 proprietary codebases, 30,737 files: "Alert" files had about 15 times the Jira defects of "Healthy" ones; issue time-in-development was d=0.45 higher, and the paper reports one lower-quality category with issue times 78% longer than Healthy ([Code Red, arXiv 2203.04374](https://arxiv.org/abs/2203.04374)). The same data support a non-linear return, with the largest gains at the high end ([Borg et al., 2401.13407](https://arxiv.org/abs/2401.13407)).
- **Gaps:** Code Health is a proprietary composite; the replication follow-up says it lacked file size and churn data and did not model file dependence ([2401.13407](https://arxiv.org/abs/2401.13407)). I found no study that tests the conjunction against churn alone. Meanwhile cyclomatic complexity largely tracks LOC ([Hassan 2009, citing Graves, Herraiz](https://sail.cs.queensu.ca/data/pdfs/ICSE2009_PredictingFaultsUsingTheComplexityOfCodeChanges.pdf)). Treat the "complexity" half as unproven beyond size.
- **Types:** none.

### 3. Cyclic dependency and other dependency-graph smells (Arcan/Designite family) — S+G (module level); Types for class-level
- **Facts + rule:** import graph; cycle = strongly connected component of size above 1. Hub-like = a node with excessive in and out degree ([Azadi et al. catalogue](http://www.taibi.it/sites/default/files/Architectural%20Smells%20Detected%20by%20Tools%20a%20Catalogue%20Proposal.pdf)).
- **Evidence:**
  - Arcan on 31 open-source Java systems: 87% of analysed commits change more in smelly artifacts, change likelihood rises with the number of smells, and change size is larger ([Sas et al.](https://boa.unimib.it/bitstream/10281/332145/4/10281-332145_VoR.pdf)).
  - 10 Apache systems: smell-based models predicted issue and change-proneness at about 76% average precision, roughly twice baseline, and cross-project models worked reasonably ([Le et al., 2102.09835](https://arxiv.org/abs/2102.09835)).
  - Cyclic classes were about 44% of classes but held roughly 65% of defect-prone class files ([Oyetoyan et al.](https://ieeexplore.ieee.org/document/6676922)).
  - Cycles raise change-proneness of nearby classes, yet cycle location and subtype knowledge could not separate critical from harmless cycles ([Circular dependencies and change-proneness](https://hal.science/hal-01203525v1)).
- **Failure modes:** architectural smells are mostly independent of code smells, so they are not a proxy for them ([Fontana et al., 1904.11755](https://arxiv.org/abs/1904.11755)). Smells did not correlate with concurrency bugs in general, only specific ones with project context ([Tamburri et al., 125 releases of 5 systems](https://arxiv.org/abs/2303.17862)). Base-rate confounding with size and churn is not controlled in the summaries I read (unverified for the full papers).

### 4. Co-change (logical coupling), and co-change not explained by structure — S+G; Types for the "structure" side beyond imports
- **Facts + rule:** commits grouped by transaction; pair support and confidence above thresholds; drop huge commits. "Unexplained" = pair with no import path between them.
- **Evidence:**
  - D'Ambros et al., ArgoUML, Eclipse JDT Core, Mylyn: Spearman above 0.5 (above 0.8 for Eclipse) with defects; better than OO metrics, weaker than plain number of changes; it improved regression models. They dropped transactions touching over 100 classes ([WCRE 2009](https://marcodambros.gitlab.io/publications/wcre09a.pdf)).
  - Zimmermann et al.: mined rules predicted 26% of follow-up files, top-3 suggestions hit 64% of the time; better on stable systems (GCC: 44% of files, about 40% precision) ([TSE 2005](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf)).
  - Structural and logical coupling overlap little: most structurally coupled entities do not co-evolve, and the reverse ([JSS 2017](https://sciencedirect.com/science/article/pii/S016412121730184X)).
  - Clio (modularity violations = co-change that the modular structure does not predict): 15 Hadoop Common and 10 Eclipse JDT releases; hundreds of hits were recognised as design problems or refactored later ([Wong et al., ICSE 2011](https://cs.drexel.edu/~yc349/papers/2011/ICSE2011.pdf)).
  - Mo et al. "Implicit Cross-module Dependency", defined from history plus architecture; evaluated on 9 Apache projects and 1 commercial; structure-history patterns contributed more to error and change-proneness than the others ([WICSA 2015](https://cs.drexel.edu/~yc349/papers/2015/wicsa2015.pdf)).
- **Failure modes:** largely redundant with churn (above: weaker than number of changes). Support threshold matters: correlations fell once n grew past 3 to 10 ([D'Ambros](https://marcodambros.gitlab.io/publications/wcre09a.pdf)). Bulk commits (licence headers, docs) create fake pairs. Clio's evidence is expert validation on two projects, not defect rates.

### 5. Ownership: minor-contributor share and top-owner proportion — S+G
- **Facts + rule:** per file, share of commits by the top author; count of authors under 5% share.
- **Evidence:** Windows Vista and 7: minor-contributor count has a strong positive relation with pre- and post-release failures, controlling for size, churn and complexity ([Bird et al., FSE 2011](https://doi.org/10.1145/2025113.2025119)). Replicated on 4 Microsoft products at file level ([Greiler et al., MSR 2015](https://microsoft.com/en-us/research/wp-content/uploads/2015/05/MSR-2015-Source-Code-Ownership-IEEE_camera-ready.pdf)). 40 proprietary repos: marginal owners need 45% more time on small changes and 93% more on large ones in low-quality code ([Borg et al., 2304.11636](https://arxiv.org/abs/2304.11636)).
- **Weak generalisation:** in open source the relationship exists but ownership adds little over LOC, recent modifications and developer count ([Foucault et al.](https://ink.library.smu.edu.sg/sis_research/2848)). A company replication found no minor-contributor link ([Koana et al., 2405.15665](https://arxiv.org/abs/2405.15665); one company, 9 projects). Commit-based ownership associates more strongly than line-based, across 25 releases ([Thongtanunam and Tantithamthavorn](https://arxiv.org/abs/2408.12807)).
- **Failure modes:** definition sensitivity (above); minor contributors who are code reviewers are not buggy ([IEEE Software blog summary](http://blog.ieeesoftware.org/2016/07/minor-contributors-correlate-to.html)); identity merging (aliases, bots) is my inference.

### 6. Organisational structure and socio-technical congruence — S+G plus an org chart (not available from git alone)
- Organisational metrics beat churn, complexity, coverage and dependencies for failure-proneness on Windows Vista ([Nagappan et al.](https://cs.umd.edu/~basili/publications/proceedings/P125.pdf)). Against that, 25 large open-source projects showed no relation between socio-technical motif congruence and bugs or churn ([Mauerer et al., 2105.08198](https://arxiv.org/abs/2105.08198)).
- **Verdict:** contradicted; not a core candidate.

### 7. Design-rule-space findings: architecture anti-patterns, decoupling level — Types (structural relations)
- **Facts + rule:** dependency graph plus history; patterns such as Unstable Interface (a file many others depend on that changes with them) and Crossing.
- **Evidence:** 19 projects: files in anti-patterns are more error- and change-prone, more patterns means more risk, and Unstable Interface and Crossing contribute most ([Mo et al., TSE 2019](https://par.nsf.gov/servlets/purl/10118809)). Decoupling level targets architectural maintenance complexity ([ICSE 2016](https://cs.drexel.edu/~yc349/papers/2016/icse2016-DL.pdf); I did not extract its effect sizes).
- **Caveat:** I found no independent replication; the studies share one research group and toolchain. A longitudinal case at one start-up ties architectural debt to refactoring payoff ([Nayebi et al., 1811.12904](https://arxiv.org/abs/1811.12904)).

## Cross-cutting defect-prediction notes
- Just-in-time change-level prediction: 6 open-source and 5 commercial projects, average accuracy 68%, recall 64%; inspecting 20% of effort finds 35% of defect-inducing changes ([Kamei et al., TSE 2013](https://ieeexplore.ieee.org/document/6341763)). This fits "report which findings a change introduced".
- A product rule consistent with the evidence: lead with process facts; add structure only where history says it matters.

## Recommendation against the product rule
Core candidates (technology-free, multi-corpus): churn concentration (1), hotspot as a named conjunction (2, with a caveat that the conjunction is untested against churn alone), import cycles (3), and unexplained co-change (4). Ownership (5) is generic but mixed; ship only as an evidence-labelled finding. Items 6 and 7 stay out of core.
