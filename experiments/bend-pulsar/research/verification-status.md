# What is formally verified, end to end (#702)

Audit by pulsar-bend at **16706e2**, on bx_c793jjwg, from a `git archive` of that sha. Every run
below is from that copy.

## The claim we can make today

Pulsar's engine **proves**, in Lean-checked Bend, that every finding it prints is correct for the
fact rows it decoded:
- a metric finding's value is that function's measure and exceeds the printed threshold;
- a cycle's files really reach each other;
- a class-in-context finding is a call whose callee has the rule's class, in a matching context.

Missing findings are ruled out too, either unconditionally or relative to a certificate the binary
checks and the CLI enforces. These proofs cover the code the binary runs. One gate,
`bend engine/PROOF.bend --verdict`, checks all of them, and a deliberate bug in any law's code
fails it.

What is **not proven** is the path from the facts file to those decoded rows, and from the
engine's lines to what `pulsar delta` prints. That covers:
- the byte readers and row decoders;
- churn, and the shipped thresholds;
- the CLI's prod flags, policy filter, allow-by-decision and added/removed set difference.

Those parts are tested by fixtures and differential checks, not proven. So the honest sentence is:

> Each finding Pulsar reports is checked by a formally verified engine, given the facts it read.
> Reading the facts and reporting the delta are tested, not proven.

We cannot yet say "Pulsar's findings are formally verified end to end."

## (1) Verdicts

Each file was run cache-busted (a unique comment appended), with `bend <f> --verdict`, Bend
2.0.40 and Lean 4.34.

| file | exit | time | peak RSS | result |
|---|---|---|---|---|
| engine/PROOF.bend (the gate) | 0 | 7.67 s | 1.48 GB | ALL PROOFS CHECK |
| ClassCtx-PROOF.bend | 0 | 6.65 s | 1.42 GB | ALL PROOFS CHECK |
| Cognitive-PROOF.bend | 0 | 0.45 s | 187 MB | ALL PROOFS CHECK |
| Crap-PROOF.bend | 0 | 0.45 s | 190 MB | ALL PROOFS CHECK |
| Hotspot-PROOF.bend | 0 | 0.57 s | 194 MB | ALL PROOFS CHECK |
| Layers-PROOF.bend | 0 | 7.17 s | 1.44 GB | ALL PROOFS CHECK |
| MetricsIn-PROOF.bend | 0 | 6.50 s | 1.48 GB | ALL PROOFS CHECK |
| Metrics-PROOF.bend | 0 | 0.41 s | 175 MB | ALL PROOFS CHECK |
| Scope-PROOF.bend | 0 | 6.12 s | 1.30 GB | ALL PROOFS CHECK |

The gate imports every one of these, plus the top-level `PROOF.bend` (the laws for Extract,
Resolve and Graph). That is 149 laws.

No `@unsafe`, `?TODO` or foreign `import "…"` appears in any shipped engine file at this sha.

## (2) Every function reachable from engine/main.bend

`verification-status/reach.py` builds the call graph from `def main`. It resolves `Alias.name`
through each file's imports, and does not follow Base. It marks each def as follows.

**proven**: a law statement names the def, directly or through a spec helper in a LAWS file.

**under-law**: no law names the def, but a caller that a law names reaches it. The law
constrains the def only as far as it constrains that caller's output. Most of these are
detector internals behind a sound/complete law, such as Graph's SCC search behind
`cycles_sound`.

**tested**: on the engine's own list of tested-but-unproven code, which overrides the two above:
- engine/LAWS.bend:10-23: the readers, the decoders, row grouping, Scope.count;
- MetricsIn-LAWS.bend:12-15: the MetricsIn decoders, including `In.ops`, which a glue law names
  only as a term.

**effects**: main.bend's IO.

**neither**: none of the above.

The full list, one row per def with its laws, is `verification-status/reach-16706e2.tsv`.

