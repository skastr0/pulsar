# engine/Cognitive-LAWS.bend - laws about Cognitive.bend. Proofs: Cognitive-PROOF.bend.
# Gate: `bend engine/Cognitive-PROOF.bend --verdict`.
#
# The laws are about the shipped Cog.seq, Cog.measure_all, Cog.findings and
# Cognitive.lines. Not covered, by design: the CO decoder (MetricsIn.bend), like the
# other decoders.

import Base
import ./Metrics.bend as M
import ./Cognitive.bend as C
import ./Metrics-LAWS.bend as ML

def MemG(xs: List<&2, C.CgM>, m: C.CgM) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : C.CgM}, MemG(t, m)>

def Measured(ms: List<&2, C.CgM>, +fn: U32, +v: Nat) -> Data:
  match ms:
    case Nil{}:
      Empty
    case Con{C.CgM{f, cog, test}, t}:
      Either<&2, &2, ML.And({f == fn : U32}, ML.And({test == False{} : Bool}, {cog == v : Nat})), Measured(t, fn, v)>

def Sound(+thr: Nat, ms: List<&2, C.CgM>, x: M.Finding) -> Data:
  match x:
    case M.Finding{+rule, +fn, +v, +t}:
      ML.And({rule == 8 : U32}, ML.And({Nat.is_gt(v, t) == True{} : Bool}, ML.And({t == thr : Nat}, Measured(ms, fn, v))))

def Arm(kids: M.Ct, next: M.Ct) -> M.Ct:
  M.Node{M.KArm{}, kids, next}

# ---- S. the spec's increments -----------------------------------------------------------------
# S1. a multi-branch counts once: an empty arm adds nothing, wherever it sits.
law cog_multi_arm_free:
  for +kids: M.Ct
  for +next: M.Ct
  for +ctx: C.Cx
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.Cog.seq(M.Node{M.KMulti{}, Arm(M.Leaf{}, kids), next}, ctx, lvl, last, ops) == C.Cog.seq(M.Node{M.KMulti{}, kids, next}, ctx, lvl, last, ops) : C.CS}

# S2. a branch costs 1 + its level; the same branch one loop deeper costs one more.
law cog_if_at_level:
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KBranch{}, Arm(M.Leaf{}, M.Leaf{}), M.Leaf{}}, C.CAny{}, lvl, last, ops)) == 1n+lvl : Nat}

law cog_loop_nests:
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KLoop{}, M.Node{M.KBranch{}, Arm(M.Leaf{}, M.Leaf{}), M.Leaf{}}, M.Leaf{}}, C.CAny{}, lvl, last, ops)) == Nat.add(1n+lvl, 1n+(1n+lvl)) : Nat}

# S3. `else if` adds 1 and no level; a nested `if` in the then arm adds 1 + the level below.
law cog_else_if_flat:
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KBranch{}, Arm(M.Leaf{}, Arm(M.Node{M.KBranch{}, Arm(M.Leaf{}, M.Leaf{}), M.Leaf{}}, M.Leaf{})), M.Leaf{}}, C.CAny{}, lvl, last, ops)) == Nat.add(1n+lvl, 1n) : Nat}

law cog_then_if_nests:
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KBranch{}, Arm(M.Node{M.KBranch{}, Arm(M.Leaf{}, M.Leaf{}), M.Leaf{}}, M.Leaf{}), M.Leaf{}}, C.CAny{}, lvl, last, ops)) == Nat.add(1n+lvl, 1n+(1n+lvl)) : Nat}

# S4. each catch costs 1 + the level; the try body keeps the level.
law cog_catch:
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KTry{}, Arm(M.Leaf{}, Arm(M.Leaf{}, M.Leaf{})), M.Leaf{}}, C.CAny{}, lvl, last, ops)) == 1n+lvl : Nat}

# S5. a run of the same operator counts once: a repeat of the previous operator adds nothing.
law cog_same_op_once:
  for +o: C.Op
  for +rest: M.Ct
  for +ctx: C.Cx
  for +lvl: Nat
  for +last: C.Op
  for +os: List<&2, C.Op>
  {C.Cog.seq(M.Node{M.KSc{}, M.Leaf{}, M.Node{M.KSc{}, M.Leaf{}, rest}}, ctx, lvl, last, Con{o, Con{o, os}}) == C.Cog.seq(M.Node{M.KSc{}, M.Leaf{}, rest}, ctx, lvl, last, Con{o, os}) : C.CS}

# S6. a change of operator starts a new run.
law cog_op_change:
  for +lvl: Nat
  {C.CS.n(C.Cog.seq(M.Node{M.KSc{}, M.Leaf{}, M.Node{M.KSc{}, M.Leaf{}, M.Leaf{}}}, C.CAny{}, lvl, C.ONone{}, [C.OAnd{}, C.OOr{}])) == 2n : Nat}

