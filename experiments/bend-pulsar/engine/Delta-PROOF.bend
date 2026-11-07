# engine/Delta-PROOF.bend - proofs of Delta-LAWS.bend.
# Gate: `bend engine/PROOF.bend --verdict` (it imports this file).

import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ./Delta.bend as D
import ./Delta-LAWS.bend as Laws

# ---- small tools ---------------------------------------------------------------------------------
def AL(+a: Bool, +b: Bool, +e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  L.And.fst({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def AR(+a: Bool, +b: Bool, +e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  L.And.snd({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def NotT(+a: Bool, +e: {Bool.not(a) == True{} : Bool}) -> {a == False{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.ff_tt(e))

def TF(+e: {True{} == False{} : Bool}) -> Empty:
  L.Bool.ff_tt(Equal.sym(Bool, True{}, False{}, e))

def Tp(-T: Data, -P: @-x: T -> Data, a: T, b: T, e: {a == b : T}, pa: P(a)) -> P(b):
  %e : P(_)
  pa

def IsLT(c: Cmp) -> Data:
  match c:
    case LT{}:
      Unit
    case _:
      Empty

def IsEQ(c: Cmp) -> Data:
  match c:
    case EQ{}:
      Unit
    case _:
      Empty

def IsGT(c: Cmp) -> Data:
  match c:
    case GT{}:
      Unit
    case _:
      Empty

def NeLE(+e: {LT{} == EQ{} : Cmp}) -> Empty:
  %e : IsLT(_)
  Unit{}

def NeLG(+e: {LT{} == GT{} : Cmp}) -> Empty:
  %e : IsLT(_)
  Unit{}

def NeGL(+e: {GT{} == LT{} : Cmp}) -> Empty:
  %e : IsGT(_)
  Unit{}

def NeGE(+e: {GT{} == EQ{} : Cmp}) -> Empty:
  %e : IsGT(_)
  Unit{}

def NeEL(+e: {EQ{} == LT{} : Cmp}) -> Empty:
  %e : IsEQ(_)
  Unit{}

def NeEG(+e: {EQ{} == GT{} : Cmp}) -> Empty:
  %e : IsEQ(_)
  Unit{}

# Two facts about one comparison that disagree.
def CC.le(+c: Cmp, +e1: {c == LT{} : Cmp}, +e2: {c == EQ{} : Cmp}) -> Empty:
  NeLE(Equal.trans(Cmp, LT{}, c, EQ{}, Equal.sym(Cmp, c, LT{}, e1), e2))

def CC.ge(+c: Cmp, +e1: {c == GT{} : Cmp}, +e2: {c == EQ{} : Cmp}) -> Empty:
  NeGE(Equal.trans(Cmp, GT{}, c, EQ{}, Equal.sym(Cmp, c, GT{}, e1), e2))

# ---- events ---------------------------------------------------------------------------------------
def Ev.isA(e: D.Ev) -> Data:
  match e:
    case D.OA{a}:
      Unit
    case _:
      Empty

def Ev.isB(e: D.Ev) -> Data:
  match e:
    case D.OB{b}:
      Unit
    case _:
      Empty

def Ev.isT(e: D.Ev) -> Data:
  match e:
    case D.BT{a, b}:
      Unit
    case _:
      Empty

def Ev.isS(e: D.Ev) -> Data:
  match e:
    case D.ST{}:
      Unit
    case _:
      Empty

def K0() -> D.Kr:
  D.Kr{0, 0, 0, 0}

def Ev.ga(e: D.Ev) -> D.Kr:
  match e:
    case D.OA{a}:
      a
    case D.BT{a, b}:
      a
    case _:
      K0()

def Ev.gb(e: D.Ev) -> D.Kr:
  match e:
    case D.OB{b}:
      b
    case D.BT{a, b}:
      b
    case _:
      K0()

# x == y for two events of different kinds is impossible: one lemma per pair used.
def X.BA(+b: D.Kr, +a: D.Kr, +e: {D.OB{b} == D.OA{a} : D.Ev}) -> Empty:
  %e : Ev.isB(_)
  Unit{}

def X.TA(+b: D.Kr, +c: D.Kr, +a: D.Kr, +e: {D.BT{b, c} == D.OA{a} : D.Ev}) -> Empty:
  %e : Ev.isT(_)
  Unit{}

def X.SA(+a: D.Kr, +e: {D.ST{} == D.OA{a} : D.Ev}) -> Empty:
  %e : Ev.isS(_)
  Unit{}

def X.AB(+a: D.Kr, +b: D.Kr, +e: {D.OA{a} == D.OB{b} : D.Ev}) -> Empty:
  %e : Ev.isA(_)
  Unit{}

def X.TB(+a: D.Kr, +c: D.Kr, +b: D.Kr, +e: {D.BT{a, c} == D.OB{b} : D.Ev}) -> Empty:
  %e : Ev.isT(_)
  Unit{}

def X.SB(+b: D.Kr, +e: {D.ST{} == D.OB{b} : D.Ev}) -> Empty:
  %e : Ev.isS(_)
  Unit{}

def X.AT(+x: D.Kr, +a: D.Kr, +b: D.Kr, +e: {D.OA{x} == D.BT{a, b} : D.Ev}) -> Empty:
  %e : Ev.isA(_)
  Unit{}

def X.BT(+x: D.Kr, +a: D.Kr, +b: D.Kr, +e: {D.OB{x} == D.BT{a, b} : D.Ev}) -> Empty:
  %e : Ev.isB(_)
  Unit{}

def X.ST(+a: D.Kr, +b: D.Kr, +e: {D.ST{} == D.BT{a, b} : D.Ev}) -> Empty:
  %e : Ev.isS(_)
  Unit{}

# ---- list membership ----------------------------------------------------------------------------
def AppL(-A: Data, +xs: List<&2, A>, +ys: List<&2, A>, +z: A, +h: Laws.In(A, xs, z)) -> Laws.In(A, List.append(&2, A, xs, ys), z):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.In(A, ys, z), h)
    case Con{+x, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AppL(A, t, ys, z, q)}

def AppR(-A: Data, +xs: List<&2, A>, +ys: List<&2, A>, +z: A, +h: Laws.In(A, ys, z)) -> Laws.In(A, List.append(&2, A, xs, ys), z):
  match xs:
    case Nil{}:
      h
    case Con{+x, +t}:
      Inr{AppR(A, t, ys, z, h)}

def AppS.k(-A: Data, +x: A, +t: List<&2, A>, +ys: List<&2, A>, +z: A, +r: Either<&2, &2, Laws.In(A, t, z), Laws.In(A, ys, z)>) -> Either<&2, &2, Laws.In(A, Con{x, t}, z), Laws.In(A, ys, z)>:
  match r:
    case Inl{q}:
      Inl{Inr{q}}
    case Inr{q}:
      Inr{q}

def AppS(-A: Data, +xs: List<&2, A>, +ys: List<&2, A>, +z: A, +h: Laws.In(A, List.append(&2, A, xs, ys), z)) -> Either<&2, &2, Laws.In(A, xs, z), Laws.In(A, ys, z)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+x, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AppS.k(A, x, t, ys, z, AppS(A, t, ys, z, q))

# ---- order on keys -------------------------------------------------------------------------------
def Fl(c: Cmp) -> Cmp:
  match c:
    case LT{}:
      GT{}
    case EQ{}:
      EQ{}
    case GT{}:
      LT{}

def BSym(+a: Bool, +b: Bool) -> {Bool.cmp(b, a) == Fl(Bool.cmp(a, b)) : Cmp}:
  match a b:
    case False{} False{}:
      {==}
    case False{} True{}:
      {==}
    case True{} False{}:
      {==}
    case True{} True{}:
      {==}

def FinSym(+ab: Bool, +bb: Bool, +t: Cmp) -> {Word.cmp.fin(bb, ab, Fl(t)) == Fl(Word.cmp.fin(ab, bb, t)) : Cmp}:
  match t:
    case LT{}:
      {==}
    case EQ{}:
      BSym(ab, bb)
    case GT{}:
      {==}

def WSym(+n: Nat, +a: Word(n), +b: Word(n)) -> {Word.cmp(n, b, a) == Fl(Word.cmp(n, a, b)) : Cmp}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      match a b:
        case WCon{+ab, +at} WCon{+bb, +bt}:
          %Equal.sym(Cmp, Word.cmp(p, bt, at), Fl(Word.cmp(p, at, bt)), WSym(p, at, bt)) : {Word.cmp.fin(bb, ab, _) == Fl(Word.cmp.fin(ab, bb, Word.cmp(p, at, bt))) : Cmp}
          FinSym(ab, bb, Word.cmp(p, at, bt))

def USym(+a: U32, +b: U32) -> {U32.cmp(b, a) == Fl(U32.cmp(a, b)) : Cmp}:
  match a b:
    case U32{+x} U32{+y}:
      WSym(32n, x, y)

# Bool.cmp a b = LT and Bool.cmp b c = LT cannot both hold.
def BB(+a: Bool, +b: Bool, +c: Bool, +e1: {Bool.cmp(a, b) == LT{} : Cmp}, +e2: {Bool.cmp(b, c) == LT{} : Cmp}) -> Empty:
  match a b c:
    case False{} False{} c2:
      NeEL(e1)
    case False{} True{} False{}:
      NeGL(e2)
    case False{} True{} True{}:
      NeEL(e2)
    case True{} False{} c2:
      NeGL(e1)
    case True{} True{} c2:
      NeEL(e1)

def WTr.k(+p: Nat, +ab: Bool, +at: Word(p), +bb: Bool, +bt: Word(p), +cb: Bool, +ct: Word(p), +t1: Cmp, +h1: {Word.cmp(p, at, bt) == t1 : Cmp}, +t2: Cmp, +h2: {Word.cmp(p, bt, ct) == t2 : Cmp}, +e1: {Word.cmp.fin(ab, bb, t1) == LT{} : Cmp}, +e2: {Word.cmp.fin(bb, cb, t2) == LT{} : Cmp}, ih: {Word.cmp(p, at, bt) == LT{} : Cmp} -> {Word.cmp(p, bt, ct) == LT{} : Cmp} -> {Word.cmp(p, at, ct) == LT{} : Cmp}) -> {Word.cmp.fin(ab, cb, Word.cmp(p, at, ct)) == LT{} : Cmp}:
  match t1 t2:
    case LT{} LT{}:
      %Equal.sym(Cmp, Word.cmp(p, at, ct), LT{}, ih(h1, h2)) : {Word.cmp.fin(ab, cb, _) == LT{} : Cmp}
      {==}
    case LT{} EQ{}:
      %L.Word.cmp_eq(p, bt, ct, h2) : {Word.cmp.fin(ab, cb, Word.cmp(p, at, _)) == LT{} : Cmp}
      %Equal.sym(Cmp, Word.cmp(p, at, bt), LT{}, h1) : {Word.cmp.fin(ab, cb, _) == LT{} : Cmp}
      {==}
    case LT{} GT{}:
      Empty.absurd({Word.cmp.fin(ab, cb, Word.cmp(p, at, ct)) == LT{} : Cmp}, NeGL(e2))
    case EQ{} LT{}:
      %Equal.sym(Word(p), at, bt, L.Word.cmp_eq(p, at, bt, h1)) : {Word.cmp.fin(ab, cb, Word.cmp(p, _, ct)) == LT{} : Cmp}
      %Equal.sym(Cmp, Word.cmp(p, bt, ct), LT{}, h2) : {Word.cmp.fin(ab, cb, _) == LT{} : Cmp}
      {==}
    case EQ{} EQ{}:
      Empty.absurd({Word.cmp.fin(ab, cb, Word.cmp(p, at, ct)) == LT{} : Cmp}, BB(ab, bb, cb, e1, e2))
    case EQ{} GT{}:
      Empty.absurd({Word.cmp.fin(ab, cb, Word.cmp(p, at, ct)) == LT{} : Cmp}, NeGL(e2))
    case GT{} t2b:
      Empty.absurd({Word.cmp.fin(ab, cb, Word.cmp(p, at, ct)) == LT{} : Cmp}, NeGL(e1))

def WTrans(+n: Nat, +a: Word(n), +b: Word(n), +c: Word(n), +e1: {Word.cmp(n, a, b) == LT{} : Cmp}, +e2: {Word.cmp(n, b, c) == LT{} : Cmp}) -> {Word.cmp(n, a, c) == LT{} : Cmp}:
  match n:
    case 0n:
      Empty.absurd({Word.cmp(0n, a, c) == LT{} : Cmp}, NeEL(e1))
    case 1n+p:
      match a b c:
        case WCon{+ab, +at} WCon{+bb, +bt} WCon{+cb, +ct}:
          WTr.k(p, ab, at, bb, bt, cb, ct, Word.cmp(p, at, bt), {==}, Word.cmp(p, bt, ct), {==}, e1, e2, x => y => WTrans(p, at, bt, ct, x, y))

def UTrans(+a: U32, +b: U32, +c: U32, +e1: {U32.cmp(a, b) == LT{} : Cmp}, +e2: {U32.cmp(b, c) == LT{} : Cmp}) -> {U32.cmp(a, c) == LT{} : Cmp}:
  match a b c:
    case U32{+x} U32{+y} U32{+z}:
      WTrans(32n, x, y, z, e1, e2)

def URefl(+a: U32) -> {U32.cmp(a, a) == EQ{} : Cmp}:
  L.Cmp.eq_true(U32.cmp(a, a), L2.U32.eq_refl(a))

def UEq.t(+a: U32, +b: U32, +e: {U32.cmp(a, b) == EQ{} : Cmp}) -> {U32.is_eq(a, b) == True{} : Bool}:
  %Equal.sym(Cmp, U32.cmp(a, b), EQ{}, e) : {Cmp.is_eq(_) == True{} : Bool}
  {==}

def UEq(+a: U32, +b: U32, +e: {U32.cmp(a, b) == EQ{} : Cmp}) -> {a == b : U32}:
  L.U32.eq_sound(a, b, UEq.t(a, b, e))

def ThenSym(+c: Cmp, +d: Cmp) -> {D.Kc.then(Fl(c), Fl(d)) == Fl(D.Kc.then(c, d)) : Cmp}:
  match c:
    case LT{}:
      {==}
    case EQ{}:
      {==}
    case GT{}:
      {==}

def ThenEq(+c: Cmp, +d: Cmp, +e: {D.Kc.then(c, d) == EQ{} : Cmp}) -> TL.And({c == EQ{} : Cmp}, {d == EQ{} : Cmp}):
  match c:
    case LT{}:
      Empty.absurd(TL.And({LT{} == EQ{} : Cmp}, {d == EQ{} : Cmp}), NeLE(e))
    case EQ{}:
      Tuple{{==}, e}
    case GT{}:
      Empty.absurd(TL.And({GT{} == EQ{} : Cmp}, {d == EQ{} : Cmp}), NeGE(e))

def KSym(+a: D.Kr, +b: D.Kr) -> {D.Kr.cmp(b, a) == Fl(D.Kr.cmp(a, b)) : Cmp}:
  match a b:
    case D.Kr{+ah, +al, +am, +av} D.Kr{+bh, +bl, +bm, +bv}:
      %Equal.sym(Cmp, U32.cmp(bh, ah), Fl(U32.cmp(ah, bh)), USym(ah, bh)) : {D.Kc.then(_, D.Kc.then(U32.cmp(bl, al), U32.cmp(bm, am))) == Fl(D.Kc.then(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))) : Cmp}
      %Equal.sym(Cmp, U32.cmp(bl, al), Fl(U32.cmp(al, bl)), USym(al, bl)) : {D.Kc.then(Fl(U32.cmp(ah, bh)), D.Kc.then(_, U32.cmp(bm, am))) == Fl(D.Kc.then(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))) : Cmp}
      %Equal.sym(Cmp, U32.cmp(bm, am), Fl(U32.cmp(am, bm)), USym(am, bm)) : {D.Kc.then(Fl(U32.cmp(ah, bh)), D.Kc.then(Fl(U32.cmp(al, bl)), _)) == Fl(D.Kc.then(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))) : Cmp}
      %Equal.sym(Cmp, D.Kc.then(Fl(U32.cmp(al, bl)), Fl(U32.cmp(am, bm))), Fl(D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm))), ThenSym(U32.cmp(al, bl), U32.cmp(am, bm))) : {D.Kc.then(Fl(U32.cmp(ah, bh)), _) == Fl(D.Kc.then(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))) : Cmp}
      ThenSym(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))

