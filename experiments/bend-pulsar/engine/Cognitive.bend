# Cognitive.bend - cognitive complexity (rule 8, core.cognitive) from the control tree.
#
# After the SonarSource white paper (G. Ann Campbell, "Cognitive Complexity"),
# computed from what CT and CO say (FACTS.md), with no source text:
#
#   +1 + level   a branch (if, ternary), a multi-branch (once, whatever its arms), a
#                loop, and each catch arm of a try
#   +1           an `else if`: the else arm holding only a branch. It adds no level.
#   +1           a run of the same boolean operator among sibling short-circuits:
#                `&&` and `||` (CO op 1, 2). `??` and the assignments (3-6) add nothing
#   level        +1 inside a branch's arm, a multi-branch arm, a loop and a catch arm;
#                a try body and a finally keep the level
#
# Where CT cannot tell what the spec needs, the count leans low, so it never exceeds
# the paper's count for the same code:
# - `else` adds nothing (CT cannot tell `if/else` from a ternary, which the paper charges once);
# - recursion and labelled jumps add nothing (CT has no fact for them);
# - a nested function counts in its own tree, not inside its parent;
# - a missing CO row reads as an operator that adds nothing.
# One deviation is a choice, not a CT limit, and is a documented undercount: operator
# runs merge across sibling statements under the same control node, so
# `a && b; c && d` counts +1 where the paper counts +2 (one sequence per expression).
# It leans low, the safe direction; revisit if dogfood shows it hiding real cases.
#
# The k-th short-circuit node of the whole input, in function order then preorder,
# takes the k-th operator of `ops`. The decoder builds `ops` from the CT and CO rows
# (MetricsIn.bend). Default threshold 15 (SonarQube S3776 convention; weak evidence,
# research/cognitive-complexity.md), strictly greater. The rule ships off by default:
# the CLI shows it only when .pulsar/policy.toml enables it.
#
#   FX core.cognitive <fn> <cognitive> <threshold>

import Base
import ./Metrics.bend as M

type Op is Data:
  OAnd{}
  OOr{}
  ONone{}

# Where a chain sits: anywhere; a branch's children before its first arm, or after
# it; a multi-branch's children; a try's children before its first arm (the body),
# or after it (the catches); the lone branch of an `else if`.
type Cx is Data:
  CAny{}
  CBr0{}
  CBr1{}
  CMulti{}
  CTry0{}
  CTry1{}
  CElif{}

# A chain's count, the operators left for what follows, and the last counted operator.
type CS is Data:
  CS{n: Nat, ops: List<&2, Op>, last: Op}

type CgM is Data:
  CgM{fn: U32, cog: Nat, test: Bool}

def Cog.default_thr() -> Nat:
  15n

def CS.n(s: CS) -> Nat:
  match s:
    case CS{n, ops, last}:
      n

def CS.ops(s: CS) -> List<&2, Op>:
  match s:
    case CS{n, ops, last}:
      ops

def CS.last(s: CS) -> Op:
  match s:
    case CS{n, ops, last}:
      last

# ---- the operator run -------------------------------------------------------------------------
def Cog.inc(o: Op, last: Op) -> Nat:
  match o last:
    case OAnd{} OAnd{}:
      0n
    case OOr{} OOr{}:
      0n
    case ONone{} _:
      0n
    case OAnd{} _:
      1n
    case OOr{} _:
      1n

def Cog.last(o: Op, last: Op) -> Op:
  match o:
    case OAnd{}:
      OAnd{}
    case OOr{}:
      OOr{}
    case ONone{}:
      last

def Ops.hd(ops: List<&2, Op>) -> Op:
  match ops:
    case Nil{}:
      ONone{}
    case Con{h, t}:
      h

def Ops.tl(ops: List<&2, Op>) -> List<&2, Op>:
  match ops:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      t

# A short-circuit node takes the next operator; any other node takes none.
def Cog.op_of(k: M.K, +ops: List<&2, Op>) -> Op:
  match k:
    case M.KSc{}:
      Ops.hd(ops)
    case _:
      ONone{}

def Cog.ops_after(k: M.K, +ops: List<&2, Op>) -> List<&2, Op>:
  match k:
    case M.KSc{}:
      Ops.tl(ops)
    case _:
      ops

# ---- one node ---------------------------------------------------------------------------------
# What the node itself adds at level `lvl`.
def Cog.self(k: M.K, ctx: Cx, +lvl: Nat, o: Op, last: Op) -> Nat:
  match k ctx:
    case M.KBranch{} CElif{}:
      1n
    case M.KBranch{} _:
      1n+lvl
    case M.KMulti{} _:
      1n+lvl
    case M.KLoop{} _:
      1n+lvl
    case M.KArm{} CTry1{}:
      1n+lvl
    case M.KSc{} _:
      Cog.inc(o, last)
    case _ _:
      0n

