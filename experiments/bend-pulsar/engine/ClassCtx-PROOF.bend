# engine/ClassCtx-PROOF.bend - proofs of the laws in ClassCtx-LAWS.bend.
# Gate: `bend ClassCtx-PROOF.bend --verdict` (run from engine/).

import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as Laws

# ---- Bool and U32 helpers --------------------------------------------------------------------
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

# A Bool cannot be both.
def B.clash(t: Bool, hf: {t == False{} : Bool}, ht: {t == True{} : Bool}) -> Empty:
  match t:
    case True{}:
      L.Bool.tt_ff(hf)
    case False{}:
      L.Bool.ff_tt(ht)

def U.eq_t(+a: U32, +b: U32, e: {a == b : U32}) -> {U32.is_eq(a, b) == True{} : Bool}:
  %e : {U32.is_eq(a, _) == True{} : Bool}
  L2.U32.eq_refl(a)

# ---- finding lists: append -------------------------------------------------------------------
def Ap.sh(+r2: U32, +s2: U32, +f2: U32, +c2: U32, +t: List<&2, X.Fd>, +ys: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, o: Either<&2, &2, Laws.FdAt(t, r, s, f, c), Laws.FdAt(ys, r, s, f, c)>) -> Either<&2, &2, Laws.FdAt(Con{X.Fd{r2, s2, f2, c2}, t}, r, s, f, c), Laws.FdAt(ys, r, s, f, c)>:
  match o:
    case Inl{a}:
      Inl{Inr{a}}
    case Inr{b}:
      Inr{b}

def Ap.split(xs: List<&2, X.Fd>, +ys: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(List.append(&2, X.Fd, xs, ys), r, s, f, c)) -> Either<&2, &2, Laws.FdAt(xs, r, s, f, c), Laws.FdAt(ys, r, s, f, c)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{X.Fd{+r2, +s2, +f2, +c2}, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          Ap.sh(r2, s2, f2, c2, t, ys, r, s, f, c, Ap.split(t, ys, r, s, f, c, q))

def Ap.l(xs: List<&2, X.Fd>, +ys: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(xs, r, s, f, c)) -> Laws.FdAt(List.append(&2, X.Fd, xs, ys), r, s, f, c):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.FdAt(ys, r, s, f, c), h)
    case Con{X.Fd{+r2, +s2, +f2, +c2}, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{Ap.l(t, ys, r, s, f, c, q)}

def Ap.r(xs: List<&2, X.Fd>, +ys: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(ys, r, s, f, c)) -> Laws.FdAt(List.append(&2, X.Fd, xs, ys), r, s, f, c):
  match xs:
    case Nil{}:
      h
    case Con{X.Fd{+r2, +s2, +f2, +c2}, +t}:
      Inr{Ap.r(t, ys, r, s, f, c, h)}

def PU.keep(b: Bool, +y: U32, acc: List<&2, U32>, +x: U32, h: TL.Mem(acc, x)) -> TL.Mem(X.Cx.push_u(b, y, acc), x):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

# ---- class membership: Cx.ids -----------------------------------------------------------------
def IS.k(b: Bool, +s: U32, +c2: U32, +t: List<&2, X.Cl>, +c: U32, +x: U32, hb: {U32.is_eq(c2, c) == b : Bool}, h: TL.Mem(X.Cx.push_u(b, s, X.Cx.ids(t, c)), x), ih: TL.Mem(X.Cx.ids(t, c), x) -> Laws.ClHas(t, x, c)) -> Laws.ClHas(Con{X.Cl{s, c2}, t}, x, c):
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{e, L.U32.eq_sound(c2, c, hb)}}
        case Inr{q}:
          Inr{ih(q)}
    case False{}:
      Inr{ih(h)}

# A symbol listed for class c has a CL fact for c.
def IS(cls: List<&2, X.Cl>, +c: U32, +x: U32, h: TL.Mem(X.Cx.ids(cls, c), x)) -> Laws.ClHas(cls, x, c):
  match cls:
    case Nil{}:
      Empty.absurd(Laws.ClHas(Nil{}, x, c), h)
    case Con{X.Cl{+s, +c2}, +t}:
      IS.k(U32.is_eq(c2, c), s, c2, t, c, x, {==}, h, y => IS(t, c, x, y))