# One level of the lexicographic order: transitive when the rest is.
def Lex.k(+x: U32, +y: U32, +z: U32, +r1: Cmp, +r2: Cmp, +r3: Cmp, +c1: Cmp, +hc1: {U32.cmp(x, y) == c1 : Cmp}, +c2: Cmp, +hc2: {U32.cmp(y, z) == c2 : Cmp}, +h1: {D.Kc.then(c1, r1) == LT{} : Cmp}, +h2: {D.Kc.then(c2, r2) == LT{} : Cmp}, k: {r1 == LT{} : Cmp} -> {r2 == LT{} : Cmp} -> {r3 == LT{} : Cmp}) -> {D.Kc.then(U32.cmp(x, z), r3) == LT{} : Cmp}:
  match c1 c2:
    case LT{} LT{}:
      %Equal.sym(Cmp, U32.cmp(x, z), LT{}, UTrans(x, y, z, hc1, hc2)) : {D.Kc.then(_, r3) == LT{} : Cmp}
      {==}
    case LT{} EQ{}:
      %UEq(y, z, hc2) : {D.Kc.then(U32.cmp(x, _), r3) == LT{} : Cmp}
      %Equal.sym(Cmp, U32.cmp(x, y), LT{}, hc1) : {D.Kc.then(_, r3) == LT{} : Cmp}
      {==}
    case LT{} GT{}:
      Empty.absurd({D.Kc.then(U32.cmp(x, z), r3) == LT{} : Cmp}, NeGL(h2))
    case EQ{} LT{}:
      %Equal.sym(U32, x, y, UEq(x, y, hc1)) : {D.Kc.then(U32.cmp(_, z), r3) == LT{} : Cmp}
      %Equal.sym(Cmp, U32.cmp(y, z), LT{}, hc2) : {D.Kc.then(_, r3) == LT{} : Cmp}
      {==}
    case EQ{} EQ{}:
      %Equal.sym(U32, x, z, Equal.trans(U32, x, y, z, UEq(x, y, hc1), UEq(y, z, hc2))) : {D.Kc.then(U32.cmp(_, z), r3) == LT{} : Cmp}
      %Equal.sym(Cmp, U32.cmp(z, z), EQ{}, URefl(z)) : {D.Kc.then(_, r3) == LT{} : Cmp}
      k(h1, h2)
    case EQ{} GT{}:
      Empty.absurd({D.Kc.then(U32.cmp(x, z), r3) == LT{} : Cmp}, NeGL(h2))
    case GT{} c2b:
      Empty.absurd({D.Kc.then(U32.cmp(x, z), r3) == LT{} : Cmp}, NeGL(h1))

def Lex(+x: U32, +y: U32, +z: U32, +r1: Cmp, +r2: Cmp, +r3: Cmp, +h1: {D.Kc.then(U32.cmp(x, y), r1) == LT{} : Cmp}, +h2: {D.Kc.then(U32.cmp(y, z), r2) == LT{} : Cmp}, k: {r1 == LT{} : Cmp} -> {r2 == LT{} : Cmp} -> {r3 == LT{} : Cmp}) -> {D.Kc.then(U32.cmp(x, z), r3) == LT{} : Cmp}:
  Lex.k(x, y, z, r1, r2, r3, U32.cmp(x, y), {==}, U32.cmp(y, z), {==}, h1, h2, k)

def KTrans(+a: D.Kr, +b: D.Kr, +c: D.Kr, +e1: {D.Kr.cmp(a, b) == LT{} : Cmp}, +e2: {D.Kr.cmp(b, c) == LT{} : Cmp}) -> {D.Kr.cmp(a, c) == LT{} : Cmp}:
  match a b c:
    case D.Kr{+ah, +al, +am, +av} D.Kr{+bh, +bl, +bm, +bv} D.Kr{+ch, +cl, +cm, +cv}:
      Lex(ah, bh, ch, D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)), D.Kc.then(U32.cmp(bl, cl), U32.cmp(bm, cm)), D.Kc.then(U32.cmp(al, cl), U32.cmp(am, cm)), e1, e2, p => q => Lex(al, bl, cl, U32.cmp(am, bm), U32.cmp(bm, cm), U32.cmp(am, cm), p, q, p2 => q2 => UTrans(am, bm, cm, p2, q2)))

def SameOf.k2(+ah: U32, +al: U32, +am: U32, +bh: U32, +bl: U32, +bm: U32, +eh: {ah == bh : U32}, +p: TL.And({U32.cmp(al, bl) == EQ{} : Cmp}, {U32.cmp(am, bm) == EQ{} : Cmp})) -> TL.And({ah == bh : U32}, TL.And({al == bl : U32}, {am == bm : U32})):
  match p:
    case Tuple{e1, e2}:
      Tuple{eh, Tuple{UEq(al, bl, e1), UEq(am, bm, e2)}}

def SameOf.k(+ah: U32, +al: U32, +am: U32, +bh: U32, +bl: U32, +bm: U32, +p: TL.And({U32.cmp(ah, bh) == EQ{} : Cmp}, {D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)) == EQ{} : Cmp})) -> TL.And({ah == bh : U32}, TL.And({al == bl : U32}, {am == bm : U32})):
  match p:
    case Tuple{e1, e2}:
      SameOf.k2(ah, al, am, bh, bl, bm, UEq(ah, bh, e1), ThenEq(U32.cmp(al, bl), U32.cmp(am, bm), e2))

# Same key, from a comparison and back.
def SameOf(+a: D.Kr, +b: D.Kr, +e: {D.Kr.cmp(a, b) == EQ{} : Cmp}) -> Laws.Same(a, b):
  match a b:
    case D.Kr{+ah, +al, +am, +av} D.Kr{+bh, +bl, +bm, +bv}:
      SameOf.k(ah, al, am, bh, bl, bm, ThenEq(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)), e))

def EqOf.k(+ah: U32, +al: U32, +am: U32, +bh: U32, +bl: U32, +bm: U32, +s: TL.And({ah == bh : U32}, TL.And({al == bl : U32}, {am == bm : U32}))) -> {D.Kc.then(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm))) == EQ{} : Cmp}:
  match s:
    case Tuple{eh, r}:
      match r:
        case Tuple{el, em}:
          %eh : {D.Kc.then(U32.cmp(ah, _), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm))) == EQ{} : Cmp}
          %el : {D.Kc.then(U32.cmp(ah, ah), D.Kc.then(U32.cmp(al, _), U32.cmp(am, bm))) == EQ{} : Cmp}
          %em : {D.Kc.then(U32.cmp(ah, ah), D.Kc.then(U32.cmp(al, al), U32.cmp(am, _))) == EQ{} : Cmp}
          %Equal.sym(Cmp, U32.cmp(ah, ah), EQ{}, URefl(ah)) : {D.Kc.then(_, D.Kc.then(U32.cmp(al, al), U32.cmp(am, am))) == EQ{} : Cmp}
          %Equal.sym(Cmp, U32.cmp(al, al), EQ{}, URefl(al)) : {D.Kc.then(EQ{}, D.Kc.then(_, U32.cmp(am, am))) == EQ{} : Cmp}
          URefl(am)

def EqOf(+a: D.Kr, +b: D.Kr, +s: Laws.Same(a, b)) -> {D.Kr.cmp(a, b) == EQ{} : Cmp}:
  match a b:
    case D.Kr{+ah, +al, +am, +av} D.Kr{+bh, +bl, +bm, +bv}:
      EqOf.k(ah, al, am, bh, bl, bm, s)

def SameSym(+a: D.Kr, +b: D.Kr, +s: Laws.Same(a, b)) -> Laws.Same(b, a):
  match s:
    case Tuple{eh, r}:
      match r:
        case Tuple{el, em}:
          Tuple{Equal.sym(U32, D.Kr.hi(a), D.Kr.hi(b), eh), Tuple{Equal.sym(U32, D.Kr.lo(a), D.Kr.lo(b), el), Equal.sym(U32, D.Kr.m(a), D.Kr.m(b), em)}}

def KCong.k(+ah: U32, +al: U32, +am: U32, +bh: U32, +bl: U32, +bm: U32, +xh: U32, +xl: U32, +xm: U32, +s: TL.And({ah == bh : U32}, TL.And({al == bl : U32}, {am == bm : U32}))) -> {D.Kc.then(U32.cmp(bh, xh), D.Kc.then(U32.cmp(bl, xl), U32.cmp(bm, xm))) == D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(al, xl), U32.cmp(am, xm))) : Cmp}:
  match s:
    case Tuple{eh, r}:
      match r:
        case Tuple{el, em}:
          %eh : {D.Kc.then(U32.cmp(_, xh), D.Kc.then(U32.cmp(bl, xl), U32.cmp(bm, xm))) == D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(al, xl), U32.cmp(am, xm))) : Cmp}
          %el : {D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(_, xl), U32.cmp(bm, xm))) == D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(al, xl), U32.cmp(am, xm))) : Cmp}
          %em : {D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(al, xl), U32.cmp(_, xm))) == D.Kc.then(U32.cmp(ah, xh), D.Kc.then(U32.cmp(al, xl), U32.cmp(am, xm))) : Cmp}
          {==}

# Equal keys compare alike.
def KCong(+a: D.Kr, +b: D.Kr, +x: D.Kr, +e: {D.Kr.cmp(a, b) == EQ{} : Cmp}) -> {D.Kr.cmp(b, x) == D.Kr.cmp(a, x) : Cmp}:
  match a b x:
    case D.Kr{+ah, +al, +am, +av} D.Kr{+bh, +bl, +bm, +bv} D.Kr{+xh, +xl, +xm, +xv}:
      KCong.k(ah, al, am, bh, bl, bm, xh, xl, xm, SameOf.k(ah, al, am, bh, bl, bm, ThenEq(U32.cmp(ah, bh), D.Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)), e)))

def FlipLT(+a: D.Kr, +b: D.Kr, +h: {D.Kr.cmp(a, b) == LT{} : Cmp}) -> {D.Kr.cmp(b, a) == GT{} : Cmp}:
  %Equal.sym(Cmp, D.Kr.cmp(b, a), Fl(D.Kr.cmp(a, b)), KSym(a, b)) : {_ == GT{} : Cmp}
  %Equal.sym(Cmp, D.Kr.cmp(a, b), LT{}, h) : {Fl(_) == GT{} : Cmp}
  {==}

