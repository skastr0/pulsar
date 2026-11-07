# MetricsIn-LAWS.bend - laws about the glue main calls. Proofs: MetricsIn-PROOF.bend.
# Kept apart from Metrics-LAWS.bend because checking Rows.bend, which MetricsIn
# imports, peaks near 1 GB, and the Metrics gate does not need it.
import Base
import ./Metrics.bend as M
import ./MetricsIn.bend as I

# ---- G. the glue main calls (MetricsIn.bend) ----------------------------------------------------
# main prints MetricsIn.lines(rules, rows). Decoding rows to FN/CT/TF is unproven
# (like Rows.bend); from the decoded facts on, the output is Metrics'.

# G1. decoded facts go to Metrics.run.
law glue_runs_metrics:
  for +r: M.Rules
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  {I.In.go(r, Some{fns}, Some{cts}) == I.In.out(r, M.Metrics.run(r, fns, cts)) : Maybe<&2, List<&2, String>>}

# G2. measured facts print exactly Metrics.lines.
law glue_prints_lines:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  {I.In.out(r, Some{ms}) == Some{M.Metrics.lines(r, ms)} : Maybe<&2, List<&2, String>>}

# G3. refused facts print nothing.
law glue_refuses:
  for +r: M.Rules
  {I.In.out(r, None{}) == None{} : Maybe<&2, List<&2, String>>}