def IC.h(+s: U32, +c2: U32, +t: List<&2, X.Cl>, +c: U32, +x: U32, ec: {c2 == c : U32}, es: {s == x : U32}) -> TL.Mem(X.Cx.push_u(U32.is_eq(c2, c), s, X.Cx.ids(t, c)), x):
  %Equal.sym(Bool, U32.is_eq(c2, c), True{}, U.eq_t(c2, c, ec)) : TL.Mem(X.Cx.push_u(_, s, X.Cx.ids(t, c)), x)
  Inl{es}

def IC.e(+s: U32, +c2: U32, +t: List<&2, X.Cl>, +c: U32, +x: U32, e: TL.And({s == x : U32}, {c2 == c : U32})) -> TL.Mem(X.Cx.push_u(U32.is_eq(c2, c), s, X.Cx.ids(t, c)), x):
  match e:
    case Tuple{es, ec}:
      IC.h(s, c2, t, c, x, ec, es)

# A CL fact for class c lists the symbol for c.
def IC(cls: List<&2, X.Cl>, +c: U32, +x: U32, h: Laws.ClHas(cls, x, c)) -> TL.Mem(X.Cx.ids(cls, c), x):
  match cls:
    case Nil{}:
      Empty.absurd(TL.Mem(Nil{}, x), h)
    case Con{X.Cl{+s, +c2}, +t}:
      match h:
        case Inl{e}:
          IC.e(s, c2, t, c, x, e)
        case Inr{q}:
          PU.keep(U32.is_eq(c2, c), s, X.Cx.ids(t, c), x, IC(t, c, x, q))

# ---- rule rows: Cx.hit over Cx.tables ---------------------------------------------------------
# Some RL row of rule r, for a class of the callee, whose masks match ctx.
def HW(rls: List<&2, X.Rl>, cls: List<&2, X.Cl>, r: U32, callee: U32, ctx: U32) -> Data:
  TL.Ex(U32, c => TL.Ex(U32, any => TL.Ex(U32, none => TL.And(Laws.RlHas(rls, r, c, any, none), TL.And(Laws.ClHas(cls, callee, c), {X.Cx.ctx_ok(any, none, ctx) == True{} : Bool})))))

def HW.tail(+r2: U32, +c2: U32, +a2: U32, +n2: U32, +t: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, w: HW(t, cls, r, callee, ctx)) -> HW(Con{X.Rl{r2, c2, a2, n2}, t}, cls, r, callee, ctx):
  match w:
    case Tuple{+c, Tuple{+a, Tuple{+n, Tuple{hr, rest}}}}:
      Tuple{c, Tuple{a, Tuple{n, Tuple{Inr{hr}, rest}}}}

def HS.h3(+r2: U32, +c2: U32, +a2: U32, +n2: U32, +t: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, er: {U32.is_eq(r2, r) == True{} : Bool}, q: TL.And({S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee) == True{} : Bool}, {X.Cx.ctx_ok(a2, n2, ctx) == True{} : Bool})) -> HW(Con{X.Rl{r2, c2, a2, n2}, t}, cls, r, callee, ctx):
  match q:
    case Tuple{hh, hx}:
      Tuple{c2, Tuple{a2, Tuple{n2, Tuple{Inl{Tuple{L.U32.eq_sound(r2, r, er), Tuple{{==}, Tuple{{==}, {==}}}}}, Tuple{IS(cls, c2, callee, SL.scope_set_sound(X.Cx.ids(cls, c2), callee, hh)), hx}}}}}

# A hit is justified by an RL row and a CL fact.
def HS.h2(+r2: U32, +c2: U32, +a2: U32, +n2: U32, +t: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, p: TL.And({U32.is_eq(r2, r) == True{} : Bool}, {Bool.and(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee), X.Cx.ctx_ok(a2, n2, ctx)) == True{} : Bool})) -> HW(Con{X.Rl{r2, c2, a2, n2}, t}, cls, r, callee, ctx):
  match p:
    case Tuple{er, p2}:
      HS.h3(r2, c2, a2, n2, t, cls, r, callee, ctx, er, L.Bool.and_true(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee), X.Cx.ctx_ok(a2, n2, ctx), p2))

def HS.head(+r2: U32, +c2: U32, +a2: U32, +n2: U32, +t: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, hr: {X.Cx.row(X.Rt{r2, a2, n2, S.Scope.set(X.Cx.ids(cls, c2))}, r, callee, ctx) == True{} : Bool}) -> HW(Con{X.Rl{r2, c2, a2, n2}, t}, cls, r, callee, ctx):
  HS.h2(r2, c2, a2, n2, t, cls, r, callee, ctx, L.Bool.and_true(U32.is_eq(r2, r), Bool.and(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee), X.Cx.ctx_ok(a2, n2, ctx)), hr))

