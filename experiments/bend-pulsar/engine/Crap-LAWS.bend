# engine/Crap-LAWS.bend - laws about Crap.bend. Filled in Crap-PROOF.bend.
# Gate: `bend engine/Crap-PROOF.bend --verdict`.
#
# The laws are about the functions the binary runs: Crap.run (entry point),
# Crap.out, Crap.measure, Crap.value / Crap.term / Md.go, Crap.findings and
# Crap.lines. MemC, Measured and Sound below only describe outputs.
#
# Not covered by any law, by design: Crap.join (FnM and CV rows to Cr records),
# like the decoders; it is shown against Crap-CHECK.bend. The evidence tail (Crap.ev)
# and its cause are covered by C1-C5.

import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Metrics-NAT.bend as N
import ./Metrics-LAWS.bend as ML

def MemC(xs: List<&2, C.CrM>, m: C.CrM) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : C.CrM}, MemC(t, m)>

# Some function in `ms` is `fn`, it is not a test, and its CRAP is `v`.
def Measured(ms: List<&2, C.CrM>, +fn: U32, +v: Nat) -> Data:
  match ms:
    case Nil{}:
      Empty
    case Con{C.CrM{f, c, cov, n, crap, test}, t}:
      Either<&2, &2, ML.And({f == fn : U32}, ML.And({test == False{} : Bool}, {crap == v : Nat})), Measured(t, fn, v)>

def Sound(+thr: Nat, ms: List<&2, C.CrM>, x: M.Finding) -> Data:
  match x:
    case M.Finding{+rule, +fn, +v, +t}:
      ML.And({rule == 5 : U32}, ML.And({Nat.is_gt(v, t) == True{} : Bool}, ML.And({t == thr : Nat}, Measured(ms, fn, v))))

# ---- E. the entry point -----------------------------------------------------------------------
# E1. the run is the joined records, measured and printed.
law crap_run:
  for +thr: Nat
  for +ms: List<&2, M.FnM>
  for +cvs: List<&2, C.Cv>
  {C.Crap.run(thr, ms, cvs) == C.Crap.out(thr, C.Crap.join(ms, cvs)) : Maybe<&2, List<&2, String>>}

# E2. joined records print the FX lines of their measures.
law crap_out_lines:
  for +thr: Nat
  for +xs: List<&2, C.Cr>
  {C.Crap.out(thr, Some{xs}) == Some{C.Crap.lines(thr, C.Crap.measure_all(xs))} : Maybe<&2, List<&2, String>>}

# E3. a refused join prints nothing.
law crap_out_refuses:
  for +thr: Nat
  {C.Crap.out(thr, None{}) == None{} : Maybe<&2, List<&2, String>>}

# E4. each function's CRAP is Crap.value of its own c and coverage.
law crap_measure:
  for +fn: U32
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for +test: Bool
  {C.Crap.measure(C.Cr{fn, c, cov, n, test}) == C.CrM{fn, c, cov, n, C.Crap.value(c, cov, n), test} : C.CrM}

law crap_measure_all_cons:
  for +x: C.Cr
  for +xs: List<&2, C.Cr>
  {C.Crap.measure_all(Con{x, xs}) == Con{C.Crap.measure(x), C.Crap.measure_all(xs)} : List<&2, C.CrM>}

# E5. one FX line per finding, in order.
law crap_lines_shape:
  for +thr: Nat
  for +ms: List<&2, C.CrM>
  {C.Crap.lines(thr, ms) == C.Crap.fxs(ms, C.Crap.findings(thr, ms)) : List<&2, String>}

# ---- V. the formula ---------------------------------------------------------------------------
# V1. CRAP = term + c, with u = coverable - covered.
law crap_value:
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  {C.Crap.value(c, cov, n) == Nat.add(C.Crap.term(c, Nat.sub(n, cov), n), c) : Nat}

# V2. the term is floor(c^2 u^3 / n^3): term x n^3 + r = c^2 u^3 for some r < n^3.
law crap_term_is_floor:
  for +c: Nat
  for +u: Nat
  for +n: Nat
  for hu: N.Le(u, n)
  for +hn: N.Le(1n, n)
  Sigma<&2, &2, Nat, r => ML.And({Nat.add(Nat.mul(C.Crap.term(c, u, n), C.Crap.cube(n)), r) == Nat.mul(Nat.mul(c, c), C.Crap.cube(u)) : Nat}, N.Le(1n+r, C.Crap.cube(n)))>