def FlipGT(+a: D.Kr, +b: D.Kr, +h: {D.Kr.cmp(a, b) == GT{} : Cmp}) -> {D.Kr.cmp(b, a) == LT{} : Cmp}:
  %Equal.sym(Cmp, D.Kr.cmp(b, a), Fl(D.Kr.cmp(a, b)), KSym(a, b)) : {_ == LT{} : Cmp}
  %Equal.sym(Cmp, D.Kr.cmp(a, b), GT{}, h) : {Fl(_) == LT{} : Cmp}
  {==}

# Moving a comparison fact along equalities of its arguments.
def CmpTr(+a: D.Kr, +a2: D.Kr, +b: D.Kr, +b2: D.Kr, +c: Cmp, +ea: {a == a2 : D.Kr}, +eb: {b == b2 : D.Kr}, +h: {D.Kr.cmp(a, b) == c : Cmp}) -> {D.Kr.cmp(a2, b2) == c : Cmp}:
  %ea : {D.Kr.cmp(_, b2) == c : Cmp}
  %eb : {D.Kr.cmp(a, _) == c : Cmp}
  h

def MergeS.t(+x: D.Kr, +xt: List<&2, D.Kr>, +y: D.Kr, +yt: List<&2, D.Kr>, +z: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, xt, z), Laws.In(D.Kr, Con{y, yt}, z)>) -> Either<&2, &2, Laws.In(D.Kr, Con{x, xt}, z), Laws.In(D.Kr, Con{y, yt}, z)>:
  match r:
    case Inl{q}:
      Inl{Inr{q}}
    case Inr{q}:
      Inr{q}

def MergeS.f(+x: D.Kr, +xt: List<&2, D.Kr>, +y: D.Kr, +yt: List<&2, D.Kr>, +z: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, Con{x, xt}, z), Laws.In(D.Kr, yt, z)>) -> Either<&2, &2, Laws.In(D.Kr, Con{x, xt}, z), Laws.In(D.Kr, Con{y, yt}, z)>:
  match r:
    case Inl{q}:
      Inl{q}
    case Inr{q}:
      Inr{Inr{q}}

# ---- the sort keeps every row and adds none --------------------------------------------------------
def MergeS.k(+b: Bool, +p: Nat, +x: D.Kr, +xt: List<&2, D.Kr>, +y: D.Kr, +yt: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, Con{D.Ks.hd(b, x, y), D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt))}, z), ih: Laws.In(D.Kr, D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt)), z) -> Either<&2, &2, Laws.In(D.Kr, D.Ks.pl(b, x, xt), z), Laws.In(D.Kr, D.Ks.pr(b, y, yt), z)>) -> Either<&2, &2, Laws.In(D.Kr, Con{x, xt}, z), Laws.In(D.Kr, Con{y, yt}, z)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          MergeS.t(x, xt, y, yt, z, ih(q))
    case False{}:
      match h:
        case Inl{e}:
          Inr{Inl{e}}
        case Inr{q}:
          MergeS.f(x, xt, y, yt, z, ih(q))

def MergeS(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, D.Ks.merge(fuel, xs, ys), z)) -> Either<&2, &2, Laws.In(D.Kr, xs, z), Laws.In(D.Kr, ys, z)>:
  match fuel:
    case 0n:
      AppS(D.Kr, xs, ys, z, h)
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Inr{h}
        case Nil{} Con{+y9, +t9}:
          Inr{h}
        case Con{+x9, +u9} Nil{}:
          Inl{h}
        case Con{+x, +xt} Con{+y, +yt}:
          MergeS.k(Cmp.is_lt(D.Kr.cmp(x, y)), p, x, xt, y, yt, z, h, q => MergeS(p, D.Ks.pl(Cmp.is_lt(D.Kr.cmp(x, y)), x, xt), D.Ks.pr(Cmp.is_lt(D.Kr.cmp(x, y)), y, yt), z, q))

def MergeCL.k(+b: Bool, +p: Nat, +x: D.Kr, +xt: List<&2, D.Kr>, +y: D.Kr, +yt: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, Con{x, xt}, z), ih: Laws.In(D.Kr, D.Ks.pl(b, x, xt), z) -> Laws.In(D.Kr, D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt)), z)) -> Laws.In(D.Kr, Con{D.Ks.hd(b, x, y), D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt))}, z):
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{ih(q)}
    case False{}:
      Inr{ih(h)}

def MergeCL(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, xs, z)) -> Laws.In(D.Kr, D.Ks.merge(fuel, xs, ys), z):
  match fuel:
    case 0n:
      AppL(D.Kr, xs, ys, z, h)
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Empty.absurd(Laws.In(D.Kr, Nil{}, z), h)
        case Nil{} Con{+y9, +t9}:
          Empty.absurd(Laws.In(D.Kr, Con{y9, t9}, z), h)
        case Con{+x9, +u9} Nil{}:
          h
        case Con{+x, +xt} Con{+y, +yt}:
          MergeCL.k(Cmp.is_lt(D.Kr.cmp(x, y)), p, x, xt, y, yt, z, h, q => MergeCL(p, D.Ks.pl(Cmp.is_lt(D.Kr.cmp(x, y)), x, xt), D.Ks.pr(Cmp.is_lt(D.Kr.cmp(x, y)), y, yt), z, q))

def MergeCR.k(+b: Bool, +p: Nat, +x: D.Kr, +xt: List<&2, D.Kr>, +y: D.Kr, +yt: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, Con{y, yt}, z), ih: Laws.In(D.Kr, D.Ks.pr(b, y, yt), z) -> Laws.In(D.Kr, D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt)), z)) -> Laws.In(D.Kr, Con{D.Ks.hd(b, x, y), D.Ks.merge(p, D.Ks.pl(b, x, xt), D.Ks.pr(b, y, yt))}, z):
  match b:
    case True{}:
      Inr{ih(h)}
    case False{}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{ih(q)}

def MergeCR(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, ys, z)) -> Laws.In(D.Kr, D.Ks.merge(fuel, xs, ys), z):
  match fuel:
    case 0n:
      AppR(D.Kr, xs, ys, z, h)
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          h
        case Nil{} Con{+y9, +t9}:
          h
        case Con{+x9, +u9} Nil{}:
          Empty.absurd(Laws.In(D.Kr, Con{x9, u9}, z), h)
        case Con{+x, +xt} Con{+y, +yt}:
          MergeCR.k(Cmp.is_lt(D.Kr.cmp(x, y)), p, x, xt, y, yt, z, h, q => MergeCR(p, D.Ks.pl(Cmp.is_lt(D.Kr.cmp(x, y)), x, xt), D.Ks.pr(Cmp.is_lt(D.Kr.cmp(x, y)), y, yt), z, q))

def HalfS.k(+k: Bool, +x: D.Kr, +t: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, D.Ks.half_k(k, x, D.Ks.half(t, Bool.not(k))), z), ih: Laws.In(D.Kr, D.Ks.half(t, Bool.not(k)), z) -> Laws.In(D.Kr, t, z)) -> Laws.In(D.Kr, Con{x, t}, z):
  match k:
    case True{}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{ih(q)}
    case False{}:
      Inr{ih(h)}

def HalfS(+xs: List<&2, D.Kr>, +k: Bool, +z: D.Kr, +h: Laws.In(D.Kr, D.Ks.half(xs, k), z)) -> Laws.In(D.Kr, xs, z):
  match xs:
    case Nil{}:
      h
    case Con{+x, +t}:
      HalfS.k(k, x, t, z, h, q => HalfS(t, Bool.not(k), z, q))

def HkIn(+k: Bool, +x: D.Kr, +r: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, r, z)) -> Laws.In(D.Kr, D.Ks.half_k(k, x, r), z):
  match k:
    case True{}:
      Inr{h}
    case False{}:
      h

def HalfC.hd(+k: Bool, +x: D.Kr, +t: List<&2, D.Kr>, +z: D.Kr, +e: {x == z : D.Kr}) -> Either<&2, &2, Laws.In(D.Kr, D.Ks.half(Con{x, t}, k), z), Laws.In(D.Kr, D.Ks.half(Con{x, t}, Bool.not(k)), z)>:
  match k:
    case True{}:
      Inl{Inl{e}}
    case False{}:
      Inr{Inl{e}}

def HalfC.tl(+k: Bool, +x: D.Kr, +t: List<&2, D.Kr>, +z: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Ks.half(t, Bool.not(k)), z), Laws.In(D.Kr, D.Ks.half(t, Bool.not(Bool.not(k))), z)>) -> Either<&2, &2, Laws.In(D.Kr, D.Ks.half(Con{x, t}, k), z), Laws.In(D.Kr, D.Ks.half(Con{x, t}, Bool.not(k)), z)>:
  match r:
    case Inl{q}:
      Inl{HkIn(k, x, D.Ks.half(t, Bool.not(k)), z, q)}
    case Inr{q}:
      Inr{HkIn(Bool.not(k), x, D.Ks.half(t, Bool.not(Bool.not(k))), z, q)}

def HalfC(+xs: List<&2, D.Kr>, +k: Bool, +z: D.Kr, +h: Laws.In(D.Kr, xs, z)) -> Either<&2, &2, Laws.In(D.Kr, D.Ks.half(xs, k), z), Laws.In(D.Kr, D.Ks.half(xs, Bool.not(k)), z)>:
  match xs:
    case Nil{}:
      Empty.absurd(Either<&2, &2, Empty, Empty>, h)
    case Con{+x, +t}:
      match h:
        case Inl{e}:
          HalfC.hd(k, x, t, z, e)
        case Inr{q}:
          HalfC.tl(k, x, t, z, HalfC(t, Bool.not(k), z, q))

def SortS.m(+p: Nat, +xs: List<&2, D.Kr>, +z: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, True{})), z), Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, False{})), z)>, ih: (Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, True{})), z) -> Laws.In(D.Kr, D.Ks.half(xs, True{}), z)), ih2: (Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, False{})), z) -> Laws.In(D.Kr, D.Ks.half(xs, False{}), z))) -> Laws.In(D.Kr, xs, z):
  match r:
    case Inl{q}:
      HalfS(xs, True{}, z, ih(q))
    case Inr{q}:
      HalfS(xs, False{}, z, ih2(q))

def SortS(+fuel: Nat, +xs: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, D.Ks.sort(fuel, xs), z)) -> Laws.In(D.Kr, xs, z):
  match fuel:
    case 0n:
      h
    case 1n+p:
      match xs:
        case Nil{}:
          h
        case Con{x, Nil{}}:
          h
        case Con{+x, Con{+y, +t}}:
          SortS.m(p, Con{x, Con{y, t}}, z, MergeS(Nat.add(2n, List.length(&2, D.Kr, t)), D.Ks.sort(p, D.Ks.half(Con{x, Con{y, t}}, True{})), D.Ks.sort(p, D.Ks.half(Con{x, Con{y, t}}, False{})), z, h), q => SortS(p, D.Ks.half(Con{x, Con{y, t}}, True{}), z, q), q => SortS(p, D.Ks.half(Con{x, Con{y, t}}, False{}), z, q))

def SortC.m(+p: Nat, +n: Nat, +xs: List<&2, D.Kr>, +z: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Ks.half(xs, True{}), z), Laws.In(D.Kr, D.Ks.half(xs, False{}), z)>, ih: (Laws.In(D.Kr, D.Ks.half(xs, True{}), z) -> Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, True{})), z)), ih2: (Laws.In(D.Kr, D.Ks.half(xs, False{}), z) -> Laws.In(D.Kr, D.Ks.sort(p, D.Ks.half(xs, False{})), z))) -> Laws.In(D.Kr, D.Ks.merge(n, D.Ks.sort(p, D.Ks.half(xs, True{})), D.Ks.sort(p, D.Ks.half(xs, False{}))), z):
  match r:
    case Inl{q}:
      MergeCL(n, D.Ks.sort(p, D.Ks.half(xs, True{})), D.Ks.sort(p, D.Ks.half(xs, False{})), z, ih(q))
    case Inr{q}:
      MergeCR(n, D.Ks.sort(p, D.Ks.half(xs, True{})), D.Ks.sort(p, D.Ks.half(xs, False{})), z, ih2(q))

def SortC(+fuel: Nat, +xs: List<&2, D.Kr>, +z: D.Kr, +h: Laws.In(D.Kr, xs, z)) -> Laws.In(D.Kr, D.Ks.sort(fuel, xs), z):
  match fuel:
    case 0n:
      h
    case 1n+p:
      match xs:
        case Nil{}:
          h
        case Con{x, Nil{}}:
          h
        case Con{+x, Con{+y, +t}}:
          SortC.m(p, Nat.add(2n, List.length(&2, D.Kr, t)), Con{x, Con{y, t}}, z, HalfC(Con{x, Con{y, t}}, True{}, z, h), q => SortC(p, D.Ks.half(Con{x, Con{y, t}}, True{}), z, q), q => SortC(p, D.Ks.half(Con{x, Con{y, t}}, False{}), z, q))

# ---- strictly ascending lists ---------------------------------------------------------------------
def LtOf(+c: Cmp, +e: {Cmp.is_lt(c) == True{} : Bool}) -> {c == LT{} : Cmp}:
  match c:
    case LT{}:
      {==}
    case EQ{}:
      Empty.absurd({EQ{} == LT{} : Cmp}, L.Bool.ff_tt(e))
    case GT{}:
      Empty.absurd({GT{} == LT{} : Cmp}, L.Bool.ff_tt(e))

