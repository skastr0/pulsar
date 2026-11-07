# engine/Churn-PROOF.bend - proofs of Churn-LAWS.bend.
# Gate: `bend engine/PROOF.bend --verdict` (it imports this file).

import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ../Lemmas3.bend as L3
import ../Nat2.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./Hotspot.bend as H
import ./Rows.bend as R
import ./Churn.bend as C
import ./Churn-LAWS.bend as Laws

# ---- helpers ----------------------------------------------------------------------------------
def CAL(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  L.And.fst({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def CAR(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  L.And.snd({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def CClash(a: Bool, e1: {a == False{} : Bool}, e2: {a == True{} : Bool}) -> Empty:
  L.Bool.ff_tt(Equal.trans(Bool, False{}, a, True{}, Equal.sym(Bool, a, False{}, e1), e2))

def ChF(c: H.Ch) -> U32:
  match c:
    case H.Ch{fn, n}:
      fn

def ChN(c: H.Ch) -> Nat:
  match c:
    case H.Ch{fn, n}:
      n

# A tally from empty is the count (Lemmas3 Cnt.sound, Te.cnt).
def CntZ(+l: List<&2, U32>, +s: U32) -> {Nat.add(TL.Count(l, s), G.Graph.cnt_of(G.Tr.getu(G.TE{}, s))) == TL.Count(l, s) : Nat}:
  %Equal.sym(Nat, G.Graph.cnt_of(G.Tr.getu(G.TE{}, s)), 0n, L3.Te.cnt(s)) : {Nat.add(TL.Count(l, s), _) == TL.Count(l, s) : Nat}
  N.Nat.add_zero(TL.Count(l, s))

def CntT(+l: List<&2, U32>, +fn: U32) -> {C.Churn.cnt(G.Graph.cnt_all(l, G.TE{}), fn) == TL.Count(l, fn) : Nat}:
  Equal.trans(Nat, C.Churn.cnt(G.Graph.cnt_all(l, G.TE{}), fn), Nat.add(TL.Count(l, fn), G.Graph.cnt_of(G.Tr.getu(G.TE{}, fn))), TL.Count(l, fn), L3.Cnt.sound(l, G.TE{}, fn), CntZ(l, fn))

# ---- soundness: a reported entry carries its tally, and the tally is not 0 ----------------------
def AllS.k(z: Bool, +t: G.Tr, +x: U32, rest: List<&2, U32>, +fn: U32, +n: Nat, hz: {Nat.is_eq(C.Churn.cnt(t, x), 0n) == z : Bool}, h: Laws.In(C.Churn.push3(z, x, C.Churn.cnt(t, x), C.Churn.all(rest, t)), H.Ch{fn, n}), ih: Laws.In(C.Churn.all(rest, t), H.Ch{fn, n}) -> TL.And({n == C.Churn.cnt(t, fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool})) -> TL.And({n == C.Churn.cnt(t, fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}):
  match z:
    case True{}:
      ih(h)
    case False{}:
      match h:
        case Inl{e}:
          %e : TL.And({ChN(_) == C.Churn.cnt(t, ChF(_)) : Nat}, {Nat.is_eq(ChN(_), 0n) == False{} : Bool})
          Tuple{{==}, hz}
        case Inr{q}:
          ih(q)

def AllS(xs: List<&2, U32>, +t: G.Tr, +fn: U32, +n: Nat, h: Laws.In(C.Churn.all(xs, t), H.Ch{fn, n})) -> TL.And({n == C.Churn.cnt(t, fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}):
  match xs:
    case Nil{}:
      Empty.absurd(TL.And({n == C.Churn.cnt(t, fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}), h)
    case Con{+x, +rest}:
      AllS.k(Nat.is_eq(C.Churn.cnt(t, x), 0n), t, x, rest, fn, n, {==}, h, y => AllS(rest, t, fn, n, y))

def GoS(ok: Bool, +cs: List<&2, U32>, +l: List<&2, U32>, +t: G.Tr, +fn: U32, +n: Nat, h: Laws.In(C.Churn.go2(ok, cs, l, t), H.Ch{fn, n})) -> TL.And({n == C.Churn.cnt(t, fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}):
  match ok:
    case True{}:
      AllS(cs, t, fn, n, h)
    case False{}:
      AllS(l, t, fn, n, h)

def SndS(+n: Nat, +k: Nat, p: TL.And({n == k : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool})) -> {Nat.is_eq(n, 0n) == False{} : Bool}:
  L.And.snd({n == k : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}, p)

def FstS(+n: Nat, +k: Nat, p: TL.And({n == k : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool})) -> {n == k : Nat}:
  L.And.fst({n == k : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool}, p)

def Laws.churn_sound(rows, fn, n, h):
  +l = C.Churn.list(rows)
  +cs = C.Uu.uniq(C.Uu.sort(64n, l), 0, True{})
  +t = G.Graph.cnt_all(l, G.TE{})
  +r = GoS(C.Churn.covers(l, S.Scope.set(cs)), cs, l, t, fn, n, h)
  Tuple{Equal.trans(Nat, n, C.Churn.cnt(t, fn), TL.Count(l, fn), FstS(n, C.Churn.cnt(t, fn), r), CntT(l, fn)), SndS(n, C.Churn.cnt(t, fn), r)}

# ---- completeness: every counted function is iterated, with a non-zero tally ----------------------
def StepNZ(b: Bool, +k: Nat, hk: {Nat.is_eq(k, 0n) == False{} : Bool}) -> {Nat.is_eq(TL.Count.step(b, k), 0n) == False{} : Bool}:
  match b:
    case True{}:
      {==}
    case False{}:
      hk

def CountHit(+h: U32, +fn: U32, t: List<&2, U32>, e: {h == fn : U32}) -> {Nat.is_eq(TL.Count.step(U32.is_eq(h, fn), TL.Count(t, fn)), 0n) == False{} : Bool}:
  %Equal.sym(U32, h, fn, e) : {Nat.is_eq(TL.Count.step(U32.is_eq(_, fn), TL.Count(t, fn)), 0n) == False{} : Bool}
  %Equal.sym(Bool, U32.is_eq(fn, fn), True{}, L2.U32.eq_refl(fn)) : {Nat.is_eq(TL.Count.step(_, TL.Count(t, fn)), 0n) == False{} : Bool}
  {==}

def CountNZ(l: List<&2, U32>, +fn: U32, hm: TL.Mem(l, fn)) -> {Nat.is_eq(TL.Count(l, fn), 0n) == False{} : Bool}:
  match l:
    case Nil{}:
      Empty.absurd({Nat.is_eq(0n, 0n) == False{} : Bool}, hm)
    case Con{+h, +t}:
      match hm:
        case Inl{e}:
          CountHit(h, fn, t, e)
        case Inr{q}:
          StepNZ(U32.is_eq(h, fn), TL.Count(t, fn), CountNZ(t, fn, q))

def Hz.rw(+t: G.Tr, +x: U32, +fn: U32, e: {x == fn : U32}, hnz: {Nat.is_eq(C.Churn.cnt(t, fn), 0n) == False{} : Bool}) -> {Nat.is_eq(C.Churn.cnt(t, x), 0n) == False{} : Bool}:
  %Equal.sym(U32, x, fn, e) : {Nat.is_eq(C.Churn.cnt(t, _), 0n) == False{} : Bool}
  hnz

def ChEq(+t: G.Tr, +x: U32, +fn: U32, e: {x == fn : U32}) -> {H.Ch{x, C.Churn.cnt(t, x)} == H.Ch{fn, C.Churn.cnt(t, fn)} : H.Ch}:
  %Equal.sym(U32, x, fn, e) : {H.Ch{_, C.Churn.cnt(t, _)} == H.Ch{fn, C.Churn.cnt(t, fn)} : H.Ch}
  {==}

def AllC.k(z: Bool, +t: G.Tr, +x: U32, rest: List<&2, U32>, +fn: U32, hz: {Nat.is_eq(C.Churn.cnt(t, x), 0n) == z : Bool}, +hnz: {Nat.is_eq(C.Churn.cnt(t, fn), 0n) == False{} : Bool}, hm: Either<&2, &2, {x == fn : U32}, TL.Mem(rest, fn)>, ih: TL.Mem(rest, fn) -> Laws.In(C.Churn.all(rest, t), H.Ch{fn, C.Churn.cnt(t, fn)})) -> Laws.In(C.Churn.push3(z, x, C.Churn.cnt(t, x), C.Churn.all(rest, t)), H.Ch{fn, C.Churn.cnt(t, fn)}):
  match z:
    case True{}:
      match hm:
        case Inl{e}:
          Empty.absurd(Laws.In(C.Churn.all(rest, t), H.Ch{fn, C.Churn.cnt(t, fn)}), CClash(Nat.is_eq(C.Churn.cnt(t, x), 0n), Hz.rw(t, x, fn, e, hnz), hz))
        case Inr{q}:
          ih(q)
    case False{}:
      match hm:
        case Inl{e}:
          Inl{ChEq(t, x, fn, e)}
        case Inr{q}:
          Inr{ih(q)}

def AllC(xs: List<&2, U32>, +t: G.Tr, +fn: U32, +hnz: {Nat.is_eq(C.Churn.cnt(t, fn), 0n) == False{} : Bool}, hm: TL.Mem(xs, fn)) -> Laws.In(C.Churn.all(xs, t), H.Ch{fn, C.Churn.cnt(t, fn)}):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.In(Nil{}, H.Ch{fn, C.Churn.cnt(t, fn)}), hm)
    case Con{+x, +rest}:
      AllC.k(Nat.is_eq(C.Churn.cnt(t, x), 0n), t, x, rest, fn, {==}, hnz, hm, q => AllC(rest, t, fn, hnz, q))

# covers(l, s) and fn in l: fn is in s.
def CovM(l: List<&2, U32>, +s: G.Tr, +fn: U32, e: {C.Churn.covers(l, s) == True{} : Bool}, hm: TL.Mem(l, fn)) -> {S.Scope.has(s, fn) == True{} : Bool}:
  match l:
    case Nil{}:
      Empty.absurd({S.Scope.has(s, fn) == True{} : Bool}, hm)
    case Con{+x, +t}:
      match hm:
        case Inl{ex}:
          %ex : {S.Scope.has(s, _) == True{} : Bool}
          CAL(S.Scope.has(s, x), C.Churn.covers(t, s), e)
        case Inr{q}:
          CovM(t, s, fn, CAR(S.Scope.has(s, x), C.Churn.covers(t, s), e), q)

def GoC(ok: Bool, +cs: List<&2, U32>, +l: List<&2, U32>, +t: G.Tr, +fn: U32, hok: {C.Churn.covers(l, S.Scope.set(cs)) == ok : Bool}, +hnz: {Nat.is_eq(C.Churn.cnt(t, fn), 0n) == False{} : Bool}, hm: TL.Mem(l, fn)) -> Laws.In(C.Churn.go2(ok, cs, l, t), H.Ch{fn, C.Churn.cnt(t, fn)}):
  match ok:
    case True{}:
      AllC(cs, t, fn, hnz, SL.scope_set_sound(cs, fn, CovM(l, S.Scope.set(cs), fn, hok, hm)))
    case False{}:
      AllC(l, t, fn, hnz, hm)

def NZ(+l: List<&2, U32>, +fn: U32, hm: TL.Mem(l, fn)) -> {Nat.is_eq(C.Churn.cnt(G.Graph.cnt_all(l, G.TE{}), fn), 0n) == False{} : Bool}:
  %Equal.sym(Nat, C.Churn.cnt(G.Graph.cnt_all(l, G.TE{}), fn), TL.Count(l, fn), CntT(l, fn)) : {Nat.is_eq(_, 0n) == False{} : Bool}
  CountNZ(l, fn, hm)

def Laws.churn_complete(rows, fn, hm):
  +l = C.Churn.list(rows)
  +cs = C.Uu.uniq(C.Uu.sort(64n, l), 0, True{})
  +t = G.Graph.cnt_all(l, G.TE{})
  %CntT(l, fn) : Laws.In(C.Churn.of(rows), H.Ch{fn, _})
  GoC(C.Churn.covers(l, S.Scope.set(cs)), cs, l, t, fn, {==}, NZ(l, fn, hm), hm)
