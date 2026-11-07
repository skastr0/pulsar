# engine/Hot-LAWS.bend - laws about Hot.bend. Proofs: Hot-PROOF.bend.
# Gate: `bend engine/Hot-PROOF.bend --verdict`.
#
# HR(k, x) is what "an entry point reaches function x within k call edges" means in the
# facts: k = 0, an EP fact for x; k + 1, that, or a CE fact into x from a function an
# entry point reaches within k. BaseAt is what "site `site` in function `fn` has a base
# finding of lane `lane` and rule `base`" means: lane 1, a QS fact for the site and fn and
# an SQL finding of rule `base` on that site; lane 2, a fan-out finding (NX) of rule
# `base` at the site and fn; lane 3, a constant-argument finding (KX) of rule `base`.
#
# The laws tie the shipped functions to them: the hot set Ho.reach is exactly the
# functions with HR (sound and complete); Ho.bases is exactly the BaseAt sites; every
# finding of an RH row is a base finding of that row's lane and rule whose function an
# entry point reaches within the row's depth (sound), and every such site is a finding
# (complete). Not covered, by design: decoding the rows.

import Base
import ../LAWS.bend as TL
import ./Sql.bend as Q
import ./Sql-LAWS.bend as QL
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./Konst.bend as K
import ./Konst-LAWS.bend as KL
import ./Hot.bend as H

def MemEp(xs: List<&2, H.Ep>, m: H.Ep) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : H.Ep}, MemEp(t, m)>

def MemRh(xs: List<&2, H.Rh>, m: H.Rh) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : H.Rh}, MemRh(t, m)>

def MemBs(xs: List<&2, H.Bs>, m: H.Bs) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : H.Bs}, MemBs(t, m)>

def MemHx(xs: List<&2, H.Hx>, m: H.Hx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : H.Hx}, MemHx(t, m)>

# Field readers for the statements below.
def EpFn(e: H.Ep) -> U32:
  match e:
    case H.Ep{fn, kind}:
      fn

def BsSite(b: H.Bs) -> U32:
  match b:
    case H.Bs{site, fn}:
      site

def BsFn(b: H.Bs) -> U32:
  match b:
    case H.Bs{site, fn}:
      fn

# ---- reach ------------------------------------------------------------------------------------
# An entry point reaches x within k CE edges.
def HR(k: Nat, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +x: U32) -> Data:
  match k:
    case 0n:
      TL.Ex(H.Ep, e => TL.And(MemEp(eps, e), {EpFn(e) == x : U32}))
    case 1n+p:
      Either<&2, &2, HR(p, eps, ces, x), TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), TL.And({F.Ce.target(e) == x : U32}, HR(p, eps, ces, F.Ce.fn(e)))))>

law ho_reach_sound:
  for +k: Nat
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +x: U32
  for hm: TL.Mem(H.Ho.reach(k, ces, H.Ho.seed(eps)), x)
  HR(k, eps, ces, x)

law ho_reach_complete:
  for +k: Nat
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +x: U32
  for w: HR(k, eps, ces, x)
  TL.Mem(H.Ho.reach(k, ces, H.Ho.seed(eps)), x)

# ---- base findings ----------------------------------------------------------------------------
# The QS fact q is the query site b.
def QsAt(q: Q.Qs, +b: H.Bs) -> Data:
  match q:
    case Q.Qs{site, file, fn, node, kind, flags}:
      {H.Bs{site, fn} == b : H.Bs}

# The SQL finding s is of rule `base` on the site of b.
def SxAt(s: Q.Sx, +base: U32, +b: H.Bs) -> Data:
  match s:
    case Q.Sx{rule, id, table, col, detail}:
      TL.And({rule == base : U32}, {id == BsSite(b) : U32})

def NxAt(n: F.Nx, +base: U32, +b: H.Bs) -> Data:
  match n:
    case F.Nx{r, site, fn, via, kind}:
      TL.And({r == base : U32}, {H.Bs{site, fn} == b : H.Bs})

def KxAt(n: K.Kx, +base: U32, +b: H.Bs) -> Data:
  match n:
    case K.Kx{r, site, fn, callee, pos}:
      TL.And({r == base : U32}, {H.Bs{site, fn} == b : H.Bs})

def SqlAt(+qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs) -> Data:
  TL.And(TL.Ex(Q.Qs, q => TL.And(QL.MemQs(qs, q), QsAt(q, b))), TL.Ex(Q.Sx, s => TL.And(QL.MemS(sxs, s), SxAt(s, base, b))))

