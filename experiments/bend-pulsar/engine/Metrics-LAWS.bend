# engine/Metrics-LAWS.bend - laws about Metrics.bend, the per-function measures.
# Filled in Metrics-PROOF.bend. Gate: `bend engine/Metrics-PROOF.bend --verdict`.
#
# Every law is about the functions the binary runs: Metrics.run (the entry
# point), Metrics.measure, the measures Cc.seq / Nest.seq / Np.agg, and
# Metrics.findings. Ct.cat, MemF, MemM, Measured, Thr and Field below only
# describe inputs and outputs; none of them is called by the binary.
#
# Not covered by any law, by design: Build.* (CT rows to trees, like Parse.bend
# for bytes). The builder is shown against the fixtures in Metrics-CHECK.bend.

import Base
import ./Metrics.bend as M

# ---- describing inputs and outputs ---------------------------------------------------------------
def And(-A: Data, -B: Data) -> Data:
  Sigma<&2, &2, A, _ => B>

# Two sibling chains, one after the other: the statements of `a`, then those of `b`.
def Ct.cat(a: M.Ct, b: M.Ct) -> M.Ct:
  match a:
    case M.Leaf{}:
      b
    case M.Node{k, kids, next}:
      M.Node{k, kids, Ct.cat(next, b)}

def MemF(xs: List<&2, M.Finding>, x: M.Finding) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == x : M.Finding}, MemF(t, x)>

def MemM(xs: List<&2, M.FnM>, m: M.FnM) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : M.FnM}, MemM(t, m)>

# The threshold rule `rule` carries, and the measure it reads.
def Thr(r: M.Rules, +rule: U32) -> Nat:
  match r:
    case M.Rules{cc, nest, np, loc, cap}:
      match rule:
        case 1:
          cc
        case 2:
          nest
        case 3:
          np
        case _:
          loc

def Field(m: M.FnM, +rule: U32) -> Nat:
  match m:
    case M.FnM{fn, cc, nest, np, loc}:
      match rule:
        case 1:
          cc
        case 2:
          nest
        case 3:
          np
        case _:
          loc

# Some function in `ms` is `fn`, and its measure for `rule` is `v`.
def Measured(ms: List<&2, M.FnM>, +rule: U32, +fn: U32, +v: Nat) -> Data:
  match ms:
    case Nil{}:
      Empty
    case Con{M.FnM{f, cc, nest, np, loc}, t}:
      Either<&2, &2, And({f == fn : U32}, {Field(M.FnM{f, cc, nest, np, loc}, rule) == v : Nat}), Measured(t, rule, fn, v)>

# What a reported finding must satisfy.
def Sound(r: M.Rules, ms: List<&2, M.FnM>, x: M.Finding) -> Data:
  match x:
    case M.Finding{+rule, +fn, +v, +thr}:
      And({Nat.is_gt(v, thr) == True{} : Bool}, And({thr == Thr(r, rule) : Nat}, Measured(ms, rule, fn, v)))

# ---- E. the entry point ------------------------------------------------------------------------
# main prints Metrics.lines(rules, ms) for the ms that Metrics.run answers.

# E1. valid facts: every function's measures, from its tree.
law run_measures_trees:
  for +r: M.Rules
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  for +fs: List<&2, M.FnT>
  for h: {M.Trees.of(fns, cts) == Some{fs} : Maybe<&2, List<&2, M.FnT>>}
  {M.Metrics.run(r, fns, cts) == Some{M.Metrics.measure_all(fs, M.Rules.cap(r))} : Maybe<&2, List<&2, M.FnM>>}

# E2. invalid facts are refused, never measured.
law run_refuses_invalid:
  for +r: M.Rules
  for +fns: List<&2, M.Fn>
  for +cts: List<&2, M.CtRow>
  for h: {M.Trees.of(fns, cts) == None{} : Maybe<&2, List<&2, M.FnT>>}
  {M.Metrics.run(r, fns, cts) == None{} : Maybe<&2, List<&2, M.FnM>>}

