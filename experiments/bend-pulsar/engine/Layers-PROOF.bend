import Base
import ../PROOF.bend as Top
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ../Lemmas3.bend as L3
import ../Nat2.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./Layers.bend as Y
import ./Layers-LAWS.bend as Laws

# ---- Bool helpers ----------------------------------------------------------------------------
def B.or_l(a: Bool, b: Bool, ha: {a == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({b == True{} : Bool}, L.Bool.ff_tt(ha))

def B.and_tt(a: Bool, b: Bool, ha: {a == True{} : Bool}, hb: {b == True{} : Bool}) -> {Bool.and(a, b) == True{} : Bool}:
  match a:
    case True{}:
      hb
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, L.Bool.ff_tt(ha))

def B.not_t(a: Bool, e: {Bool.not(a) == True{} : Bool}) -> {a == False{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.ff_tt(e))

# Bool.or(Bool.not(a), b) is true and a is true: b is true.
def B.imp(a: Bool, b: Bool, e: {Bool.or(Bool.not(a), b) == True{} : Bool}, ha: {a == True{} : Bool}) -> {b == True{} : Bool}:
  match a:
    case True{}:
      e
    case False{}:
      Empty.absurd({b == True{} : Bool}, L.Bool.ff_tt(ha))

def B.clash(a: Bool, e1: {a == False{} : Bool}, e2: {a == True{} : Bool}) -> Empty:
  L.Bool.ff_tt(Equal.trans(Bool, False{}, a, True{}, Equal.sym(Bool, a, False{}, e1), e2))

def U.eq_of(+a: U32, +b: U32, e: {a == b : U32}) -> {U32.is_eq(a, b) == True{} : Bool}:
  %e : {U32.is_eq(a, _) == True{} : Bool}
  L2.U32.eq_refl(a)

def Fst(-A: Data, -B: Data, p: TL.And(A, B)) -> A:
  L.And.fst(A, B, p)

def Snd(-A: Data, -B: Data, p: TL.And(A, B)) -> B:
  L.And.snd(A, B, p)

# ---- E. the entry point ------------------------------------------------------------------------
def Laws.run_is_detectors(lf, ok):
  %Equal.sym(Bool, Y.Layers.valid(lf), True{}, ok) : {Y.Layers.run2(_, lf) == Some{Y.LOut{Y.LF.nl(lf), Y.LF.ns(lf), G.Graph.edges(Y.Layers.req_graph(lf), 0), G.Graph.analyze(Y.Layers.req_graph(lf)), Y.Layers.unprovided(lf), Y.Layers.opaque(lf), Y.Layers.dups(lf), Y.Layers.hubs(lf)}} : Maybe<Y.LOut>}
  {==}

def Laws.run_refuses_invalid(lf, bad):
  %Equal.sym(Bool, Y.Layers.valid(lf), False{}, bad) : {Y.Layers.run2(_, lf) == None{} : Maybe<Y.LOut>}
  {==}

def Laws.lines_shape(nl, ns, edges, cs, ok, us, os, ds, hs):
  {==}

def B.not_f(a: Bool, e: {a == False{} : Bool}) -> {Bool.not(a) == True{} : Bool}:
  %Equal.sym(Bool, a, False{}, e) : {Bool.not(_) == True{} : Bool}
  {==}

def AL(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  L.And.fst({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def AR(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  L.And.snd({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

# ---- reflection: the relation tests mean fact membership --------------------------------------
def EqP.of(+a: U32, +b: U32, +c: U32, +d: U32, p: TL.And({U32.is_eq(a, b) == True{} : Bool}, {U32.is_eq(c, d) == True{} : Bool})) -> TL.And({a == b : U32}, {c == d : U32}):
  match p:
    case Tuple{x, y}:
      Tuple{L.U32.eq_sound(a, b, x), L.U32.eq_sound(c, d, y)}

def EqP.to(+a: U32, +b: U32, +c: U32, +d: U32, p: TL.And({a == b : U32}, {c == d : U32})) -> {Bool.and(U32.is_eq(a, b), U32.is_eq(c, d)) == True{} : Bool}:
  match p:
    case Tuple{x, y}:
      B.and_tt(U32.is_eq(a, b), U32.is_eq(c, d), U.eq_of(a, b, x), U.eq_of(c, d, y))

def LyS.k(+l2: U32, f: U32, +s2: U32, t: List<&2, Y.Ly>, +l: U32, +s: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)) == True{} : Bool}, {Y.Ly.has(t, l, s) == True{} : Bool}>, ih: {Y.Ly.has(t, l, s) == True{} : Bool} -> Laws.LyHas(t, l, s)) -> Laws.LyHas(Con{Y.Ly{l2, f, s2}, t}, l, s):
  match o:
    case Inl{a}:
      Inl{EqP.of(l2, l, s2, s, L.Bool.and_true(U32.is_eq(l2, l), U32.is_eq(s2, s), a))}
    case Inr{b}:
      Inr{ih(b)}

def LyS(lys: List<&2, Y.Ly>, +l: U32, +s: U32, e: {Y.Ly.has(lys, l, s) == True{} : Bool}) -> Laws.LyHas(lys, l, s):
  match lys:
    case Nil{}:
      Empty.absurd(Empty, L.Bool.ff_tt(e))
    case Con{Y.Ly{+l2, +f, +s2}, +t}:
      LyS.k(l2, f, s2, t, l, s, L.Bool.or_true(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Y.Ly.has(t, l, s), e), y => LyS(t, l, s, y))

def LyC(lys: List<&2, Y.Ly>, +l: U32, +s: U32, h: Laws.LyHas(lys, l, s)) -> {Y.Ly.has(lys, l, s) == True{} : Bool}:
  match lys:
    case Nil{}:
      Empty.absurd({False{} == True{} : Bool}, h)
    case Con{Y.Ly{+l2, f, +s2}, +t}:
      match h:
        case Inl{p}:
          B.or_l(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Y.Ly.has(t, l, s), EqP.to(l2, l, s2, s, p))
        case Inr{q}:
          L2.Bool.or_r(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Y.Ly.has(t, l, s), LyC(t, l, s, q))

def LqS.k(+l2: U32, +s2: U32, t: List<&2, Y.Lq>, +l: U32, +s: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)) == True{} : Bool}, {Y.Lq.has(t, l, s) == True{} : Bool}>, ih: {Y.Lq.has(t, l, s) == True{} : Bool} -> Laws.LqHas(t, l, s)) -> Laws.LqHas(Con{Y.Lq{l2, s2}, t}, l, s):
  match o:
    case Inl{a}:
      Inl{EqP.of(l2, l, s2, s, L.Bool.and_true(U32.is_eq(l2, l), U32.is_eq(s2, s), a))}
    case Inr{b}:
      Inr{ih(b)}

def LqS(lqs: List<&2, Y.Lq>, +l: U32, +s: U32, e: {Y.Lq.has(lqs, l, s) == True{} : Bool}) -> Laws.LqHas(lqs, l, s):
  match lqs:
    case Nil{}:
      Empty.absurd(Empty, L.Bool.ff_tt(e))
    case Con{Y.Lq{+l2, +s2}, +t}:
      LqS.k(l2, s2, t, l, s, L.Bool.or_true(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Y.Lq.has(t, l, s), e), y => LqS(t, l, s, y))

def LpS.k(+o2: U32, +i2: U32, m: U32, t: List<&2, Y.Lp>, +o: U32, +i: U32, oo: Either<&2, &2, {Bool.and(U32.is_eq(o2, o), U32.is_eq(i2, i)) == True{} : Bool}, {Y.Lp.has(t, o, i) == True{} : Bool}>, ih: {Y.Lp.has(t, o, i) == True{} : Bool} -> Laws.LpHas(t, o, i)) -> Laws.LpHas(Con{Y.Lp{o2, i2, m}, t}, o, i):
  match oo:
    case Inl{a}:
      Inl{EqP.of(o2, o, i2, i, L.Bool.and_true(U32.is_eq(o2, o), U32.is_eq(i2, i), a))}
    case Inr{b}:
      Inr{ih(b)}

def LpS(lps: List<&2, Y.Lp>, +o: U32, +i: U32, e: {Y.Lp.has(lps, o, i) == True{} : Bool}) -> Laws.LpHas(lps, o, i):
  match lps:
    case Nil{}:
      Empty.absurd(Empty, L.Bool.ff_tt(e))
    case Con{Y.Lp{+o2, +i2, +m}, +t}:
      LpS.k(o2, i2, m, t, o, i, L.Bool.or_true(Bool.and(U32.is_eq(o2, o), U32.is_eq(i2, i)), Y.Lp.has(t, o, i), e), y => LpS(t, o, i, y))

def LrS.k(+r2: U32, +l2: U32, t: List<&2, Y.Lr>, +r: U32, +l: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(r2, r), U32.is_eq(l2, l)) == True{} : Bool}, {Y.Lr.has(t, r, l) == True{} : Bool}>, ih: {Y.Lr.has(t, r, l) == True{} : Bool} -> Laws.LrHas(t, r, l)) -> Laws.LrHas(Con{Y.Lr{r2, l2}, t}, r, l):
  match o:
    case Inl{a}:
      Inl{EqP.of(r2, r, l2, l, L.Bool.and_true(U32.is_eq(r2, r), U32.is_eq(l2, l), a))}
    case Inr{b}:
      Inr{ih(b)}

