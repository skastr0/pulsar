# engine/Fanout-LAWS.bend - laws about Fanout.bend. Proofs: Fanout-PROOF.bend.
# Gate: `bend engine/Fanout-PROOF.bend --verdict`.
#
# Rch(k, x) is what "function x reaches a call of class c within k call edges" means
# in the facts: k = 0, a CS fact in x whose callee has a CL fact for c; k + 1, that, or
# a CE fact from x to a function that reaches within k. The laws tie the shipped
# functions to it: the reach set Fo.reach is exactly the functions with Rch (sound and
# complete), every finding of a rule row is a loop site with a matching chain (sound),
# and every such site is a finding (complete). Not covered, by design: decoding the rows.

import Base
import ../LAWS.bend as TL
import ./Scope.bend as S
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as CL
import ./Fanout.bend as F

def MemNx(xs: List<&2, F.Nx>, m: F.Nx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : F.Nx}, MemNx(t, m)>

def MemCs(xs: List<&2, X.Cs>, m: X.Cs) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : X.Cs}, MemCs(t, m)>

def MemCe(xs: List<&2, F.Ce>, m: F.Ce) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : F.Ce}, MemCe(t, m)>

def MemRf(xs: List<&2, F.Rf>, m: F.Rf) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : F.Rf}, MemRf(t, m)>

# The CS fact s is in function x and calls a symbol of class c.
def SeedAt(s: X.Cs, +cls: List<&2, X.Cl>, +c: U32, +x: U32) -> Data:
  match s:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({fn == x : U32}, CL.ClHas(cls, callee, c))

# x reaches a call of class c within k CE edges.
def Rch(k: Nat, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +x: U32) -> Data:
  match k:
    case 0n:
      TL.Ex(X.Cs, s => TL.And(MemCs(css, s), SeedAt(s, cls, c, x)))
    case 1n+p:
      Either<&2, &2, Rch(p, css, ces, cls, c, x), TL.Ex(F.Ce, e => TL.And(MemCe(ces, e), TL.And({F.Ce.fn(e) == x : U32}, Rch(p, css, ces, cls, c, F.Ce.target(e)))))>

# A loop site (loop depth > 0) whose ctx has no bit of `none`, in the facts' terms.
def AtLoop(+ld: U32, +ctx: U32, +none: U32) -> Data:
  TL.And({U32.is_eq(ld, 0) == False{} : Bool}, {U32.is_eq(U32.and(ctx, none), 0) == True{} : Bool})

# A kind 0 finding y of rule r from the CS fact s.
def DirAt(s: X.Cs, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +y: F.Nx) -> Data:
  match s:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And(AtLoop(ld, ctx, none), TL.And(CL.ClHas(cls, callee, c), {F.Nx{r, site, fn, callee, 0} == y : F.Nx}))

# A kind 1 finding y of rule r from the CE fact e, whose target reaches within p edges.
def ViaAt(e: F.Ce, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +p: Nat, +y: F.Nx) -> Data:
  match e:
    case F.Ce{site, fn, target, node, ld, ctx}:
      TL.And(AtLoop(ld, ctx, none), TL.And(Rch(p, css, ces, cls, c, target), {F.Nx{r, site, fn, target, 1} == y : F.Nx}))

# ---- the reach set ----------------------------------------------------------------------------
law fo_reach_sound:
  for +k: Nat
  for +css: List<&2, X.Cs>
  for +ces: List<&2, F.Ce>
  for +cls: List<&2, X.Cl>
  for +c: U32
  for +x: U32
  for hm: TL.Mem(F.Fo.reach(k, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), x)
  Rch(k, css, ces, cls, c, x)

law fo_reach_complete:
  for +k: Nat
  for +css: List<&2, X.Cs>
  for +ces: List<&2, F.Ce>
  for +cls: List<&2, X.Cl>
  for +c: U32
  for +x: U32
  for w: Rch(k, css, ces, cls, c, x)
  TL.Mem(F.Fo.reach(k, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), x)

# ---- one rule row -----------------------------------------------------------------------------
# Every finding is a loop site calling the class (kind 0), or a loop call edge whose
# target reaches it within edges - 1 further edges (kind 1).
law fo_rule_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +ces: List<&2, F.Ce>
  for +r: U32
  for +c: U32
  for +edges: U32
  for +none: U32
  for +y: F.Nx
  for hm: MemNx(F.Fo.rule(css, cls, ces, F.Rf{r, c, edges, none}), y)
  Either<&2, &2, TL.Ex(X.Cs, s => TL.And(MemCs(css, s), DirAt(s, cls, c, r, none, y))), TL.Ex(Nat, p => TL.And({U32.to_nat(edges) == 1n+p : Nat}, TL.Ex(F.Ce, e => TL.And(MemCe(ces, e), ViaAt(e, css, ces, cls, c, r, none, p, y)))))>

law fo_direct_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +ces: List<&2, F.Ce>
  for +r: U32
  for +c: U32
  for +edges: U32
  for +none: U32
  for +site: U32
  for +fn: U32
  for +callee: U32
  for +ld: U32
  for +ctx: U32
  for hm: MemCs(css, X.Cs{site, fn, callee, ld, ctx})
  for ha: AtLoop(ld, ctx, none)
  for hc: CL.ClHas(cls, callee, c)
  MemNx(F.Fo.rule(css, cls, ces, F.Rf{r, c, edges, none}), F.Nx{r, site, fn, callee, 0})

law fo_via_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +ces: List<&2, F.Ce>
  for +r: U32
  for +c: U32
  for +edges: U32
  for +none: U32
  for +p: Nat
  for +site: U32
  for +fn: U32
  for +target: U32
  for +node: U32
  for +ld: U32
  for +ctx: U32
  for he: {U32.to_nat(edges) == 1n+p : Nat}
  for hm: MemCe(ces, F.Ce{site, fn, target, node, ld, ctx})
  for ha: AtLoop(ld, ctx, none)
  for w: Rch(p, css, ces, cls, c, target)
  MemNx(F.Fo.rule(css, cls, ces, F.Rf{r, c, edges, none}), F.Nx{r, site, fn, target, 1})

# ---- every rule row ---------------------------------------------------------------------------
law fo_findings_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +ces: List<&2, F.Ce>
  for +rfs: List<&2, F.Rf>
  for +y: F.Nx
  for hm: MemNx(F.Fanout.findings(F.FoF{css, cls, ces, rfs}), y)
  TL.Ex(F.Rf, f => TL.And(MemRf(rfs, f), MemNx(F.Fo.rule(css, cls, ces, f), y)))

law fo_findings_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +ces: List<&2, F.Ce>
  for +rfs: List<&2, F.Rf>
  for +f: F.Rf
  for +y: F.Nx
  for hf: MemRf(rfs, f)
  for hm: MemNx(F.Fo.rule(css, cls, ces, f), y)
  MemNx(F.Fanout.findings(F.FoF{css, cls, ces, rfs}), y)

law fo_lines_shape:
  for +f: F.FoF
  {F.Fanout.lines(f) == Con{"pulsar-fanout 0", List.append(&2, String, F.Fo.lines(F.Fanout.findings(f)), ["NXS " ++ Nat.show(List.length(&2, F.Nx, F.Fanout.findings(f)))])} : List<&2, String>}