# E3. the printed measures are exactly Cc.of, Nest.of and Np.of of the tree,
# and the length is the FN fact's `loc`.
law measure_is_the_measures:
  for +fn: U32
  for +t: M.Ct
  for +loc: U32
  for +cap: Nat
  {M.Metrics.measure(M.FnT{fn, t, loc}, cap) == M.FnM{fn, M.Cc.of(t), M.Nest.of(t), M.Np.of(t, cap), U32.to_nat(loc)} : M.FnM}

# E4. measure_all measures each function, in order.
law measure_all_cons:
  for +f: M.FnT
  for +fs: List<&2, M.FnT>
  for +cap: Nat
  {M.Metrics.measure_all(Con{f, fs}, cap) == Con{M.Metrics.measure(f, cap), M.Metrics.measure_all(fs, cap)} : List<&2, M.FnM>}

# E5. the output is one FM line per function, then one FX line per finding.
law lines_shape:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  {M.Metrics.lines(r, ms) == List.append(&2, String, M.Report.fms(ms), M.Report.fxs(M.Metrics.findings(r, ms))) : List<&2, String>}

# ---- F. findings ------------------------------------------------------------------------------
# F1. sound: every finding is over its rule's threshold, and its value is the
# measure of a function that was measured.
law findings_sound:
  for +r: M.Rules
  for +ms: List<&2, M.FnM>
  for +x: M.Finding
  for hm: MemF(M.Metrics.findings(r, ms), x)
  Sound(r, ms, x)

# F2-F5. complete: a measure over its rule's threshold is reported, for each rule.
law findings_complete_cyclomatic:
  for +tcc: Nat
  for +tnest: Nat
  for +tnp: Nat
  for +tloc: Nat
  for +cap: Nat
  for +ms: List<&2, M.FnM>
  for +fn: U32
  for +cc: Nat
  for +nest: Nat
  for +np: Nat
  for +loc: Nat
  for hm: MemM(ms, M.FnM{fn, cc, nest, np, loc})
  for h: {Nat.is_gt(cc, tcc) == True{} : Bool}
  MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, ms), M.Finding{1, fn, cc, tcc})

law findings_complete_nesting:
  for +tcc: Nat
  for +tnest: Nat
  for +tnp: Nat
  for +tloc: Nat
  for +cap: Nat
  for +ms: List<&2, M.FnM>
  for +fn: U32
  for +cc: Nat
  for +nest: Nat
  for +np: Nat
  for +loc: Nat
  for hm: MemM(ms, M.FnM{fn, cc, nest, np, loc})
  for h: {Nat.is_gt(nest, tnest) == True{} : Bool}
  MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, ms), M.Finding{2, fn, nest, tnest})

law findings_complete_npath:
  for +tcc: Nat
  for +tnest: Nat
  for +tnp: Nat
  for +tloc: Nat
  for +cap: Nat
  for +ms: List<&2, M.FnM>
  for +fn: U32
  for +cc: Nat
  for +nest: Nat
  for +np: Nat
  for +loc: Nat
  for hm: MemM(ms, M.FnM{fn, cc, nest, np, loc})
  for h: {Nat.is_gt(np, tnp) == True{} : Bool}
  MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, ms), M.Finding{3, fn, np, tnp})

law findings_complete_length:
  for +tcc: Nat
  for +tnest: Nat
  for +tnp: Nat
  for +tloc: Nat
  for +cap: Nat
  for +ms: List<&2, M.FnM>
  for +fn: U32
  for +cc: Nat
  for +nest: Nat
  for +np: Nat
  for +loc: Nat
  for hm: MemM(ms, M.FnM{fn, cc, nest, np, loc})
  for h: {Nat.is_gt(loc, tloc) == True{} : Bool}
  MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, ms), M.Finding{4, fn, loc, tloc})

# ---- X. nested functions ----------------------------------------------------------------------
# A kind-8 node and anything under it count for nothing in this function.

# X1. cyclomatic skips it.
law cyclomatic_skips_nested_fn:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KFn{}, kids, next}) == M.Cc.seq(next) : Nat}

# X2. nesting skips it.
law nesting_skips_nested_fn:
  for +kids: M.Ct
  for +next: M.Ct
  for +m: M.Md
  {M.Nest.seq(M.Node{M.KFn{}, kids, next}, m) == M.Nest.seq(next, m) : Nat}

