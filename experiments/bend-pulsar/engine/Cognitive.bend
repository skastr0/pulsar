# Cognitive.bend - cognitive complexity (rule 8, core.cognitive) from the control tree.
#
# After the SonarSource white paper (G. Ann Campbell, "Cognitive Complexity"),
# computed from what CT and CO say (FACTS.md), with no source text:
#
#   +1 + level   a branch (if, ternary), a multi-branch (once, whatever its arms), a
#                loop, and each catch arm of a try
#   +1           an `else if`: the else arm of an `if` whose CB flavor is 4. It adds no level.
#   +1           a plain `else` (CB flavor 3), at no level
#   +1           a `break` or `continue` to a label (CB flavor 5 on its kind-7 node)
#   +1           each run of `&&` or `||`: the adapter marks where a run starts (CO op 1 and 2
#                start one, 9 and 10 continue it, read as ONone). `??` and the assignments
#                (3-6) add nothing
#   level        +1 inside a branch's arm, a multi-branch arm, a loop and a catch arm;
#                a try body and a finally keep the level
#
# The CB flavor of a branch (FACTS.md) decides what its else arm is: flavor 4 makes a lone
# branch in it an `else if`; flavors 1 (ternary), 2 and 3 never do, so a ternary in the
# alternate and `else { if .. }` are nested branches (+1 + level). A branch with no CB row
# (an adapter that does not emit it) keeps the v1 reading: a lone branch in the second arm
# is an `else if`, and `else` adds nothing.
#
# Where the facts cannot tell what the spec needs, the count leans low, so it never exceeds
# the paper's count for the same code:
# - recursion and labelled jumps add nothing (no fact for them);
# - a nested function counts in its own tree, not inside its parent;
# - a missing CO row reads as an operator that adds nothing.
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

# One token per kind-6 node (the operator) and per kind-1 node (its CB flavor), in preorder.
# ONone is also what a branch with no CB row takes.
type Op is Data:
  OAnd{}
  OOr{}
  ONone{}
  FTern{}
  FIf{}
  FIfE{}
  FIfEl{}
  FLab{}

# Where a chain sits: anywhere; a branch's children before its first arm, or after
# it; a multi-branch's children; a try's children before its first arm (the body),
# or after it (the catches); the lone branch of an `else if`.
# CBr0 and CBr1 are the v1 reading (flavor unknown); the E forms are a flavor-4 `if` (its else
# arm is an `else if`); the N forms a branch whose else arm is never one.
type Cx is Data:
  CAny{}
  CBr0{}
  CBr1{}
  CBr0E{}
  CBr1E{}
  CBr0N{}
  CBr1N{}
  CMulti{}
  CTry0{}
  CTry1{}
  CElif{}

# A chain's count and the tokens left for what follows.
type CS is Data:
  CS{n: Nat, ops: List<&2, Op>}

type CgM is Data:
  CgM{fn: U32, cog: Nat, test: Bool}

def Cog.default_thr() -> Nat:
  15n

def CS.n(s: CS) -> Nat:
  match s:
    case CS{n, ops}:
      n

def CS.ops(s: CS) -> List<&2, Op>:
  match s:
    case CS{n, ops}:
      ops

# ---- the operator run -------------------------------------------------------------------------
def Cog.inc(o: Op) -> Nat:
  match o:
    case OAnd{}:
      1n
    case OOr{}:
      1n
    case _:
      0n

# A `break` or `continue` to a label (flavor 5) costs one, at no level.
def Cog.jump_inc(o: Op) -> Nat:
  match o:
    case FLab{}:
      1n
    case _:
      0n

# A plain `else` (flavor 3) costs one, at no level.
def Cog.else_inc(o: Op) -> Nat:
  match o:
    case FIfE{}:
      1n
    case _:
      0n

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

# A short-circuit node takes the next operator and a branch node the next flavor; any other
# node takes none.
def Cog.op_of(k: M.K, +ops: List<&2, Op>) -> Op:
  match k:
    case M.KSc{}:
      Ops.hd(ops)
    case M.KBranch{}:
      Ops.hd(ops)
    case M.KExit{}:
      Ops.hd(ops)
    case _:
      ONone{}