| module | proven | under-law | tested | effects | neither |
|---|---|---|---|---|---|
| Extract.bend | 1 | 1 | | | |
| Resolve.bend | 1 | 8 | | | |
| Graph.bend | 4 | 111 | | | |
| engine/Facts.bend | 5 | 8 | 1 | | |
| engine/Scope.bend | 4 | 3 | 2 | | |
| engine/Pipeline.bend | 17 | 10 | | | 1 |
| engine/Metrics.bend | 20 | 43 | | | 1 |
| engine/Cognitive.bend | 8 | 16 | | | |
| engine/Crap.bend | 9 | 13 | | | |
| engine/Hotspot.bend | 4 | 6 | | | |
| engine/ClassCtx.bend | 10 | 16 | 9 | | |
| engine/Layers.bend | 30 | 120 | 15 | | |
| engine/MetricsIn.bend | 3 | 2 | 34 | | 1 |
| engine/Churn.bend | | | | | 18 |
| engine/Parse.bend | | | 33 | | |
| engine/Rows.bend | | | 21 | | |
| engine/main.bend | | | | 21 | |
| **total (630)** | **116** | **357** | **115** | **21** | **21** |

The 21 that are under no law and on no list:
- **Churn.bend, all 18 defs.** They compute the churn input of core.hotspot and
  core.risky-change, via `Ch.Churn.of(rows)` in MetricsIn.lines. Churn.bend has no LAWS file.
- **`Metrics.defaults`.** The thresholds main passes. Soundness laws are stated for any rules
  value, so a printed finding is correct against the threshold it prints. But no law fixes which
  thresholds ship.
- **`MetricsIn.lines`.** A one-line composition: decoders, then `In.go`. The laws start at
  `In.go` (glue_runs_metrics).
- **`Engine.row_tags`.** The tags the reader keeps. A dropped tag silently removes that input,
  as CO was missing before 47ff71a. Inference, not run: dropping TF would mark no test functions
  and so add findings on tests.

## (3) Each shipped rule, from facts to the printed line

"Engine part" is what is proven from the decoded rows to the engine's output line. "Unproven
links" is everything else on the path from the facts file to `pulsar delta`'s output.

| rule id | engine part: sound? | complete? | unproven links on the path |
|---|---|---|---|
| graph.import-cycle (the "cycles" output) | yes: `cycles_sound` holds unconditionally, `analyze_is_cycles`, `pipeline_cycles_are_graph_cycles`, K laws per fact, `engine_is_both` | relative to the CERT certificates (`cycles_complete`, `sccs_partition`); delta refuses `CERT 0` (delta.rs:303), but a missing CERT line passes, since the check is `== Some(false)` | Parse.bend reader; row grouping (Scope.go / Facts.close_n); prod flags (Rust, TS-only: `lang/scope.rs is_prod`, the open dogfood bug); id→path mapping (delta.rs:161) |
| core.cyclomatic, core.nesting, core.npath, core.length | yes: Metrics `findings_sound`, plus measure laws tying each value to its definition (`cyclomatic_is_one_plus_decisions`, `npath_is_nejmeh_capped`, …), glue G1-G3 | yes: `findings_complete_*` | Rows.bend; FN/CT/TF decoders; `Metrics.defaults`; `Engine.row_tags`; CLI policy disable (delta.rs:205) |
| core.cognitive | yes: `cog_findings_sound`, 9 increment laws, `cog_lines`, `glue_measures` | yes: `cog_findings_complete` | as above, plus the CO decoder `In.ops`; the CLI shows it only when policy enables it (delta.rs:205) |
| core.crap | yes: `crap_findings_sound`, `crap_value`, `crap_run` | yes: `crap_findings_complete` | CV decoder; the coverage file reader (Rust, cli/src/coverage) |
| core.hotspot | yes: `hs_sound`, `hotspot_bases` | yes: `hs_complete` | **Churn.bend (no laws)**; the history facts (Rust) |
| core.risky-change | yes: `hs_sound`, `risky_bases` | yes: `hs_complete` | Churn.bend; CV decoder; coverage reader |
| effect/\*, js-globals/\*, platform-node/\* (class-in-context, RCX) | yes: `classctx_sound`, `engine_classctx_run` | yes: `classctx_complete` | ClassCtx.decode; symbol→class catalog data and RL rows (Rust); grouping by (rule, fn, callee), and silent drops on a failed lookup (delta.rs:238-272) |
| layer rules (LCYC, LUNP, LOPQ, LDUP, LHUB) | yes: `req_edge_sound`, `unprovided_*`, `dup_*`, `hub_counts`, `run_is_detectors`, `engine_layers_*` | completeness only as far as `run_is_detectors` | Layers.decode. **Not shipped**: no CLI code parses these lines (only packs/effect/HANDCHECK.md mentions them), so `pulsar delta` never reports them |

