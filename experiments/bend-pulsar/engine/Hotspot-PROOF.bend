# engine/Hotspot-PROOF.bend - proofs of Hotspot-LAWS.bend. Gate: bend Hotspot-PROOF.bend --verdict
import Base
import ./Metrics.bend as M
import ./Hotspot.bend as H
import ./Metrics-LAWS.bend as ML
import ./Metrics-PROOF.bend as MP
import ./Hotspot-LAWS.bend as Laws

def Laws.hs_lines_shape(thr, chs, m, c):
  {==}

def Laws.hotspot_bases():
  Tuple{{==}, Tuple{{==}, Tuple{{==}, Tuple{{==}, {==}}}}}

def Laws.risky_bases():
  Tuple{{==}, Tuple{{==}, Tuple{{==}, Tuple{{==}, {==}}}}}

def Split.and(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> ML.And({a == True{} : Bool}, {b == True{} : Bool}):
  match a:
    case True{}:
      Tuple{{==}, e}
    case False{}:
      Empty.absurd(ML.And({False{} == True{} : Bool}, {b == True{} : Bool}), MP.Bool.ff_tt(e))

def Split.or(a: Bool, b: Bool, e: {Bool.or(a, b) == True{} : Bool}) -> Either<&2, &2, {a == True{} : Bool}, {b == True{} : Bool}>:
  match a:
    case True{}:
      Inl{{==}}
    case False{}:
      Inr{e}

def Or.r(a: Bool, b: Bool, e: {b == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      e

def And.both(a: Bool, b: Bool, ea: {a == True{} : Bool}, eb: {b == True{} : Bool}) -> {Bool.and(a, b) == True{} : Bool}:
  %Equal.sym(Bool, a, True{}, ea) : {Bool.and(_, b) == True{} : Bool}
  eb

def Wit.here(+k: U32, +fn: U32, +f: U32, +rule: U32, +v: Nat, +t: Nat, +rest: List<&2, M.Finding>, o: Either<&2, &2, {Bool.and(U32.is_eq(f, fn), H.Hs.base_ok(k, rule)) == True{} : Bool}, {H.Hs.any(k, fn, rest) == True{} : Bool}>, ih: {H.Hs.any(k, fn, rest) == True{} : Bool} -> Laws.Witness(k, fn, rest)) -> Laws.Witness(k, fn, Con{M.Finding{rule, f, v, t}, rest}):
  match o:
    case Inl{e}:
      Inl{Split.and(U32.is_eq(f, fn), H.Hs.base_ok(k, rule), e)}
    case Inr{e}:
      Inr{ih(e)}

# Hs.any says yes only with a witness.
def Wit.of_any(+k: U32, +fn: U32, base: List<&2, M.Finding>, e: {H.Hs.any(k, fn, base) == True{} : Bool}) -> Laws.Witness(k, fn, base):
  match base:
    case Nil{}:
      Empty.absurd(Laws.Witness(k, fn, Nil{}), MP.Bool.ff_tt(e))
    case Con{M.Finding{+rule, +f, +v, +t}, +rest}:
      Wit.here(k, fn, f, rule, v, t, rest, Split.or(Bool.and(U32.is_eq(f, fn), H.Hs.base_ok(k, rule)), H.Hs.any(k, fn, rest), e), ee => Wit.of_any(k, fn, rest, ee))

def Wit.any_here(a: Bool, b: Bool, c: Bool, p: ML.And({a == True{} : Bool}, {b == True{} : Bool})) -> {Bool.or(Bool.and(a, b), c) == True{} : Bool}:
  match p:
    case Tuple{ea, eb}:
      %Equal.sym(Bool, Bool.and(a, b), True{}, And.both(a, b, ea, eb)) : {Bool.or(_, c) == True{} : Bool}
      {==}

# ...and a witness makes Hs.any say yes.
def Wit.any(+k: U32, +fn: U32, base: List<&2, M.Finding>, w: Laws.Witness(k, fn, base)) -> {H.Hs.any(k, fn, base) == True{} : Bool}:
  match base:
    case Nil{}:
      match w:
    case Con{M.Finding{+rule, +f, v, t}, +rest}:
      match w:
        case Inl{p}:
          Wit.any_here(U32.is_eq(f, fn), H.Hs.base_ok(k, rule), H.Hs.any(k, fn, rest), p)
        case Inr{q}:
          Or.r(Bool.and(U32.is_eq(f, fn), H.Hs.base_ok(k, rule)), H.Hs.any(k, fn, rest), Wit.any(k, fn, rest, q))


# ---- S1. sound --------------------------------------------------------------------------------
def Hs.weak(+k: U32, +thr: Nat, c: H.Ch, +t: List<&2, H.Ch>, +base: List<&2, M.Finding>, x: M.Finding, s: Laws.Sound(k, thr, t, base, x)) -> Laws.Sound(k, thr, Con{c, t}, base, x):
  match x:
    case M.Finding{rule, fn, v, tt}:
      match s:
        case Tuple{a, Tuple{b, Tuple{d, Tuple{mc, w}}}}:
          Tuple{a, Tuple{b, Tuple{d, Tuple{Inr{mc}, w}}}}

def Hs.hit2(+k: U32, +thr: Nat, +fn: U32, +n: Nat, +t: List<&2, H.Ch>, +base: List<&2, M.Finding>, s: ML.And({Nat.is_gt(n, thr) == True{} : Bool}, {H.Hs.any(k, fn, base) == True{} : Bool})) -> Laws.Sound(k, thr, Con{H.Ch{fn, n}, t}, base, M.Finding{k, fn, n, thr}):
  match s:
    case Tuple{g1, g2}:
      Tuple{{==}, Tuple{g1, Tuple{{==}, Tuple{Inl{{==}}, Wit.of_any(k, fn, base, g2)}}}}

def Hs.hit(+k: U32, +thr: Nat, +fn: U32, +n: Nat, +t: List<&2, H.Ch>, +base: List<&2, M.Finding>, +x: M.Finding, p: ML.And({Bool.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base)) == True{} : Bool}, {M.Finding{k, fn, n, thr} == x : M.Finding})) -> Laws.Sound(k, thr, Con{H.Ch{fn, n}, t}, base, x):
  match p:
    case Tuple{g, e}:
      %e : Laws.Sound(k, thr, Con{H.Ch{fn, n}, t}, base, _)
      Hs.hit2(k, thr, fn, n, t, base, Split.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base), g))