# Everything after x in a list ascending after x is above x.
def AscH2(+t: List<&2, D.Kr>, +x: D.Kr, +z: D.Kr, +e: {D.Ks.asc(t, Some{x}) == True{} : Bool}, +h: Laws.In(D.Kr, t, z)) -> {D.Kr.cmp(x, z) == LT{} : Cmp}:
  match t:
    case Nil{}:
      Empty.absurd({D.Kr.cmp(x, z) == LT{} : Cmp}, h)
    case Con{+y, +t2}:
      match h:
        case Inl{ey}:
          %ey : {D.Kr.cmp(x, _) == LT{} : Cmp}
          LtOf(D.Kr.cmp(x, y), AL(Cmp.is_lt(D.Kr.cmp(x, y)), D.Ks.asc(t2, Some{y}), e))
        case Inr{q}:
          KTrans(x, y, z, LtOf(D.Kr.cmp(x, y), AL(Cmp.is_lt(D.Kr.cmp(x, y)), D.Ks.asc(t2, Some{y}), e)), AscH2(t2, y, z, AR(Cmp.is_lt(D.Kr.cmp(x, y)), D.Ks.asc(t2, Some{y}), e), q))

def AscH(+t: List<&2, D.Kr>, +x: D.Kr, +z: D.Kr, +e: {D.Ks.asc(Con{x, t}, None{}) == True{} : Bool}, +h: Laws.In(D.Kr, t, z)) -> {D.Kr.cmp(x, z) == LT{} : Cmp}:
  AscH2(t, x, z, e, h)

# The tail of an ascending list is ascending.
def AscW(+t: List<&2, D.Kr>, +x: D.Kr, +e: {D.Ks.asc(t, Some{x}) == True{} : Bool}) -> {D.Ks.asc(t, None{}) == True{} : Bool}:
  match t:
    case Nil{}:
      {==}
    case Con{+y, +t2}:
      AR(Cmp.is_lt(D.Kr.cmp(x, y)), D.Ks.asc(t2, Some{y}), e)

def AscT(+t: List<&2, D.Kr>, +x: D.Kr, +e: {D.Ks.asc(Con{x, t}, None{}) == True{} : Bool}) -> {D.Ks.asc(t, None{}) == True{} : Bool}:
  AscW(t, x, e)

# In a strictly ascending list two rows with the same key are the same row.
def Uniq(+xs: List<&2, D.Kr>, +p: D.Kr, +q: D.Kr, +e: {D.Ks.asc(xs, None{}) == True{} : Bool}, +hp: Laws.In(D.Kr, xs, p), +hq: Laws.In(D.Kr, xs, q), +eq: {D.Kr.cmp(p, q) == EQ{} : Cmp}) -> {p == q : D.Kr}:
  match xs:
    case Nil{}:
      Empty.absurd({p == q : D.Kr}, hp)
    case Con{+x, +t}:
      match hp hq:
        case Inl{ep} Inl{eq2}:
          Equal.trans(D.Kr, p, x, q, Equal.sym(D.Kr, x, p, ep), eq2)
        case Inl{ep} Inr{q2}:
          Empty.absurd({p == q : D.Kr}, CC.le(D.Kr.cmp(p, q), CmpTr(x, p, q, q, LT{}, ep, {==}, AscH(t, x, q, e, q2)), eq))
        case Inr{p2} Inl{eq2}:
          Empty.absurd({p == q : D.Kr}, CC.ge(D.Kr.cmp(p, q), CmpTr(p, p, x, q, GT{}, {==}, eq2, FlipLT(x, p, AscH(t, x, p, e, p2))), eq))
        case Inr{p2} Inr{q2}:
          Uniq(t, p, q, AscT(t, x, e), p2, q2, eq)

def StIn.k(+e: D.Ev, +h: Laws.In(D.Ev, Con{D.ST{}, Nil{}}, e)) -> {D.ST{} == e : D.Ev}:
  match h:
    case Inl{q}:
      q
    case Inr{q}:
      Empty.absurd({D.ST{} == e : D.Ev}, q)

# ---- the walk: what each event says about the two sides ---------------------------------------------
def StIn(+xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +e: D.Ev, +h: Laws.In(D.Ev, D.Dw.st(xs, ys), e)) -> {D.ST{} == e : D.Ev}:
  match xs ys:
    case Nil{} Nil{}:
      Empty.absurd({D.ST{} == e : D.Ev}, h)
    case Nil{} Con{y, t}:
      StIn.k(e, h)
    case Con{x, t} ys2:
      StIn.k(e, h)

def ObNoA(+ys: List<&2, D.Kr>, +a: D.Kr, +h: Laws.In(D.Ev, D.Dw.ob(ys), D.OA{a})) -> Empty:
  match ys:
    case Nil{}:
      h
    case Con{+y, t}:
      match h:
        case Inl{e}:
          X.BA(y, a, e)
        case Inr{q}:
          ObNoA(t, a, q)

def ObNoT(+ys: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.ob(ys), D.BT{a, b})) -> Empty:
  match ys:
    case Nil{}:
      h
    case Con{+y, t}:
      match h:
        case Inl{e}:
          X.BT(y, a, b, e)
        case Inr{q}:
          ObNoT(t, a, b, q)

def OaNoB(+xs: List<&2, D.Kr>, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.oa(xs), D.OB{b})) -> Empty:
  match xs:
    case Nil{}:
      h
    case Con{+x, t}:
      match h:
        case Inl{e}:
          X.AB(x, b, e)
        case Inr{q}:
          OaNoB(t, b, q)

def OaNoT(+xs: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.oa(xs), D.BT{a, b})) -> Empty:
  match xs:
    case Nil{}:
      h
    case Con{+x, t}:
      match h:
        case Inl{e}:
          X.AT(x, a, b, e)
        case Inr{q}:
          OaNoT(t, a, b, q)

def OaIn(+xs: List<&2, D.Kr>, +a: D.Kr, +h: Laws.In(D.Ev, D.Dw.oa(xs), D.OA{a})) -> Laws.In(D.Kr, xs, a):
  match xs:
    case Nil{}:
      h
    case Con{+x, t}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Ev, D.Kr, Ev.ga, D.OA{x}, D.OA{a}, e)}
        case Inr{q}:
          Inr{OaIn(t, a, q)}

def ObIn(+ys: List<&2, D.Kr>, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.ob(ys), D.OB{b})) -> Laws.In(D.Kr, ys, b):
  match ys:
    case Nil{}:
      h
    case Con{+y, t}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Ev, D.Kr, Ev.gb, D.OB{y}, D.OB{b}, e)}
        case Inr{q}:
          Inr{ObIn(t, b, q)}

def OaC(+xs: List<&2, D.Kr>, +a: D.Kr, +h: Laws.In(D.Kr, xs, a)) -> Laws.In(D.Ev, D.Dw.oa(xs), D.OA{a}):
  match xs:
    case Nil{}:
      h
    case Con{+x, t}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Kr, D.Ev, w => D.OA{w}, x, a, e)}
        case Inr{q}:
          Inr{OaC(t, a, q)}

def ObC(+ys: List<&2, D.Kr>, +b: D.Kr, +h: Laws.In(D.Kr, ys, b)) -> Laws.In(D.Ev, D.Dw.ob(ys), D.OB{b}):
  match ys:
    case Nil{}:
      h
    case Con{+y, t}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Kr, D.Ev, w => D.OB{w}, y, b, e)}
        case Inr{q}:
          Inr{ObC(t, b, q)}

# WA. an OA event names a base row.
def WA.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +a: D.Kr, +h: Laws.In(D.Ev, Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, D.OA{a}), ih: Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OA{a}) -> Laws.In(D.Kr, D.Dw.na(c, a0, ta), a)) -> Laws.In(D.Kr, Con{a0, ta}, a):
  match c:
    case LT{}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Ev, D.Kr, Ev.ga, D.OA{a0}, D.OA{a}, e)}
        case Inr{q}:
          Inr{ih(q)}
    case EQ{}:
      match h:
        case Inl{e}:
          Empty.absurd(Laws.In(D.Kr, Con{a0, ta}, a), X.TA(a0, b0, a, e))
        case Inr{q}:
          Inr{ih(q)}
    case GT{}:
      match h:
        case Inl{e}:
          Empty.absurd(Laws.In(D.Kr, Con{a0, ta}, a), X.BA(b0, a, e))
        case Inr{q}:
          ih(q)

def WA(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +a: D.Kr, +h: Laws.In(D.Ev, D.Dw.walk(fuel, xs, ys), D.OA{a})) -> Laws.In(D.Kr, xs, a):
  match fuel:
    case 0n:
      Empty.absurd(Laws.In(D.Kr, xs, a), X.SA(a, StIn(xs, ys, D.OA{a}, h)))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Empty.absurd(Laws.In(D.Kr, Nil{}, a), ObNoA(Nil{}, a, h))
        case Nil{} Con{+y9, +t9}:
          Empty.absurd(Laws.In(D.Kr, Nil{}, a), ObNoA(Con{y9, t9}, a, h))
        case Con{+x9, +u9} Nil{}:
          OaIn(Con{x9, u9}, a, h)
        case Con{+a0, +ta} Con{+b0, +tb}:
          WA.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, a, h, q => WA(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), a, q))

# WB. an OB event names a head row.
def WB.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +b: D.Kr, +h: Laws.In(D.Ev, Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, D.OB{b}), ih: Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OB{b}) -> Laws.In(D.Kr, D.Dw.nb(c, b0, tb), b)) -> Laws.In(D.Kr, Con{b0, tb}, b):
  match c:
    case LT{}:
      match h:
        case Inl{e}:
          Empty.absurd(Laws.In(D.Kr, Con{b0, tb}, b), X.AB(a0, b, e))
        case Inr{q}:
          ih(q)
    case EQ{}:
      match h:
        case Inl{e}:
          Empty.absurd(Laws.In(D.Kr, Con{b0, tb}, b), X.TB(a0, b0, b, e))
        case Inr{q}:
          Inr{ih(q)}
    case GT{}:
      match h:
        case Inl{e}:
          Inl{Equal.cong(D.Ev, D.Kr, Ev.gb, D.OB{b0}, D.OB{b}, e)}
        case Inr{q}:
          Inr{ih(q)}

def WB(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.walk(fuel, xs, ys), D.OB{b})) -> Laws.In(D.Kr, ys, b):
  match fuel:
    case 0n:
      Empty.absurd(Laws.In(D.Kr, ys, b), X.SB(b, StIn(xs, ys, D.OB{b}, h)))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          ObIn(Nil{}, b, h)
        case Nil{} Con{+y9, +t9}:
          ObIn(Con{y9, t9}, b, h)
        case Con{+x9, +u9} Nil{}:
          Empty.absurd(Laws.In(D.Kr, Nil{}, b), OaNoB(Con{x9, u9}, b, h))
        case Con{+a0, +ta} Con{+b0, +tb}:
          WB.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, b, h, q => WB(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), b, q))

# WT. a BT event names a base row and a head row with the same key.
def WTy(xs: List<&2, D.Kr>, ys: List<&2, D.Kr>, a: D.Kr, b: D.Kr) -> Data:
  TL.And(Laws.In(D.Kr, xs, a), TL.And(Laws.In(D.Kr, ys, b), {D.Kr.cmp(a, b) == EQ{} : Cmp}))

def WT.lt(+a0: D.Kr, +ta: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +r: WTy(ta, ys, a, b)) -> WTy(Con{a0, ta}, ys, a, b):
  match r:
    case Tuple{x, y}:
      Tuple{Inr{x}, y}

def WT.gt(+xs: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +r: WTy(xs, tb, a, b)) -> WTy(xs, Con{b0, tb}, a, b):
  match r:
    case Tuple{x, y}:
      match y:
        case Tuple{y1, y2}:
          Tuple{x, Tuple{Inr{y1}, y2}}

def WT.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +hc: {D.Kr.cmp(a0, b0) == c : Cmp}, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Ev, Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, D.BT{a, b}), ih: Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.BT{a, b}) -> WTy(D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb), a, b)) -> WTy(Con{a0, ta}, Con{b0, tb}, a, b):
  match c:
    case LT{}:
      match h:
        case Inl{e}:
          Empty.absurd(WTy(Con{a0, ta}, Con{b0, tb}, a, b), X.AT(a0, a, b, e))
        case Inr{q}:
          WT.lt(a0, ta, Con{b0, tb}, a, b, ih(q))
    case EQ{}:
      match h:
        case Inl{e}:
          Tuple{Inl{Equal.cong(D.Ev, D.Kr, Ev.ga, D.BT{a0, b0}, D.BT{a, b}, e)}, Tuple{Inl{Equal.cong(D.Ev, D.Kr, Ev.gb, D.BT{a0, b0}, D.BT{a, b}, e)}, CmpTr(a0, a, b0, b, EQ{}, Equal.cong(D.Ev, D.Kr, Ev.ga, D.BT{a0, b0}, D.BT{a, b}, e), Equal.cong(D.Ev, D.Kr, Ev.gb, D.BT{a0, b0}, D.BT{a, b}, e), hc)}}
        case Inr{q}:
          WT.gt(Con{a0, ta}, b0, tb, a, b, WT.lt(a0, ta, tb, a, b, ih(q)))
    case GT{}:
      match h:
        case Inl{e}:
          Empty.absurd(WTy(Con{a0, ta}, Con{b0, tb}, a, b), X.BT(b0, a, b, e))
        case Inr{q}:
          WT.gt(Con{a0, ta}, b0, tb, a, b, ih(q))