def LrS(lrs: List<&2, Y.Lr>, +r: U32, +l: U32, e: {Y.Lr.has(lrs, r, l) == True{} : Bool}) -> Laws.LrHas(lrs, r, l):
  match lrs:
    case Nil{}:
      Empty.absurd(Empty, L.Bool.ff_tt(e))
    case Con{Y.Lr{+r2, +l2}, +t}:
      LrS.k(r2, l2, t, r, l, L.Bool.or_true(Bool.and(U32.is_eq(r2, r), U32.is_eq(l2, l)), Y.Lr.has(t, r, l), e), y => LrS(t, r, l, y))

def SvP.to(+s2: U32, +s: U32, +k: U32, p: TL.And({s2 == s : U32}, {U32.is_eq(k, 0) == False{} : Bool})) -> {Bool.and(U32.is_eq(s2, s), Bool.not(U32.is_eq(k, 0))) == True{} : Bool}:
  match p:
    case Tuple{x, y}:
      B.and_tt(U32.is_eq(s2, s), Bool.not(U32.is_eq(k, 0)), U.eq_of(s2, s, x), B.not_f(U32.is_eq(k, 0), y))

def SvC(svs: List<&2, Y.Sv>, +s: U32, h: Laws.SvDflt(svs, s)) -> {Y.Sv.dflt(svs, s) == True{} : Bool}:
  match svs:
    case Nil{}:
      Empty.absurd({False{} == True{} : Bool}, h)
    case Con{Y.Sv{+s2, f, +k}, +t}:
      match h:
        case Inl{p}:
          B.or_l(Bool.and(U32.is_eq(s2, s), Bool.not(U32.is_eq(k, 0))), Y.Sv.dflt(t, s), SvP.to(s2, s, k, p))
        case Inr{q}:
          L2.Bool.or_r(Bool.and(U32.is_eq(s2, s), Bool.not(U32.is_eq(k, 0))), Y.Sv.dflt(t, s), SvC(t, s, q))