def HS.or(+r2: U32, +c2: U32, +a2: U32, +n2: U32, +t: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, o: Either<&2, &2, {X.Cx.row(X.Rt{r2, a2, n2, S.Scope.set(X.Cx.ids(cls, c2))}, r, callee, ctx) == True{} : Bool}, {X.Cx.hit(X.Cx.tables(t, cls), r, callee, ctx) == True{} : Bool}>, ih: {X.Cx.hit(X.Cx.tables(t, cls), r, callee, ctx) == True{} : Bool} -> HW(t, cls, r, callee, ctx)) -> HW(Con{X.Rl{r2, c2, a2, n2}, t}, cls, r, callee, ctx):
  match o:
    case Inl{hr}:
      HS.head(r2, c2, a2, n2, t, cls, r, callee, ctx, hr)
    case Inr{ht}:
      HW.tail(r2, c2, a2, n2, t, cls, r, callee, ctx, ih(ht))

def HS(rls: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +callee: U32, +ctx: U32, h: {X.Cx.hit(X.Cx.tables(rls, cls), r, callee, ctx) == True{} : Bool}) -> HW(rls, cls, r, callee, ctx):
  match rls:
    case Nil{}:
      Empty.absurd(HW(Nil{}, cls, r, callee, ctx), L.Bool.ff_tt(h))
    case Con{X.Rl{+r2, +c2, +a2, +n2}, +t}:
      HS.or(r2, c2, a2, n2, t, cls, r, callee, ctx, L.Bool.or_true(X.Cx.row(X.Rt{r2, a2, n2, S.Scope.set(X.Cx.ids(cls, c2))}, r, callee, ctx), X.Cx.hit(X.Cx.tables(t, cls), r, callee, ctx), h), y => HS(t, cls, r, callee, ctx, y))

def HC.has(+cls: List<&2, X.Cl>, +c2: U32, +c: U32, +callee: U32, ec: {c2 == c : U32}, hc: Laws.ClHas(cls, callee, c)) -> {S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee) == True{} : Bool}:
  %Equal.sym(U32, c2, c, ec) : {S.Scope.has(S.Scope.set(X.Cx.ids(cls, _)), callee) == True{} : Bool}
  SL.scope_set_complete(X.Cx.ids(cls, c), callee, IC(cls, c, callee, hc))

def HC.ok(+a2: U32, +n2: U32, +a: U32, +n: U32, +ctx: U32, ea: {a2 == a : U32}, en: {n2 == n : U32}, hx: {X.Cx.ctx_ok(a, n, ctx) == True{} : Bool}) -> {X.Cx.ctx_ok(a2, n2, ctx) == True{} : Bool}:
  %Equal.sym(U32, a2, a, ea) : {X.Cx.ctx_ok(_, n2, ctx) == True{} : Bool}
  %Equal.sym(U32, n2, n, en) : {X.Cx.ctx_ok(a, _, ctx) == True{} : Bool}
  hx

# An RL row and a CL fact make a hit.
def HC(rls: List<&2, X.Rl>, +cls: List<&2, X.Cl>, +r: U32, +c: U32, +a: U32, +n: U32, +callee: U32, +ctx: U32, hr: Laws.RlHas(rls, r, c, a, n), +hc: Laws.ClHas(cls, callee, c), +hx: {X.Cx.ctx_ok(a, n, ctx) == True{} : Bool}) -> {X.Cx.hit(X.Cx.tables(rls, cls), r, callee, ctx) == True{} : Bool}:
  match rls:
    case Nil{}:
      Empty.absurd({X.Cx.hit(Nil{}, r, callee, ctx) == True{} : Bool}, hr)
    case Con{X.Rl{+r2, +c2, +a2, +n2}, +t}:
      match hr:
        case Inl{e}:
          match e:
            case Tuple{er, e1}:
              match e1:
                case Tuple{ec, e2}:
                  match e2:
                    case Tuple{ea, en}:
                      B.or_l(X.Cx.row(X.Rt{r2, a2, n2, S.Scope.set(X.Cx.ids(cls, c2))}, r, callee, ctx), X.Cx.hit(X.Cx.tables(t, cls), r, callee, ctx), B.and_tt(U32.is_eq(r2, r), Bool.and(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee), X.Cx.ctx_ok(a2, n2, ctx)), U.eq_t(r2, r, er), B.and_tt(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c2)), callee), X.Cx.ctx_ok(a2, n2, ctx), HC.has(cls, c2, c, callee, ec, hc), HC.ok(a2, n2, a, n, ctx, ea, en, hx))))
        case Inr{q}:
          L2.Bool.or_r(X.Cx.row(X.Rt{r2, a2, n2, S.Scope.set(X.Cx.ids(cls, c2))}, r, callee, ctx), X.Cx.hit(X.Cx.tables(t, cls), r, callee, ctx), HC(t, cls, r, c, a, n, callee, ctx, q, hc, hx))