def WT(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Ev, D.Dw.walk(fuel, xs, ys), D.BT{a, b})) -> WTy(xs, ys, a, b):
  match fuel:
    case 0n:
      Empty.absurd(WTy(xs, ys, a, b), X.ST(a, b, StIn(xs, ys, D.BT{a, b}, h)))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Empty.absurd(WTy(Nil{}, Nil{}, a, b), ObNoT(Nil{}, a, b, h))
        case Nil{} Con{+y9, +t9}:
          Empty.absurd(WTy(Nil{}, Con{y9, t9}, a, b), ObNoT(Con{y9, t9}, a, b, h))
        case Con{+x9, +u9} Nil{}:
          Empty.absurd(WTy(Con{x9, u9}, Nil{}, a, b), OaNoT(Con{x9, u9}, a, b, h))
        case Con{+a0, +ta} Con{+b0, +tb}:
          WT.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, {==}, a, b, h, q => WT(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), a, b, q))

# NA. a base key reported alone matches no head row.
def Asc(xs: List<&2, D.Kr>) -> Data:
  {D.Ks.asc(xs, None{}) == True{} : Bool}

def NA.lt(+a0: D.Kr, +b0: D.Kr, +tb: List<&2, D.Kr>, +a: D.Kr, +y: D.Kr, +ea: {a0 == a : D.Kr}, +hc: {D.Kr.cmp(a0, b0) == LT{} : Cmp}, +ay: Asc(Con{b0, tb}), +hy: Laws.In(D.Kr, Con{b0, tb}, y), +e: {D.Kr.cmp(a, y) == EQ{} : Cmp}) -> Empty:
  match hy:
    case Inl{eb}:
      CC.le(D.Kr.cmp(a, y), CmpTr(a0, a, b0, y, LT{}, ea, eb, hc), e)
    case Inr{qy}:
      CC.le(D.Kr.cmp(a, y), CmpTr(a0, a, y, y, LT{}, ea, {==}, KTrans(a0, b0, y, hc, AscH(tb, b0, y, ay, qy))), e)

def NA.gt(+a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +a: D.Kr, +y: D.Kr, +hc: {D.Kr.cmp(a0, b0) == GT{} : Cmp}, +ax: Asc(Con{a0, ta}), +eb: {b0 == y : D.Kr}, +e: {D.Kr.cmp(a, y) == EQ{} : Cmp}, +ha: Laws.In(D.Kr, Con{a0, ta}, a)) -> Empty:
  match ha:
    case Inl{ea}:
      CC.ge(D.Kr.cmp(a, y), CmpTr(a0, a, b0, y, GT{}, ea, eb, hc), e)
    case Inr{qa}:
      CC.ge(D.Kr.cmp(a, y), CmpTr(a, a, b0, y, GT{}, {==}, eb, FlipLT(b0, a, KTrans(b0, a0, a, FlipGT(a0, b0, hc), AscH(ta, a0, a, ax, qa)))), e)

def NA.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +hc: {D.Kr.cmp(a0, b0) == c : Cmp}, +a: D.Kr, +ax: Asc(Con{a0, ta}), +ay: Asc(Con{b0, tb}), +h: Laws.In(D.Ev, Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, D.OA{a}), +y: D.Kr, +hy: Laws.In(D.Kr, Con{b0, tb}, y), +e: {D.Kr.cmp(a, y) == EQ{} : Cmp}, wa: Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OA{a}) -> Laws.In(D.Kr, D.Dw.na(c, a0, ta), a), ih: Asc(D.Dw.na(c, a0, ta)) -> Asc(D.Dw.nb(c, b0, tb)) -> Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OA{a}) -> Laws.In(D.Kr, D.Dw.nb(c, b0, tb), y) -> Empty) -> Empty:
  match c:
    case LT{}:
      match h:
        case Inl{ea}:
          NA.lt(a0, b0, tb, a, y, Equal.cong(D.Ev, D.Kr, Ev.ga, D.OA{a0}, D.OA{a}, ea), hc, ay, hy, e)
        case Inr{q}:
          ih(AscT(ta, a0, ax), ay, q, hy)
    case EQ{}:
      match h:
        case Inl{ea}:
          X.TA(a0, b0, a, ea)
        case Inr{q}:
          match hy:
            case Inl{eb}:
              CC.ge(D.Kr.cmp(a, y), CmpTr(a, a, b0, y, GT{}, {==}, eb, FlipLT(b0, a, Equal.trans(Cmp, D.Kr.cmp(b0, a), D.Kr.cmp(a0, a), LT{}, KCong(a0, b0, a, hc), AscH(ta, a0, a, ax, wa(q))))), e)
            case Inr{qy}:
              ih(AscT(ta, a0, ax), AscT(tb, b0, ay), q, qy)
    case GT{}:
      match h:
        case Inl{ea}:
          X.BA(b0, a, ea)
        case Inr{q}:
          match hy:
            case Inl{eb}:
              NA.gt(a0, ta, b0, a, y, hc, ax, eb, e, wa(q))
            case Inr{qy}:
              ih(ax, AscT(tb, b0, ay), q, qy)

def NA(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +a: D.Kr, +ax: Asc(xs), +ay: Asc(ys), +h: Laws.In(D.Ev, D.Dw.walk(fuel, xs, ys), D.OA{a}), +y: D.Kr, +hy: Laws.In(D.Kr, ys, y), +e: {D.Kr.cmp(a, y) == EQ{} : Cmp}) -> Empty:
  match fuel:
    case 0n:
      X.SA(a, StIn(xs, ys, D.OA{a}, h))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          ObNoA(Nil{}, a, h)
        case Nil{} Con{+y9, +t9}:
          ObNoA(Con{y9, t9}, a, h)
        case Con{+x9, +u9} Nil{}:
          hy
        case Con{+a0, +ta} Con{+b0, +tb}:
          NA.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, {==}, a, ax, ay, h, y, hy, e, q => WA(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), a, q), u => v => q => r => NA(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), a, u, v, q, y, r, e))

def NB.lt(+a0: D.Kr, +b0: D.Kr, +tb: List<&2, D.Kr>, +b: D.Kr, +x: D.Kr, +hc: {D.Kr.cmp(a0, b0) == LT{} : Cmp}, +ay: Asc(Con{b0, tb}), +ex: {a0 == x : D.Kr}, +e: {D.Kr.cmp(x, b) == EQ{} : Cmp}, +hb: Laws.In(D.Kr, Con{b0, tb}, b)) -> Empty:
  match hb:
    case Inl{eb}:
      CC.le(D.Kr.cmp(x, b), CmpTr(a0, x, b0, b, LT{}, ex, eb, hc), e)
    case Inr{qb}:
      CC.le(D.Kr.cmp(x, b), CmpTr(a0, x, b, b, LT{}, ex, {==}, KTrans(a0, b0, b, hc, AscH(tb, b0, b, ay, qb))), e)

def NB.gt(+a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +b: D.Kr, +x: D.Kr, +eb: {b0 == b : D.Kr}, +hc: {D.Kr.cmp(a0, b0) == GT{} : Cmp}, +ax: Asc(Con{a0, ta}), +hx: Laws.In(D.Kr, Con{a0, ta}, x), +e: {D.Kr.cmp(x, b) == EQ{} : Cmp}) -> Empty:
  match hx:
    case Inl{ex}:
      CC.ge(D.Kr.cmp(x, b), CmpTr(a0, x, b0, b, GT{}, ex, eb, hc), e)
    case Inr{qx}:
      CC.ge(D.Kr.cmp(x, b), CmpTr(x, x, b0, b, GT{}, {==}, eb, FlipLT(b0, x, KTrans(b0, a0, x, FlipGT(a0, b0, hc), AscH(ta, a0, x, ax, qx)))), e)

# NB. a head key reported alone matches no base row.
def NB.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +hc: {D.Kr.cmp(a0, b0) == c : Cmp}, +b: D.Kr, +ax: Asc(Con{a0, ta}), +ay: Asc(Con{b0, tb}), +h: Laws.In(D.Ev, Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, D.OB{b}), +x: D.Kr, +hx: Laws.In(D.Kr, Con{a0, ta}, x), +e: {D.Kr.cmp(x, b) == EQ{} : Cmp}, wb: Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OB{b}) -> Laws.In(D.Kr, D.Dw.nb(c, b0, tb), b), ih: Asc(D.Dw.na(c, a0, ta)) -> Asc(D.Dw.nb(c, b0, tb)) -> Laws.In(D.Ev, D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), D.OB{b}) -> Laws.In(D.Kr, D.Dw.na(c, a0, ta), x) -> Empty) -> Empty:
  match c:
    case LT{}:
      match h:
        case Inl{eb}:
          X.AB(a0, b, eb)
        case Inr{q}:
          match hx:
            case Inl{ex}:
              NB.lt(a0, b0, tb, b, x, hc, ay, ex, e, wb(q))
            case Inr{qx}:
              ih(AscT(ta, a0, ax), ay, q, qx)
    case EQ{}:
      match h:
        case Inl{eb}:
          X.TB(a0, b0, b, eb)
        case Inr{q}:
          match hx:
            case Inl{ex}:
              CC.le(D.Kr.cmp(x, b), CmpTr(a0, x, b, b, LT{}, ex, {==}, Equal.trans(Cmp, D.Kr.cmp(a0, b), D.Kr.cmp(b0, b), LT{}, Equal.sym(Cmp, D.Kr.cmp(b0, b), D.Kr.cmp(a0, b), KCong(a0, b0, b, hc)), AscH(tb, b0, b, ay, wb(q)))), e)
            case Inr{qx}:
              ih(AscT(ta, a0, ax), AscT(tb, b0, ay), q, qx)
    case GT{}:
      match h:
        case Inl{eb}:
          NB.gt(a0, ta, b0, b, x, Equal.cong(D.Ev, D.Kr, Ev.gb, D.OB{b0}, D.OB{b}, eb), hc, ax, hx, e)
        case Inr{q}:
          ih(ax, AscT(tb, b0, ay), q, hx)

def NB(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +b: D.Kr, +ax: Asc(xs), +ay: Asc(ys), +h: Laws.In(D.Ev, D.Dw.walk(fuel, xs, ys), D.OB{b}), +x: D.Kr, +hx: Laws.In(D.Kr, xs, x), +e: {D.Kr.cmp(x, b) == EQ{} : Cmp}) -> Empty:
  match fuel:
    case 0n:
      X.SB(b, StIn(xs, ys, D.OB{b}, h))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          hx
        case Nil{} Con{+y9, +t9}:
          hx
        case Con{+x9, +u9} Nil{}:
          OaNoB(Con{x9, u9}, b, h)
        case Con{+a0, +ta} Con{+b0, +tb}:
          NB.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, {==}, b, ax, ay, h, x, hx, e, q => WB(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), b, q), u => v => q => r => NB(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), b, u, v, q, x, r, e))

# CA / CB. with a walk that is not stuck, every row is reported alone or matched.
def CAy(es: List<&2, D.Ev>, a: D.Kr) -> Data:
  Either<&2, &2, Laws.In(D.Ev, es, D.OA{a}), TL.Ex(D.Kr, b => Laws.In(D.Ev, es, D.BT{a, b}))>

def CBy(es: List<&2, D.Ev>, b: D.Kr) -> Data:
  Either<&2, &2, Laws.In(D.Ev, es, D.OB{b}), TL.Ex(D.Kr, a => Laws.In(D.Ev, es, D.BT{a, b}))>

def CA.w(+e0: D.Ev, +es: List<&2, D.Ev>, +a: D.Kr, +r: CAy(es, a)) -> CAy(Con{e0, es}, a):
  match r:
    case Inl{q}:
      Inl{Inr{q}}
    case Inr{t}:
      match t:
        case Tuple{+b, q}:
          Inr{Tuple{b, Inr{q}}}

def CB.w(+e0: D.Ev, +es: List<&2, D.Ev>, +b: D.Kr, +r: CBy(es, b)) -> CBy(Con{e0, es}, b):
  match r:
    case Inl{q}:
      Inl{Inr{q}}
    case Inr{t}:
      match t:
        case Tuple{+a, q}:
          Inr{Tuple{a, Inr{q}}}

def StuckT(+e: {True{} == False{} : Bool}) -> Empty:
  TF(e)

def CA.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +a: D.Kr, +hs: {D.Dw.stuck(Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}) == False{} : Bool}, +h: Laws.In(D.Kr, Con{a0, ta}, a), ih: {D.Dw.stuck(D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))) == False{} : Bool} -> Laws.In(D.Kr, D.Dw.na(c, a0, ta), a) -> CAy(D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), a)) -> CAy(Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, a):
  match c:
    case LT{}:
      match h:
        case Inl{e}:
          Inl{Inl{Equal.cong(D.Kr, D.Ev, w => D.OA{w}, a0, a, e)}}
        case Inr{q}:
          CA.w(D.OA{a0}, D.Dw.walk(p, ta, Con{b0, tb}), a, ih(hs, q))
    case EQ{}:
      match h:
        case Inl{e}:
          Inr{Tuple{b0, Inl{Equal.cong(D.Kr, D.Ev, w => D.BT{w, b0}, a0, a, e)}}}
        case Inr{q}:
          CA.w(D.BT{a0, b0}, D.Dw.walk(p, ta, tb), a, ih(hs, q))
    case GT{}:
      CA.w(D.OB{b0}, D.Dw.walk(p, Con{a0, ta}, tb), a, ih(hs, h))