# A checked LP walk is a walk.
def LpP.fin(+lps: List<&2, Y.Lp>, +u: U32, +w: U32, +v: U32, s: Laws.LpHas(lps, u, w), r: TL.Ex(Nat, k => Laws.LpWalk(lps, k, w, v))) -> TL.Ex(Nat, k => Laws.LpWalk(lps, k, u, v)):
  match r:
    case Tuple{+k, wk}:
      Tuple{1n+k, Tuple{w, Tuple{s, wk}}}

def LpP(ws: List<&2, U32>, +lps: List<&2, Y.Lp>, +u: U32, +v: U32, +e: {Y.Lp.path0(ws, lps, u, v) == True{} : Bool}) -> TL.Ex(Nat, k => Laws.LpWalk(lps, k, u, v)):
  match ws:
    case Nil{}:
      Tuple{0n, L.U32.eq_sound(u, v, e)}
    case Con{+w, +t}:
      LpP.fin(lps, u, w, v, LpS(lps, u, w, AL(Y.Lp.has(lps, u, w), Y.Lp.path0(t, lps, w, v), e)), LpP(t, lps, w, v, AR(Y.Lp.has(lps, u, w), Y.Lp.path0(t, lps, w, v), e)))

# ---- the reach-set certificate ----------------------------------------------------------------
def StS.hd(+r2: U32, +l2: U32, +r: U32, +t: G.Tr, +y: U32, e: {Bool.or(Bool.not(U32.is_eq(r2, r)), S.Scope.has(t, l2)) == True{} : Bool}, p: TL.And({r2 == r : U32}, {l2 == y : U32})) -> {S.Scope.has(t, y) == True{} : Bool}:
  match p:
    case Tuple{a, b}:
      %b : {S.Scope.has(t, _) == True{} : Bool}
      B.imp(U32.is_eq(r2, r), S.Scope.has(t, l2), e, U.eq_of(r2, r, a))

# starts_in accepted: every layer provided at r is in t.
def StS(lrs: List<&2, Y.Lr>, +r: U32, +t: G.Tr, e: {Y.Un.starts_in(lrs, r, t) == True{} : Bool}, +y: U32, hy: Laws.LrHas(lrs, r, y)) -> {S.Scope.has(t, y) == True{} : Bool}:
  match lrs:
    case Nil{}:
      Empty.absurd({S.Scope.has(t, y) == True{} : Bool}, hy)
    case Con{Y.Lr{+r2, +l2}, +rest}:
      match hy:
        case Inl{p}:
          StS.hd(r2, l2, r, t, y, AL(Bool.or(Bool.not(U32.is_eq(r2, r)), S.Scope.has(t, l2)), Y.Un.starts_in(rest, r, t), e), p)
        case Inr{q}:
          StS(rest, r, t, AR(Bool.or(Bool.not(U32.is_eq(r2, r)), S.Scope.has(t, l2)), Y.Un.starts_in(rest, r, t), e), y, q)

def Rw.has(+t: G.Tr, +a: U32, +b: U32, e: {a == b : U32}, h: {S.Scope.has(t, b) == True{} : Bool}) -> {S.Scope.has(t, a) == True{} : Bool}:
  %Equal.sym(U32, a, b, e) : {S.Scope.has(t, _) == True{} : Bool}
  h

def ClS.hd(+o2: U32, +i2: U32, +t: G.Tr, +o: U32, +i: U32, e: {Bool.or(Bool.not(S.Scope.has(t, o2)), S.Scope.has(t, i2)) == True{} : Bool}, p: TL.And({o2 == o : U32}, {i2 == i : U32}), ho: {S.Scope.has(t, o) == True{} : Bool}) -> {S.Scope.has(t, i) == True{} : Bool}:
  match p:
    case Tuple{a, b}:
      %b : {S.Scope.has(t, _) == True{} : Bool}
      B.imp(S.Scope.has(t, o2), S.Scope.has(t, i2), e, Rw.has(t, o2, o, a, ho))

# closed accepted: a constituent of a member is a member.
def ClS(lps: List<&2, Y.Lp>, +t: G.Tr, e: {Y.Un.closed(lps, t) == True{} : Bool}, +o: U32, +i: U32, hp: Laws.LpHas(lps, o, i), ho: {S.Scope.has(t, o) == True{} : Bool}) -> {S.Scope.has(t, i) == True{} : Bool}:
  match lps:
    case Nil{}:
      Empty.absurd({S.Scope.has(t, i) == True{} : Bool}, hp)
    case Con{Y.Lp{+o2, +i2, m}, +rest}:
      match hp:
        case Inl{p}:
          ClS.hd(o2, i2, t, o, i, AL(Bool.or(Bool.not(S.Scope.has(t, o2)), S.Scope.has(t, i2)), Y.Un.closed(rest, t), e), p, ho)
        case Inr{q}:
          ClS(rest, t, AR(Bool.or(Bool.not(S.Scope.has(t, o2)), S.Scope.has(t, i2)), Y.Un.closed(rest, t), e), o, i, q, ho)