def Cog.kctx_arm(ctx: Cx, lone: Bool) -> Cx:
  match ctx lone:
    case CBr1{} True{}:
      CElif{}
    case _ _:
      CAny{}

# The context of the node's children.
def Cog.kctx(k: M.K, ctx: Cx, lone: Bool) -> Cx:
  match k:
    case M.KBranch{}:
      CBr0{}
    case M.KMulti{}:
      CMulti{}
    case M.KTry{}:
      CTry0{}
    case M.KArm{}:
      Cog.kctx_arm(ctx, lone)
    case _:
      CAny{}

def Cog.klvl_arm(ctx: Cx, lone: Bool, +lvl: Nat) -> Nat:
  match ctx lone:
    case CBr0{} _:
      1n+lvl
    case CBr1{} True{}:
      lvl
    case CBr1{} False{}:
      1n+lvl
    case CMulti{} _:
      1n+lvl
    case CTry1{} _:
      1n+lvl
    case _ _:
      lvl

# The level of the node's children.
def Cog.klvl(k: M.K, ctx: Cx, lone: Bool, +lvl: Nat) -> Nat:
  match k:
    case M.KLoop{}:
      1n+lvl
    case M.KArm{}:
      Cog.klvl_arm(ctx, lone, lvl)
    case _:
      lvl

# The context of the node's later siblings.
def Cog.after(k: M.K, ctx: Cx) -> Cx:
  match k ctx:
    case M.KArm{} CBr0{}:
      CBr1{}
    case M.KArm{} CTry0{}:
      CTry1{}
    case _ _:
      ctx

# ---- a chain ----------------------------------------------------------------------------------
# The count of chain `t` at context `ctx` and level `lvl`, after operator `last`.
def Cog.seq(t: M.Ct, +ctx: Cx, +lvl: Nat, +last: Op, +ops: List<&2, Op>) -> CS:
  match t:
    case M.Leaf{}:
      CS{0n, ops, last}
    case M.Node{+k, +kids, next}:
      +o = Cog.op_of(k, ops)
      +r = Cog.seq(kids, Cog.kctx(k, ctx, M.Nest.lone(kids)), Cog.klvl(k, ctx, M.Nest.lone(kids), lvl), ONone{}, Cog.ops_after(k, ops))
      +s = Cog.seq(next, Cog.after(k, ctx), lvl, Cog.last(o, last), CS.ops(r))
      CS{Nat.add(Nat.add(Cog.self(k, ctx, lvl, o, last), CS.n(r)), CS.n(s)), CS.ops(s), CS.last(s)}

def Cog.of(t: M.Ct, +ops: List<&2, Op>) -> CS:
  Cog.seq(t, CAny{}, 0n, ONone{}, ops)

# ---- measures, findings, output ---------------------------------------------------------------
def Cog.measure_all(fs: List<&2, M.FnT>, +ops: List<&2, Op>) -> List<&2, CgM>:
  match fs:
    case Nil{}:
      Nil{}
    case Con{M.FnT{fn, +t, loc, test}, rest}:
      +s = Cog.of(t, ops)
      Con{CgM{fn, CS.n(s), test}, Cog.measure_all(rest, CS.ops(s))}

def Cog.prod(test: Bool, +fn: U32, +v: Nat, +thr: Nat, rest: List<&2, M.Finding>) -> List<&2, M.Finding>:
  match test:
    case True{}:
      rest
    case False{}:
      M.Rule.check(8, fn, v, thr, rest)

def Cog.findings(+thr: Nat, ms: List<&2, CgM>) -> List<&2, M.Finding>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{CgM{+fn, +v, test}, t}:
      Cog.prod(test, fn, v, thr, Cog.findings(thr, t))

def Cog.fx_line(x: M.Finding) -> String:
  match x:
    case M.Finding{rule, fn, v, thr}:
      "FX core.cognitive " ++ U32.show(fn) ++ " " ++ Nat.show(v) ++ " " ++ Nat.show(thr)

def Cog.fxs(xs: List<&2, M.Finding>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Cog.fx_line(h), Cog.fxs(t)}

# The entry point: the functions' trees and the operators to FX lines.
def Cognitive.lines(+thr: Nat, fs: List<&2, M.FnT>, +ops: List<&2, Op>) -> List<&2, String>:
  Cog.fxs(Cog.findings(thr, Cog.measure_all(fs, ops)))