For every rule, the engine part also needs a CLI step after it: delta's added/removed set
difference and allow-by-decision (delta.rs:391-398), and the finding key hash (finding.rs).
Both are Rust, tested and not proven.

## (4) Negative controls

I reran these on the 16706e2 copy. Each one must fail the gate.

| control | run against | result |
|---|---|---|
| layers `req_edge_sound`: Rq.check forgets that x must require s | engine/PROOF.bend | FAILS, exit 1, at RkS.fin (1.8 s) |
| classctx `classctx_sound`: Cx.row drops the class test | engine/PROOF.bend | FAILS, exit 1, at HS.head (1.9 s) |
| hotspot `hs_sound`: find ignores the churn threshold | engine/PROOF.bend | FAILS, exit 1, at Laws.hs_sound (2.1 s) |
| cognitive `cog_if_at_level` (while reviewing #699) | engine/PROOF.bend | FAILS, exit 1, at Laws.cog_if_at_level |
| controls/cognitive.json, all 14 | Cognitive-PROOF.bend | 14/14 fail |
| controls/metrics-in.json, all 9 | MetricsIn-PROOF.bend | 9/9 fail |

## The lead's three points

1. **"Cognitive-PROOF.bend and Rules-PROOF.bend are not imported by engine/PROOF.bend."**
   - Cognitive: true before 16706e2, fixed by it. engine/PROOF.bend:23 imports it, and the
     cog_if_at_level control fails the gate.
   - Rules: no Rules\*.bend file is in the tree at this sha. They are pulsar-bend's uncommitted
     #697 drafts. Rules.bend is not reachable from main, and it will join the gate when it is
     wired in.
   - Also not in the gate at this sha: Sql.bend (#695, work in progress). It is not reachable
     from main either: no LAWS file, only Sql-CHECK.bend.
2. **"Churn.bend has no LAWS file."** Confirmed. All 18 of its reachable defs are under no law,
   and it feeds core.hotspot and core.risky-change.
3. **"Delta's set difference is computed in Rust."** Confirmed, at cli/src/delta.rs:391-398.
   - The same file also applies the policy enable/disable (205, 311) and allow-by-decision
     (397).
   - It maps engine ids to files and functions (161, 238).
   - It drops class-in-context findings whose lookups fail (250-256).

## To close the gaps, in order of how much they move the claim

1. Laws for Churn.bend, which lifts the hotspot and risky-change engine paths to the same level
   as the rest.
2. Report the layer rules through the CLI, or state that they are not shipped.
3. A law fixing `Metrics.defaults` and `Engine.row_tags` to the documented values, for example
   one equality law each.
4. ~~Proven decoders.~~ Out of scope by operator decision (AGENTS.md and PRODUCT.md): fact
   extraction and reading (parsers, adapters, the engine's byte readers and row decoders) are
   covered by fixtures and differential tests, not proofs. The claim above is stated "given the
   facts it read" for that reason.
6. The CLI's part of the report: refuse a missing CERT line as well as `CERT 0`, report or
   remove the layer rules, and stop dropping class-in-context findings silently.
5. Move delta's set difference into the engine (two fact sets in, added/removed out). The Rust
   side would then only format the result.