# ---- sites: Cx.sites ------------------------------------------------------------------------------
# A CS fact at the site whose context passed rule r's rows.
def SW(css: List<&2, X.Cs>, rts: List<&2, X.Rt>, r: U32, s: U32, f: U32, c: U32) -> Data:
  TL.Ex(U32, ctx => TL.And(Laws.CsAt(css, s, f, c, ctx), {X.Cx.hit(rts, r, c, ctx) == True{} : Bool}))

def SW.tail(+s2: U32, +f2: U32, +c2: U32, +ld: U32, +x2: U32, +t: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r: U32, +s: U32, +f: U32, +c: U32, w: SW(t, rts, r, s, f, c)) -> SW(Con{X.Cs{s2, f2, c2, ld, x2}, t}, rts, r, s, f, c):
  match w:
    case Tuple{+ctx, w1}:
      match w1:
        case Tuple{hc, hh}:
          Tuple{ctx, Tuple{Inr{hc}, hh}}

def SS.hit(+rts: List<&2, X.Rt>, +r0: U32, +r: U32, +c2: U32, +c: U32, +x: U32, er: {r0 == r : U32}, ec: {c2 == c : U32}, hb: {X.Cx.hit(rts, r0, c2, x) == True{} : Bool}) -> {X.Cx.hit(rts, r, c, x) == True{} : Bool}:
  %er : {X.Cx.hit(rts, _, c, x) == True{} : Bool}
  %ec : {X.Cx.hit(rts, r0, _, x) == True{} : Bool}
  hb

def SS.fin(+rts: List<&2, X.Rt>, +r0: U32, +s2: U32, +f2: U32, +c2: U32, +ld: U32, +x2: U32, +t: List<&2, X.Cs>, +r: U32, +s: U32, +f: U32, +c: U32, hb: {X.Cx.hit(rts, r0, c2, x2) == True{} : Bool}, er: {r0 == r : U32}, es: {s2 == s : U32}, ef: {f2 == f : U32}, +ec: {c2 == c : U32}) -> SW(Con{X.Cs{s2, f2, c2, ld, x2}, t}, rts, r, s, f, c):
  Tuple{x2, Tuple{Inl{Tuple{es, Tuple{ef, Tuple{ec, {==}}}}}, SS.hit(rts, r0, r, c2, c, x2, er, ec, hb)}}

def SS.k(b: Bool, +rts: List<&2, X.Rt>, +r0: U32, +s2: U32, +f2: U32, +c2: U32, +ld: U32, +x2: U32, +t: List<&2, X.Cs>, +r: U32, +s: U32, +f: U32, +c: U32, hb: {X.Cx.hit(rts, r0, c2, x2) == b : Bool}, h: Laws.FdAt(X.Cx.push_f(b, X.Fd{r0, s2, f2, c2}, X.Cx.sites(t, rts, r0)), r, s, f, c), ih: Laws.FdAt(X.Cx.sites(t, rts, r0), r, s, f, c) -> SW(t, rts, r, s, f, c)) -> SW(Con{X.Cs{s2, f2, c2, ld, x2}, t}, rts, r, s, f, c):
  match b:
    case True{}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{er, e1}:
              match e1:
                case Tuple{es, e2}:
                  match e2:
                    case Tuple{ef, ec}:
                      SS.fin(rts, r0, s2, f2, c2, ld, x2, t, r, s, f, c, hb, er, es, ef, ec)
        case Inr{q}:
          SW.tail(s2, f2, c2, ld, x2, t, rts, r, s, f, c, ih(q))
    case False{}:
      SW.tail(s2, f2, c2, ld, x2, t, rts, r, s, f, c, ih(h))

# A finding of rule r0's pass names a CS fact whose context hit the finding's rule.
def SS(css: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r0: U32, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(X.Cx.sites(css, rts, r0), r, s, f, c)) -> SW(css, rts, r, s, f, c):
  match css:
    case Nil{}:
      Empty.absurd(SW(Nil{}, rts, r, s, f, c), h)
    case Con{X.Cs{+s2, +f2, +c2, +ld, +x2}, +t}:
      SS.k(X.Cx.hit(rts, r0, c2, x2), rts, r0, s2, f2, c2, ld, x2, t, r, s, f, c, {==}, h, y => SS(t, rts, r0, r, s, f, c, y))

