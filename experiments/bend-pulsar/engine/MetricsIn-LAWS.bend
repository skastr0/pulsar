# MetricsIn-LAWS.bend - laws about the glue main calls. Proofs: MetricsIn-PROOF.bend.
# Kept apart from Metrics-LAWS.bend because checking Rows.bend, which MetricsIn
# imports, peaks near 1 GB, and the Metrics gate does not need it.
import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Hotspot.bend as H
import ./Cognitive.bend as G
import ./MetricsIn.bend as I
import ./Rows.bend as R
import ./Churn.bend as Ch
import ./Untested.bend as U

# ---- G. the glue main calls (MetricsIn.bend) ----------------------------------------------------
# main prints MetricsIn.lines(rules, rows). Decoding rows to FN/CT/TF/CV is unproven
# (like Rows.bend); from the decoded facts on, the output is Metrics', then Cognitive's,
# then Crap's, then Hotspot's, each proven in its own LAWS file. Aligning the CO and CB
# rows to the token list (In.ops) is unproven too; what each row's value decodes to is
# pinned (G0b). The churn list is proven: G0 passes
# Churn.of(rows), which Churn-LAWS CH1-CH2 prove exact, so Hotspot's churn (G4) is
# the counted CFN rows.
# Decoding QS and RU rows to the Untested input (In.un) is unproven.

# G0. the entry point: MetricsIn.lines is In.go on the decoded rows, with Churn.of(rows)
# as the churn list.
# In.un(rows) is the untested-data-access input.
law glue_entry:
  for +r: M.Rules
  for +rows: List<&2, R.Row>
  {I.MetricsIn.lines(r, rows) == I.In.go(r, I.In.cvs(rows), Ch.Churn.of(rows), I.In.un(rows), I.In.crs(rows), I.In.marked(I.In.fns(rows), I.In.tfs(rows)), I.In.cts(rows)) : Maybe<&2, List<&2, String>>}