def CA(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +a: D.Kr, +hs: {D.Dw.stuck(D.Dw.walk(fuel, xs, ys)) == False{} : Bool}, +h: Laws.In(D.Kr, xs, a)) -> CAy(D.Dw.walk(fuel, xs, ys), a):
  match fuel:
    case 0n:
      match xs ys:
        case Nil{} ys2:
          Empty.absurd(CAy(D.Dw.st(Nil{}, ys2), a), h)
        case Con{x, t} ys2:
          Empty.absurd(CAy(Con{D.ST{}, Nil{}}, a), StuckT(hs))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Empty.absurd(CAy(D.Dw.ob(Nil{}), a), h)
        case Nil{} Con{+y9, +t9}:
          Empty.absurd(CAy(D.Dw.ob(Con{y9, t9}), a), h)
        case Con{+x9, +u9} Nil{}:
          Inl{OaC(Con{x9, u9}, a, h)}
        case Con{+a0, +ta} Con{+b0, +tb}:
          CA.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, a, hs, h, u => q => CA(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), a, u, q))

def CB.k(+c: Cmp, +p: Nat, +a0: D.Kr, +ta: List<&2, D.Kr>, +b0: D.Kr, +tb: List<&2, D.Kr>, +b: D.Kr, +hs: {D.Dw.stuck(Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}) == False{} : Bool}, +h: Laws.In(D.Kr, Con{b0, tb}, b), ih: {D.Dw.stuck(D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))) == False{} : Bool} -> Laws.In(D.Kr, D.Dw.nb(c, b0, tb), b) -> CBy(D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb)), b)) -> CBy(Con{D.Dw.ev(c, a0, b0), D.Dw.walk(p, D.Dw.na(c, a0, ta), D.Dw.nb(c, b0, tb))}, b):
  match c:
    case LT{}:
      CB.w(D.OA{a0}, D.Dw.walk(p, ta, Con{b0, tb}), b, ih(hs, h))
    case EQ{}:
      match h:
        case Inl{e}:
          Inr{Tuple{a0, Inl{Equal.cong(D.Kr, D.Ev, w => D.BT{a0, w}, b0, b, e)}}}
        case Inr{q}:
          CB.w(D.BT{a0, b0}, D.Dw.walk(p, ta, tb), b, ih(hs, q))
    case GT{}:
      match h:
        case Inl{e}:
          Inl{Inl{Equal.cong(D.Kr, D.Ev, w => D.OB{w}, b0, b, e)}}
        case Inr{q}:
          CB.w(D.OB{b0}, D.Dw.walk(p, Con{a0, ta}, tb), b, ih(hs, q))

def CB(+fuel: Nat, +xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>, +b: D.Kr, +hs: {D.Dw.stuck(D.Dw.walk(fuel, xs, ys)) == False{} : Bool}, +h: Laws.In(D.Kr, ys, b)) -> CBy(D.Dw.walk(fuel, xs, ys), b):
  match fuel:
    case 0n:
      match xs ys:
        case Nil{} Nil{}:
          Empty.absurd(CBy(Nil{}, b), h)
        case Nil{} Con{y, t}:
          Empty.absurd(CBy(Con{D.ST{}, Nil{}}, b), StuckT(hs))
        case Con{x, t} ys2:
          Empty.absurd(CBy(Con{D.ST{}, Nil{}}, b), StuckT(hs))
    case 1n+p:
      match xs ys:
        case Nil{} Nil{}:
          Inl{ObC(Nil{}, b, h)}
        case Nil{} Con{+y9, +t9}:
          Inl{ObC(Con{y9, t9}, b, h)}
        case Con{+x9, +u9} Nil{}:
          Empty.absurd(CBy(D.Dw.oa(Con{x9, u9}), b), h)
        case Con{+a0, +ta} Con{+b0, +tb}:
          CB.k(D.Kr.cmp(a0, b0), p, a0, ta, b0, tb, b, hs, h, u => q => CB(p, D.Dw.na(D.Kr.cmp(a0, b0), a0, ta), D.Dw.nb(D.Kr.cmp(a0, b0), b0, tb), b, u, q))

# ---- the report: each list holds exactly its events --------------------------------------------------
def PushV(+b: D.Kr, +x: D.Kr, +c: U32, bb: Bool, +hb: {U32.is_eq(D.Kr.v(b), c) == bb : Bool}, +h: Laws.In(D.Kr, D.Dr.push(bb, b, Nil{}), x)) -> TL.And({b == x : D.Kr}, {D.Kr.v(x) == c : U32}):
  match bb:
    case True{}:
      match h:
        case Inl{e}:
          Tuple{e, Equal.trans(U32, D.Kr.v(x), D.Kr.v(b), c, Equal.sym(U32, D.Kr.v(b), D.Kr.v(x), Equal.cong(D.Kr, U32, D.Kr.v, b, x, e)), L.U32.eq_sound(D.Kr.v(b), c, hb))}
        case Inr{q}:
          Empty.absurd(TL.And({b == x : D.Kr}, {D.Kr.v(x) == c : U32}), q)
    case False{}:
      Empty.absurd(TL.And({b == x : D.Kr}, {D.Kr.v(x) == c : U32}), h)

def IsEqT(+x: D.Kr, +c: U32, +hv: {D.Kr.v(x) == c : U32}) -> {U32.is_eq(D.Kr.v(x), c) == True{} : Bool}:
  %Equal.sym(U32, D.Kr.v(x), c, hv) : {U32.is_eq(_, c) == True{} : Bool}
  L2.U32.eq_refl(c)

def EvPush(+x: D.Kr, +c: U32, +hv: {D.Kr.v(x) == c : U32}) -> Laws.In(D.Kr, D.Dr.push(U32.is_eq(D.Kr.v(x), c), x, Nil{}), x):
  %Equal.sym(Bool, U32.is_eq(D.Kr.v(x), c), True{}, IsEqT(x, c, hv)) : Laws.In(D.Kr, D.Dr.push(_, x, Nil{}), x)
  Inl{{==}}

def NewTy(es: List<&2, D.Ev>, x: D.Kr, c: U32) -> Data:
  TL.And(Laws.In(D.Ev, es, D.OB{x}), {D.Kr.v(x) == c : U32})

def EvNewS.b(+b: D.Kr, +t: List<&2, D.Ev>, +x: D.Kr, +c: U32, +p: TL.And({b == x : D.Kr}, {D.Kr.v(x) == c : U32})) -> NewTy(Con{D.OB{b}, t}, x, c):
  match p:
    case Tuple{e, v}:
      Tuple{Inl{Equal.cong(D.Kr, D.Ev, w => D.OB{w}, b, x, e)}, v}

def EvNewS(+c: U32, +e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.ev_new(c, e), x)) -> NewTy(Con{e, t}, x, c):
  match e:
    case D.OB{+b}:
      EvNewS.b(b, t, x, c, PushV(b, x, c, U32.is_eq(D.Kr.v(b), c), {==}, h))
    case D.OA{a}:
      Empty.absurd(NewTy(Con{D.OA{a}, t}, x, c), h)
    case D.BT{a, b}:
      Empty.absurd(NewTy(Con{D.BT{a, b}, t}, x, c), h)
    case D.ST{}:
      Empty.absurd(NewTy(Con{D.ST{}, t}, x, c), h)

def NewS.w(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +c: U32, +p: NewTy(t, x, c)) -> NewTy(Con{e, t}, x, c):
  match p:
    case Tuple{a, v}:
      Tuple{Inr{a}, v}

def NewS.k(+e: D.Ev, +t: List<&2, D.Ev>, +c: U32, +x: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Dr.ev_new(c, e), x), Laws.In(D.Kr, D.Dr.new(t, c), x)>, ih: Laws.In(D.Kr, D.Dr.new(t, c), x) -> NewTy(t, x, c)) -> NewTy(Con{e, t}, x, c):
  match r:
    case Inl{q}:
      EvNewS(c, e, t, x, q)
    case Inr{q}:
      NewS.w(e, t, x, c, ih(q))

def NewS(+es: List<&2, D.Ev>, +c: U32, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.new(es, c), x)) -> NewTy(es, x, c):
  match es:
    case Nil{}:
      Empty.absurd(NewTy(Nil{}, x, c), h)
    case Con{+e, +t}:
      NewS.k(e, t, c, x, AppS(D.Kr, D.Dr.ev_new(c, e), D.Dr.new(t, c), x, h), q => NewS(t, c, x, q))

def NewC(+es: List<&2, D.Ev>, +c: U32, +x: D.Kr, +h: Laws.In(D.Ev, es, D.OB{x}), +hv: {D.Kr.v(x) == c : U32}) -> Laws.In(D.Kr, D.Dr.new(es, c), x):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Kr, Nil{}, x), h)
    case Con{+e, +t}:
      match h:
        case Inl{ee}:
          %Equal.sym(D.Ev, e, D.OB{x}, ee) : Laws.In(D.Kr, List.append(&2, D.Kr, D.Dr.ev_new(c, _), D.Dr.new(t, c)), x)
          AppL(D.Kr, D.Dr.ev_new(c, D.OB{x}), D.Dr.new(t, c), x, EvPush(x, c, hv))
        case Inr{q}:
          AppR(D.Kr, D.Dr.ev_new(c, e), D.Dr.new(t, c), x, NewC(t, c, x, q, hv))

def CovTy(es: List<&2, D.Ev>, x: D.Kr) -> Data:
  TL.And(CBy(es, x), {D.Kr.v(x) == 1 : U32})

def EvCovS.b(+b: D.Kr, +t: List<&2, D.Ev>, +x: D.Kr, +p: TL.And({b == x : D.Kr}, {D.Kr.v(x) == 1 : U32})) -> CovTy(Con{D.OB{b}, t}, x):
  match p:
    case Tuple{e, v}:
      Tuple{Inl{Inl{Equal.cong(D.Kr, D.Ev, w => D.OB{w}, b, x, e)}}, v}

def EvCovS.t(+a: D.Kr, +b: D.Kr, +t: List<&2, D.Ev>, +x: D.Kr, +p: TL.And({b == x : D.Kr}, {D.Kr.v(x) == 1 : U32})) -> CovTy(Con{D.BT{a, b}, t}, x):
  match p:
    case Tuple{e, v}:
      Tuple{Inr{Tuple{a, Inl{Equal.cong(D.Kr, D.Ev, w => D.BT{a, w}, b, x, e)}}}, v}

def EvCovS(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.ev_cov(e), x)) -> CovTy(Con{e, t}, x):
  match e:
    case D.OB{+b}:
      EvCovS.b(b, t, x, PushV(b, x, 1, U32.is_eq(D.Kr.v(b), 1), {==}, h))
    case D.BT{+a, +b}:
      EvCovS.t(a, b, t, x, PushV(b, x, 1, U32.is_eq(D.Kr.v(b), 1), {==}, h))
    case D.OA{a}:
      Empty.absurd(CovTy(Con{D.OA{a}, t}, x), h)
    case D.ST{}:
      Empty.absurd(CovTy(Con{D.ST{}, t}, x), h)

def CovS.w(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +p: CovTy(t, x)) -> CovTy(Con{e, t}, x):
  match p:
    case Tuple{c, v}:
      Tuple{CB.w(e, t, x, c), v}

def CovS.k(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Dr.ev_cov(e), x), Laws.In(D.Kr, D.Dr.cov(t), x)>, ih: Laws.In(D.Kr, D.Dr.cov(t), x) -> CovTy(t, x)) -> CovTy(Con{e, t}, x):
  match r:
    case Inl{q}:
      EvCovS(e, t, x, q)
    case Inr{q}:
      CovS.w(e, t, x, ih(q))

def CovS(+es: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.cov(es), x)) -> CovTy(es, x):
  match es:
    case Nil{}:
      Empty.absurd(CovTy(Nil{}, x), h)
    case Con{+e, +t}:
      CovS.k(e, t, x, AppS(D.Kr, D.Dr.ev_cov(e), D.Dr.cov(t), x, h), q => CovS(t, x, q))

def CovC1(+es: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Ev, es, D.OB{x}), +hv: {D.Kr.v(x) == 1 : U32}) -> Laws.In(D.Kr, D.Dr.cov(es), x):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Kr, Nil{}, x), h)
    case Con{+e, +t}:
      match h:
        case Inl{ee}:
          %Equal.sym(D.Ev, e, D.OB{x}, ee) : Laws.In(D.Kr, List.append(&2, D.Kr, D.Dr.ev_cov(_), D.Dr.cov(t)), x)
          AppL(D.Kr, D.Dr.ev_cov(D.OB{x}), D.Dr.cov(t), x, EvPush(x, 1, hv))
        case Inr{q}:
          AppR(D.Kr, D.Dr.ev_cov(e), D.Dr.cov(t), x, CovC1(t, x, q, hv))

def CovC2(+es: List<&2, D.Ev>, +a: D.Kr, +x: D.Kr, +h: Laws.In(D.Ev, es, D.BT{a, x}), +hv: {D.Kr.v(x) == 1 : U32}) -> Laws.In(D.Kr, D.Dr.cov(es), x):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Kr, Nil{}, x), h)
    case Con{+e, +t}:
      match h:
        case Inl{ee}:
          %Equal.sym(D.Ev, e, D.BT{a, x}, ee) : Laws.In(D.Kr, List.append(&2, D.Kr, D.Dr.ev_cov(_), D.Dr.cov(t)), x)
          AppL(D.Kr, D.Dr.ev_cov(D.BT{a, x}), D.Dr.cov(t), x, EvPush(x, 1, hv))
        case Inr{q}:
          AppR(D.Kr, D.Dr.ev_cov(e), D.Dr.cov(t), x, CovC2(t, a, x, q, hv))