# X3. NPath never reads its subtree: any subtree gives what no subtree gives.
law npath_ignores_nested_fn_body:
  for +kids: M.Ct
  for +next: M.Ct
  for +cap: Nat
  {M.Np.agg(M.Node{M.KFn{}, kids, next}, cap) == M.Np.agg(M.Node{M.KFn{}, M.Leaf{}, next}, cap) : M.Agg}

# ---- C. cyclomatic ----------------------------------------------------------------------------
# C1. cyclomatic is 1 + the decisions.
law cyclomatic_is_one_plus_decisions:
  for +t: M.Ct
  {M.Cc.of(t) == 1n+M.Cc.seq(t) : Nat}

# C2. decisions add up over statements in sequence.
law decisions_add_up:
  for +a: M.Ct
  for +b: M.Ct
  {M.Cc.seq(Ct.cat(a, b)) == Nat.add(M.Cc.seq(a), M.Cc.seq(b)) : Nat}

# C3-C5. a branch, a loop and a short-circuit are one decision each.
law decision_branch:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KBranch{}, kids, next}) == 1n+Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

law decision_loop:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KLoop{}, kids, next}) == 1n+Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

law decision_short_circuit:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KSc{}, kids, next}) == 1n+Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

# C6. a multi-branch is one decision per arm, less one for a default.
law decision_multi:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KMulti{}, kids, next}) == Nat.add(Nat.add(Nat.sub(M.Cc.arms(kids), M.Cc.dflt(kids)), M.Cc.seq(kids)), M.Cc.seq(next)) : Nat}

# C7. a try is one decision per arm after the body: one per catch.
law decision_try:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KTry{}, kids, next}) == Nat.add(Nat.add(Nat.sub(M.Cc.arms(kids), 1n), M.Cc.seq(kids)), M.Cc.seq(next)) : Nat}

# C8. arms, early exits, flags and finally arms are not decisions.
law no_decision_arm:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KArm{}, kids, next}) == Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

law no_decision_exit:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KExit{}, kids, next}) == Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

law no_decision_flag:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KFlag{}, kids, next}) == Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

law no_decision_finally:
  for +kids: M.Ct
  for +next: M.Ct
  {M.Cc.seq(M.Node{M.KFin{}, kids, next}) == Nat.add(M.Cc.seq(kids), M.Cc.seq(next)) : Nat}

# C9. the arms a multi-branch counts are exactly its kind-2 children.
law arms_add_up:
  for +a: M.Ct
  for +b: M.Ct
  {M.Cc.arms(Ct.cat(a, b)) == Nat.add(M.Cc.arms(a), M.Cc.arms(b)) : Nat}

# ---- D. nesting -------------------------------------------------------------------------------
# D1. a loop is one level deeper than its body.
law nesting_loop:
  for +kids: M.Ct
  for +next: M.Ct
  for +m: M.Md
  {M.Nest.seq(M.Node{M.KLoop{}, kids, next}, m) == Nat.max(1n+M.Nest.seq(kids, M.MAny{}), M.Nest.seq(next, m)) : Nat}

# D2. `if (c) { if (d) {b} }` nests: two levels plus b's.
law nesting_then_if_nests:
  for +b: M.Ct
  {M.Nest.of(M.Node{M.KBranch{}, M.Node{M.KArm{}, M.Node{M.KBranch{}, b, M.Leaf{}}, M.Leaf{}}, M.Leaf{}}) == 2n+M.Nest.seq(b, M.MPre{}) : Nat}

# D3. `if (c) {a} else if (d) {b}` does not: one level plus the deeper of a and b.
law nesting_else_if_is_flat:
  for +a: M.Ct
  for +b: M.Ct
  {M.Nest.of(M.Node{M.KBranch{}, M.Node{M.KArm{}, a, M.Node{M.KArm{}, M.Node{M.KBranch{}, b, M.Leaf{}}, M.Leaf{}}}, M.Leaf{}}) == 1n+Nat.max(M.Nest.seq(a, M.MAny{}), M.Nest.seq(b, M.MPre{})) : Nat}