# ... so a closed set holds everything a member reaches.
def WkS(k: Nat, +lps: List<&2, Y.Lp>, +t: G.Tr, +e: {Y.Un.closed(lps, t) == True{} : Bool}, +y: U32, +m: U32, hs: {S.Scope.has(t, y) == True{} : Bool}, hw: Laws.LpWalk(lps, k, y, m)) -> {S.Scope.has(t, m) == True{} : Bool}:
  match k:
    case 0n:
      %hw : {S.Scope.has(t, _) == True{} : Bool}
      hs
    case 1n+p:
      match hw:
        case Tuple{+w, rest}:
          match rest:
            case Tuple{hp, wk}:
              WkS(p, lps, t, e, w, m, ClS(lps, t, e, y, w, hp, hs), wk)

def NbS(sl: List<&2, U32>, +lys: List<&2, Y.Ly>, +s: U32, e: {Y.Un.none_build(sl, lys, s) == True{} : Bool}, +m: U32, hm: TL.Mem(sl, m)) -> {Y.Ly.has(lys, m, s) == False{} : Bool}:
  match sl:
    case Nil{}:
      Empty.absurd({Y.Ly.has(lys, m, s) == False{} : Bool}, hm)
    case Con{+h, +t}:
      match hm:
        case Inl{q}:
          %q : {Y.Ly.has(lys, _, s) == False{} : Bool}
          B.not_t(Y.Ly.has(lys, h, s), AL(Bool.not(Y.Ly.has(lys, h, s)), Y.Un.none_build(t, lys, s), e))
        case Inr{q}:
          NbS(t, lys, s, AR(Bool.not(Y.Ly.has(lys, h, s)), Y.Un.none_build(t, lys, s), e), m, q)

def NoS(sl: List<&2, U32>, +los: List<&2, U32>, e: {Y.Un.none_opaque(sl, los) == True{} : Bool}, +m: U32, hm: TL.Mem(sl, m)) -> {Y.Lo.has(los, m) == False{} : Bool}:
  match sl:
    case Nil{}:
      Empty.absurd({Y.Lo.has(los, m) == False{} : Bool}, hm)
    case Con{+h, +t}:
      match hm:
        case Inl{q}:
          %q : {Y.Lo.has(los, _) == False{} : Bool}
          B.not_t(Y.Lo.has(los, h), AL(Bool.not(Y.Lo.has(los, h)), Y.Un.none_opaque(t, los), e))
        case Inr{q}:
          NoS(t, los, AR(Bool.not(Y.Lo.has(los, h)), Y.Un.none_opaque(t, los), e), m, q)

# ---- keep lemmas: a kept candidate passed its checker -------------------------------------------
def KU.k(b: Bool, +lf: Y.LF, +c: Y.Uc, t: List<&2, Y.Uc>, +x: Y.Uc, hb: {Y.Un.check(lf, c) == b : Bool}, h: Laws.In(Y.Uc, Y.Un.push(b, c, Y.Un.keep(t, lf)), x), ih: Laws.In(Y.Uc, Y.Un.keep(t, lf), x) -> {Y.Un.check(lf, x) == True{} : Bool}) -> {Y.Un.check(lf, x) == True{} : Bool}:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          %e : {Y.Un.check(lf, _) == True{} : Bool}
          hb
        case Inr{q}:
          ih(q)
    case False{}:
      ih(h)