# S6'. an operator the white paper does not score (CO 3..7: `??`, the assignment forms and
# optional chaining `?.`, read as ONone) adds nothing and does not break a run: the count
# is that of what follows, with the same last operator. Optional chaining counts for
# cyclomatic and NPath (Metrics-LAWS C5, N), not here: the SonarSource spec does not
# increment for it (lead ruling, 2026-11-07).
law cog_unscored_op_free:
  for +rest: M.Ct
  for +ctx: C.Cx
  for +lvl: Nat
  for +last: C.Op
  for +os: List<&2, C.Op>
  {C.CS.n(C.Cog.seq(M.Node{M.KSc{}, M.Leaf{}, rest}, ctx, lvl, last, Con{C.ONone{}, os})) == C.CS.n(C.Cog.seq(rest, ctx, lvl, last, os)) : Nat}

# S7. a nested function's boundary adds nothing here (it is measured in its own tree).
law cog_nested_fn_free:
  for +next: M.Ct
  for +ctx: C.Cx
  for +lvl: Nat
  for +last: C.Op
  for +ops: List<&2, C.Op>
  {C.Cog.seq(M.Node{M.KFn{}, M.Leaf{}, next}, ctx, lvl, last, ops) == C.Cog.seq(next, ctx, lvl, last, ops) : C.CS}

# ---- E. the entry point -----------------------------------------------------------------------
law cog_lines:
  for +thr: Nat
  for +fs: List<&2, M.FnT>
  for +ops: List<&2, C.Op>
  {C.Cognitive.lines(thr, fs, ops) == C.Cog.fxs(C.Cog.findings(thr, C.Cog.measure_all(fs, ops))) : List<&2, String>}

# Each function is measured from its own tree, then hands the rest of the operators on.
law cog_measure_cons:
  for +fn: U32
  for +t: M.Ct
  for +loc: U32
  for +test: Bool
  for +rest: List<&2, M.FnT>
  for +ops: List<&2, C.Op>
  {C.Cog.measure_all(Con{M.FnT{fn, t, loc, test}, rest}, ops) == Con{C.CgM{fn, C.CS.n(C.Cog.of(t, ops)), test}, C.Cog.measure_all(rest, C.CS.ops(C.Cog.of(t, ops)))} : List<&2, C.CgM>}

# ---- F. findings ------------------------------------------------------------------------------
law cog_findings_sound:
  for +thr: Nat
  for +ms: List<&2, C.CgM>
  for +x: M.Finding
  for hm: ML.MemF(C.Cog.findings(thr, ms), x)
  Sound(thr, ms, x)

law cog_findings_complete:
  for +thr: Nat
  for +ms: List<&2, C.CgM>
  for +fn: U32
  for +v: Nat
  for hm: MemG(ms, C.CgM{fn, v, False{}})
  for h: {Nat.is_gt(v, thr) == True{} : Bool}
  ML.MemF(C.Cog.findings(thr, ms), M.Finding{8, fn, v, thr})

law cog_skips_tests:
  for +thr: Nat
  for +fn: U32
  for +v: Nat
  for +ms: List<&2, C.CgM>
  {C.Cog.findings(thr, Con{C.CgM{fn, v, True{}}, ms}) == C.Cog.findings(thr, ms) : List<&2, M.Finding>}

# ---- G. FM lines ------------------------------------------------------------------------------
# Pairing Metrics' and Cognitive's measures of the same trees gives each function, in order,
# exactly one FM line: its Metrics measures (Metrics-LAWS E3), then its cognitive measure.
law cog_fms_nil:
  for +cap: Nat
  for +ops: List<&2, C.Op>
  {C.Cog.fms(M.Metrics.measure_all(Nil{}, cap), C.Cog.measure_all(Nil{}, ops)) == Nil{} : List<&2, String>}

law cog_fms_aligned:
  for +fn: U32
  for +t: M.Ct
  for +loc: U32
  for +test: Bool
  for +rest: List<&2, M.FnT>
  for +cap: Nat
  for +ops: List<&2, C.Op>
  {C.Cog.fms(M.Metrics.measure_all(Con{M.FnT{fn, t, loc, test}, rest}, cap), C.Cog.measure_all(Con{M.FnT{fn, t, loc, test}, rest}, ops)) == Con{M.Report.fm(M.FnM{fn, M.Cc.of(t), M.Nest.of(t), M.Np.of(t, cap), U32.to_nat(loc), test}) ++ " " ++ Nat.show(C.CS.n(C.Cog.of(t, ops))), C.Cog.fms(M.Metrics.measure_all(rest, cap), C.Cog.measure_all(rest, C.CS.ops(C.Cog.of(t, ops))))} : List<&2, String>}