# V3. more coverage never raises CRAP.
law crap_monotone_coverage:
  for +c: Nat
  for +a: Nat
  for +b: Nat
  for +n: Nat
  for hab: N.Le(a, b)
  for hbn: N.Le(b, n)
  for +hn: N.Le(1n, n)
  N.Le(C.Crap.value(c, b, n), C.Crap.value(c, a, n))

# V4. CRAP is at least c.
law crap_at_least_c:
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  N.Le(c, C.Crap.value(c, cov, n))

# V5. full coverage leaves CRAP = c.
law crap_full_coverage:
  for +c: Nat
  for +n: Nat
  for +hn: N.Le(1n, n)
  {C.Crap.value(c, n, n) == c : Nat}

# ---- F. findings ------------------------------------------------------------------------------
# F1. sound: every finding is core.crap, strictly over the threshold, and the CRAP
# of a non-test function with coverage data.
law crap_findings_sound:
  for +thr: Nat
  for +ms: List<&2, C.CrM>
  for +x: M.Finding
  for hm: ML.MemF(C.Crap.findings(thr, ms), x)
  Sound(thr, ms, x)

# F2. complete: a non-test function's CRAP over the threshold is reported.
law crap_findings_complete:
  for +thr: Nat
  for +ms: List<&2, C.CrM>
  for +fn: U32
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for +v: Nat
  for hm: MemC(ms, C.CrM{fn, c, cov, n, v, False{}})
  for h: {Nat.is_gt(v, thr) == True{} : Bool}
  ML.MemF(C.Crap.findings(thr, ms), M.Finding{5, fn, v, thr})

# F3. a test function (TF) adds no findings.
law crap_skips_tests:
  for +thr: Nat
  for +fn: U32
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for +v: Nat
  for +ms: List<&2, C.CrM>
  {C.Crap.findings(thr, Con{C.CrM{fn, c, cov, n, v, True{}}, ms}) == C.Crap.findings(thr, ms) : List<&2, M.Finding>}

# ---- C. the cause -----------------------------------------------------------------------------
# C1-C2. cause is complexity-only exactly when c u^3 <= n^3 (u = coverable - covered).
law crap_cause_complexity_only:
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for h: {C.Crap.cause(c, cov, n) == True{} : Bool}
  N.Le(Nat.mul(c, C.Crap.cube(Nat.sub(n, cov))), C.Crap.cube(n))

law crap_cause_coverage:
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for h: {C.Crap.cause(c, cov, n) == False{} : Bool}
  N.Le(1n+C.Crap.cube(n), Nat.mul(c, C.Crap.cube(Nat.sub(n, cov))))

law crap_cause_name_complexity:
  {C.Crap.cause_name(True{}) == "complexity-only" : String}

law crap_cause_name_coverage:
  {C.Crap.cause_name(False{}) == "coverage" : String}

# C3-C5. the evidence of fn is the tail of its own record, with the cause; a function with
# no record (no coverage data) has none.
law crap_ev_none:
  for +fn: U32
  {C.Crap.ev(fn, Nil{}) == "" : String}

law crap_ev_skip:
  for +fn: U32
  for +f: U32
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for +v: Nat
  for +test: Bool
  for +t: List<&2, C.CrM>
  for h: {U32.is_eq(f, fn) == False{} : Bool}
  {C.Crap.ev(fn, Con{C.CrM{f, c, cov, n, v, test}, t}) == C.Crap.ev(fn, t) : String}

law crap_ev_hit:
  for +fn: U32
  for +f: U32
  for +c: Nat
  for +cov: Nat
  for +n: Nat
  for +v: Nat
  for +test: Bool
  for +t: List<&2, C.CrM>
  for h: {U32.is_eq(f, fn) == True{} : Bool}
  {C.Crap.ev(fn, Con{C.CrM{f, c, cov, n, v, test}, t}) == " cyclomatic=" ++ Nat.show(c) ++ " covered=" ++ Nat.show(cov) ++ " coverable=" ++ Nat.show(n) ++ " cause=" ++ C.Crap.cause_name(C.Crap.cause(c, cov, n)) : String}