def SC.hit(+rts: List<&2, X.Rt>, +r: U32, +c2: U32, +c: U32, +x2: U32, +ctx: U32, ec: {c2 == c : U32}, ex: {x2 == ctx : U32}, hh: {X.Cx.hit(rts, r, c, ctx) == True{} : Bool}) -> {X.Cx.hit(rts, r, c2, x2) == True{} : Bool}:
  %Equal.sym(U32, c2, c, ec) : {X.Cx.hit(rts, r, _, x2) == True{} : Bool}
  %Equal.sym(U32, x2, ctx, ex) : {X.Cx.hit(rts, r, c, _) == True{} : Bool}
  hh

def SC.k(b: Bool, +rts: List<&2, X.Rt>, +r: U32, +s2: U32, +f2: U32, +c2: U32, +x2: U32, +t: List<&2, X.Cs>, +s: U32, +f: U32, +c: U32, +ctx: U32, hb: {X.Cx.hit(rts, r, c2, x2) == b : Bool}, h: Either<&2, &2, TL.And({s2 == s : U32}, TL.And({f2 == f : U32}, TL.And({c2 == c : U32}, {x2 == ctx : U32}))), Laws.CsAt(t, s, f, c, ctx)>, +hh: {X.Cx.hit(rts, r, c, ctx) == True{} : Bool}, ih: Laws.CsAt(t, s, f, c, ctx) -> Laws.FdAt(X.Cx.sites(t, rts, r), r, s, f, c)) -> Laws.FdAt(X.Cx.push_f(b, X.Fd{r, s2, f2, c2}, X.Cx.sites(t, rts, r)), r, s, f, c):
  match b:
    case True{}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{es, e1}:
              match e1:
                case Tuple{ef, e2}:
                  match e2:
                    case Tuple{ec, ex}:
                      Inl{Tuple{{==}, Tuple{es, Tuple{ef, ec}}}}
        case Inr{q}:
          Inr{ih(q)}
    case False{}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{es, e1}:
              match e1:
                case Tuple{ef, e2}:
                  match e2:
                    case Tuple{ec, ex}:
                      Empty.absurd(Laws.FdAt(X.Cx.sites(t, rts, r), r, s, f, c), B.clash(X.Cx.hit(rts, r, c2, x2), hb, SC.hit(rts, r, c2, c, x2, ctx, ec, ex, hh)))
        case Inr{q}:
          ih(q)

# A CS fact whose context hits rule r is in rule r's pass.
def SC(css: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r: U32, +s: U32, +f: U32, +c: U32, +ctx: U32, hs: Laws.CsAt(css, s, f, c, ctx), +hh: {X.Cx.hit(rts, r, c, ctx) == True{} : Bool}) -> Laws.FdAt(X.Cx.sites(css, rts, r), r, s, f, c):
  match css:
    case Nil{}:
      Empty.absurd(Laws.FdAt(Nil{}, r, s, f, c), hs)
    case Con{X.Cs{+s2, +f2, +c2, +ld, +x2}, +t}:
      SC.k(X.Cx.hit(rts, r, c2, x2), rts, r, s2, f2, c2, x2, t, s, f, c, ctx, {==}, hs, hh, y => SC(t, rts, r, s, f, c, ctx, y, hh))

# ---- rules: Cx.rules lists every rule id of RL ------------------------------------------------
def Eq.tr(+r1: U32, +prev: U32, +r: U32, h1: {r1 == prev : U32}, e: {r1 == r : U32}) -> {prev == r : U32}:
  %e : {prev == _ : U32}
  Equal.sym(U32, r1, prev, h1)

def RG.h(b: Bool, +r1: U32, +prev: U32, +rest: List<&2, U32>, +r: U32, hb: {U32.is_eq(r1, prev) == b : Bool}, e: {r1 == r : U32}) -> Either<&2, &2, {prev == r : U32}, TL.Mem(X.Cx.push_u(Bool.not(b), r1, rest), r)>:
  match b:
    case True{}:
      Inl{Eq.tr(r1, prev, r, L.U32.eq_sound(r1, prev, hb), e)}
    case False{}:
      Inr{Inl{e}}