def KU(cs: List<&2, Y.Uc>, +lf: Y.LF, +x: Y.Uc, h: Laws.In(Y.Uc, Y.Un.keep(cs, lf), x)) -> {Y.Un.check(lf, x) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({Y.Un.check(lf, x) == True{} : Bool}, h)
    case Con{+c, +t}:
      KU.k(Y.Un.check(lf, c), lf, c, t, x, {==}, h, y => KU(t, lf, x, y))

def KD.k(b: Bool, +lf: Y.LF, +c: Y.Dc, t: List<&2, Y.Dc>, +x: Y.Dc, hb: {Y.Du.check(lf, c) == b : Bool}, h: Laws.In(Y.Dc, Y.Du.push(b, c, Y.Du.keep(t, lf)), x), ih: Laws.In(Y.Dc, Y.Du.keep(t, lf), x) -> {Y.Du.check(lf, x) == True{} : Bool}) -> {Y.Du.check(lf, x) == True{} : Bool}:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          %e : {Y.Du.check(lf, _) == True{} : Bool}
          hb
        case Inr{q}:
          ih(q)
    case False{}:
      ih(h)

def KD(cs: List<&2, Y.Dc>, +lf: Y.LF, +x: Y.Dc, h: Laws.In(Y.Dc, Y.Du.keep(cs, lf), x)) -> {Y.Du.check(lf, x) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({Y.Du.check(lf, x) == True{} : Bool}, h)
    case Con{+c, +t}:
      KD.k(Y.Du.check(lf, c), lf, c, t, x, {==}, h, y => KD(t, lf, x, y))

def KH.k(b: Bool, +ta: G.Tr, +tb: G.Tr, +c: Y.Hub, t: List<&2, Y.Hub>, +x: Y.Hub, hb: {Y.Hb.check(ta, tb, c) == b : Bool}, h: Laws.In(Y.Hub, Y.Hb.push(b, c, Y.Hb.keep(t, ta, tb)), x), ih: Laws.In(Y.Hub, Y.Hb.keep(t, ta, tb), x) -> {Y.Hb.check(ta, tb, x) == True{} : Bool}) -> {Y.Hb.check(ta, tb, x) == True{} : Bool}:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          %e : {Y.Hb.check(ta, tb, _) == True{} : Bool}
          hb
        case Inr{q}:
          ih(q)
    case False{}:
      ih(h)

def KH(cs: List<&2, Y.Hub>, +ta: G.Tr, +tb: G.Tr, +x: Y.Hub, h: Laws.In(Y.Hub, Y.Hb.keep(cs, ta, tb), x)) -> {Y.Hb.check(ta, tb, x) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({Y.Hb.check(ta, tb, x) == True{} : Bool}, h)
    case Con{+c, +t}:
      KH.k(Y.Hb.check(ta, tb, c), ta, tb, c, t, x, {==}, h, y => KH(t, ta, tb, x, y))

# ---- (2) unprovided: the checker's parts ----------------------------------------------------------
def UB.q(+lf: Y.LF, +l: U32, +s: U32) -> Bool:
  Y.Lq.has(Y.LF.lqs(lf), l, s)

def UB.rp(+lf: Y.LF, +r: U32, +l: U32, +x: U32, ws: List<&2, U32>) -> Bool:
  Bool.and(Y.Lr.has(Y.LF.lrs(lf), r, x), Y.Lp.path0(ws, Y.LF.lps(lf), x, l))

def UB.st(+lf: Y.LF, +r: U32, +sl: List<&2, U32>) -> Bool:
  Y.Un.starts_in(Y.LF.lrs(lf), r, S.Scope.set(sl))

def UB.cl(+lf: Y.LF, +sl: List<&2, U32>) -> Bool:
  Y.Un.closed(Y.LF.lps(lf), S.Scope.set(sl))

def UB.nb(+lf: Y.LF, +s: U32, +sl: List<&2, U32>) -> Bool:
  Y.Un.none_build(sl, Y.LF.lys(lf), s)

def UB.no(+lf: Y.LF, +sl: List<&2, U32>) -> Bool:
  Y.Un.none_opaque(sl, Y.LF.los(lf))

def UB.nd(+lf: Y.LF, +s: U32) -> Bool:
  Bool.not(Y.Sv.dflt(Y.LF.svs(lf), s))

def UB.left(+lf: Y.LF, +r: U32, +l: U32, +s: U32, +x: U32, +ws: List<&2, U32>) -> Bool:
  Bool.and(UB.q(lf, l, s), UB.rp(lf, r, l, x, ws))

def UB.right(+lf: Y.LF, +r: U32, +s: U32, +sl: List<&2, U32>) -> Bool:
  Bool.and(Bool.and(UB.st(lf, r, sl), UB.cl(lf, sl)), Bool.and(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s)))

# The checker accepted the reported candidate.
def UP(+lf: Y.LF, +r: U32, +l: U32, +s: U32, +x: U32, +ws: List<&2, U32>, +sl: List<&2, U32>, h: Laws.In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})) -> {Bool.and(UB.left(lf, r, l, s, x, ws), UB.right(lf, r, s, sl)) == True{} : Bool}:
  KU(Y.UR.cs(Y.Layers.unprovided_search(lf)), lf, Y.Uc{r, l, s, x, ws, sl}, h)

def UP.left(+lf: Y.LF, +r: U32, +l: U32, +s: U32, +x: U32, +ws: List<&2, U32>, +sl: List<&2, U32>, h: Laws.In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})) -> {UB.left(lf, r, l, s, x, ws) == True{} : Bool}:
  AL(UB.left(lf, r, l, s, x, ws), UB.right(lf, r, s, sl), UP(lf, r, l, s, x, ws, sl, h))

def UP.right(+lf: Y.LF, +r: U32, +l: U32, +s: U32, +x: U32, +ws: List<&2, U32>, +sl: List<&2, U32>, h: Laws.In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})) -> {UB.right(lf, r, s, sl) == True{} : Bool}:
  AR(UB.left(lf, r, l, s, x, ws), UB.right(lf, r, s, sl), UP(lf, r, l, s, x, ws, sl, h))

def UP.set(+lf: Y.LF, +r: U32, +s: U32, +sl: List<&2, U32>, e: {UB.right(lf, r, s, sl) == True{} : Bool}) -> {Bool.and(UB.st(lf, r, sl), UB.cl(lf, sl)) == True{} : Bool}:
  AL(Bool.and(UB.st(lf, r, sl), UB.cl(lf, sl)), Bool.and(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s)), e)

def UP.none(+lf: Y.LF, +r: U32, +s: U32, +sl: List<&2, U32>, e: {UB.right(lf, r, s, sl) == True{} : Bool}) -> {Bool.and(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s)) == True{} : Bool}:
  AR(Bool.and(UB.st(lf, r, sl), UB.cl(lf, sl)), Bool.and(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s)), e)

# Everything any layer provided at r reaches is in the certified set sl.
def UP.reach(+lf: Y.LF, +r: U32, +s: U32, +sl: List<&2, U32>, e: {UB.right(lf, r, s, sl) == True{} : Bool}, +y: U32, hy: Laws.LrHas(Y.LF.lrs(lf), r, y), +k: Nat, +m: U32, hw: Laws.LpWalk(Y.LF.lps(lf), k, y, m)) -> TL.Mem(sl, m):
  +se = UP.set(lf, r, s, sl, e)
  SL.scope_set_sound(sl, m, WkS(k, Y.LF.lps(lf), S.Scope.set(sl), AR(UB.st(lf, r, sl), UB.cl(lf, sl), se), y, m, StS(Y.LF.lrs(lf), r, S.Scope.set(sl), AL(UB.st(lf, r, sl), UB.cl(lf, sl), se), y, hy), hw))

