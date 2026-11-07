# engine/Konst-PROOF.bend - proofs of Konst-LAWS.bend. Gate: bend Konst-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as CL
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Sql-PROOF.bend as QP
import ./Fanout-LAWS.bend as FL
import ./Fanout-PROOF.bend as FP
import ./Konst.bend as K
import ./Konst-LAWS.bend as Laws

# ---- list lemmas ------------------------------------------------------------------------------
def AK.sh(+a: K.Kx, +t: List<&2, K.Kx>, +ys: List<&2, K.Kx>, +y: K.Kx, o: Either<&2, &2, Laws.MemKx(t, y), Laws.MemKx(ys, y)>) -> Either<&2, &2, Laws.MemKx(Con{a, t}, y), Laws.MemKx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AK.split(xs: List<&2, K.Kx>, +ys: List<&2, K.Kx>, +y: K.Kx, h: Laws.MemKx(List.append(&2, K.Kx, xs, ys), y)) -> Either<&2, &2, Laws.MemKx(xs, y), Laws.MemKx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AK.sh(a, t, ys, y, AK.split(t, ys, y, q))

def AK.l(xs: List<&2, K.Kx>, +ys: List<&2, K.Kx>, +y: K.Kx, h: Laws.MemKx(xs, y)) -> Laws.MemKx(List.append(&2, K.Kx, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemKx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AK.l(t, ys, y, q)}

def AK.r(xs: List<&2, K.Kx>, +ys: List<&2, K.Kx>, +y: K.Kx, h: Laws.MemKx(ys, y)) -> Laws.MemKx(List.append(&2, K.Kx, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AK.r(t, ys, y, h)}

def KK.mem(b: Bool, +x: K.Kx, +rest: List<&2, K.Kx>, +y: K.Kx, h: Laws.MemKx(K.Ko.keep(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : K.Kx}), Laws.MemKx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def KK.stay(b: Bool, +x: K.Kx, +rest: List<&2, K.Kx>, +y: K.Kx, h: Laws.MemKx(rest, y)) -> Laws.MemKx(K.Ko.keep(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def KK.hit(b: Bool, +x: K.Kx, +rest: List<&2, K.Kx>, hb: {b == True{} : Bool}) -> Laws.MemKx(K.Ko.keep(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemKx(K.Ko.keep(_, x, rest), x)
  Inl{{==}}

def Lift.al(-P: @a: K.Al -> Data, +h: K.Al, +t: List<&2, K.Al>, w: TL.Ex(K.Al, a => TL.And(Laws.MemAl(t, a), P(a)))) -> TL.Ex(K.Al, a => TL.And(Laws.MemAl(Con{h, t}, a), P(a))):
  match w:
    case Tuple{a, Tuple{ms, at}}:
      Tuple{a, Tuple{Inr{ms}, at}}

# ---- the constant-argument sites --------------------------------------------------------------
def Sites.k(+site: U32, +p: U32, +kind: U32, +t: List<&2, K.Al>, +pos: U32, +x: U32, o: Either<&2, &2, TL.And({U32.is_eq(p, pos) == True{} : Bool}, {site == x : U32}), TL.Mem(K.Ko.sites(t, pos), x)>, ih: TL.Mem(K.Ko.sites(t, pos), x) -> TL.Ex(K.Al, a => TL.And(Laws.MemAl(t, a), Laws.AlAt(a, x, pos)))) -> TL.Ex(K.Al, a => TL.And(Laws.MemAl(Con{K.Al{site, p, kind}, t}, a), Laws.AlAt(a, x, pos))):
  match o:
    case Inl{Tuple{ep, es}}:
      Tuple{K.Al{site, p, kind}, Tuple{Inl{{==}}, Tuple{es, L.U32.eq_sound(p, pos, ep)}}}
    case Inr{m}:
      Lift.al(a => Laws.AlAt(a, x, pos), K.Al{site, p, kind}, t, ih(m))

def Sites.s(als: List<&2, K.Al>, +pos: U32, +x: U32, h: TL.Mem(K.Ko.sites(als, pos), x)) -> TL.Ex(K.Al, a => TL.And(Laws.MemAl(als, a), Laws.AlAt(a, x, pos))):
  match als:
    case Nil{}:
      match h:
    case Con{K.Al{+site, +p, +kind}, +t}:
      Sites.k(site, p, kind, t, pos, x, FP.PU.mem(U32.is_eq(p, pos), site, K.Ko.sites(t, pos), x, h), q => Sites.s(t, pos, x, q))

def Sites.stay(h: K.Al, +t: List<&2, K.Al>, +pos: U32, +x: U32, m: TL.Mem(K.Ko.sites(t, pos), x)) -> TL.Mem(K.Ko.sites(Con{h, t}, pos), x):
  match h:
    case K.Al{+site, +p, +kind}:
      CP.PU.keep(U32.is_eq(p, pos), site, K.Ko.sites(t, pos), x, m)

def Sites.c(als: List<&2, K.Al>, +site: U32, +pos: U32, +kind: U32, hm: Laws.MemAl(als, K.Al{site, pos, kind})) -> TL.Mem(K.Ko.sites(als, pos), site):
  match als:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(K.Al, h, K.Al{site, pos, kind}, e) : TL.Mem(K.Ko.sites(Con{_, t}, pos), site)
          FP.PU.hit(U32.is_eq(pos, pos), site, K.Ko.sites(t, pos), CP.U.eq_t(pos, pos, {==}))
        case Inr{q}:
          Sites.stay(h, t, pos, site, Sites.c(t, site, pos, kind, q))

# ---- one rule row -----------------------------------------------------------------------------
def Hits.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +als: List<&2, K.Al>, +r: U32, +pos: U32, +y: K.Kx, o: Either<&2, &2, TL.And({Bool.and(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), S.Scope.has(S.Scope.set(K.Ko.sites(als, pos)), site)) == True{} : Bool}, {K.Kx{r, site, fn, callee, pos} == y : K.Kx}), Laws.MemKx(K.Ko.hits(t, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(K.Ko.sites(als, pos))), y)>, ih: Laws.MemKx(K.Ko.hits(t, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(K.Ko.sites(als, pos))), y) -> TL.Ex(X.Cs, s => TL.And(FL.MemCs(t, s), Laws.KAt(s, cls, c, als, r, pos, y)))) -> TL.Ex(X.Cs, s => TL.And(FL.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, s), Laws.KAt(s, cls, c, als, r, pos, y))):
  match o:
    case Inl{Tuple{+eb, ex}}:
      Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{CP.IS(cls, c, callee, SL.scope_set_sound(X.Cx.ids(cls, c), callee, QP.And.l(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), S.Scope.has(S.Scope.set(K.Ko.sites(als, pos)), site), eb))), Tuple{Sites.s(als, pos, site, SL.scope_set_sound(K.Ko.sites(als, pos), site, QP.And.r(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), S.Scope.has(S.Scope.set(K.Ko.sites(als, pos)), site), eb))), ex}}}}
    case Inr{m}:
      FP.Lift.cs(s => Laws.KAt(s, cls, c, als, r, pos, y), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def Hits.s(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +als: List<&2, K.Al>, +r: U32, +pos: U32, +y: K.Kx, h: Laws.MemKx(K.Ko.hits(css, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(K.Ko.sites(als, pos))), y)) -> TL.Ex(X.Cs, s => TL.And(FL.MemCs(css, s), Laws.KAt(s, cls, c, als, r, pos, y))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      Hits.k(site, fn, callee, ld, ctx, t, cls, c, als, r, pos, y, KK.mem(Bool.and(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), S.Scope.has(S.Scope.set(K.Ko.sites(als, pos)), site)), K.Kx{r, site, fn, callee, pos}, K.Ko.hits(t, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(K.Ko.sites(als, pos))), y, h), q => Hits.s(t, cls, c, als, r, pos, y, q))

def Laws.ko_rule_sound(css, cls, als, r, c, pos, y, hm):
  Hits.s(css, cls, c, als, r, pos, y, hm)

def Hits.stay(h: X.Cs, +t: List<&2, X.Cs>, +r: U32, +pos: U32, +cset: G.Tr, +aset: G.Tr, +y: K.Kx, m: Laws.MemKx(K.Ko.hits(t, r, pos, cset, aset), y)) -> Laws.MemKx(K.Ko.hits(Con{h, t}, r, pos, cset, aset), y):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      KK.stay(Bool.and(S.Scope.has(cset, callee), S.Scope.has(aset, site)), K.Kx{r, site, fn, callee, pos}, K.Ko.hits(t, r, pos, cset, aset), y, m)

def Hits.c(css: List<&2, X.Cs>, +r: U32, +pos: U32, +cset: G.Tr, +aset: G.Tr, +site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, hm: FL.MemCs(css, X.Cs{site, fn, callee, ld, ctx}), +hb: {Bool.and(S.Scope.has(cset, callee), S.Scope.has(aset, site)) == True{} : Bool}) -> Laws.MemKx(K.Ko.hits(css, r, pos, cset, aset), K.Kx{r, site, fn, callee, pos}):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, X.Cs{site, fn, callee, ld, ctx}, e) : Laws.MemKx(K.Ko.hits(Con{_, t}, r, pos, cset, aset), K.Kx{r, site, fn, callee, pos})
          KK.hit(Bool.and(S.Scope.has(cset, callee), S.Scope.has(aset, site)), K.Kx{r, site, fn, callee, pos}, K.Ko.hits(t, r, pos, cset, aset), hb)
        case Inr{q}:
          Hits.stay(h, t, r, pos, cset, aset, K.Kx{r, site, fn, callee, pos}, Hits.c(t, r, pos, cset, aset, site, fn, callee, ld, ctx, q, hb))