def CovC(+es: List<&2, D.Ev>, +x: D.Kr, +h: CBy(es, x), +hv: {D.Kr.v(x) == 1 : U32}) -> Laws.In(D.Kr, D.Dr.cov(es), x):
  match h:
    case Inl{q}:
      CovC1(es, x, q, hv)
    case Inr{t}:
      match t:
        case Tuple{+a, q}:
          CovC2(es, a, x, q, hv)

def EvRemS(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.ev_rem(e), x)) -> Laws.In(D.Ev, Con{e, t}, D.OA{x}):
  match e:
    case D.OA{+a}:
      match h:
        case Inl{q}:
          Inl{Equal.cong(D.Kr, D.Ev, w => D.OA{w}, a, x, q)}
        case Inr{q}:
          Empty.absurd(Laws.In(D.Ev, Con{D.OA{a}, t}, D.OA{x}), q)
    case D.OB{b}:
      Empty.absurd(Laws.In(D.Ev, Con{D.OB{b}, t}, D.OA{x}), h)
    case D.BT{a, b}:
      Empty.absurd(Laws.In(D.Ev, Con{D.BT{a, b}, t}, D.OA{x}), h)
    case D.ST{}:
      Empty.absurd(Laws.In(D.Ev, Con{D.ST{}, t}, D.OA{x}), h)

def RemS.k(+e: D.Ev, +t: List<&2, D.Ev>, +x: D.Kr, +r: Either<&2, &2, Laws.In(D.Kr, D.Dr.ev_rem(e), x), Laws.In(D.Kr, D.Dr.rem(t), x)>, ih: Laws.In(D.Kr, D.Dr.rem(t), x) -> Laws.In(D.Ev, t, D.OA{x})) -> Laws.In(D.Ev, Con{e, t}, D.OA{x}):
  match r:
    case Inl{q}:
      EvRemS(e, t, x, q)
    case Inr{q}:
      Inr{ih(q)}

def RemS(+es: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Kr, D.Dr.rem(es), x)) -> Laws.In(D.Ev, es, D.OA{x}):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Ev, Nil{}, D.OA{x}), h)
    case Con{+e, +t}:
      RemS.k(e, t, x, AppS(D.Kr, D.Dr.ev_rem(e), D.Dr.rem(t), x, h), q => RemS(t, x, q))

def RemC(+es: List<&2, D.Ev>, +x: D.Kr, +h: Laws.In(D.Ev, es, D.OA{x})) -> Laws.In(D.Kr, D.Dr.rem(es), x):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Kr, Nil{}, x), h)
    case Con{+e, +t}:
      match h:
        case Inl{ee}:
          %Equal.sym(D.Ev, e, D.OA{x}, ee) : Laws.In(D.Kr, List.append(&2, D.Kr, D.Dr.ev_rem(_), D.Dr.rem(t)), x)
          Inl{{==}}
        case Inr{q}:
          AppR(D.Kr, D.Dr.ev_rem(e), D.Dr.rem(t), x, RemC(t, x, q))

def MvBT(m: D.Mv) -> D.Ev:
  match m:
    case D.Mv{a, b}:
      D.BT{a, b}

def MvDir(+w: Bool, m: D.Mv) -> Bool:
  match m:
    case D.Mv{+a, +b}:
      D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b))

def MovTy(es: List<&2, D.Ev>, w: Bool, a: D.Kr, b: D.Kr) -> Data:
  TL.And(Laws.In(D.Ev, es, D.BT{a, b}), {D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)) == True{} : Bool})

def PickS(+a0: D.Kr, +b0: D.Kr, +t: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, bb: Bool, +hb: {D.Dr.dir(w, D.Kr.v(a0), D.Kr.v(b0)) == bb : Bool}, +h: Laws.In(D.Mv, D.Dr.pick(bb, a0, b0, Nil{}), D.Mv{a, b})) -> MovTy(Con{D.BT{a0, b0}, t}, w, a, b):
  match bb:
    case True{}:
      match h:
        case Inl{em}:
          Tuple{Inl{Equal.cong(D.Mv, D.Ev, MvBT, D.Mv{a0, b0}, D.Mv{a, b}, em)}, Equal.trans(Bool, D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)), D.Dr.dir(w, D.Kr.v(a0), D.Kr.v(b0)), True{}, Equal.sym(Bool, D.Dr.dir(w, D.Kr.v(a0), D.Kr.v(b0)), D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)), Equal.cong(D.Mv, Bool, m => MvDir(w, m), D.Mv{a0, b0}, D.Mv{a, b}, em)), hb)}
        case Inr{q}:
          Empty.absurd(MovTy(Con{D.BT{a0, b0}, t}, w, a, b), q)
    case False{}:
      Empty.absurd(MovTy(Con{D.BT{a0, b0}, t}, w, a, b), h)

def EvMovS(+e: D.Ev, +t: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Mv, D.Dr.ev_move(w, e), D.Mv{a, b})) -> MovTy(Con{e, t}, w, a, b):
  match e:
    case D.BT{+a0, +b0}:
      PickS(a0, b0, t, w, a, b, D.Dr.dir(w, D.Kr.v(a0), D.Kr.v(b0)), {==}, h)
    case D.OA{x}:
      Empty.absurd(MovTy(Con{D.OA{x}, t}, w, a, b), h)
    case D.OB{x}:
      Empty.absurd(MovTy(Con{D.OB{x}, t}, w, a, b), h)
    case D.ST{}:
      Empty.absurd(MovTy(Con{D.ST{}, t}, w, a, b), h)

def MovS.w(+e: D.Ev, +t: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, +p: MovTy(t, w, a, b)) -> MovTy(Con{e, t}, w, a, b):
  match p:
    case Tuple{x, y}:
      Tuple{Inr{x}, y}

def MovS.k(+e: D.Ev, +t: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, +r: Either<&2, &2, Laws.In(D.Mv, D.Dr.ev_move(w, e), D.Mv{a, b}), Laws.In(D.Mv, D.Dr.moves(t, w), D.Mv{a, b})>, ih: Laws.In(D.Mv, D.Dr.moves(t, w), D.Mv{a, b}) -> MovTy(t, w, a, b)) -> MovTy(Con{e, t}, w, a, b):
  match r:
    case Inl{q}:
      EvMovS(e, t, w, a, b, q)
    case Inr{q}:
      MovS.w(e, t, w, a, b, ih(q))

def MovS(+es: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Mv, D.Dr.moves(es, w), D.Mv{a, b})) -> MovTy(es, w, a, b):
  match es:
    case Nil{}:
      Empty.absurd(MovTy(Nil{}, w, a, b), h)
    case Con{+e, +t}:
      MovS.k(e, t, w, a, b, AppS(D.Mv, D.Dr.ev_move(w, e), D.Dr.moves(t, w), D.Mv{a, b}, h), q => MovS(t, w, a, b, q))

def MovC(+es: List<&2, D.Ev>, +w: Bool, +a: D.Kr, +b: D.Kr, +h: Laws.In(D.Ev, es, D.BT{a, b}), +hd: {D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)) == True{} : Bool}) -> Laws.In(D.Mv, D.Dr.moves(es, w), D.Mv{a, b}):
  match es:
    case Nil{}:
      Empty.absurd(Laws.In(D.Mv, Nil{}, D.Mv{a, b}), h)
    case Con{+e, +t}:
      match h:
        case Inl{ee}:
          %Equal.sym(D.Ev, e, D.BT{a, b}, ee) : Laws.In(D.Mv, List.append(&2, D.Mv, D.Dr.ev_move(w, _), D.Dr.moves(t, w)), D.Mv{a, b})
          %Equal.sym(Bool, D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)), True{}, hd) : Laws.In(D.Mv, List.append(&2, D.Mv, D.Dr.pick(_, a, b, Nil{}), D.Dr.moves(t, w)), D.Mv{a, b})
          Inl{{==}}
        case Inr{q}:
          AppR(D.Mv, D.Dr.ev_move(w, e), D.Dr.moves(t, w), D.Mv{a, b}, MovC(t, w, a, b, q, hd))

# ---- the run: what a printed delta certifies -------------------------------------------------------
def S64(+xs: List<&2, D.Kr>) -> List<&2, D.Kr>:
  D.Ks.sort(64n, xs)

def FK(+xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>) -> Nat:
  D.Dl.fuel(S64(xs), S64(ys))

def WK(+xs: List<&2, D.Kr>, +ys: List<&2, D.Kr>) -> List<&2, D.Ev>:
  D.Dw.walk(FK(xs, ys), S64(xs), S64(ys))

def Ok(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>) -> Bool:
  Bool.and(D.Dl.asc4(S64(kb), S64(kh), S64(mb), S64(mh)), Bool.and(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh)))))

def IsNone(m: Maybe<D.DOut>) -> Data:
  match m:
    case None{}:
      Unit
    case Some{x}:
      Empty

def MG(m: Maybe<D.DOut>) -> D.DOut:
  match m:
    case None{}:
      D.DOut{Nil{}, Nil{}, Nil{}, Nil{}, 0, Nil{}, Nil{}}
    case Some{x}:
      x

def R4.no(+o: D.DOut, +e: {None{} == Some{o} : Maybe<D.DOut>}) -> Empty:
  %e : IsNone(_)
  Unit{}

def R4(bb: Bool, +wk: List<&2, D.Ev>, +wm: List<&2, D.Ev>, +o: D.DOut, +e: {D.Dl.r4(bb, wk, wm) == Some{o} : Maybe<D.DOut>}) -> TL.And({bb == True{} : Bool}, {D.Dl.out(wk, wm) == o : D.DOut}):
  match bb:
    case True{}:
      Tuple{{==}, Equal.cong(Maybe<D.DOut>, D.DOut, MG, Some{D.Dl.out(wk, wm)}, Some{o}, e)}
    case False{}:
      Empty.absurd(TL.And({False{} == True{} : Bool}, {D.Dl.out(wk, wm) == o : D.DOut}), R4.no(o, e))

def RunR(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> TL.And({Ok(kb, kh, mb, mh) == True{} : Bool}, {D.Dl.out(WK(kb, kh), WK(mb, mh)) == o : D.DOut}):
  R4(Ok(kb, kh, mb, mh), WK(kb, kh), WK(mb, mh), o, e)

def R.ok(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {Ok(kb, kh, mb, mh) == True{} : Bool}:
  L.And.fst({Ok(kb, kh, mb, mh) == True{} : Bool}, {D.Dl.out(WK(kb, kh), WK(mb, mh)) == o : D.DOut}, RunR(kb, kh, mb, mh, o, e))

def R.out(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {D.Dl.out(WK(kb, kh), WK(mb, mh)) == o : D.DOut}:
  L.And.snd({Ok(kb, kh, mb, mh) == True{} : Bool}, {D.Dl.out(WK(kb, kh), WK(mb, mh)) == o : D.DOut}, RunR(kb, kh, mb, mh, o, e))

def R.a4(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {D.Dl.asc4(S64(kb), S64(kh), S64(mb), S64(mh)) == True{} : Bool}:
  AL(D.Dl.asc4(S64(kb), S64(kh), S64(mb), S64(mh)), Bool.and(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh)))), R.ok(kb, kh, mb, mh, o, e))

def R.ns(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {Bool.and(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh)))) == True{} : Bool}:
  AR(D.Dl.asc4(S64(kb), S64(kh), S64(mb), S64(mh)), Bool.and(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh)))), R.ok(kb, kh, mb, mh, o, e))

def R.sk(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {D.Dw.stuck(WK(kb, kh)) == False{} : Bool}:
  NotT(D.Dw.stuck(WK(kb, kh)), AL(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh))), R.ns(kb, kh, mb, mh, o, e)))