def Laws.unprovided_requires(lf, r, l, s, x, ws, sl, h):
  LqS(Y.LF.lqs(lf), l, s, AL(UB.q(lf, l, s), UB.rp(lf, r, l, x, ws), UP.left(lf, r, l, s, x, ws, sl, h)))

def Laws.unprovided_rooted(lf, r, l, s, x, ws, sl, h):
  +e = AR(UB.q(lf, l, s), UB.rp(lf, r, l, x, ws), UP.left(lf, r, l, s, x, ws, sl, h))
  Tuple{LrS(Y.LF.lrs(lf), r, x, AL(Y.Lr.has(Y.LF.lrs(lf), r, x), Y.Lp.path0(ws, Y.LF.lps(lf), x, l), e)), LpP(ws, Y.LF.lps(lf), x, l, AR(Y.Lr.has(Y.LF.lrs(lf), r, x), Y.Lp.path0(ws, Y.LF.lps(lf), x, l), e))}

def Laws.unprovided_no_builder(lf, r, l, s, x, ws, sl, h, y, hy, k, m, hw, hb):
  +e = UP.right(lf, r, l, s, x, ws, sl, h)
  +n = UP.none(lf, r, s, sl, e)
  +nn = AL(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s), n)
  B.clash(Y.Ly.has(Y.LF.lys(lf), m, s), NbS(sl, Y.LF.lys(lf), s, AL(UB.nb(lf, s, sl), UB.no(lf, sl), nn), m, UP.reach(lf, r, s, sl, e, y, hy, k, m, hw)), LyC(Y.LF.lys(lf), m, s, hb))

def Laws.unprovided_no_opaque(lf, r, l, s, x, ws, sl, h, y, hy, k, m, hw, ho):
  +e = UP.right(lf, r, l, s, x, ws, sl, h)
  +n = UP.none(lf, r, s, sl, e)
  +nn = AL(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s), n)
  B.clash(Y.Lo.has(Y.LF.los(lf), m), NoS(sl, Y.LF.los(lf), AR(UB.nb(lf, s, sl), UB.no(lf, sl), nn), m, UP.reach(lf, r, s, sl, e, y, hy, k, m, hw)), L2.Mem.to_bool(Y.LF.los(lf), m, ho))

def Laws.unprovided_no_default(lf, r, l, s, x, ws, sl, h, hd):
  +e = UP.right(lf, r, l, s, x, ws, sl, h)
  +n = UP.none(lf, r, s, sl, e)
  B.clash(Y.Sv.dflt(Y.LF.svs(lf), s), B.not_t(Y.Sv.dflt(Y.LF.svs(lf), s), AR(Bool.and(UB.nb(lf, s, sl), UB.no(lf, sl)), UB.nd(lf, s), n)), SvC(Y.LF.svs(lf), s, hd))

# ---- (3) duplicate builders ----------------------------------------------------------------------
def DB.l(+lf: Y.LF, +s: U32, +a: U32, +b: U32) -> Bool:
  Bool.and(U32.is_lt(a, b), Bool.and(Y.Ly.has(Y.LF.lys(lf), a, s), Y.Ly.has(Y.LF.lys(lf), b, s)))

def DB.r(+lf: Y.LF, +a: U32, +b: U32, +w: U32, wa: List<&2, U32>, wb: List<&2, U32>) -> Bool:
  Bool.and(Y.Lp.path0(wa, Y.LF.lps(lf), w, a), Y.Lp.path0(wb, Y.LF.lps(lf), w, b))

def DP(+lf: Y.LF, +s: U32, +a: U32, +b: U32, +w: U32, +wa: List<&2, U32>, +wb: List<&2, U32>, h: Laws.In(Y.Dc, Y.Layers.dups(lf), Y.Dc{s, a, b, w, wa, wb})) -> {Bool.and(DB.l(lf, s, a, b), DB.r(lf, a, b, w, wa, wb)) == True{} : Bool}:
  KD(Y.Dc.sort(Y.Du.tops(Y.Layers.iota(U32.to_nat(Y.LF.nl(lf)), 0), lf, Y.Layers.lp_adj(lf)), Nil{}), lf, Y.Dc{s, a, b, w, wa, wb}, h)

def Laws.dup_builders(lf, s, a, b, w, wa, wb, h):
  +e = AL(DB.l(lf, s, a, b), DB.r(lf, a, b, w, wa, wb), DP(lf, s, a, b, w, wa, wb, h))
  +e2 = AR(U32.is_lt(a, b), Bool.and(Y.Ly.has(Y.LF.lys(lf), a, s), Y.Ly.has(Y.LF.lys(lf), b, s)), e)
  Tuple{AL(U32.is_lt(a, b), Bool.and(Y.Ly.has(Y.LF.lys(lf), a, s), Y.Ly.has(Y.LF.lys(lf), b, s)), e), Tuple{LyS(Y.LF.lys(lf), a, s, AL(Y.Ly.has(Y.LF.lys(lf), a, s), Y.Ly.has(Y.LF.lys(lf), b, s), e2)), LyS(Y.LF.lys(lf), b, s, AR(Y.Ly.has(Y.LF.lys(lf), a, s), Y.Ly.has(Y.LF.lys(lf), b, s), e2))}}

