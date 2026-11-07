# engine/Rules-PROOF.bend - proofs of the laws in Rules-LAWS.bend.
# Gate: `bend Rules-PROOF.bend --verdict` (run from engine/).

import Base
import ../PROOF.bend as Top
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ./Rules.bend as R
import ./Rules-LAWS.bend as Laws

# ---- small equalities --------------------------------------------------------------------------
def U.eq_t(+a: U32, +b: U32, e: {a == b : U32}) -> {U32.is_eq(a, b) == True{} : Bool}:
  %e : {U32.is_eq(a, _) == True{} : Bool}
  L2.U32.eq_refl(a)

def B.clash(t: Bool, hf: {t == False{} : Bool}, ht: {t == True{} : Bool}) -> Empty:
  match t:
    case True{}:
      L.Bool.tt_ff(hf)
    case False{}:
      L.Bool.ff_tt(ht)

def MU.val(m: Maybe<&2, U32>) -> U32:
  match m:
    case None{}:
      0
    case Some{x}:
      x

def MU.inj(+x: U32, +y: U32, e: {Some{x} == Some{y} : Maybe<&2, U32>}) -> {x == y : U32}:
  Equal.cong(Maybe<&2, U32>, U32, MU.val, Some{x}, Some{y}, e)

def MU.some(x: U32) -> Maybe<&2, U32>:
  Some{x}

def MU.disc(m: Maybe<&2, U32>) -> Type:
  match m:
    case None{}:
      Empty
    case Some{_}:
      Unit

def MU.none_some(+x: U32, e: {None{} == Some{x} : Maybe<&2, U32>}) -> Empty:
  %Equal.sym(Maybe<&2, U32>, None{}, Some{x}, e) : MU.disc(_)
  Unit{}

def MU.some_none(+x: U32, e: {Some{x} == None{} : Maybe<&2, U32>}) -> Empty:
  MU.none_some(x, Equal.sym(Maybe<&2, U32>, Some{x}, None{}, e))

def ME.val(m: Maybe<&2, List<&2, Maybe<&2, U32>>>) -> List<&2, Maybe<&2, U32>>:
  match m:
    case None{}:
      Nil{}
    case Some{x}:
      x