def RG.t(+r1: U32, +prev: U32, +t2: List<&2, X.Rl>, +r: U32, o: Either<&2, &2, {r1 == r : U32}, TL.Mem(X.Cx.rules_go(t2, r1), r)>) -> Either<&2, &2, {prev == r : U32}, TL.Mem(X.Cx.push_u(Bool.not(U32.is_eq(r1, prev)), r1, X.Cx.rules_go(t2, r1)), r)>:
  match o:
    case Inl{e}:
      RG.h(U32.is_eq(r1, prev), r1, prev, X.Cx.rules_go(t2, r1), r, {==}, e)
    case Inr{m}:
      Inr{PU.keep(Bool.not(U32.is_eq(r1, prev)), r1, X.Cx.rules_go(t2, r1), r, m)}

def RG(t: List<&2, X.Rl>, +prev: U32, +r: U32, +c: U32, +a: U32, +n: U32, h: Laws.RlHas(t, r, c, a, n)) -> Either<&2, &2, {prev == r : U32}, TL.Mem(X.Cx.rules_go(t, prev), r)>:
  match t:
    case Nil{}:
      Empty.absurd(Either<&2, &2, {prev == r : U32}, TL.Mem(Nil{}, r)>, h)
    case Con{X.Rl{+r1, +c1, +a1, +n1}, +t2}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{e1, rest}:
              RG.h(U32.is_eq(r1, prev), r1, prev, X.Cx.rules_go(t2, r1), r, {==}, e1)
        case Inr{q}:
          RG.t(r1, prev, t2, r, RG(t2, r1, r, c, a, n, q))

def RC(rls: List<&2, X.Rl>, +r: U32, +c: U32, +a: U32, +n: U32, h: Laws.RlHas(rls, r, c, a, n)) -> TL.Mem(X.Cx.rules(rls), r):
  match rls:
    case Nil{}:
      Empty.absurd(TL.Mem(Nil{}, r), h)
    case Con{X.Rl{+r1, +c1, +a1, +n1}, +t}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{e1, rest}:
              Inl{e1}
        case Inr{q}:
          RG(t, r1, r, c, a, n, q)

# ---- Cx.find: one pass per rule id ----------------------------------------------------------------
def FS.o(+r0: U32, +t: List<&2, U32>, +css: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r: U32, +s: U32, +f: U32, +c: U32, o: Either<&2, &2, Laws.FdAt(X.Cx.sites(css, rts, r0), r, s, f, c), Laws.FdAt(X.Cx.find(t, css, rts), r, s, f, c)>, ih: Laws.FdAt(X.Cx.find(t, css, rts), r, s, f, c) -> SW(css, rts, r, s, f, c)) -> SW(css, rts, r, s, f, c):
  match o:
    case Inl{a}:
      SS(css, rts, r0, r, s, f, c, a)
    case Inr{b}:
      ih(b)

def FS(rs: List<&2, U32>, +css: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(X.Cx.find(rs, css, rts), r, s, f, c)) -> SW(css, rts, r, s, f, c):
  match rs:
    case Nil{}:
      Empty.absurd(SW(css, rts, r, s, f, c), h)
    case Con{+r0, +t}:
      FS.o(r0, t, css, rts, r, s, f, c, Ap.split(X.Cx.sites(css, rts, r0), X.Cx.find(t, css, rts), r, s, f, c, h), y => FS(t, css, rts, r, s, f, c, y))