def Laws.dup_one_composition(lf, s, a, b, w, wa, wb, h):
  +e = AR(DB.l(lf, s, a, b), DB.r(lf, a, b, w, wa, wb), DP(lf, s, a, b, w, wa, wb, h))
  Tuple{LpP(wa, Y.LF.lps(lf), w, a, AL(Y.Lp.path0(wa, Y.LF.lps(lf), w, a), Y.Lp.path0(wb, Y.LF.lps(lf), w, b), e)), LpP(wb, Y.LF.lps(lf), w, b, AR(Y.Lp.path0(wa, Y.LF.lps(lf), w, a), Y.Lp.path0(wb, Y.LF.lps(lf), w, b), e))}

def CntE.z(+l: List<&2, U32>, +s: U32) -> {Nat.add(TL.Count(l, s), G.Graph.cnt_of(G.Tr.getu(G.TE{}, s))) == TL.Count(l, s) : Nat}:
  %Equal.sym(Nat, G.Graph.cnt_of(G.Tr.getu(G.TE{}, s)), 0n, L3.Te.cnt(s)) : {Nat.add(TL.Count(l, s), _) == TL.Count(l, s) : Nat}
  N.Nat.add_zero(TL.Count(l, s))

# ---- (4) hubs ---------------------------------------------------------------------------------------
# A tally from empty is the count (Lemmas3 Cnt.sound, Te.cnt).
def CntE(+l: List<&2, U32>, +s: U32) -> {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(l, G.TE{}), s)) == TL.Count(l, s) : Nat}:
  Equal.trans(Nat, G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(l, G.TE{}), s)), Nat.add(TL.Count(l, s), G.Graph.cnt_of(G.Tr.getu(G.TE{}, s))), TL.Count(l, s), L3.Cnt.sound(l, G.TE{}, s), CntE.z(l, s))

# The checker's count equation, stated with TL.Count.
def CntU(+a: U32, +l: List<&2, U32>, +s: U32, e: {U32.is_eq(a, Y.Hb.cnt(G.Graph.cnt_all(l, G.TE{}), s)) == True{} : Bool}) -> {a == U32.from_nat(TL.Count(l, s)) : U32}:
  %CntE(l, s) : {a == U32.from_nat(_) : U32}
  L.U32.eq_sound(a, Y.Hb.cnt(G.Graph.cnt_all(l, G.TE{}), s), e)

def HB.l(+ta: G.Tr, +tb: G.Tr, +s: U32, +a: U32, +b: U32) -> Bool:
  Bool.and(U32.is_eq(a, Y.Hb.cnt(ta, s)), U32.is_eq(b, Y.Hb.cnt(tb, s)))

def HB.r(+k: U32, +a: U32, +b: U32) -> Bool:
  Bool.and(U32.is_eq(k, U32.add(a, b)), U32.is_ge(k, Y.Layers.hub_min()))

def HB.go(+lf: Y.LF, +la: List<&2, U32>, +lb: List<&2, U32>, +s: U32, +k: U32, +a: U32, +b: U32, h: Laws.In(Y.Hub, Y.Hb.hubs2(lf, G.Graph.cnt_all(la, G.TE{}), G.Graph.cnt_all(lb, G.TE{})), Y.Hub{s, k, a, b})) -> TL.And({a == U32.from_nat(TL.Count(la, s)) : U32}, TL.And({b == U32.from_nat(TL.Count(lb, s)) : U32}, TL.And({k == U32.add(a, b) : U32}, {U32.is_ge(k, Y.Layers.hub_min()) == True{} : Bool}))):
  +ta = G.Graph.cnt_all(la, G.TE{})
  +tb = G.Graph.cnt_all(lb, G.TE{})
  +e = KH(Y.Hb.cands(Y.Layers.iota(U32.to_nat(Y.LF.ns(lf)), 0), ta, tb), ta, tb, Y.Hub{s, k, a, b}, h)
  +el = AL(HB.l(ta, tb, s, a, b), HB.r(k, a, b), e)
  +er = AR(HB.l(ta, tb, s, a, b), HB.r(k, a, b), e)
  Tuple{CntU(a, la, s, AL(U32.is_eq(a, Y.Hb.cnt(ta, s)), U32.is_eq(b, Y.Hb.cnt(tb, s)), el)), Tuple{CntU(b, lb, s, AR(U32.is_eq(a, Y.Hb.cnt(ta, s)), U32.is_eq(b, Y.Hb.cnt(tb, s)), el)), Tuple{L.U32.eq_sound(k, U32.add(a, b), AL(U32.is_eq(k, U32.add(a, b)), U32.is_ge(k, Y.Layers.hub_min()), er)), AR(U32.is_eq(k, U32.add(a, b)), U32.is_ge(k, Y.Layers.hub_min()), er)}}}

def Laws.hub_counts(lf, s, k, a, b, h):
  HB.go(lf, Y.Hb.lq_ids(Y.LF.lqs(lf)), Y.Hb.us_ids(Y.LF.uss(lf), Y.Hb.lc_set(Y.LF.lcs(lf))), s, k, a, b, h)

# ---- (1) the requirement graph ----------------------------------------------------------------------
def RkS.fin(+lqs: List<&2, Y.Lq>, +lys: List<&2, Y.Ly>, +x: U32, +w2: U32, +s2: U32, +w: U32, +hb: {Y.Rq.check(lqs, lys, x, w2, s2) == True{} : Bool}, e: {w2 == w : U32}) -> TL.And(Laws.LqHas(lqs, x, s2), Laws.LyHas(lys, w, s2)):
  %e : TL.And(Laws.LqHas(lqs, x, s2), Laws.LyHas(lys, _, s2))
  Tuple{LqS(lqs, x, s2, AL(Y.Lq.has(lqs, x, s2), Y.Ly.has(lys, w2, s2), hb)), LyS(lys, w2, s2, AR(Y.Lq.has(lqs, x, s2), Y.Ly.has(lys, w2, s2), hb))}