def R.sm(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {D.Dw.stuck(WK(mb, mh)) == False{} : Bool}:
  NotT(D.Dw.stuck(WK(mb, mh)), AR(Bool.not(D.Dw.stuck(WK(kb, kh))), Bool.not(D.Dw.stuck(WK(mb, mh))), R.ns(kb, kh, mb, mh, o, e)))

def R.ak(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {Bool.and(D.Ks.asc(S64(kb), None{}), D.Ks.asc(S64(kh), None{})) == True{} : Bool}:
  AL(Bool.and(D.Ks.asc(S64(kb), None{}), D.Ks.asc(S64(kh), None{})), Bool.and(D.Ks.asc(S64(mb), None{}), D.Ks.asc(S64(mh), None{})), R.a4(kb, kh, mb, mh, o, e))

def R.am(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> {Bool.and(D.Ks.asc(S64(mb), None{}), D.Ks.asc(S64(mh), None{})) == True{} : Bool}:
  AR(Bool.and(D.Ks.asc(S64(kb), None{}), D.Ks.asc(S64(kh), None{})), Bool.and(D.Ks.asc(S64(mb), None{}), D.Ks.asc(S64(mh), None{})), R.a4(kb, kh, mb, mh, o, e))

def R.ab(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> Asc(S64(kb)):
  AL(D.Ks.asc(S64(kb), None{}), D.Ks.asc(S64(kh), None{}), R.ak(kb, kh, mb, mh, o, e))

def R.ah(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> Asc(S64(kh)):
  AR(D.Ks.asc(S64(kb), None{}), D.Ks.asc(S64(kh), None{}), R.ak(kb, kh, mb, mh, o, e))

def R.amb(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> Asc(S64(mb)):
  AL(D.Ks.asc(S64(mb), None{}), D.Ks.asc(S64(mh), None{}), R.am(kb, kh, mb, mh, o, e))

def R.amh(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +o: D.DOut, +e: {Laws.Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}) -> Asc(S64(mh)):
  AR(D.Ks.asc(S64(mb), None{}), D.Ks.asc(S64(mh), None{}), R.am(kb, kh, mb, mh, o, e))

# ---- the laws ------------------------------------------------------------------------------------------
def Fr.b(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +c: U32, +q: NewTy(WK(kb, kh), x, c)) -> TL.And(Laws.In(D.Kr, kh, x), {D.Kr.v(x) == c : U32}):
  match q:
    case Tuple{a, v}:
      Tuple{SortS(64n, kh, x, WB(FK(kb, kh), S64(kb), S64(kh), x, a)), v}

def Fr.n(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +c: U32, +ab: Asc(S64(kb)), +ah: Asc(S64(kh)), +q: NewTy(WK(kb, kh), x, c), +hk: Laws.Has(kb, x)) -> Empty:
  match q hk:
    case Tuple{a, v} Tuple{+y, r}:
      match r:
        case Tuple{hy, sy}:
          NB(FK(kb, kh), S64(kb), S64(kh), x, ab, ah, a, y, SortC(64n, kb, y, hy), EqOf(y, x, sy))

def Laws.added_sound(kb, kh, mb, mh, o, e, x, h):
  Fr.b(kb, kh, x, 0, NewS(WK(kb, kh), 0, x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Added(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)))

def Laws.added_fresh(kb, kh, mb, mh, o, e, x, h, hk):
  Fr.n(kb, kh, x, 0, R.ab(kb, kh, mb, mh, o, e), R.ah(kb, kh, mb, mh, o, e), NewS(WK(kb, kh), 0, x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Added(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)), hk)

def Laws.allowed_sound(kb, kh, mb, mh, o, e, x, h):
  Fr.b(kb, kh, x, 2, NewS(WK(kb, kh), 2, x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Allowed(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)))

def Laws.allowed_fresh(kb, kh, mb, mh, o, e, x, h, hk):
  Fr.n(kb, kh, x, 2, R.ab(kb, kh, mb, mh, o, e), R.ah(kb, kh, mb, mh, o, e), NewS(WK(kb, kh), 2, x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Allowed(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)), hk)

def Cv.t(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +a: D.Kr, +x: D.Kr, +w: WTy(S64(kb), S64(kh), a, x)) -> Laws.In(D.Kr, kh, x):
  match w:
    case Tuple{p, r}:
      match r:
        case Tuple{hx, eq}:
          SortS(64n, kh, x, hx)

def Cv.b(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +r: CBy(WK(kb, kh), x)) -> Laws.In(D.Kr, kh, x):
  match r:
    case Inl{q}:
      SortS(64n, kh, x, WB(FK(kb, kh), S64(kb), S64(kh), x, q))
    case Inr{t}:
      match t:
        case Tuple{+a, q}:
          Cv.t(kb, kh, a, x, WT(FK(kb, kh), S64(kb), S64(kh), a, x, q))

def Cv.s(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +p: CovTy(WK(kb, kh), x)) -> TL.And(Laws.In(D.Kr, kh, x), {D.Kr.v(x) == 1 : U32}):
  match p:
    case Tuple{r, v}:
      Tuple{Cv.b(kb, kh, x, r), v}

def Laws.coverage_sound(kb, kh, mb, mh, o, e, x, h):
  Cv.s(kb, kh, x, CovS(WK(kb, kh), x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Cov(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)))

def Laws.removed_sound(kb, kh, mb, mh, o, e, x, h):
  SortS(64n, kb, x, WA(FK(kb, kh), S64(kb), S64(kh), x, RemS(WK(kb, kh), x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Removed(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h))))

def Rm.n(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +ab: Asc(S64(kb)), +ah: Asc(S64(kh)), +q: Laws.In(D.Ev, WK(kb, kh), D.OA{x}), +hk: Laws.Has(kh, x)) -> Empty:
  match hk:
    case Tuple{+y, r}:
      match r:
        case Tuple{hy, sy}:
          NA(FK(kb, kh), S64(kb), S64(kh), x, ab, ah, q, y, SortC(64n, kh, y, hy), EqOf(x, y, SameSym(y, x, sy)))

def Laws.removed_fresh(kb, kh, mb, mh, o, e, x, h, hk):
  Rm.n(kb, kh, x, R.ab(kb, kh, mb, mh, o, e), R.ah(kb, kh, mb, mh, o, e), RemS(WK(kb, kh), x, Tp(D.DOut, u => Laws.In(D.Kr, Laws.Removed(u), x), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)), hk)

def Mv.s2(+mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +a: D.Kr, +b: D.Kr, +hv: Bool, +eh: {hv == True{} : Bool}, +w: WTy(S64(mb), S64(mh), a, b)) -> TL.And(TL.And(Laws.In(D.Kr, mb, a), Laws.In(D.Kr, mh, b)), TL.And(Laws.Same(a, b), {hv == True{} : Bool})):
  match w:
    case Tuple{ha, r}:
      match r:
        case Tuple{hb, eq}:
          Tuple{Tuple{SortS(64n, mb, a, ha), SortS(64n, mh, b, hb)}, Tuple{SameOf(a, b, eq), eh}}

def Mv.s(+mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +w: Bool, +a: D.Kr, +b: D.Kr, +p: MovTy(WK(mb, mh), w, a, b)) -> TL.And(TL.And(Laws.In(D.Kr, mb, a), Laws.In(D.Kr, mh, b)), TL.And(Laws.Same(a, b), {D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)) == True{} : Bool})):
  match p:
    case Tuple{q, d}:
      Mv.s2(mb, mh, a, b, D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)), d, WT(FK(mb, mh), S64(mb), S64(mh), a, b, q))

def Laws.worsened_sound(kb, kh, mb, mh, o, e, a, b, h):
  Mv.s(mb, mh, True{}, a, b, MovS(WK(mb, mh), True{}, a, b, Tp(D.DOut, u => Laws.In(D.Mv, Laws.Worse(u), D.Mv{a, b}), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)))

def Laws.improved_sound(kb, kh, mb, mh, o, e, a, b, h):
  Mv.s(mb, mh, False{}, a, b, MovS(WK(mb, mh), False{}, a, b, Tp(D.DOut, u => Laws.In(D.Mv, Laws.Better(u), D.Mv{a, b}), o, D.Dl.out(WK(kb, kh), WK(mb, mh)), Equal.sym(D.DOut, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e)), h)))

# completeness
def Ac.t(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +a: D.Kr, +x: D.Kr, +w: WTy(S64(kb), S64(kh), a, x)) -> Laws.Has(kb, x):
  match w:
    case Tuple{ha, r}:
      match r:
        case Tuple{hx, eq}:
          Tuple{a, Tuple{SortS(64n, kb, a, ha), SameOf(a, x, eq)}}

def Ac(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +c: U32, +x: D.Kr, +hv: {D.Kr.v(x) == c : U32}, +r: CBy(WK(kb, kh), x)) -> Either<&2, &2, Laws.In(D.Kr, D.Dr.new(WK(kb, kh), c), x), Laws.Has(kb, x)>:
  match r:
    case Inl{q}:
      Inl{NewC(WK(kb, kh), c, x, q, hv)}
    case Inr{t}:
      match t:
        case Tuple{+a, q}:
          Inr{Ac.t(kb, kh, a, x, WT(FK(kb, kh), S64(kb), S64(kh), a, x, q))}

def Laws.added_complete(kb, kh, mb, mh, o, e, x, hx, hv):
  Tp(D.DOut, u => Either<&2, &2, Laws.In(D.Kr, Laws.Added(u), x), Laws.Has(kb, x)>, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), Ac(kb, kh, 0, x, hv, CB(FK(kb, kh), S64(kb), S64(kh), x, R.sk(kb, kh, mb, mh, o, e), SortC(64n, kh, x, hx))))

def Laws.allowed_complete(kb, kh, mb, mh, o, e, x, hx, hv):
  Tp(D.DOut, u => Either<&2, &2, Laws.In(D.Kr, Laws.Allowed(u), x), Laws.Has(kb, x)>, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), Ac(kb, kh, 2, x, hv, CB(FK(kb, kh), S64(kb), S64(kh), x, R.sk(kb, kh, mb, mh, o, e), SortC(64n, kh, x, hx))))

def Laws.coverage_complete(kb, kh, mb, mh, o, e, x, hx, hv):
  Tp(D.DOut, u => Laws.In(D.Kr, Laws.Cov(u), x), D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), CovC(WK(kb, kh), x, CB(FK(kb, kh), S64(kb), S64(kh), x, R.sk(kb, kh, mb, mh, o, e), SortC(64n, kh, x, hx)), hv))

def Rc.t(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +b: D.Kr, +w: WTy(S64(kb), S64(kh), x, b)) -> Laws.Has(kh, x):
  match w:
    case Tuple{hx, r}:
      match r:
        case Tuple{hb, eq}:
          Tuple{b, Tuple{SortS(64n, kh, b, hb), SameSym(x, b, SameOf(x, b, eq))}}

def Rc(+kb: List<&2, D.Kr>, +kh: List<&2, D.Kr>, +x: D.Kr, +r: CAy(WK(kb, kh), x)) -> Either<&2, &2, Laws.In(D.Kr, D.Dr.rem(WK(kb, kh)), x), Laws.Has(kh, x)>:
  match r:
    case Inl{q}:
      Inl{RemC(WK(kb, kh), x, q)}
    case Inr{t}:
      match t:
        case Tuple{+b, q}:
          Inr{Rc.t(kb, kh, x, b, WT(FK(kb, kh), S64(kb), S64(kh), x, b, q))}

def Laws.removed_complete(kb, kh, mb, mh, o, e, x, hx):
  Tp(D.DOut, u => Either<&2, &2, Laws.In(D.Kr, Laws.Removed(u), x), Laws.Has(kh, x)>, D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), Rc(kb, kh, x, CA(FK(kb, kh), S64(kb), S64(kh), x, R.sk(kb, kh, mb, mh, o, e), SortC(64n, kb, x, hx))))

def Wc.t(+mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +w: Bool, +a: D.Kr, +b: D.Kr, +b2: D.Kr, +amh: Asc(S64(mh)), +hb: Laws.In(D.Kr, mh, b), +hs: Laws.Same(a, b), +hd: {D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)) == True{} : Bool}, +q: Laws.In(D.Ev, WK(mb, mh), D.BT{a, b2}), +wt: WTy(S64(mb), S64(mh), a, b2)) -> Laws.In(D.Mv, D.Dr.moves(WK(mb, mh), w), D.Mv{a, b}):
  match wt:
    case Tuple{ha, r}:
      match r:
        case Tuple{hb2, eq2}:
          MovC(WK(mb, mh), w, a, b, Tp(D.Kr, z => Laws.In(D.Ev, WK(mb, mh), D.BT{a, z}), b2, b, Uniq(S64(mh), b2, b, amh, hb2, SortC(64n, mh, b, hb), Equal.trans(Cmp, D.Kr.cmp(b2, b), D.Kr.cmp(a, b), EQ{}, KCong(a, b2, b, eq2), EqOf(a, b, hs))), q), hd)

def Wc(+mb: List<&2, D.Kr>, +mh: List<&2, D.Kr>, +w: Bool, +a: D.Kr, +b: D.Kr, +amb: Asc(S64(mb)), +amh: Asc(S64(mh)), +hb: Laws.In(D.Kr, mh, b), +hs: Laws.Same(a, b), +hd: {D.Dr.dir(w, D.Kr.v(a), D.Kr.v(b)) == True{} : Bool}, +r: CAy(WK(mb, mh), a)) -> Laws.In(D.Mv, D.Dr.moves(WK(mb, mh), w), D.Mv{a, b}):
  match r:
    case Inl{q}:
      Empty.absurd(Laws.In(D.Mv, D.Dr.moves(WK(mb, mh), w), D.Mv{a, b}), NA(FK(mb, mh), S64(mb), S64(mh), a, amb, amh, q, b, SortC(64n, mh, b, hb), EqOf(a, b, hs)))
    case Inr{t}:
      match t:
        case Tuple{+b2, q}:
          Wc.t(mb, mh, w, a, b, b2, amh, hb, hs, hd, q, WT(FK(mb, mh), S64(mb), S64(mh), a, b2, q))

def Laws.worsened_complete(kb, kh, mb, mh, o, e, a, b, ha, hb, hs, hv):
  Tp(D.DOut, u => Laws.In(D.Mv, Laws.Worse(u), D.Mv{a, b}), D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), Wc(mb, mh, True{}, a, b, R.amb(kb, kh, mb, mh, o, e), R.amh(kb, kh, mb, mh, o, e), hb, hs, hv, CA(FK(mb, mh), S64(mb), S64(mh), a, R.sm(kb, kh, mb, mh, o, e), SortC(64n, mb, a, ha))))

def Laws.improved_complete(kb, kh, mb, mh, o, e, a, b, ha, hb, hs, hv):
  Tp(D.DOut, u => Laws.In(D.Mv, Laws.Better(u), D.Mv{a, b}), D.Dl.out(WK(kb, kh), WK(mb, mh)), o, R.out(kb, kh, mb, mh, o, e), Wc(mb, mh, False{}, a, b, R.amb(kb, kh, mb, mh, o, e), R.amh(kb, kh, mb, mh, o, e), hb, hs, hv, CA(FK(mb, mh), S64(mb), S64(mh), a, R.sm(kb, kh, mb, mh, o, e), SortC(64n, mb, a, ha))))

def Laws.lines_shape(ad, al, cv, rm, sm, wo, be):
  {==}