# b is a base finding of lane `lane` and rule `base`.
def BaseAt(+qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +lane: U32, +base: U32, +b: H.Bs) -> Data:
  Either<&2, &2, TL.And({lane == 1 : U32}, SqlAt(qs, sxs, base, b)), Either<&2, &2, TL.And({lane == 2 : U32}, TL.Ex(F.Nx, n => TL.And(FL.MemNx(nxs, n), NxAt(n, base, b)))), TL.And({lane == 3 : U32}, TL.Ex(K.Kx, n => TL.And(KL.MemKx(kxs, n), KxAt(n, base, b))))>>

law ho_bases_sound:
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +qs: List<&2, Q.Qs>
  for +sxs: List<&2, Q.Sx>
  for +nxs: List<&2, F.Nx>
  for +kxs: List<&2, K.Kx>
  for +rhs: List<&2, H.Rh>
  for +lane: U32
  for +base: U32
  for +b: H.Bs
  for hm: MemBs(H.Ho.bases(lane, base, H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}), b)
  BaseAt(qs, sxs, nxs, kxs, lane, base, b)

law ho_bases_complete:
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +qs: List<&2, Q.Qs>
  for +sxs: List<&2, Q.Sx>
  for +nxs: List<&2, F.Nx>
  for +kxs: List<&2, K.Kx>
  for +rhs: List<&2, H.Rh>
  for +lane: U32
  for +base: U32
  for +b: H.Bs
  for w: BaseAt(qs, sxs, nxs, kxs, lane, base, b)
  MemBs(H.Ho.bases(lane, base, H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}), b)

# ---- one rule row -----------------------------------------------------------------------------
# y is the finding of row (r, lane, base, depth) for the base finding b, and an entry
# point reaches b's function within `depth` edges.
def HotAt(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +r: U32, +lane: U32, +base: U32, +depth: U32, +y: H.Hx) -> Data:
  TL.Ex(H.Bs, b => TL.And(BaseAt(qs, sxs, nxs, kxs, lane, base, b), TL.And(HR(U32.to_nat(depth), eps, ces, BsFn(b)), {H.Hx{r, lane, base, BsSite(b), BsFn(b)} == y : H.Hx})))

law ho_rule_sound:
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +qs: List<&2, Q.Qs>
  for +sxs: List<&2, Q.Sx>
  for +nxs: List<&2, F.Nx>
  for +kxs: List<&2, K.Kx>
  for +rhs: List<&2, H.Rh>
  for +r: U32
  for +lane: U32
  for +base: U32
  for +depth: U32
  for +y: H.Hx
  for hm: MemHx(H.Ho.rule(H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}, H.Rh{r, lane, base, depth}), y)
  HotAt(eps, ces, qs, sxs, nxs, kxs, r, lane, base, depth, y)

law ho_rule_complete:
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +qs: List<&2, Q.Qs>
  for +sxs: List<&2, Q.Sx>
  for +nxs: List<&2, F.Nx>
  for +kxs: List<&2, K.Kx>
  for +rhs: List<&2, H.Rh>
  for +r: U32
  for +lane: U32
  for +base: U32
  for +depth: U32
  for +y: H.Hx
  for w: HotAt(eps, ces, qs, sxs, nxs, kxs, r, lane, base, depth, y)
  MemHx(H.Ho.rule(H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}, H.Rh{r, lane, base, depth}), y)

# ---- every rule row ---------------------------------------------------------------------------
law ho_findings_sound:
  for +f: H.HF
  for +y: H.Hx
  for hm: MemHx(H.Hot.findings(f), y)
  TL.Ex(H.Rh, h => TL.And(MemRh(H.Ho.rhs(f), h), MemHx(H.Ho.rule(f, h), y)))

law ho_findings_complete:
  for +f: H.HF
  for +h: H.Rh
  for +y: H.Hx
  for hh: MemRh(H.Ho.rhs(f), h)
  for hm: MemHx(H.Ho.rule(f, h), y)
  MemHx(H.Hot.findings(f), y)

law ho_lines_shape:
  for +f: H.HF
  {H.Hot.lines(f) == Con{"pulsar-hot 0", List.append(&2, String, H.Ho.lines(H.Hot.findings(f)), ["HXS " ++ Nat.show(List.length(&2, H.Hx, H.Hot.findings(f)))])} : List<&2, String>}