def FC(rs: List<&2, U32>, +css: List<&2, X.Cs>, +rts: List<&2, X.Rt>, +r: U32, +s: U32, +f: U32, +c: U32, hm: TL.Mem(rs, r), +hs: Laws.FdAt(X.Cx.sites(css, rts, r), r, s, f, c)) -> Laws.FdAt(X.Cx.find(rs, css, rts), r, s, f, c):
  match rs:
    case Nil{}:
      Empty.absurd(Laws.FdAt(Nil{}, r, s, f, c), hm)
    case Con{+r0, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(U32, r0, r, e) : Laws.FdAt(List.append(&2, X.Fd, X.Cx.sites(css, rts, _), X.Cx.find(t, css, rts)), r, s, f, c)
          Ap.l(X.Cx.sites(css, rts, r), X.Cx.find(t, css, rts), r, s, f, c, hs)
        case Inr{q}:
          Ap.r(X.Cx.sites(css, rts, r0), X.Cx.find(t, css, rts), r, s, f, c, FC(t, css, rts, r, s, f, c, q, hs))

def Snd.fin(+cf: X.CF, +r: U32, +site: U32, +fn: U32, +callee: U32, w: SW(X.CF.css(cf), X.Cx.tables(X.CF.rls(cf), X.CF.cls(cf)), r, site, fn, callee)) -> Laws.Why(cf, r, site, fn, callee):
  match w:
    case Tuple{+ctx, Tuple{hc, hh}}:
      Tuple{ctx, Tuple{hc, HS(X.CF.rls(cf), X.CF.cls(cf), r, callee, ctx, hh)}}

# ---- X1, X2: the detector --------------------------------------------------------------------------
def Laws.classctx_sound(cf, r, site, fn, callee, h):
  Snd.fin(cf, r, site, fn, callee, FS(X.Cx.rules(X.CF.rls(cf)), X.CF.css(cf), X.Cx.tables(X.CF.rls(cf), X.CF.cls(cf)), r, site, fn, callee, h))

def Laws.classctx_complete(cf, site, fn, callee, ctx, r, c, any, none, hs, hr, hc, hx):
  +hr2 = hr
  +rts = X.Cx.tables(X.CF.rls(cf), X.CF.cls(cf))
  FC(X.Cx.rules(X.CF.rls(cf)), X.CF.css(cf), rts, r, site, fn, callee, RC(X.CF.rls(cf), r, c, any, none, hr2), SC(X.CF.css(cf), rts, r, site, fn, callee, ctx, hs, HC(X.CF.rls(cf), X.CF.cls(cf), r, c, any, none, callee, ctx, hr2, hc, hx)))

def Laws.ctx_ok_is_masks(any, none, ctx):
  {==}

# ---- E1-E3: the entry point --------------------------------------------------------------------------
def Laws.run_is_findings(cf, ok):
  %Equal.sym(Bool, X.ClassCtx.valid(cf), True{}, ok) : {X.ClassCtx.run2(_, cf) == Some{X.ClassCtx.findings(cf)} : Maybe<List<&2, X.Fd>>}
  {==}

def Laws.run_refuses_invalid(cf, bad):
  %Equal.sym(Bool, X.ClassCtx.valid(cf), False{}, bad) : {X.ClassCtx.run2(_, cf) == None{} : Maybe<List<&2, X.Fd>>}
  {==}

def Laws.lines_shape(fs):
  {==}

# ---- X4-X6: per-rule counts ------------------------------------------------------------------------
def Eq.tr3(+r2: U32, +r1: U32, +r: U32, x: {r2 == r1 : U32}, y: {r2 == r : U32}) -> {r1 == r : U32}:
  %x : {_ == r : U32}
  y

def OR.lift(+r2: U32, +s2: U32, +f2: U32, +c2: U32, +t: List<&2, X.Fd>, +r: U32, +r1: U32, +s: U32, +f: U32, +c: U32, w: TL.And({r1 == r : U32}, Laws.FdAt(t, r1, s, f, c))) -> TL.And({r1 == r : U32}, Laws.FdAt(Con{X.Fd{r2, s2, f2, c2}, t}, r1, s, f, c)):
  match w:
    case Tuple{e, m}:
      Tuple{e, Inr{m}}

def OR.k(b: Bool, +r2: U32, +s2: U32, +f2: U32, +c2: U32, +t: List<&2, X.Fd>, +r: U32, +r1: U32, +s: U32, +f: U32, +c: U32, hb: {U32.is_eq(r2, r) == b : Bool}, h: Laws.FdAt(X.Cx.push_f(b, X.Fd{r2, s2, f2, c2}, X.Cx.of_rule(t, r)), r1, s, f, c), ih: Laws.FdAt(X.Cx.of_rule(t, r), r1, s, f, c) -> TL.And({r1 == r : U32}, Laws.FdAt(t, r1, s, f, c))) -> TL.And({r1 == r : U32}, Laws.FdAt(Con{X.Fd{r2, s2, f2, c2}, t}, r1, s, f, c)):
  match b:
    case True{}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{+er, rest}:
              Tuple{Eq.tr3(r2, r1, r, er, L.U32.eq_sound(r2, r, hb)), Inl{Tuple{er, rest}}}
        case Inr{q}:
          OR.lift(r2, s2, f2, c2, t, r, r1, s, f, c, ih(q))
    case False{}:
      OR.lift(r2, s2, f2, c2, t, r, r1, s, f, c, ih(h))

def OR.s(fs: List<&2, X.Fd>, +r: U32, +r1: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(X.Cx.of_rule(fs, r), r1, s, f, c)) -> TL.And({r1 == r : U32}, Laws.FdAt(fs, r1, s, f, c)):
  match fs:
    case Nil{}:
      Empty.absurd(TL.And({r1 == r : U32}, Laws.FdAt(Nil{}, r1, s, f, c)), h)
    case Con{X.Fd{+r2, +s2, +f2, +c2}, +t}:
      OR.k(U32.is_eq(r2, r), r2, s2, f2, c2, t, r, r1, s, f, c, {==}, h, y => OR.s(t, r, r1, s, f, c, y))

def Laws.of_rule_sound(fs, r, r2, site, fn, callee, h):
  OR.s(fs, r, r2, site, fn, callee, h)

def OC.hit(b: Bool, +r2: U32, +s2: U32, +f2: U32, +c2: U32, +rest: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, hb: {b == True{} : Bool}, e: TL.And({r2 == r : U32}, TL.And({s2 == s : U32}, TL.And({f2 == f : U32}, {c2 == c : U32})))) -> Laws.FdAt(X.Cx.push_f(b, X.Fd{r2, s2, f2, c2}, rest), r, s, f, c):
  %Equal.sym(Bool, b, True{}, hb) : Laws.FdAt(X.Cx.push_f(_, X.Fd{r2, s2, f2, c2}, rest), r, s, f, c)
  Inl{e}

def OC.keep(b: Bool, +r2: U32, +s2: U32, +f2: U32, +c2: U32, +rest: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, m: Laws.FdAt(rest, r, s, f, c)) -> Laws.FdAt(X.Cx.push_f(b, X.Fd{r2, s2, f2, c2}, rest), r, s, f, c):
  match b:
    case True{}:
      Inr{m}
    case False{}:
      m

def OC(fs: List<&2, X.Fd>, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(fs, r, s, f, c)) -> Laws.FdAt(X.Cx.of_rule(fs, r), r, s, f, c):
  match fs:
    case Nil{}:
      Empty.absurd(Laws.FdAt(Nil{}, r, s, f, c), h)
    case Con{X.Fd{+r2, +s2, +f2, +c2}, +t}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{+er, rest}:
              OC.hit(U32.is_eq(r2, r), r2, s2, f2, c2, X.Cx.of_rule(t, r), r, s, f, c, U.eq_t(r2, r, er), Tuple{er, rest})
        case Inr{q}:
          OC.keep(U32.is_eq(r2, r), r2, s2, f2, c2, X.Cx.of_rule(t, r), r, s, f, c, OC(t, r, s, f, c, q))

def Laws.of_rule_complete(fs, r, site, fn, callee, h):
  OC(fs, r, site, fn, callee, h)

def FRG.t(+r1: U32, +prev: U32, +t2: List<&2, X.Fd>, +r: U32, o: Either<&2, &2, {r1 == r : U32}, TL.Mem(X.Cx.frules_go(t2, r1), r)>) -> Either<&2, &2, {prev == r : U32}, TL.Mem(X.Cx.push_u(Bool.not(U32.is_eq(r1, prev)), r1, X.Cx.frules_go(t2, r1)), r)>:
  match o:
    case Inl{e}:
      RG.h(U32.is_eq(r1, prev), r1, prev, X.Cx.frules_go(t2, r1), r, {==}, e)
    case Inr{m}:
      Inr{PU.keep(Bool.not(U32.is_eq(r1, prev)), r1, X.Cx.frules_go(t2, r1), r, m)}

def FRG(t: List<&2, X.Fd>, +prev: U32, +r: U32, +s: U32, +f: U32, +c: U32, h: Laws.FdAt(t, r, s, f, c)) -> Either<&2, &2, {prev == r : U32}, TL.Mem(X.Cx.frules_go(t, prev), r)>:
  match t:
    case Nil{}:
      Empty.absurd(Either<&2, &2, {prev == r : U32}, TL.Mem(Nil{}, r)>, h)
    case Con{X.Fd{+r1, +s1, +f1, +c1}, +t2}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{e1, rest}:
              RG.h(U32.is_eq(r1, prev), r1, prev, X.Cx.frules_go(t2, r1), r, {==}, e1)
        case Inr{q}:
          FRG.t(r1, prev, t2, r, FRG(t2, r1, r, s, f, c, q))

def Laws.rcxn_rules_complete(fs, r, site, fn, callee, h):
  match fs:
    case Nil{}:
      Empty.absurd(TL.Mem(Nil{}, r), h)
    case Con{X.Fd{+r1, +s1, +f1, +c1}, +t}:
      match h:
        case Inl{e}:
          match e:
            case Tuple{e1, rest}:
              Inl{e1}
        case Inr{q}:
          FRG(t, r1, r, site, fn, callee, q)