def RkS.k(b: Bool, +lqs: List<&2, Y.Lq>, +lys: List<&2, Y.Ly>, +x: U32, +w2: U32, +s2: U32, t: List<&2, Y.Ce>, +w: U32, hb: {Y.Rq.check(lqs, lys, x, w2, s2) == b : Bool}, hm: TL.Mem(Y.Layers.push_u(b, w2, Y.Rq.keep(t, lqs, lys, x)), w), ih: TL.Mem(Y.Rq.keep(t, lqs, lys, x), w) -> TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, x, s), Laws.LyHas(lys, w, s)))) -> TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, x, s), Laws.LyHas(lys, w, s))):
  match b:
    case True{}:
      match hm:
        case Inl{e}:
          Tuple{s2, RkS.fin(lqs, lys, x, w2, s2, w, hb, e)}
        case Inr{q}:
          ih(q)
    case False{}:
      ih(hm)

# A kept row entry has a witness service.
def RkS(cs: List<&2, Y.Ce>, +lqs: List<&2, Y.Lq>, +lys: List<&2, Y.Ly>, +x: U32, +w: U32, hm: TL.Mem(Y.Rq.keep(cs, lqs, lys, x), w)) -> TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, x, s), Laws.LyHas(lys, w, s))):
  match cs:
    case Nil{}:
      Empty.absurd(TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, x, s), Laws.LyHas(lys, w, s))), hm)
    case Con{Y.Ce{+w2, +s2}, +t}:
      RkS.k(Y.Rq.check(lqs, lys, x, w2, s2), lqs, lys, x, w2, s2, t, w, {==}, hm, y => RkS(t, lqs, lys, x, w, y))

def RwS.inc(+x: U32, +p: Nat, hx: {x == U32.from_nat(p) : U32}) -> {U32.inc(x) == U32.from_nat(1n+p) : U32}:
  %hx : {U32.inc(x) == U32.inc(_) : U32}
  {==}

# Row n of Rq.rows(fuel, x, ..) with x = from_nat(p) belongs to layer from_nat(n + p).
def RwS(fuel: Nat, +lqs: List<&2, Y.Lq>, +lys: List<&2, Y.Ly>, +x: U32, +p: Nat, +n: Nat, +w: U32, hx: {x == U32.from_nat(p) : U32}, hm: TL.Mem(TL.Nth(Y.Rq.rows(fuel, x, lqs, lys), n), w)) -> TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, U32.from_nat(Nat.add(n, p)), s), Laws.LyHas(lys, w, s))):
  match fuel:
    case 0n:
      match n:
        case 0n:
          Empty.absurd(TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, U32.from_nat(Nat.add(0n, p)), s), Laws.LyHas(lys, w, s))), hm)
        case 1n+n2:
          Empty.absurd(TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, U32.from_nat(Nat.add(1n+n2, p)), s), Laws.LyHas(lys, w, s))), hm)
    case 1n+q:
      match n:
        case 0n:
          %hx : TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, _, s), Laws.LyHas(lys, w, s)))
          RkS(Y.Rq.sort(Y.Rq.cands(lqs, x, lys, Nil{})), lqs, lys, x, w, hm)
        case 1n+n2:
          %N.Nat.add_succ_r(n2, p) : TL.Ex(U32, s => TL.And(Laws.LqHas(lqs, U32.from_nat(_), s), Laws.LyHas(lys, w, s)))
          RwS(q, lqs, lys, U32.inc(x), 1n+p, n2, w, RwS.inc(x, p, hx), hm)

def RE.ex(+lf: Y.LF, +u: U32, +w: U32, hs: TL.Succ(Y.Layers.req_graph(lf), u, w)) -> TL.Ex(U32, s => TL.And(Laws.LqHas(Y.LF.lqs(lf), u, s), Laws.LyHas(Y.LF.lys(lf), w, s))):
  %N.U32.round(u) : TL.Ex(U32, s => TL.And(Laws.LqHas(Y.LF.lqs(lf), _, s), Laws.LyHas(Y.LF.lys(lf), w, s)))
  %N.Nat.add_zero(U32.to_nat(u)) : TL.Ex(U32, s => TL.And(Laws.LqHas(Y.LF.lqs(lf), U32.from_nat(_), s), Laws.LyHas(Y.LF.lys(lf), w, s)))
  RwS(U32.to_nat(Y.LF.nl(lf)), Y.LF.lqs(lf), Y.LF.lys(lf), 0, 0n, U32.to_nat(u), w, {==}, hs)

def RE.cvt(+lf: Y.LF, +u: U32, +w: U32, e: TL.Ex(U32, s => TL.And(Laws.LqHas(Y.LF.lqs(lf), u, s), Laws.LyHas(Y.LF.lys(lf), w, s)))) -> Sigma<&1, &1, U32, s => TL.And(Laws.LqHas(Y.LF.lqs(lf), u, s), Laws.LyHas(Y.LF.lys(lf), w, s))>:
  match e:
    case Tuple{s, p}:
      Tuple{s, p}

def Laws.req_edge_sound(lf, u, w, hs):
  RE.cvt(lf, u, w, RE.ex(lf, u, w, hs))