def Cog.ops_after(k: M.K, +ops: List<&2, Op>) -> List<&2, Op>:
  match k:
    case M.KSc{}:
      Ops.tl(ops)
    case M.KBranch{}:
      Ops.tl(ops)
    case M.KExit{}:
      Ops.tl(ops)
    case _:
      ops

# ---- one node ---------------------------------------------------------------------------------
# What the node itself adds at level `lvl`.
def Cog.self(k: M.K, ctx: Cx, +lvl: Nat, o: Op) -> Nat:
  match k ctx:
    case M.KBranch{} CElif{}:
      Nat.add(Cog.else_inc(o), 1n)
    case M.KBranch{} _:
      Nat.add(Cog.else_inc(o), 1n+lvl)
    case M.KMulti{} _:
      1n+lvl
    case M.KLoop{} _:
      1n+lvl
    case M.KArm{} CTry1{}:
      1n+lvl
    case M.KSc{} _:
      Cog.inc(o)
    case M.KExit{} _:
      Cog.jump_inc(o)
    case _ _:
      0n

def Cog.kctx_arm(ctx: Cx, lone: Bool) -> Cx:
  match ctx lone:
    case CBr1{} True{}:
      CElif{}
    case CBr1E{} True{}:
      CElif{}
    case _ _:
      CAny{}

# What a branch's children see before its first arm, by its flavor.
def Cog.brctx(o: Op) -> Cx:
  match o:
    case FIfEl{}:
      CBr0E{}
    case FTern{}:
      CBr0N{}
    case FIf{}:
      CBr0N{}
    case FIfE{}:
      CBr0N{}
    case _:
      CBr0{}

# The context of the node's children.
def Cog.kctx(k: M.K, ctx: Cx, lone: Bool, o: Op) -> Cx:
  match k:
    case M.KBranch{}:
      Cog.brctx(o)
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
    case CBr0E{} _:
      1n+lvl
    case CBr0N{} _:
      1n+lvl
    case CBr1{} True{}:
      lvl
    case CBr1{} False{}:
      1n+lvl
    case CBr1E{} True{}:
      lvl
    case CBr1E{} False{}:
      1n+lvl
    case CBr1N{} _:
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
    case M.KArm{} CBr0E{}:
      CBr1E{}
    case M.KArm{} CBr0N{}:
      CBr1N{}
    case M.KArm{} CTry0{}:
      CTry1{}
    case _ _:
      ctx

# ---- a chain ----------------------------------------------------------------------------------
# The count of chain `t` at context `ctx` and level `lvl`.
def Cog.seq(t: M.Ct, +ctx: Cx, +lvl: Nat, +ops: List<&2, Op>) -> CS:
  match t:
    case M.Leaf{}:
      CS{0n, ops}
    case M.Node{+k, +kids, next}:
      +o = Cog.op_of(k, ops)
      +r = Cog.seq(kids, Cog.kctx(k, ctx, M.Nest.lone(kids), o), Cog.klvl(k, ctx, M.Nest.lone(kids), lvl), Cog.ops_after(k, ops))
      +s = Cog.seq(next, Cog.after(k, ctx), lvl, CS.ops(r))
      CS{Nat.add(Nat.add(Cog.self(k, ctx, lvl, o), CS.n(r)), CS.n(s)), CS.ops(s)}

def Cog.of(t: M.Ct, +ops: List<&2, Op>) -> CS:
  Cog.seq(t, CAny{}, 0n, ops)

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

# ---- FM lines ---------------------------------------------------------------------------------
# A function's FM line from Metrics (cyclomatic, nesting, npath, length) with its cognitive
# measure as a fifth field. MetricsIn pairs the two measure lists of the same trees, in order.
def Cog.fm(m: M.FnM, g: CgM) -> String:
  match g:
    case CgM{fn, cog, test}:
      M.Report.fm(m) ++ " " ++ Nat.show(cog)

def Cog.fms(ms: List<&2, M.FnM>, gs: List<&2, CgM>) -> List<&2, String>:
  match ms gs:
    case Con{m, t} Con{g, u}:
      Con{Cog.fm(m, g), Cog.fms(t, u)}
    case _ _:
      Nil{}