def Hs.snd(+k: U32, +thr: Nat, +fn: U32, +n: Nat, +t: List<&2, H.Ch>, +base: List<&2, M.Finding>, +x: M.Finding, o: Either<&2, &2, ML.And({Bool.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base)) == True{} : Bool}, {M.Finding{k, fn, n, thr} == x : M.Finding}), ML.MemF(H.Hs.find(k, thr, t, base), x)>, ih: ML.MemF(H.Hs.find(k, thr, t, base), x) -> Laws.Sound(k, thr, t, base, x)) -> Laws.Sound(k, thr, Con{H.Ch{fn, n}, t}, base, x):
  match o:
    case Inl{p}:
      Hs.hit(k, thr, fn, n, t, base, x, p)
    case Inr{m}:
      Hs.weak(k, thr, H.Ch{fn, n}, t, base, x, ih(m))

def Laws.hs_sound(k, thr, chs, base, x, hm):
  match chs:
    case Nil{}:
      match hm:
    case Con{c, t}:
      match c:
        case H.Ch{+fn, +n}:
          Hs.snd(k, thr, fn, n, t, base, x, MP.Keep.mem(Bool.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base)), M.Finding{k, fn, n, thr}, H.Hs.find(k, thr, t, base), x, hm), mm => Laws.hs_sound(k, thr, t, base, x, mm))

# ---- S2. complete -----------------------------------------------------------------------------
def Hs.stay(+k: U32, +thr: Nat, c: H.Ch, +t: List<&2, H.Ch>, +base: List<&2, M.Finding>, +y: M.Finding, mm: ML.MemF(H.Hs.find(k, thr, t, base), y)) -> ML.MemF(H.Hs.find(k, thr, Con{c, t}, base), y):
  match c:
    case H.Ch{+fn, +n}:
      MP.Keep.stay(Bool.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base)), M.Finding{k, fn, n, thr}, H.Hs.find(k, thr, t, base), y, mm)

def Laws.hs_complete(k, thr, chs, base, fn, n, hm, h, w):
  match chs:
    case Nil{}:
      match hm:
    case Con{c, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(H.Ch, c, H.Ch{fn, n}, e) : ML.MemF(H.Hs.find(k, thr, Con{_, t}, base), M.Finding{k, fn, n, thr})
          MP.Keep.hit(Bool.and(Nat.is_gt(n, thr), H.Hs.any(k, fn, base)), M.Finding{k, fn, n, thr}, H.Hs.find(k, thr, t, base), And.both(Nat.is_gt(n, thr), H.Hs.any(k, fn, base), h, Wit.any(k, fn, base, w)))
        case Inr{mm}:
          Hs.stay(k, thr, c, t, base, M.Finding{k, fn, n, thr}, Laws.hs_complete(k, thr, t, base, fn, n, mm, h, w))
