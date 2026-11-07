# MetricsIn-LAWS.bend - laws about the glue main calls. Proofs: MetricsIn-PROOF.bend.
# Kept apart from Metrics-LAWS.bend because checking Rows.bend, which MetricsIn
# imports, peaks near 1 GB, and the Metrics gate does not need it.
import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Hotspot.bend as H
import ./Cognitive.bend as G
import ./MetricsIn.bend as I

# ---- G. the glue main calls (MetricsIn.bend) ----------------------------------------------------
# main prints MetricsIn.lines(rules, rows). Decoding rows to FN/CT/TF/CV and the churn
# count are unproven (like Rows.bend); from the decoded facts on, the output is
# Metrics', then Cognitive's, then Crap's, then Hotspot's, each proven in its own LAWS
# file. Decoding CO to the operator list (In.ops) is unproven too.

# G1. decoded facts go to Trees.of, the tree builder Metrics.run uses, and the CO rows
# to the operator list.
law glue_runs_metrics:
  for +r: M.Rules
  for +cv: Maybe<&2, List<&2, C.Cv>>
  for +chs: List<&2, H.Ch>
  for +om: Maybe<&2, List<&2, I.Co>>
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  {I.In.go(r, cv, chs, om, Some{fns}, Some{cts}) == I.In.out(r, cv, chs, I.In.ops(cts, om), M.Trees.of(fns, cts)) : Maybe<&2, List<&2, String>>}

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

# G3. built trees are measured by Metrics and by Cognitive at threshold 15, then the
# measures are joined with the CV rows (Crap.join).
law glue_measures:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +ops: List<&2, G.Op>
  for +fts: List<&2, M.FnT>
  {I.In.out(r, Some{cvs}, chs, Some{ops}, Some{fts}) == I.In.comp(r, M.Metrics.measure_all(fts, M.Rules.cap(r)), G.Cognitive.lines(15n, fts, ops), chs, C.Crap.join(M.Metrics.measure_all(fts, M.Rules.cap(r)), cvs)) : Maybe<&2, List<&2, String>>}

# G4. the output is Metrics.lines, then the cognitive lines, then Crap.lines at the CRAP
# threshold, then Hotspot.lines at the churn threshold over Metrics' and CRAP's findings.
law glue_prints_lines:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +gl: List<&2, String>
  for +chs: List<&2, H.Ch>
  for +xs: List<&2, C.Cr>
  {I.In.comp(r, ms, gl, chs, Some{xs}) == Some{List.append(&2, String, M.Metrics.lines(r, ms), List.append(&2, String, gl, List.append(&2, String, C.Crap.lines(30n, C.Crap.measure_all(xs)), H.Hotspot.lines(2n, chs, M.Metrics.findings(r, ms), C.Crap.findings(30n, C.Crap.measure_all(xs))))))} : Maybe<&2, List<&2, String>>}

# G5. refused facts print nothing: the trees are refused, the CV rows or the CO rows
# are malformed, or the join refuses.
law glue_refuses:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +ops: List<&2, G.Op>
  {I.In.out(r, Some{cvs}, chs, Some{ops}, None{}) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_cv:
  for +r: M.Rules
  for +chs: List<&2, H.Ch>
  for +om: Maybe<&2, List<&2, G.Op>>
  for +m: Maybe<&2, List<&2, M.FnT>>
  {I.In.out(r, None{}, chs, om, m) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_co:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +m: Maybe<&2, List<&2, M.FnT>>
  {I.In.out(r, Some{cvs}, chs, None{}, m) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_join:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +gl: List<&2, String>
  for +chs: List<&2, H.Ch>
  {I.In.comp(r, ms, gl, chs, None{}) == None{} : Maybe<&2, List<&2, String>>}