def Laws.ko_rule_complete(css, cls, als, r, c, pos, site, fn, callee, ld, ctx, kind, hm, hc, ha):
  Hits.c(css, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(K.Ko.sites(als, pos)), site, fn, callee, ld, ctx, hm, HP.And.both(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), S.Scope.has(S.Scope.set(K.Ko.sites(als, pos)), site), SL.scope_set_complete(X.Cx.ids(cls, c), callee, CP.IC(cls, c, callee, hc)), SL.scope_set_complete(K.Ko.sites(als, pos), site, Sites.c(als, site, pos, kind, ha))))

# ---- every rule row ---------------------------------------------------------------------------
def Rules.up(+k: K.Rk, +t: List<&2, K.Rk>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, K.Al>, +y: K.Kx, w: TL.Ex(K.Rk, g => TL.And(Laws.MemRk(t, g), Laws.MemKx(K.Ko.rule(css, cls, als, g), y)))) -> TL.Ex(K.Rk, g => TL.And(Laws.MemRk(Con{k, t}, g), Laws.MemKx(K.Ko.rule(css, cls, als, g), y))):
  match w:
    case Tuple{g, Tuple{mg, m}}:
      Tuple{g, Tuple{Inr{mg}, m}}

def Rules.s2(+k: K.Rk, +t: List<&2, K.Rk>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, K.Al>, +y: K.Kx, o: Either<&2, &2, Laws.MemKx(K.Ko.rule(css, cls, als, k), y), Laws.MemKx(K.Ko.rules(css, cls, als, t), y)>, ih: Laws.MemKx(K.Ko.rules(css, cls, als, t), y) -> TL.Ex(K.Rk, g => TL.And(Laws.MemRk(t, g), Laws.MemKx(K.Ko.rule(css, cls, als, g), y)))) -> TL.Ex(K.Rk, g => TL.And(Laws.MemRk(Con{k, t}, g), Laws.MemKx(K.Ko.rule(css, cls, als, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      Rules.up(k, t, css, cls, als, y, ih(m))

def Rules.s(rks: List<&2, K.Rk>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, K.Al>, +y: K.Kx, h: Laws.MemKx(K.Ko.rules(css, cls, als, rks), y)) -> TL.Ex(K.Rk, g => TL.And(Laws.MemRk(rks, g), Laws.MemKx(K.Ko.rule(css, cls, als, g), y))):
  match rks:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      Rules.s2(k, t, css, cls, als, y, AK.split(K.Ko.rule(css, cls, als, k), K.Ko.rules(css, cls, als, t), y, h), m => Rules.s(t, css, cls, als, y, m))

def Laws.ko_findings_sound(css, cls, als, rks, y, hm):
  Rules.s(rks, css, cls, als, y, hm)

def Rules.c(rks: List<&2, K.Rk>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, K.Al>, +k: K.Rk, +y: K.Kx, hk: Laws.MemRk(rks, k), hm: Laws.MemKx(K.Ko.rule(css, cls, als, k), y)) -> Laws.MemKx(K.Ko.rules(css, cls, als, rks), y):
  match rks:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(K.Rk, h, k, e) : Laws.MemKx(K.Ko.rules(css, cls, als, Con{_, t}), y)
          AK.l(K.Ko.rule(css, cls, als, k), K.Ko.rules(css, cls, als, t), y, hm)
        case Inr{q}:
          AK.r(K.Ko.rule(css, cls, als, h), K.Ko.rules(css, cls, als, t), y, Rules.c(t, css, cls, als, k, y, q, hm))

def Laws.ko_findings_complete(css, cls, als, rks, k, y, hk, hm):
  Rules.c(rks, css, cls, als, k, y, hk, hm)

def Laws.ko_lines_shape(f):
  {==}