# G0b. the token each CO value (1..10) and CB value (1..5) that FACTS.md defines decodes to, plus
# one value outside each range (0 and 11, 0 and 6). FACTS.md. CO 1 and 2 start a run of `&&`
# and `||`; 9 and 10 continue one and are not scored, like 3..8 (`??`, the assignments,
# `?.`, defaults). CB 1..4 are the four branch flavors and 5 a labelled jump; anything else is
# unknown (ONone, the v1 reading).
law glue_tokens:
  {[I.In.tok(6, 1), I.In.tok(6, 2), I.In.tok(6, 3), I.In.tok(6, 4), I.In.tok(6, 5), I.In.tok(6, 6), I.In.tok(6, 7), I.In.tok(6, 8), I.In.tok(6, 9), I.In.tok(6, 10), I.In.tok(6, 0), I.In.tok(6, 11), I.In.tok(1, 1), I.In.tok(1, 2), I.In.tok(1, 3), I.In.tok(1, 4), I.In.tok(1, 5), I.In.tok(7, 5), I.In.tok(1, 0), I.In.tok(1, 6)] == [G.OAnd{}, G.OOr{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.ONone{}, G.FTern{}, G.FIf{}, G.FIfE{}, G.FIfEl{}, G.FLab{}, G.FLab{}, G.ONone{}, G.ONone{}] : List<&2, G.Op>}

# G1. decoded facts go to Trees.of, the tree builder Metrics.run uses, and the CO and CB
# rows to the token list.
law glue_runs_metrics:
  for +r: M.Rules
  for +cv: Maybe<&2, List<&2, C.Cv>>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +om: Maybe<&2, I.Cr>
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  {I.In.go(r, cv, chs, u, om, Some{fns}, Some{cts}) == I.In.out(r, cv, chs, u, I.In.ops(cts, om), M.Trees.of(fns, cts)) : Maybe<&2, List<&2, String>>}

# G2. Metrics.run is Trees.of, measured; so is the glue's measure of built trees.
law glue_trees:
  for +r: M.Rules
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  {M.Metrics.run(r, fns, cts) == M.Metrics.run2(M.Rules.cap(r), M.Trees.of(fns, cts)) : Maybe<&2, List<&2, M.FnM>>}

law glue_measure_is_run:
  for +cap: Nat
  for +fts: List<&2, M.FnT>
  {M.Metrics.run2(cap, Some{fts}) == Some{M.Metrics.measure_all(fts, cap)} : Maybe<&2, List<&2, M.FnM>>}

# G3. built trees are measured by Metrics and by Cognitive; the cognitive findings are at
# threshold 15 (Cognitive.lines, by cog_lines), and Metrics' measures are joined with the
# CV rows (Crap.join).
law glue_measures:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +ops: List<&2, G.Op>
  for +fts: List<&2, M.FnT>
  {I.In.out(r, Some{cvs}, chs, u, Some{ops}, Some{fts}) == I.In.comp(r, M.Metrics.measure_all(fts, M.Rules.cap(r)), G.Cog.measure_all(fts, ops), G.Cognitive.lines(15n, fts, ops), chs, u, C.Crap.join(M.Metrics.measure_all(fts, M.Rules.cap(r)), cvs)) : Maybe<&2, List<&2, String>>}

# G4. the output is the FM lines (each function's Metrics measures with its cognitive
# measure, Cognitive-LAWS G), then Metrics' FX lines, then the cognitive lines, then
# Crap.lines at the CRAP threshold, then Hotspot.lines at the churn threshold over
# Metrics' and CRAP's findings.
# Then Untested.lines over Metrics' records, CRAP's findings and the functions with
# coverage data (Untested-LAWS).
law glue_prints_lines:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +gs: List<&2, G.CgM>
  for +gl: List<&2, String>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +xs: List<&2, C.Cr>
  {I.In.comp(r, ms, gs, gl, chs, u, Some{xs}) == Some{List.append(&2, String, G.Cog.fms(ms, gs), List.append(&2, String, M.Report.fxs(M.Metrics.findings(r, ms)), List.append(&2, String, gl, List.append(&2, String, C.Crap.lines(30n, C.Crap.measure_all(xs)), List.append(&2, String, H.Hotspot.lines(2n, chs, M.Metrics.findings(r, ms), C.Crap.findings(30n, C.Crap.measure_all(xs))), U.Untested.lines(ms, C.Crap.findings(30n, C.Crap.measure_all(xs)), C.Crap.measure_all(xs), u))))))} : Maybe<&2, List<&2, String>>}

# G4'. the CO decoder reads op 7 (optional chaining `?.`) as an unscored operator, like
# 3..6, so it adds no cognitive (Cognitive-LAWS S6'); its CT kind-6 node still counts for
# cyclomatic and NPath.
law glue_op_optional_chain:
  {I.In.op(7) == G.ONone{} : G.Op}

# G4''. the CO decoder reads op 8 (a default value: a parameter default `x = 1` or a
# destructuring default `{ a = 1 }`) as an unscored operator too, so it adds no cognitive;
# its CT kind-6 node counts for cyclomatic and NPath (lead ruling, 2026-11-07).
law glue_op_default_value:
  {I.In.op(8) == G.ONone{} : G.Op}

# G5. refused facts print nothing: the trees are refused, the CV rows or the CO rows
# are malformed, or the join refuses.
law glue_refuses:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +ops: List<&2, G.Op>
  {I.In.out(r, Some{cvs}, chs, u, Some{ops}, None{}) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_cv:
  for +r: M.Rules
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +om: Maybe<&2, List<&2, G.Op>>
  for +m: Maybe<&2, List<&2, M.FnT>>
  {I.In.out(r, None{}, chs, u, om, m) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_co:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  for +m: Maybe<&2, List<&2, M.FnT>>
  {I.In.out(r, Some{cvs}, chs, u, None{}, m) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_join:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +gs: List<&2, G.CgM>
  for +gl: List<&2, String>
  for +chs: List<&2, H.Ch>
  for +u: U.UF
  {I.In.comp(r, ms, gs, gl, chs, u, None{}) == None{} : Maybe<&2, List<&2, String>>}
