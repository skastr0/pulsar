# MetricsIn-LAWS.bend - laws about the glue main calls. Proofs: MetricsIn-PROOF.bend.
# Kept apart from Metrics-LAWS.bend because checking Rows.bend, which MetricsIn
# imports, peaks near 1 GB, and the Metrics gate does not need it.
import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Hotspot.bend as H
import ./MetricsIn.bend as I

# ---- G. the glue main calls (MetricsIn.bend) ----------------------------------------------------
# main prints MetricsIn.lines(rules, rows). Decoding rows to FN/CT/TF/CV and the churn
# count are unproven (like Rows.bend); from the decoded facts on, the output is
# Metrics', then Crap's, then Hotspot's, each proven in its own LAWS file.

# G1. decoded facts go to Metrics.run.
law glue_runs_metrics:
  for +r: M.Rules
  for +cv: Maybe<&2, List<&2, C.Cv>>
  for +chs: List<&2, H.Ch>
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  {I.In.go(r, cv, chs, Some{fns}, Some{cts}) == I.In.out(r, cv, chs, M.Metrics.run(r, fns, cts)) : Maybe<&2, List<&2, String>>}

# G2. measured functions are joined with the CV rows (Crap.join).
law glue_joins_coverage:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  for +ms: List<&2, M.FnM>
  {I.In.out(r, Some{cvs}, chs, Some{ms}) == I.In.comp(r, ms, chs, C.Crap.join(ms, cvs)) : Maybe<&2, List<&2, String>>}

# G3. the output is Metrics.lines, then Crap.lines at the CRAP threshold, then
# Hotspot.lines at the churn threshold over Metrics' and CRAP's findings.
law glue_prints_lines:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +chs: List<&2, H.Ch>
  for +xs: List<&2, C.Cr>
  {I.In.comp(r, ms, chs, Some{xs}) == Some{List.append(&2, String, M.Metrics.lines(r, ms), List.append(&2, String, C.Crap.lines(30n, C.Crap.measure_all(xs)), H.Hotspot.lines(2n, chs, M.Metrics.findings(r, ms), C.Crap.findings(30n, C.Crap.measure_all(xs)))))} : Maybe<&2, List<&2, String>>}

# G4. refused facts print nothing: Metrics refuses, the CV rows are malformed, or the join refuses.
law glue_refuses:
  for +r: M.Rules
  for +cvs: List<&2, C.Cv>
  for +chs: List<&2, H.Ch>
  {I.In.out(r, Some{cvs}, chs, None{}) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_cv:
  for +r: M.Rules
  for +chs: List<&2, H.Ch>
  for +m: Maybe<&2, List<&2, M.FnM>>
  {I.In.out(r, None{}, chs, m) == None{} : Maybe<&2, List<&2, String>>}

law glue_refuses_join:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +chs: List<&2, H.Ch>
  {I.In.comp(r, ms, chs, None{}) == None{} : Maybe<&2, List<&2, String>>}