def ME.inj(+x: List<&2, Maybe<&2, U32>>, +y: List<&2, Maybe<&2, U32>>, e: {Some{x} == Some{y} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> {x == y : List<&2, Maybe<&2, U32>>}:
  Equal.cong(Maybe<&2, List<&2, Maybe<&2, U32>>>, List<&2, Maybe<&2, U32>>, ME.val, Some{x}, Some{y}, e)

def ME.disc(m: Maybe<&2, List<&2, Maybe<&2, U32>>>) -> Type:
  match m:
    case None{}:
      Empty
    case Some{_}:
      Unit

def ME.none_some(+x: List<&2, Maybe<&2, U32>>, e: {None{} == Some{x} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> Empty:
  %Equal.sym(Maybe<&2, List<&2, Maybe<&2, U32>>>, None{}, Some{x}, e) : ME.disc(_)
  Unit{}

# ---- the binding order -------------------------------------------------------------------------
def Le.refl(+e: List<&2, Maybe<&2, U32>>) -> Laws.Le(e, e):
  match e:
    case Nil{}:
      Unit{}
    case Con{None{}, +t}:
      Le.refl(t)
    case Con{Some{+x}, +t}:
      Tuple{{==}, Le.refl(t)}

# Below an empty environment means binding nothing, so below anything.
def Le.nil_any(+t: List<&2, Maybe<&2, U32>>, +X: List<&2, Maybe<&2, U32>>, h: Laws.Le(t, Nil{})) -> Laws.Le(t, X):
  match t:
    case Nil{}:
      Unit{}
    case Con{None{}, +r}:
      match X:
        case Nil{}:
          h
        case Con{+hx, +tx}:
          Le.nil_any(r, tx, h)
    case Con{Some{+x}, +r}:
      Empty.absurd(Laws.Le(Con{Some{x}, r}, X), h)

def Le.tail(+h: Maybe<&2, U32>, +t: List<&2, Maybe<&2, U32>>, +H: Maybe<&2, U32>, +T: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(Con{h, t}, Con{H, T})) -> Laws.Le(t, T):
  match h:
    case None{}:
      hl
    case Some{+y}:
      L.And.snd({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl)

# A Some head cannot sit below a Nil, and below a Con it fixes the head.
def Le.tl0(+hb: Maybe<&2, U32>, +tb: List<&2, Maybe<&2, U32>>, +h: Laws.Le(Con{hb, tb}, Nil{})) -> Laws.Le(tb, Nil{}):
  match hb:
    case None{}:
      h
    case Some{+y}:
      Empty.absurd(Laws.Le(tb, Nil{}), h)

def Le.hd0(+x: U32, +hb: Maybe<&2, U32>, +tb: List<&2, Maybe<&2, U32>>, e: {hb == Some{x} : Maybe<&2, U32>}, h: Laws.Le(Con{hb, tb}, Nil{})) -> Empty:
  match hb:
    case None{}:
      MU.none_some(x, e)
    case Some{+y}:
      h

def Le.hd(+hb: Maybe<&2, U32>, +tb: List<&2, Maybe<&2, U32>>, +hc: Maybe<&2, U32>, +tc: List<&2, Maybe<&2, U32>>, +x: U32, e: {hb == Some{x} : Maybe<&2, U32>}, h: Laws.Le(Con{hb, tb}, Con{hc, tc})) -> {hc == Some{x} : Maybe<&2, U32>}:
  match hb:
    case None{}:
      Empty.absurd({hc == Some{x} : Maybe<&2, U32>}, MU.none_some(x, e))
    case Some{+y}:
      Equal.trans(Maybe<&2, U32>, hc, Some{y}, Some{x}, L.And.fst({hc == Some{y} : Maybe<&2, U32>}, Laws.Le(tb, tc), h), e)

def Le.trans(+a: List<&2, Maybe<&2, U32>>, +b: List<&2, Maybe<&2, U32>>, +c: List<&2, Maybe<&2, U32>>, +hab: Laws.Le(a, b), +hbc: Laws.Le(b, c)) -> Laws.Le(a, c):
  match a:
    case Nil{}:
      Unit{}
    case Con{None{}, +t}:
      match b:
        case Nil{}:
          match c:
            case Nil{}:
              hab
            case Con{+hc, +tc}:
              Le.nil_any(t, tc, hab)
        case Con{+hb, +tb}:
          match c:
            case Nil{}:
              Le.trans(t, tb, Nil{}, hab, Le.tl0(hb, tb, hbc))
            case Con{+hc, +tc}:
              Le.trans(t, tb, tc, hab, Le.tail(hb, tb, hc, tc, hbc))
    case Con{Some{+x}, +t}:
      match b:
        case Nil{}:
          Empty.absurd(Laws.Le(Con{Some{x}, t}, c), hab)
        case Con{+hb, +tb}:
          match c:
            case Nil{}:
              Empty.absurd(Laws.Le(Con{Some{x}, t}, Nil{}), Le.hd0(x, hb, tb, L.And.fst({hb == Some{x} : Maybe<&2, U32>}, Laws.Le(t, tb), hab), hbc))
            case Con{+hc, +tc}:
              Tuple{Le.hd(hb, tb, hc, tc, x, L.And.fst({hb == Some{x} : Maybe<&2, U32>}, Laws.Le(t, tb), hab), hbc), Le.trans(t, tb, tc, L.And.snd({hb == Some{x} : Maybe<&2, U32>}, Laws.Le(t, tb), hab), Le.tail(hb, tb, hc, tc, hbc))}

# A binding below E is a binding of E.
def Le.get(+e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +v: Nat, +x: U32, +hl: Laws.Le(e, E), hg: {R.Env.get(e, v) == Some{x} : Maybe<&2, U32>}) -> {R.Env.get(E, v) == Some{x} : Maybe<&2, U32>}:
  match e:
    case Nil{}:
      Empty.absurd({R.Env.get(E, v) == Some{x} : Maybe<&2, U32>}, MU.none_some(x, hg))
    case Con{+h, +t}:
      match h:
        case None{}:
          match E:
            case Nil{}:
              match v:
                case 0n:
                  Empty.absurd({R.Env.get(Nil{}, 0n) == Some{x} : Maybe<&2, U32>}, MU.none_some(x, hg))
                case 1n+p:
                  Le.get(t, Nil{}, p, x, hl, hg)
            case Con{+H, +T}:
              match v:
                case 0n:
                  Empty.absurd({H == Some{x} : Maybe<&2, U32>}, MU.none_some(x, hg))
                case 1n+p:
                  Le.get(t, T, p, x, hl, hg)
        case Some{+y}:
          match E:
            case Nil{}:
              Empty.absurd({R.Env.get(Nil{}, v) == Some{x} : Maybe<&2, U32>}, hl)
            case Con{+H, +T}:
              match v:
                case 0n:
                  Equal.trans(Maybe<&2, U32>, H, Some{y}, Some{x}, L.And.fst({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl), hg)
                case 1n+p:
                  Le.get(t, T, p, x, L.And.snd({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl), hg)

# Setting an unbound variable only adds a binding.
def Le.set(+e: List<&2, Maybe<&2, U32>>, +v: Nat, +x: U32, hg: {R.Env.get(e, v) == None{} : Maybe<&2, U32>}) -> Laws.Le(e, R.Env.set(e, v, x)):
  match e:
    case Nil{}:
      match v:
        case 0n:
          Unit{}
        case 1n+p:
          Unit{}
    case Con{+h, +t}:
      match h:
        case None{}:
          match v:
            case 0n:
              Le.refl(t)
            case 1n+p:
              Le.set(t, p, x, hg)
        case Some{+y}:
          match v:
            case 0n:
              Empty.absurd(Laws.Le(Con{Some{y}, t}, Con{Some{x}, t}), MU.some_none(y, hg))
            case 1n+p:
              Tuple{{==}, Le.set(t, p, x, hg)}

# Setting v to the value E binds it keeps the environment below E.
def Le.up(+e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +v: Nat, +x: U32, +hl: Laws.Le(e, E), hg: {R.Env.get(E, v) == Some{x} : Maybe<&2, U32>}) -> Laws.Le(R.Env.set(e, v, x), E):
  match e:
    case Nil{}:
      match E:
        case Nil{}:
          Empty.absurd(Laws.Le(R.Env.set(Nil{}, v, x), Nil{}), MU.none_some(x, hg))
        case Con{+H, +T}:
          match v:
            case 0n:
              Tuple{hg, Unit{}}
            case 1n+p:
              Le.up(Nil{}, T, p, x, Unit{}, hg)
    case Con{+h, +t}:
      match h:
        case None{}:
          match E:
            case Nil{}:
              Empty.absurd(Laws.Le(R.Env.set(Con{None{}, t}, v, x), Nil{}), MU.none_some(x, hg))
            case Con{+H, +T}:
              match v:
                case 0n:
                  Tuple{hg, hl}
                case 1n+p:
                  Le.up(t, T, p, x, hl, hg)
        case Some{+y}:
          match E:
            case Nil{}:
              Empty.absurd(Laws.Le(R.Env.set(Con{Some{y}, t}, v, x), Nil{}), MU.none_some(x, hg))
            case Con{+H, +T}:
              match v:
                case 0n:
                  Tuple{hg, L.And.snd({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl)}
                case 1n+p:
                  Tuple{L.And.fst({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl), Le.up(t, T, p, x, L.And.snd({H == Some{y} : Maybe<&2, U32>}, Laws.Le(t, T), hl), hg)}

def Env.sg(+e: List<&2, Maybe<&2, U32>>, +v: Nat, +x: U32) -> {R.Env.get(R.Env.set(e, v, x), v) == Some{x} : Maybe<&2, U32>}:
  match e:
    case Nil{}:
      match v:
        case 0n:
          {==}
        case 1n+p:
          Env.sg(Nil{}, p, x)
    case Con{+h, +t}:
      match v:
        case 0n:
          {==}
        case 1n+p:
          Env.sg(t, p, x)

# ---- matching is monotone in the environment ---------------------------------------------------
def M1.mono(t: R.Tm, +x: U32, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e, E), h: Laws.Match1(t, x, e)) -> Laws.Match1(t, x, E):
  match t:
    case R.TV{+v}:
      Le.get(e, E, v, x, hl, h)
    case R.TC{+c}:
      h
    case R.TW{}:
      Unit{}

def Ms.mono(ts: List<&2, R.Tm>, xs: List<&2, U32>, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e, E), +h: Laws.Matches(ts, xs, e)) -> Laws.Matches(ts, xs, E):
  match ts:
    case Nil{}:
      match xs:
        case Nil{}:
          Unit{}
        case Con{+x, +xr}:
          Empty.absurd(Laws.Matches(Nil{}, Con{x, xr}, E), h)
    case Con{+t, +tr}:
      match xs:
        case Nil{}:
          Empty.absurd(Laws.Matches(Con{t, tr}, Nil{}, E), h)
        case Con{+x, +xr}:
          Tuple{M1.mono(t, x, e, E, hl, L.And.fst(Laws.Match1(t, x, e), Laws.Matches(tr, xr, e), h)), Ms.mono(tr, xr, e, E, hl, L.And.snd(Laws.Match1(t, x, e), Laws.Matches(tr, xr, e), h))}

def HM.mono(tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e, E), h: Laws.HasMatch(tups, ts, e)) -> Laws.HasMatch(tups, ts, E):
  match tups:
    case Nil{}:
      Empty.absurd(Laws.HasMatch(Nil{}, ts, E), h)
    case Con{+x, +t}:
      match h:
        case Inl{a}:
          Inl{Ms.mono(ts, x, e, E, hl, a)}
        case Inr{b}:
          Inr{HM.mono(t, ts, e, E, hl, b)}

# ---- one term: sound ---------------------------------------------------------------------------
# A picked environment is the one given, and the test was true.
def U1.pk(b: Bool, +y: U32, +v: Nat, +x: U32, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, hb: {U32.is_eq(y, x) == b : Bool}, hm: {R.Env.get(e, v) == Some{y} : Maybe<&2, U32>}, h: {R.Un.pick(b, e) == Some{e1} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> TL.And(Laws.Le(e, e1), {R.Env.get(e1, v) == Some{x} : Maybe<&2, U32>}):
  match b:
    case True{}:
      %ME.inj(e, e1, h) : TL.And(Laws.Le(e, _), {R.Env.get(_, v) == Some{x} : Maybe<&2, U32>})
      Tuple{Le.refl(e), Equal.trans(Maybe<&2, U32>, R.Env.get(e, v), Some{y}, Some{x}, hm, Equal.cong(U32, Maybe<&2, U32>, MU.some, y, x, L.U32.eq_sound(y, x, hb)))}
    case False{}:
      Empty.absurd(TL.And(Laws.Le(e, e1), {R.Env.get(e1, v) == Some{x} : Maybe<&2, U32>}), ME.none_some(e1, h))

def U1.var(m: Maybe<&2, U32>, +v: Nat, +x: U32, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, hm: {R.Env.get(e, v) == m : Maybe<&2, U32>}, h: {R.Un.var(m, v, x, e) == Some{e1} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> TL.And(Laws.Le(e, e1), {R.Env.get(e1, v) == Some{x} : Maybe<&2, U32>}):
  match m:
    case None{}:
      %ME.inj(R.Env.set(e, v, x), e1, h) : TL.And(Laws.Le(e, _), {R.Env.get(_, v) == Some{x} : Maybe<&2, U32>})
      Tuple{Le.set(e, v, x, hm), Env.sg(e, v, x)}
    case Some{+y}:
      U1.pk(U32.is_eq(y, x), y, v, x, e, e1, {==}, hm, h)

def U1.tc(b: Bool, +c: U32, +x: U32, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, hb: {U32.is_eq(c, x) == b : Bool}, h: {R.Un.pick(b, e) == Some{e1} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> TL.And(Laws.Le(e, e1), {c == x : U32}):
  match b:
    case True{}:
      %ME.inj(e, e1, h) : TL.And(Laws.Le(e, _), {c == x : U32})
      Tuple{Le.refl(e), L.U32.eq_sound(c, x, hb)}
    case False{}:
      Empty.absurd(TL.And(Laws.Le(e, e1), {c == x : U32}), ME.none_some(e1, h))

def U1.sound(t: R.Tm, +x: U32, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, h: {R.Un.one(t, x, e) == Some{e1} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> TL.And(Laws.Le(e, e1), Laws.Match1(t, x, e1)):
  match t:
    case R.TV{+v}:
      U1.var(R.Env.get(e, v), v, x, e, e1, {==}, h)
    case R.TC{+c}:
      U1.tc(U32.is_eq(c, x), c, x, e, e1, {==}, h)
    case R.TW{}:
      %ME.inj(e, e1, h) : TL.And(Laws.Le(e, _), Unit)
      Tuple{Le.refl(e), Unit{}}

# ---- one atom against one tuple: sound -----------------------------------------------------------
# What a match from a possibly failed start says: nothing from None, the law from Some e.
def UG.SW(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, ts: List<&2, R.Tm>, xs: List<&2, U32>, e2: List<&2, Maybe<&2, U32>>) -> Data:
  match m:
    case None{}:
      Empty
    case Some{e}:
      TL.And(Laws.Le(e, e2), Laws.Matches(ts, xs, e2))

def UG.k2(+t: R.Tm, +x: U32, +tr: List<&2, R.Tm>, +xr: List<&2, U32>, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, s: TL.And(Laws.Le(e, e1), Laws.Match1(t, x, e1)), ih: TL.And(Laws.Le(e1, e2), Laws.Matches(tr, xr, e2))) -> TL.And(Laws.Le(e, e2), Laws.Matches(Con{t, tr}, Con{x, xr}, e2)):
  match s:
    case Tuple{+l1, m1}:
      match ih:
        case Tuple{+l2, ms}:
          Tuple{Le.trans(e, e1, e2, l1, l2), Tuple{M1.mono(t, x, e1, e2, l2, m1), ms}}

def UG.k(m1: Maybe<&2, List<&2, Maybe<&2, U32>>>, +t: R.Tm, +x: U32, +tr: List<&2, R.Tm>, +xr: List<&2, U32>, +e: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, hm: {R.Un.one(t, x, e) == m1 : Maybe<&2, List<&2, Maybe<&2, U32>>>}, ih: UG.SW(m1, tr, xr, e2)) -> TL.And(Laws.Le(e, e2), Laws.Matches(Con{t, tr}, Con{x, xr}, e2)):
  match m1:
    case None{}:
      Empty.absurd(TL.And(Laws.Le(e, e2), Laws.Matches(Con{t, tr}, Con{x, xr}, e2)), ih)
    case Some{+e1}:
      UG.k2(t, x, tr, xr, e, e1, e2, U1.sound(t, x, e, e1, hm), ih)

def UG.sound(ts: List<&2, R.Tm>, xs: List<&2, U32>, m: Maybe<&2, List<&2, Maybe<&2, U32>>>, +e2: List<&2, Maybe<&2, U32>>, h: {R.Un.go(ts, xs, m) == Some{e2} : Maybe<&2, List<&2, Maybe<&2, U32>>>}) -> UG.SW(m, ts, xs, e2):
  match ts:
    case Nil{}:
      match xs:
        case Nil{}:
          match m:
            case None{}:
              ME.none_some(e2, h)
            case Some{+e}:
              %ME.inj(e, e2, h) : TL.And(Laws.Le(e, _), Unit)
              Tuple{Le.refl(e), Unit{}}
        case Con{+x, +xr}:
          Empty.absurd(UG.SW(m, Nil{}, Con{x, xr}, e2), ME.none_some(e2, h))
    case Con{+t, +tr}:
      match xs:
        case Nil{}:
          Empty.absurd(UG.SW(m, Con{t, tr}, Nil{}, e2), ME.none_some(e2, h))
        case Con{+x, +xr}:
          match m:
            case None{}:
              ME.none_some(e2, h)
            case Some{+e}:
              UG.k(R.Un.one(t, x, e), t, x, tr, xr, e, e2, {==}, UG.sound(tr, xr, R.Un.one(t, x, e), e2, h))

# ---- one atom against one tuple: complete ------------------------------------------------------
# The match succeeds with an environment below E.
def UC.W(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, E: List<&2, Maybe<&2, U32>>) -> Data:
  TL.Ex(List<&2, Maybe<&2, U32>>, e1 => TL.And({m == Some{e1} : Maybe<&2, List<&2, Maybe<&2, U32>>>}, Laws.Le(e1, E)))

def UC.pk(b: Bool, +y: U32, +x: U32, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, hb: {U32.is_eq(y, x) == b : Bool}, +hl: Laws.Le(e, E), yx: {y == x : U32}) -> UC.W(R.Un.pick(b, e), E):
  match b:
    case True{}:
      Tuple{e, Tuple{{==}, hl}}
    case False{}:
      Empty.absurd(UC.W(None{}, E), B.clash(U32.is_eq(y, x), hb, U.eq_t(y, x, yx)))

def UC.var(m: Maybe<&2, U32>, +v: Nat, +x: U32, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, hm: {R.Env.get(e, v) == m : Maybe<&2, U32>}, +hl: Laws.Le(e, E), hE: {R.Env.get(E, v) == Some{x} : Maybe<&2, U32>}) -> UC.W(R.Un.var(m, v, x, e), E):
  match m:
    case None{}:
      Tuple{R.Env.set(e, v, x), Tuple{{==}, Le.up(e, E, v, x, hl, hE)}}
    case Some{+y}:
      UC.pk(U32.is_eq(y, x), y, x, e, E, {==}, hl, MU.inj(y, x, Equal.trans(Maybe<&2, U32>, Some{y}, R.Env.get(E, v), Some{x}, Equal.sym(Maybe<&2, U32>, R.Env.get(E, v), Some{y}, Le.get(e, E, v, y, hl, hm)), hE)))

def UC.one(t: R.Tm, +x: U32, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e, E), h: Laws.Match1(t, x, E)) -> UC.W(R.Un.one(t, x, e), E):
  match t:
    case R.TV{+v}:
      UC.var(R.Env.get(e, v), v, x, e, E, {==}, hl, h)
    case R.TC{+c}:
      UC.pk(U32.is_eq(c, x), c, x, e, E, {==}, hl, h)
    case R.TW{}:
      Tuple{e, Tuple{{==}, hl}}

def UC.le(+e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, w: UC.W(Some{e}, E)) -> Laws.Le(e, E):
  match w:
    case Tuple{+e1, Tuple{eq, hl}}:
      %Equal.sym(List<&2, Maybe<&2, U32>>, e, e1, ME.inj(e, e1, eq)) : Laws.Le(_, E)
      hl

def UC.none(+E: List<&2, Maybe<&2, U32>>, w: UC.W(None{}, E)) -> Empty:
  match w:
    case Tuple{+e1, Tuple{eq, hl}}:
      ME.none_some(e1, eq)

def UGC(ts: List<&2, R.Tm>, xs: List<&2, U32>, m: Maybe<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: UC.W(m, E), +h: Laws.Matches(ts, xs, E)) -> UC.W(R.Un.go(ts, xs, m), E):
  match ts:
    case Nil{}:
      match xs:
        case Nil{}:
          w
        case Con{+x, +xr}:
          Empty.absurd(UC.W(R.Un.go(Nil{}, Con{x, xr}, m), E), h)
    case Con{+t, +tr}:
      match xs:
        case Nil{}:
          Empty.absurd(UC.W(R.Un.go(Con{t, tr}, Nil{}, m), E), h)
        case Con{+x, +xr}:
          match m:
            case None{}:
              Empty.absurd(UC.W(None{}, E), UC.none(E, w))
            case Some{+e}:
              UGC(tr, xr, R.Un.one(t, x, e), E, UC.one(t, x, e, E, UC.le(e, E, w), L.And.fst(Laws.Match1(t, x, E), Laws.Matches(tr, xr, E), h)), L.And.snd(Laws.Match1(t, x, E), Laws.Matches(tr, xr, E), h))

# ---- lists of environments -----------------------------------------------------------------------
def MA.sh(+a: List<&2, Maybe<&2, U32>>, +t: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, o: Either<&2, &2, Laws.MemE(t, e), Laws.MemE(ys, e)>) -> Either<&2, &2, Laws.MemE(Con{a, t}, e), Laws.MemE(ys, e)>:
  match o:
    case Inl{p}:
      Inl{Inr{p}}
    case Inr{p}:
      Inr{p}

def MA.split(xs: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, h: Laws.MemE(List.append(&2, List<&2, Maybe<&2, U32>>, xs, ys), e)) -> Either<&2, &2, Laws.MemE(xs, e), Laws.MemE(ys, e)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{q}:
          Inl{Inl{q}}
        case Inr{q}:
          MA.sh(a, t, ys, e, MA.split(t, ys, e, q))

def MA.l(xs: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, h: Laws.MemE(xs, e)) -> Laws.MemE(List.append(&2, List<&2, Maybe<&2, U32>>, xs, ys), e):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemE(ys, e), h)
    case Con{+a, +t}:
      match h:
        case Inl{q}:
          Inl{q}
        case Inr{q}:
          Inr{MA.l(t, ys, e, q)}

def MA.r(xs: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, h: Laws.MemE(ys, e)) -> Laws.MemE(List.append(&2, List<&2, Maybe<&2, U32>>, xs, ys), e):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{MA.r(t, ys, e, h)}

# ---- the join: sound -----------------------------------------------------------------------------
def JO.inr(+x: List<&2, U32>, +t: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, q: TL.And(Laws.Le(e, e2), Laws.HasMatch(t, ts, e2))) -> TL.And(Laws.Le(e, e2), Laws.HasMatch(Con{x, t}, ts, e2)):
  match q:
    case Tuple{a, b}:
      Tuple{a, Inr{b}}

def JO.inl(+x: List<&2, U32>, +t: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, q: TL.And(Laws.Le(e, e2), Laws.Matches(ts, x, e2))) -> TL.And(Laws.Le(e, e2), Laws.HasMatch(Con{x, t}, ts, e2)):
  match q:
    case Tuple{a, b}:
      Tuple{a, Inl{b}}

def JO.k(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, +x: List<&2, U32>, +t: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, hm: {R.Un.go(ts, x, Some{e}) == m : Maybe<&2, List<&2, Maybe<&2, U32>>>}, h: Laws.MemE(R.Join.push(m, R.Join.one(t, ts, e)), e2), ih: Laws.MemE(R.Join.one(t, ts, e), e2) -> TL.And(Laws.Le(e, e2), Laws.HasMatch(t, ts, e2))) -> TL.And(Laws.Le(e, e2), Laws.HasMatch(Con{x, t}, ts, e2)):
  match m:
    case None{}:
      JO.inr(x, t, ts, e, e2, ih(h))
    case Some{+e1}:
      match h:
        case Inl{eq}:
          %eq : TL.And(Laws.Le(e, _), Laws.HasMatch(Con{x, t}, ts, _))
          JO.inl(x, t, ts, e, e1, UG.sound(ts, x, Some{e}, e1, hm))
        case Inr{q}:
          JO.inr(x, t, ts, e, e2, ih(q))

def JO.sound(tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +e2: List<&2, Maybe<&2, U32>>, h: Laws.MemE(R.Join.one(tups, ts, e), e2)) -> TL.And(Laws.Le(e, e2), Laws.HasMatch(tups, ts, e2)):
  match tups:
    case Nil{}:
      Empty.absurd(TL.And(Laws.Le(e, e2), Laws.HasMatch(Nil{}, ts, e2)), h)
    case Con{+x, +t}:
      JO.k(R.Un.go(ts, x, Some{e}), x, t, ts, e, e2, {==}, h, q => JO.sound(t, ts, e, e2, q))

# Some start environment in es lies below e2, and e2 matches the atom.
def JE.W(es: List<&2, List<&2, Maybe<&2, U32>>>, tups: List<&2, List<&2, U32>>, ts: List<&2, R.Tm>, e2: List<&2, Maybe<&2, U32>>) -> Data:
  TL.Ex(List<&2, Maybe<&2, U32>>, e0 => TL.And(Laws.MemE(es, e0), TL.And(Laws.Le(e0, e2), Laws.HasMatch(tups, ts, e2))))

def JE.there(+e: List<&2, Maybe<&2, U32>>, +t: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e2: List<&2, Maybe<&2, U32>>, w: JE.W(t, tups, ts, e2)) -> JE.W(Con{e, t}, tups, ts, e2):
  match w:
    case Tuple{+e0, Tuple{hm, rest}}:
      Tuple{e0, Tuple{Inr{hm}, rest}}

def JE.k(+e: List<&2, Maybe<&2, U32>>, +t: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e2: List<&2, Maybe<&2, U32>>, o: Either<&2, &2, Laws.MemE(R.Join.one(tups, ts, e), e2), Laws.MemE(R.Join.ext(t, tups, ts), e2)>, ih: Laws.MemE(R.Join.ext(t, tups, ts), e2) -> JE.W(t, tups, ts, e2)) -> JE.W(Con{e, t}, tups, ts, e2):
  match o:
    case Inl{p}:
      Tuple{e, Tuple{Inl{{==}}, JO.sound(tups, ts, e, e2, p)}}
    case Inr{p}:
      JE.there(e, t, tups, ts, e2, ih(p))

def JE.sound(es: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e2: List<&2, Maybe<&2, U32>>, h: Laws.MemE(R.Join.ext(es, tups, ts), e2)) -> JE.W(es, tups, ts, e2):
  match es:
    case Nil{}:
      Empty.absurd(JE.W(Nil{}, tups, ts, e2), h)
    case Con{+e, +t}:
      JE.k(e, t, tups, ts, e2, MA.split(R.Join.one(tups, ts, e), R.Join.ext(t, tups, ts), e2, h), q => JE.sound(t, tups, ts, e2, q))

def JA.W(es: List<&2, List<&2, Maybe<&2, U32>>>, as: List<&2, R.At>, rels: List<&2, List<&2, List<&2, U32>>>, e: List<&2, Maybe<&2, U32>>) -> Data:
  TL.Ex(List<&2, Maybe<&2, U32>>, e0 => TL.And(Laws.MemE(es, e0), TL.And(Laws.Le(e0, e), Laws.Holds(as, rels, e))))

def JA.k2(+es: List<&2, List<&2, Maybe<&2, U32>>>, +r: Nat, +ts: List<&2, R.Tm>, +rest: List<&2, R.At>, +rels: List<&2, List<&2, List<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, +e1: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e1, e), hh: Laws.Holds(rest, rels, e), w: JE.W(es, R.Rels.get(rels, r), ts, e1)) -> JA.W(es, Con{R.At{r, ts}, rest}, rels, e):
  match w:
    case Tuple{+e0, Tuple{m0, Tuple{+l0, hmt}}}:
      Tuple{e0, Tuple{m0, Tuple{Le.trans(e0, e1, e, l0, hl), Tuple{HM.mono(R.Rels.get(rels, r), ts, e1, e, hl, hmt), hh}}}}

def JA.k(+es: List<&2, List<&2, Maybe<&2, U32>>>, +r: Nat, +ts: List<&2, R.Tm>, +rest: List<&2, R.At>, +rels: List<&2, List<&2, List<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, w: JA.W(R.Join.ext(es, R.Rels.get(rels, r), ts), rest, rels, e)) -> JA.W(es, Con{R.At{r, ts}, rest}, rels, e):
  match w:
    case Tuple{+e1, Tuple{hm, Tuple{hl, hh}}}:
      JA.k2(es, r, ts, rest, rels, e, e1, hl, hh, JE.sound(es, R.Rels.get(rels, r), ts, e1, hm))

def JA.sound(as: List<&2, R.At>, +rels: List<&2, List<&2, List<&2, U32>>>, +es: List<&2, List<&2, Maybe<&2, U32>>>, +e: List<&2, Maybe<&2, U32>>, h: Laws.MemE(R.Join.atoms(as, rels, es), e)) -> JA.W(es, as, rels, e):
  match as:
    case Nil{}:
      Tuple{e, Tuple{h, Tuple{Le.refl(e), Unit{}}}}
    case Con{R.At{+r, +ts}, +rest}:
      JA.k(es, r, ts, rest, rels, e, JA.sound(rest, rels, R.Join.ext(es, R.Rels.get(rels, r), ts), e, h))

def JA.fin(+as: List<&2, R.At>, +rels: List<&2, List<&2, List<&2, U32>>>, +e0: List<&2, Maybe<&2, U32>>, +e: List<&2, Maybe<&2, U32>>, w: JA.W([e0], as, rels, e)) -> TL.And(Laws.Le(e0, e), Laws.Holds(as, rels, e)):
  match w:
    case Tuple{+e1, Tuple{m, rest}}:
      match m:
        case Inl{eq}:
          %Equal.sym(List<&2, Maybe<&2, U32>>, e0, e1, eq) : TL.And(Laws.Le(_, e), Laws.Holds(as, rels, e))
          rest
        case Inr{z}:
          Empty.absurd(TL.And(Laws.Le(e0, e), Laws.Holds(as, rels, e)), z)

# R1.
def Laws.join_sound(as, rels, e0, e, h):
  JA.fin(as, rels, e0, e, JA.sound(as, rels, [e0], e, h))

# ---- the join: complete --------------------------------------------------------------------------
def JC.W(es: List<&2, List<&2, Maybe<&2, U32>>>, E: List<&2, Maybe<&2, U32>>) -> Data:
  TL.Ex(List<&2, Maybe<&2, U32>>, e1 => TL.And(Laws.MemE(es, e1), Laws.Le(e1, E)))

def JC.push(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, +rest: List<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: JC.W(rest, E)) -> JC.W(R.Join.push(m, rest), E):
  match m:
    case None{}:
      w
    case Some{+a}:
      match w:
        case Tuple{+e1, Tuple{hm, hl}}:
          Tuple{e1, Tuple{Inr{hm}, hl}}

def JC.got(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, +rest: List<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: UC.W(m, E)) -> JC.W(R.Join.push(m, rest), E):
  match m:
    case None{}:
      Empty.absurd(JC.W(rest, E), UC.none(E, w))
    case Some{+a}:
      match w:
        case Tuple{+e1, Tuple{eq, hl}}:
          Tuple{e1, Tuple{Inl{ME.inj(a, e1, eq)}, hl}}

def JOC(tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, +hl: Laws.Le(e, E), h: Laws.HasMatch(tups, ts, E)) -> JC.W(R.Join.one(tups, ts, e), E):
  match tups:
    case Nil{}:
      Empty.absurd(JC.W(Nil{}, E), h)
    case Con{+x, +t}:
      match h:
        case Inl{a}:
          JC.got(R.Un.go(ts, x, Some{e}), R.Join.one(t, ts, e), E, UGC(ts, x, Some{e}, E, Tuple{e, Tuple{{==}, hl}}, a))
        case Inr{b}:
          JC.push(R.Un.go(ts, x, Some{e}), R.Join.one(t, ts, e), E, JOC(t, ts, e, E, hl, b))

def JC.l(+xs: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: JC.W(xs, E)) -> JC.W(List.append(&2, List<&2, Maybe<&2, U32>>, xs, ys), E):
  match w:
    case Tuple{+e1, Tuple{hm, hl}}:
      Tuple{e1, Tuple{MA.l(xs, ys, e1, hm), hl}}

def JC.r(+xs: List<&2, List<&2, Maybe<&2, U32>>>, +ys: List<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: JC.W(ys, E)) -> JC.W(List.append(&2, List<&2, Maybe<&2, U32>>, xs, ys), E):
  match w:
    case Tuple{+e1, Tuple{hm, hl}}:
      Tuple{e1, Tuple{MA.r(xs, ys, e1, hm), hl}}

def JEC(es: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +e0: List<&2, Maybe<&2, U32>>, +E: List<&2, Maybe<&2, U32>>, hm: Laws.MemE(es, e0), +hl: Laws.Le(e0, E), +hh: Laws.HasMatch(tups, ts, E)) -> JC.W(R.Join.ext(es, tups, ts), E):
  match es:
    case Nil{}:
      Empty.absurd(JC.W(Nil{}, E), hm)
    case Con{+a, +t}:
      match hm:
        case Inl{eq}:
          %Equal.sym(List<&2, Maybe<&2, U32>>, a, e0, eq) : JC.W(List.append(&2, List<&2, Maybe<&2, U32>>, R.Join.one(tups, ts, _), R.Join.ext(t, tups, ts)), E)
          JC.l(R.Join.one(tups, ts, e0), R.Join.ext(t, tups, ts), E, JOC(tups, ts, e0, E, hl, hh))
        case Inr{q}:
          JC.r(R.Join.one(tups, ts, a), R.Join.ext(t, tups, ts), E, JEC(t, tups, ts, e0, E, q, hl, hh))

def JAC.k(+es: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, R.Tm>, +E: List<&2, Maybe<&2, U32>>, w: JC.W(es, E), +hh: Laws.HasMatch(tups, ts, E)) -> JC.W(R.Join.ext(es, tups, ts), E):
  match w:
    case Tuple{+e0, Tuple{hm, hl}}:
      JEC(es, tups, ts, e0, E, hm, hl, hh)

def JAC(as: List<&2, R.At>, +rels: List<&2, List<&2, List<&2, U32>>>, +es: List<&2, List<&2, Maybe<&2, U32>>>, +E: List<&2, Maybe<&2, U32>>, w: JC.W(es, E), h: Laws.Holds(as, rels, E)) -> JC.W(R.Join.atoms(as, rels, es), E):
  match as:
    case Nil{}:
      w
    case Con{R.At{+r, +ts}, +rest}:
      match h:
        case Tuple{h1, h2}:
          JAC(rest, rels, R.Join.ext(es, R.Rels.get(rels, r), ts), E, JAC.k(es, R.Rels.get(rels, r), ts, E, w, h1), h2)

# R2.
def Laws.join_complete(as, rels, e0, E, hl, hh):
  JAC(as, rels, [e0], E, Tuple{e0, Tuple{Inl{{==}}, hl}}, hh)
