# Cognitive complexity — evidence for a `core.cognitive` rule (#663 proposal)

Requested by pulsar-lead after dogfood triage run 1 (`research/dogfood-triage-ee12518.md`):
the exhaustive-enum-match pattern (`facts.rs Rel>tag`, cyclomatic 31 from a 30-arm match
returning string literals) is a systematic cyclomatic false-positive shape. Proposal on the
table: add a cognitive-complexity rule per the SonarSource spec, alongside cyclomatic —
not a special case inside cyclomatic.

## The spec (official sources only)

SonarSource, "Cognitive Complexity" white paper (G. Ann Campbell),
https://www.sonarsource.com/docs/CognitiveComplexity.pdf and
https://www.sonarsource.com/resources/white-papers/cognitive-complexity/ ; increment model as
documented at https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition.md

Increments, per function:

- **Structural breaks, +1 each:** `if`, `else if`, `else`, ternary, `catch`, `switch`
  (the whole switch/match once, regardless of case count), loops (`for`, `while`,
  `do`/`while`), recursion.
- **Nesting:** a structural break adds its current nesting depth on top of the +1.
  Nesting inside nested functions/lambdas can raise the level.
- **`else if` chains:** the first `if` +1, each `else if` +1, final `else` +1 — none of
  them increase nesting.
- **Jumps:** `goto` and labelled `break`/`continue` +1; unlabelled `break`/`continue` +0.
- **Logical operators:** +1 per contiguous run of the same binary operator —
  `a && b && c` is +1, `a && b || c` is +2.
- **Readability aids:** method calls, null-coalescing etc. add nothing.

Design intent (white paper): measure *understandability* — what a reader must hold in their
head — rather than testability. Switch/match arm count deliberately does not add points;
nesting does, which is what cyclomatic misses.

## Default threshold evidence

- SonarQube rule S3776 (cognitive complexity per function) defaults to **15**
  (https://docs.sonarsource.com/sonarqube-server/user-guide/issues/issue-types.md); the
  SonarQube Server 2026.5 notes a **30** default for Rust specifically. Convention, not
  defect-prediction evidence — same evidentiary class as our nesting>3.
- No peer-reviewed defect-validation study for the metric was found; treat the threshold
  as weakly evidenced, same as `core.nesting`.

## Fit with our CT facts

Our CT kinds already carry most of what the spec needs:

| spec construct | our CT |
|---|---|
| if / else-if / else | KBranch + KArm chain (arm position gives the else-if/else distinction) |
| switch/match | KMulti (one node — already counts once, cases are KArms) |
| loops | KLoop |
| catch/finally | KTry (+ KFin) |
| ternary | needs checking: is `?:` emitted as KSc or a branch? (adapter contract) |
| `&&`/`||` runs | KSc + **`CO fn node op`** (ruled by pulsar-lead): op 1=`&&`, 2=`||`, 3=`??`, 4=`&&=`, 5=`||=`, 6=`??=`; adapters emit it for kind-6 nodes, Rust maps `&&`/`||` only. `??` stays +0 per spec (null-coalescing is a readability aid) — the op column exists so the rule can tell runs apart |
| recursion | no CT kind — needs an adapter fact (self-call edge already exists in call graphs for TS/Rust lanes?) |
| labelled break/continue, goto | KExit exists; labelled-ness would need a flag |
| nesting depth per break | computable from CT depth at each break node |

Net: the metric is computable from CT plus the `CO` relation (FACTS.md row owned by
pulsar-composites; pulsar-ts and pulsar-rs emit it) and small adapter additions for
ternary classification, recursion and labelled-jump flags. No source text needed in the
engine — consistent with the facts contract.

## Dogfood evidence (run 1, ee12518)

NPath multiplies sequences and *sums* match arms, so `cyclomatic / npath` separates
"many arms" (dispatch tables, ratio near 1) from "branchy sequencing" (ratio near 0):

| function | cc | npath | cc/np | read |
|---|---|---|---|---|
| facts.rs `Rel>tag` | 31 | 31 | 1.00 | pure enum→string dispatch — cognitive ≈ 1, would not flag |
| bend/mod.rs `Walker>tokens` | 13 | 16 | 0.81 | arm-dominated dispatch |
| bend/mod.rs `Walker>block` | 13 | 27 | 0.48 | arm-dominated |
| ts/extract.rs `type_only_exports` | 15 | 28 | 0.54 | arm-dominated |
| engine.rs `parse` | 14 | 68 | 0.21 | match-heavy parser dispatch |
| ts/resolve.rs `Resolution>new` | 14 | 100 | 0.14 | mixed, arm-leaning |
| bend/mod.rs `link_laws` | 12 | 55 | 0.22 | arm-leaning |
| coverage/map.rs `assign` | 11 | 82 | 0.13 | arm-leaning |
| catalog.rs `validate` | 23 | 108000 | 0.00 | genuinely branchy — would still flag |
| driver.rs `build` | 11→18 | 306→32640 | ~0 | genuinely branchy — would still flag |
| resource-bench.ts `runResourceBench` | 53 | ≥cap | ~0 | genuinely branchy — would still flag |

Of the 29 cyclomatic findings, roughly 8 sit in the arm-dominated cluster (npath ≤ ~150 with
cc ≥ 11). Cyclomatic counts each arm as a decision; cognitive counts the whole match once —
exactly the correction the `Rel>tag` case needs, without touching genuinely branchy code.

## Ruling (pulsar-lead, after this note)

1. `core.cognitive` ships as its own rule in Metrics beside cyclomatic, threshold **15**
   explicit in the rule, with laws like the other metrics (pulsar-composites, #663).
2. Evidence is weak → the rule ships **OFF by default**; pulsar-cli enables it in this
   repo's `.pulsar/policy.toml` so dogfood gathers real evidence on our own code.
3. Operator identity: new relation `CO fn node op` for kind-6 nodes (arity unchanged);
   composites writes the FACTS.md row, ts/rs emit it, Rust maps `&&` and `||` only.

## Recommendation to #663 (as ruled)

1. Add `core.cognitive` as a **separate rule** computed from the same CT, not a patch to
   `core.cyclomatic` — keeps both metrics' semantics clean and lets policy choose either.
2. Default threshold **15** (SonarQube S3776 convention), labelled weak-evidence in
   thresholds.md; revisit after it runs on our own dogfood corpus.
3. Until ternary/recursion/labelled-jump adapter bits land, a v1 can omit them
   (document the gap) — they are rare in our corpus. `CO` covers the operator-run rule.
4. Keep `core.cyclomatic`, `core.nesting`, `core.npath` unchanged — cognitive complexity
   complements, does not replace, the testability metrics.
