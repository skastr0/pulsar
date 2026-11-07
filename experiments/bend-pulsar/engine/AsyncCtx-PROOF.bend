# engine/AsyncCtx-PROOF.bend - proofs of AsyncCtx-LAWS.bend.
# Gate: `bend engine/AsyncCtx-PROOF.bend --verdict`.

import Base
import ../LAWS.bend as TL
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as XL
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Sql-PROOF.bend as QP
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./Fanout-PROOF.bend as FP
import ./FnCtx.bend as N
import ./FnCtx-LAWS.bend as NL
import ./FnCtx-PROOF.bend as NP
import ./AsyncCtx.bend as A
import ./AsyncCtx-LAWS.bend as Laws
import ./Rows.bend as W

# ---- the sets the exclusive rule builds (abbreviations) ---------------------------------------
def OC(+cls: List<&2, X.Cl>, +outer: U32) -> G.Tr:
  S.Scope.set(X.Cx.ids(cls, outer))

def OS1(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +outer: U32) -> G.Tr:
  S.Scope.set(A.Ac.osites(css, OC(cls, outer)))

def XS1(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +xns: List<&2, A.Xn>, +outer: U32) -> G.Tr:
  S.Scope.set(A.Ac.xin(xns, OS1(css, cls, outer)))

def TB(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +outer: U32) -> G.Tr:
  S.Scope.set(A.Ac.both(aws, XS1(css, cls, xns, outer)))

# ---- finding lists ------------------------------------------------------------------------------
def AA.sh(+a: A.Ad, +t: List<&2, A.Ad>, +ys: List<&2, A.Ad>, +y: A.Ad, o: Either<&2, &2, Laws.MemAd(t, y), Laws.MemAd(ys, y)>) -> Either<&2, &2, Laws.MemAd(Con{a, t}, y), Laws.MemAd(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AA.split(xs: List<&2, A.Ad>, +ys: List<&2, A.Ad>, +y: A.Ad, h: Laws.MemAd(List.append(&2, A.Ad, xs, ys), y)) -> Either<&2, &2, Laws.MemAd(xs, y), Laws.MemAd(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AA.sh(a, t, ys, y, AA.split(t, ys, y, q))

def AA.l(xs: List<&2, A.Ad>, +ys: List<&2, A.Ad>, +y: A.Ad, h: Laws.MemAd(xs, y)) -> Laws.MemAd(List.append(&2, A.Ad, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemAd(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AA.l(t, ys, y, q)}

def AA.r(xs: List<&2, A.Ad>, +ys: List<&2, A.Ad>, +y: A.Ad, h: Laws.MemAd(ys, y)) -> Laws.MemAd(List.append(&2, A.Ad, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AA.r(t, ys, y, h)}

def KA.mem(b: Bool, +x: A.Ad, +rest: List<&2, A.Ad>, +y: A.Ad, h: Laws.MemAd(A.Ac.keep(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : A.Ad}), Laws.MemAd(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def KA.stay(b: Bool, +x: A.Ad, +rest: List<&2, A.Ad>, +y: A.Ad, h: Laws.MemAd(rest, y)) -> Laws.MemAd(A.Ac.keep(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def KA.hit(b: Bool, +x: A.Ad, +rest: List<&2, A.Ad>, hb: {b == True{} : Bool}) -> Laws.MemAd(A.Ac.keep(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemAd(A.Ac.keep(_, x, rest), x)
  Inl{{==}}

def Lift.cs(-P: @c: X.Cs -> Data, +h: X.Cs, +t: List<&2, X.Cs>, w: TL.Ex(X.Cs, c => TL.And(Laws.MemCs(t, c), P(c)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(Con{h, t}, c), P(c))):
  match w:
    case Tuple{c, Tuple{ms, at}}:
      Tuple{c, Tuple{Inr{ms}, at}}

def D3(+a: Bool, +b: Bool, +c: Bool, +e: {Bool.and(a, Bool.and(b, c)) == True{} : Bool}) -> TL.And({a == True{} : Bool}, TL.And({b == True{} : Bool}, {c == True{} : Bool})):
  Tuple{QP.And.l(a, Bool.and(b, c), e), Tuple{QP.And.l(b, c, QP.And.r(a, Bool.and(b, c), e)), QP.And.r(b, c, QP.And.r(a, Bool.and(b, c), e))}}

def D3c(+a: Bool, +b: Bool, +c: Bool, ea: {a == True{} : Bool}, eb: {b == True{} : Bool}, ec: {c == True{} : Bool}) -> {Bool.and(a, Bool.and(b, c)) == True{} : Bool}:
  HP.And.both(a, Bool.and(b, c), ea, HP.And.both(b, c, eb, ec))

# ---- Ac.osites: the CS sites of a call of class outer ---------------------------------------------
def OS.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +outer: U32, +x: U32, o: Either<&2, &2, TL.And({S.Scope.has(OC(cls, outer), callee) == True{} : Bool}, {site == x : U32}), TL.Mem(A.Ac.osites(t, OC(cls, outer)), x)>, ih: TL.Mem(A.Ac.osites(t, OC(cls, outer)), x) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(t, c), Laws.OAt(c, cls, x, outer)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, c), Laws.OAt(c, cls, x, outer))):
  match o:
    case Inl{Tuple{eb, es}}:
      Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{es, CP.IS(cls, outer, callee, SL.scope_set_sound(X.Cx.ids(cls, outer), callee, eb))}}}
    case Inr{m}:
      Lift.cs(c => Laws.OAt(c, cls, x, outer), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def OS.s(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +outer: U32, +x: U32, h: TL.Mem(A.Ac.osites(css, OC(cls, outer)), x)) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), Laws.OAt(c, cls, x, outer))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      OS.k(site, fn, callee, ld, ctx, t, cls, outer, x, FP.PU.mem(S.Scope.has(OC(cls, outer), callee), site, A.Ac.osites(t, OC(cls, outer)), x, h), q => OS.s(t, cls, outer, x, q))

def OS.stay(h: X.Cs, +t: List<&2, X.Cs>, +oc: G.Tr, +x: U32, m: TL.Mem(A.Ac.osites(t, oc), x)) -> TL.Mem(A.Ac.osites(Con{h, t}, oc), x):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      CP.PU.keep(S.Scope.has(oc, callee), site, A.Ac.osites(t, oc), x, m)

def OS.c(css: List<&2, X.Cs>, +oc: G.Tr, +x: U32, +f2: U32, +c2: U32, +ld2: U32, +ctx2: U32, hm: Laws.MemCs(css, X.Cs{x, f2, c2, ld2, ctx2}), +hb: {S.Scope.has(oc, c2) == True{} : Bool}) -> TL.Mem(A.Ac.osites(css, oc), x):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, X.Cs{x, f2, c2, ld2, ctx2}, e) : TL.Mem(A.Ac.osites(Con{_, t}, oc), x)
          FP.PU.hit(S.Scope.has(oc, c2), x, A.Ac.osites(t, oc), hb)
        case Inr{q}:
          OS.stay(h, t, oc, x, OS.c(t, oc, x, f2, c2, ld2, ctx2, q, hb))

# ---- Ac.xin: the XN sites inside such a call ---------------------------------------------------
def XE(+a: U32, +b: U32, +o: U32, e: {a == b : U32}) -> {A.Xn{a, o} == A.Xn{b, o} : A.Xn}:
  %e : {A.Xn{a, o} == A.Xn{_, o} : A.Xn}
  {==}

def XI.up(+h: A.Xn, +t: List<&2, A.Xn>, +s: U32, +os: G.Tr, w: TL.Ex(U32, x => TL.And(Laws.MemXn(t, A.Xn{s, x}), {S.Scope.has(os, x) == True{} : Bool}))) -> TL.Ex(U32, x => TL.And(Laws.MemXn(Con{h, t}, A.Xn{s, x}), {S.Scope.has(os, x) == True{} : Bool})):
  match w:
    case Tuple{x, Tuple{m, e}}:
      Tuple{x, Tuple{Inr{m}, e}}

def XI.k(+site: U32, +outer: U32, +t: List<&2, A.Xn>, +os: G.Tr, +s: U32, o: Either<&2, &2, TL.And({S.Scope.has(os, outer) == True{} : Bool}, {site == s : U32}), TL.Mem(A.Ac.xin(t, os), s)>, ih: TL.Mem(A.Ac.xin(t, os), s) -> TL.Ex(U32, x => TL.And(Laws.MemXn(t, A.Xn{s, x}), {S.Scope.has(os, x) == True{} : Bool}))) -> TL.Ex(U32, x => TL.And(Laws.MemXn(Con{A.Xn{site, outer}, t}, A.Xn{s, x}), {S.Scope.has(os, x) == True{} : Bool})):
  match o:
    case Inl{Tuple{eb, es}}:
      Tuple{outer, Tuple{Inl{XE(site, s, outer, es)}, eb}}
    case Inr{m}:
      XI.up(A.Xn{site, outer}, t, s, os, ih(m))

def XI.s(xns: List<&2, A.Xn>, +os: G.Tr, +s: U32, h: TL.Mem(A.Ac.xin(xns, os), s)) -> TL.Ex(U32, x => TL.And(Laws.MemXn(xns, A.Xn{s, x}), {S.Scope.has(os, x) == True{} : Bool})):
  match xns:
    case Nil{}:
      match h:
    case Con{A.Xn{+site, +outer}, +t}:
      XI.k(site, outer, t, os, s, FP.PU.mem(S.Scope.has(os, outer), site, A.Ac.xin(t, os), s, h), q => XI.s(t, os, s, q))

def XI.stay(h: A.Xn, +t: List<&2, A.Xn>, +os: G.Tr, +s: U32, m: TL.Mem(A.Ac.xin(t, os), s)) -> TL.Mem(A.Ac.xin(Con{h, t}, os), s):
  match h:
    case A.Xn{+site, +outer}:
      CP.PU.keep(S.Scope.has(os, outer), site, A.Ac.xin(t, os), s, m)

def XI.c(xns: List<&2, A.Xn>, +os: G.Tr, +s: U32, +x: U32, hm: Laws.MemXn(xns, A.Xn{s, x}), +hb: {S.Scope.has(os, x) == True{} : Bool}) -> TL.Mem(A.Ac.xin(xns, os), s):
  match xns:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(A.Xn, h, A.Xn{s, x}, e) : TL.Mem(A.Ac.xin(Con{_, t}, os), s)
          FP.PU.hit(S.Scope.has(os, x), s, A.Ac.xin(t, os), hb)
        case Inr{q}:
          XI.stay(h, t, os, s, XI.c(t, os, s, x, q, hb))

# ---- Ac.both: the AW sites also in a set -------------------------------------------------------
def BO.up(+a: U32, +t: List<&2, U32>, +xs: G.Tr, +s: U32, w: TL.And(TL.Mem(t, s), {S.Scope.has(xs, s) == True{} : Bool})) -> TL.And(TL.Mem(Con{a, t}, s), {S.Scope.has(xs, s) == True{} : Bool}):
  match w:
    case Tuple{m, e}:
      Tuple{Inr{m}, e}

def BO.k(+a: U32, +t: List<&2, U32>, +xs: G.Tr, +s: U32, o: Either<&2, &2, TL.And({S.Scope.has(xs, a) == True{} : Bool}, {a == s : U32}), TL.Mem(A.Ac.both(t, xs), s)>, ih: TL.Mem(A.Ac.both(t, xs), s) -> TL.And(TL.Mem(t, s), {S.Scope.has(xs, s) == True{} : Bool})) -> TL.And(TL.Mem(Con{a, t}, s), {S.Scope.has(xs, s) == True{} : Bool}):
  match o:
    case Inl{Tuple{eb, ea}}:
      %ea : TL.And(TL.Mem(Con{a, t}, _), {S.Scope.has(xs, _) == True{} : Bool})
      Tuple{Inl{{==}}, eb}
    case Inr{m}:
      BO.up(a, t, xs, s, ih(m))

def BO.s(aws: List<&2, U32>, +xs: G.Tr, +s: U32, h: TL.Mem(A.Ac.both(aws, xs), s)) -> TL.And(TL.Mem(aws, s), {S.Scope.has(xs, s) == True{} : Bool}):
  match aws:
    case Nil{}:
      match h:
    case Con{+a, +t}:
      BO.k(a, t, xs, s, FP.PU.mem(S.Scope.has(xs, a), a, A.Ac.both(t, xs), s, h), q => BO.s(t, xs, s, q))

def BO.c(aws: List<&2, U32>, +xs: G.Tr, +s: U32, hm: TL.Mem(aws, s), +hb: {S.Scope.has(xs, s) == True{} : Bool}) -> TL.Mem(A.Ac.both(aws, xs), s):
  match aws:
    case Nil{}:
      match hm:
    case Con{+a, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(U32, a, s, e) : TL.Mem(A.Ac.both(Con{_, t}, xs), s)
          FP.PU.hit(S.Scope.has(xs, s), s, A.Ac.both(t, xs), hb)
        case Inr{q}:
          CP.PU.keep(S.Scope.has(xs, a), a, A.Ac.both(t, xs), s, BO.c(t, xs, s, q, hb))

# ---- Ac.xs: the CS sites of an exclusive row ----------------------------------------------------
def XsH(c: X.Cs, +r: U32, +ta: G.Tr, +tb: G.Tr, +y: A.Ad) -> Data:
  match c:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And({S.Scope.has(ta, callee) == True{} : Bool}, {S.Scope.has(tb, site) == True{} : Bool}))

def XS.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +y: A.Ad, o: Either<&2, &2, TL.And({Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)) == True{} : Bool}, {A.Ad{r, site, fn} == y : A.Ad}), Laws.MemAd(A.Ac.xs(t, r, ta, tb), y)>, ih: Laws.MemAd(A.Ac.xs(t, r, ta, tb), y) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(t, c), XsH(c, r, ta, tb, y)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, c), XsH(c, r, ta, tb, y))):
  match o:
    case Inl{Tuple{+eb, ex}}:
      Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{ex, Tuple{QP.And.l(S.Scope.has(ta, callee), S.Scope.has(tb, site), eb), QP.And.r(S.Scope.has(ta, callee), S.Scope.has(tb, site), eb)}}}}
    case Inr{m}:
      Lift.cs(c => XsH(c, r, ta, tb, y), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def XS.s(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +y: A.Ad, h: Laws.MemAd(A.Ac.xs(css, r, ta, tb), y)) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), XsH(c, r, ta, tb, y))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      XS.k(site, fn, callee, ld, ctx, t, r, ta, tb, y, KA.mem(Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)), A.Ad{r, site, fn}, A.Ac.xs(t, r, ta, tb), y, h), q => XS.s(t, r, ta, tb, y, q))

def XS.stay(h: X.Cs, +t: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +y: A.Ad, m: Laws.MemAd(A.Ac.xs(t, r, ta, tb), y)) -> Laws.MemAd(A.Ac.xs(Con{h, t}, r, ta, tb), y):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      KA.stay(Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)), A.Ad{r, site, fn}, A.Ac.xs(t, r, ta, tb), y, m)

def XS.c(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, hm: Laws.MemCs(css, X.Cs{site, fn, callee, ld, ctx}), +hb: {Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)) == True{} : Bool}) -> Laws.MemAd(A.Ac.xs(css, r, ta, tb), A.Ad{r, site, fn}):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, X.Cs{site, fn, callee, ld, ctx}, e) : Laws.MemAd(A.Ac.xs(Con{_, t}, r, ta, tb), A.Ad{r, site, fn})
          KA.hit(Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)), A.Ad{r, site, fn}, A.Ac.xs(t, r, ta, tb), hb)
        case Inr{q}:
          XS.stay(h, t, r, ta, tb, A.Ad{r, site, fn}, XS.c(t, r, ta, tb, site, fn, callee, ld, ctx, q, hb))

# ---- exclusive rule: from the sets to the facts ---------------------------------------------------
def XO.s(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +xns: List<&2, A.Xn>, +s: U32, +outer: U32, w: TL.Ex(U32, x => TL.And(Laws.MemXn(xns, A.Xn{s, x}), {S.Scope.has(OS1(css, cls, outer), x) == True{} : Bool}))) -> Laws.XOut(css, cls, xns, s, outer):
  match w:
    case Tuple{+x, Tuple{m, e}}:
      Tuple{x, Tuple{m, OS.s(css, cls, outer, x, SL.scope_set_sound(A.Ac.osites(css, OC(cls, outer)), x, e))}}

def XC2(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +r: U32, +inner: U32, +outer: U32, +site: U32, +fn: U32, +callee: U32, +y: A.Ad, ey: {A.Ad{r, site, fn} == y : A.Ad}, hi: XL.ClHas(cls, callee, inner), w: TL.And(TL.Mem(aws, site), {S.Scope.has(XS1(css, cls, xns, outer), site) == True{} : Bool})) -> TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And(XL.ClHas(cls, callee, inner), TL.And(TL.Mem(aws, site), Laws.XOut(css, cls, xns, site, outer)))):
  match w:
    case Tuple{ma, e1}:
      Tuple{ey, Tuple{hi, Tuple{ma, XO.s(css, cls, xns, site, outer, XI.s(xns, OS1(css, cls, outer), site, SL.scope_set_sound(A.Ac.xin(xns, OS1(css, cls, outer)), site, e1)))}}}

def XC(c: X.Cs, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +r: U32, +inner: U32, +outer: U32, +y: A.Ad, h: XsH(c, r, OC(cls, inner), TB(css, cls, aws, xns, outer), y)) -> Laws.XAt(c, css, cls, aws, xns, r, inner, outer, y):
  match c:
    case X.Cs{+site, +fn, +callee, ld, ctx}:
      match h:
        case Tuple{ey, Tuple{ei, et}}:
          XC2(css, cls, aws, xns, r, inner, outer, site, fn, callee, y, ey, CP.IS(cls, inner, callee, SL.scope_set_sound(X.Cx.ids(cls, inner), callee, ei)), BO.s(aws, XS1(css, cls, xns, outer), site, SL.scope_set_sound(A.Ac.both(aws, XS1(css, cls, xns, outer)), site, et)))

def XM(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +r: U32, +inner: U32, +outer: U32, +y: A.Ad, w: TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), XsH(c, r, OC(cls, inner), TB(css, cls, aws, xns, outer), y)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), Laws.XAt(c, css, cls, aws, xns, r, inner, outer, y))):
  match w:
    case Tuple{+c, Tuple{m, h}}:
      Tuple{c, Tuple{m, XC(c, css, cls, aws, xns, r, inner, outer, y, h)}}

def Laws.ac_xrule_sound(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, r, inner, outer, y, hm):
  XM(css, cls, aws, xns, r, inner, outer, y, XS.s(css, r, OC(cls, inner), TB(css, cls, aws, xns, outer), y, hm))

def XTB.c(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +outer: U32, +site: U32, +x: U32, +f2: U32, +c2: U32, +ld2: U32, +ctx2: U32, ha: TL.Mem(aws, site), hx: Laws.MemXn(xns, A.Xn{site, x}), ho: Laws.MemCs(css, X.Cs{x, f2, c2, ld2, ctx2}), hoc: XL.ClHas(cls, c2, outer)) -> {S.Scope.has(TB(css, cls, aws, xns, outer), site) == True{} : Bool}:
  SL.scope_set_complete(A.Ac.both(aws, XS1(css, cls, xns, outer)), site, BO.c(aws, XS1(css, cls, xns, outer), site, ha, SL.scope_set_complete(A.Ac.xin(xns, OS1(css, cls, outer)), site, XI.c(xns, OS1(css, cls, outer), site, x, hx, SL.scope_set_complete(A.Ac.osites(css, OC(cls, outer)), x, OS.c(css, OC(cls, outer), x, f2, c2, ld2, ctx2, ho, SL.scope_set_complete(X.Cx.ids(cls, outer), c2, CP.IC(cls, outer, c2, hoc))))))))

def Laws.ac_xrule_complete(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, r, inner, outer, site, fn, callee, ld, ctx, x, f2, c2, ld2, ctx2, hc, hi, ha, hx, ho, hoc):
  XS.c(css, r, OC(cls, inner), TB(css, cls, aws, xns, outer), site, fn, callee, ld, ctx, hc, HP.And.both(S.Scope.has(OC(cls, inner), callee), S.Scope.has(TB(css, cls, aws, xns, outer), site), SL.scope_set_complete(X.Cx.ids(cls, inner), callee, CP.IC(cls, inner, callee, hi)), XTB.c(css, cls, aws, xns, outer, site, x, f2, c2, ld2, ctx2, ha, hx, ho, hoc)))

# ---- Ac.ds and Ac.de: the dropped sites -----------------------------------------------------------
def DsH(c: X.Cs, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad) -> Data:
  match c:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And({S.Scope.has(ta, callee) == True{} : Bool}, TL.And({S.Scope.has(tb, site) == True{} : Bool}, {S.Scope.has(tc, fn) == True{} : Bool})))

def DeH(e: F.Ce, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad) -> Data:
  match e:
    case F.Ce{site, fn, target, node, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And({S.Scope.has(ta, target) == True{} : Bool}, TL.And({S.Scope.has(tb, site) == True{} : Bool}, {S.Scope.has(tc, fn) == True{} : Bool})))

def DS.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, o: Either<&2, &2, TL.And({Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))) == True{} : Bool}, {A.Ad{r, site, fn} == y : A.Ad}), Laws.MemAd(A.Ac.ds(t, r, ta, tb, tc), y)>, ih: Laws.MemAd(A.Ac.ds(t, r, ta, tb, tc), y) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(t, c), DsH(c, r, ta, tb, tc, y)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, c), DsH(c, r, ta, tb, tc, y))):
  match o:
    case Inl{Tuple{eb, ex}}:
      Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{ex, D3(S.Scope.has(ta, callee), S.Scope.has(tb, site), S.Scope.has(tc, fn), eb)}}}
    case Inr{m}:
      Lift.cs(c => DsH(c, r, ta, tb, tc, y), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def DS.s(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, h: Laws.MemAd(A.Ac.ds(css, r, ta, tb, tc), y)) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), DsH(c, r, ta, tb, tc, y))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      DS.k(site, fn, callee, ld, ctx, t, r, ta, tb, tc, y, KA.mem(Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.ds(t, r, ta, tb, tc), y, h), q => DS.s(t, r, ta, tb, tc, y, q))

def DS.stay(h: X.Cs, +t: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, m: Laws.MemAd(A.Ac.ds(t, r, ta, tb, tc), y)) -> Laws.MemAd(A.Ac.ds(Con{h, t}, r, ta, tb, tc), y):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      KA.stay(Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.ds(t, r, ta, tb, tc), y, m)

def DS.c(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, hm: Laws.MemCs(css, X.Cs{site, fn, callee, ld, ctx}), +hb: {Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))) == True{} : Bool}) -> Laws.MemAd(A.Ac.ds(css, r, ta, tb, tc), A.Ad{r, site, fn}):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, X.Cs{site, fn, callee, ld, ctx}, e) : Laws.MemAd(A.Ac.ds(Con{_, t}, r, ta, tb, tc), A.Ad{r, site, fn})
          KA.hit(Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.ds(t, r, ta, tb, tc), hb)
        case Inr{q}:
          DS.stay(h, t, r, ta, tb, tc, A.Ad{r, site, fn}, DS.c(t, r, ta, tb, tc, site, fn, callee, ld, ctx, q, hb))

def DE.k(+site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, +t: List<&2, F.Ce>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, o: Either<&2, &2, TL.And({Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))) == True{} : Bool}, {A.Ad{r, site, fn} == y : A.Ad}), Laws.MemAd(A.Ac.de(t, r, ta, tb, tc), y)>, ih: Laws.MemAd(A.Ac.de(t, r, ta, tb, tc), y) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(t, e), DeH(e, r, ta, tb, tc, y)))) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, e), DeH(e, r, ta, tb, tc, y))):
  match o:
    case Inl{Tuple{eb, ex}}:
      Tuple{F.Ce{site, fn, target, node, ld, ctx}, Tuple{Inl{{==}}, Tuple{ex, D3(S.Scope.has(ta, target), S.Scope.has(tb, site), S.Scope.has(tc, fn), eb)}}}
    case Inr{m}:
      FP.Lift.ce(e => DeH(e, r, ta, tb, tc, y), F.Ce{site, fn, target, node, ld, ctx}, t, ih(m))

def DE.s(ces: List<&2, F.Ce>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, h: Laws.MemAd(A.Ac.de(ces, r, ta, tb, tc), y)) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), DeH(e, r, ta, tb, tc, y))):
  match ces:
    case Nil{}:
      match h:
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      DE.k(site, fn, target, node, ld, ctx, t, r, ta, tb, tc, y, KA.mem(Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.de(t, r, ta, tb, tc), y, h), q => DE.s(t, r, ta, tb, tc, y, q))

def DE.stay(h: F.Ce, +t: List<&2, F.Ce>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, m: Laws.MemAd(A.Ac.de(t, r, ta, tb, tc), y)) -> Laws.MemAd(A.Ac.de(Con{h, t}, r, ta, tb, tc), y):
  match h:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      KA.stay(Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.de(t, r, ta, tb, tc), y, m)

def DE.c(ces: List<&2, F.Ce>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr, +site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, hm: FL.MemCe(ces, F.Ce{site, fn, target, node, ld, ctx}), +hb: {Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))) == True{} : Bool}) -> Laws.MemAd(A.Ac.de(ces, r, ta, tb, tc), A.Ad{r, site, fn}):
  match ces:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(F.Ce, h, F.Ce{site, fn, target, node, ld, ctx}, e) : Laws.MemAd(A.Ac.de(Con{_, t}, r, ta, tb, tc), A.Ad{r, site, fn})
          KA.hit(Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), A.Ad{r, site, fn}, A.Ac.de(t, r, ta, tb, tc), hb)
        case Inr{q}:
          DE.stay(h, t, r, ta, tb, tc, A.Ad{r, site, fn}, DE.c(t, r, ta, tb, tc, site, fn, target, node, ld, ctx, q, hb))

# ---- dropped rule: from the sets to the facts -----------------------------------------------------
def DC(c: X.Cs, +cls: List<&2, X.Cl>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +k: U32, +y: A.Ad, h: DsH(c, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps), y)) -> Laws.DAt(c, cls, dvs, eps, r, k, y):
  match c:
    case X.Cs{+site, +fn, +callee, ld, ctx}:
      match h:
        case Tuple{ey, Tuple{ek, Tuple{ed, ee}}}:
          Tuple{ey, Tuple{CP.IS(cls, k, callee, SL.scope_set_sound(X.Cx.ids(cls, k), callee, ek)), Tuple{SL.scope_set_sound(dvs, site, ed), SL.scope_set_sound(eps, fn, ee)}}}

def DM(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +k: U32, +y: A.Ad, w: TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), DsH(c, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps), y)))) -> TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), Laws.DAt(c, cls, dvs, eps, r, k, y))):
  match w:
    case Tuple{+c, Tuple{m, h}}:
      Tuple{c, Tuple{m, DC(c, cls, dvs, eps, r, k, y, h)}}

def DEC(e: F.Ce, +fcs: List<&2, N.Fc>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +y: A.Ad, h: DeH(e, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), S.Scope.set(dvs), S.Scope.set(eps), y)) -> Laws.DEAt(e, fcs, dvs, eps, r, y):
  match e:
    case F.Ce{+site, +fn, +target, node, ld, ctx}:
      match h:
        case Tuple{ey, Tuple{et, Tuple{ed, ee}}}:
          Tuple{ey, Tuple{NP.Fns.s(fcs, 1, 0, target, SL.scope_set_sound(N.Nc.fns(fcs, 1, 0), target, et)), Tuple{SL.scope_set_sound(dvs, site, ed), SL.scope_set_sound(eps, fn, ee)}}}

def DEM(+ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +y: A.Ad, w: TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), DeH(e, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), S.Scope.set(dvs), S.Scope.set(eps), y)))) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), Laws.DEAt(e, fcs, dvs, eps, r, y))):
  match w:
    case Tuple{+e, Tuple{m, h}}:
      Tuple{e, Tuple{m, DEC(e, fcs, dvs, eps, r, y, h)}}

def DR.as(on: Bool, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +y: A.Ad, h: Laws.MemAd(A.Ac.dasync(on, ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)), y)) -> TL.And({on == True{} : Bool}, TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), Laws.DEAt(e, fcs, dvs, eps, r, y)))):
  match on:
    case True{}:
      Tuple{{==}, DEM(ces, fcs, dvs, eps, r, y, DE.s(ces, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), S.Scope.set(dvs), S.Scope.set(eps), y, h))}
    case False{}:
      match h:

def DR.s2(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +r: U32, +k: U32, +a: U32, +y: A.Ad, o: Either<&2, &2, Laws.MemAd(A.Ac.ds(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps)), y), Laws.MemAd(A.Ac.dasync(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)), y)>) -> Either<&2, &2, TL.Ex(X.Cs, c => TL.And(Laws.MemCs(css, c), Laws.DAt(c, cls, dvs, eps, r, k, y))), TL.And({U32.is_eq(a, 1) == True{} : Bool}, TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), Laws.DEAt(e, fcs, dvs, eps, r, y))))>:
  match o:
    case Inl{m}:
      Inl{DM(css, cls, dvs, eps, r, k, y, DS.s(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps), y, m))}
    case Inr{m}:
      Inr{DR.as(U32.is_eq(a, 1), ces, fcs, dvs, eps, r, y, m)}

def Laws.ac_drule_sound(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, r, k, a, y, hm):
  DR.s2(css, cls, dvs, eps, ces, fcs, r, k, a, y, AA.split(A.Ac.ds(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps)), A.Ac.dasync(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)), y, hm))

def Laws.ac_drule_complete_class(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, r, k, a, site, fn, callee, ld, ctx, hc, hk, hd, he):
  AA.l(A.Ac.ds(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps)), A.Ac.dasync(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)), A.Ad{r, site, fn}, DS.c(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps), site, fn, callee, ld, ctx, hc, D3c(S.Scope.has(S.Scope.set(X.Cx.ids(cls, k)), callee), S.Scope.has(S.Scope.set(dvs), site), S.Scope.has(S.Scope.set(eps), fn), SL.scope_set_complete(X.Cx.ids(cls, k), callee, CP.IC(cls, k, callee, hk)), SL.scope_set_complete(dvs, site, hd), SL.scope_set_complete(eps, fn, he))))

def DA.c(on: Bool, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +r: U32, +tb: G.Tr, +tc: G.Tr, +y: A.Ad, hon: {on == True{} : Bool}, h: Laws.MemAd(A.Ac.de(ces, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), tb, tc), y)) -> Laws.MemAd(A.Ac.dasync(on, ces, fcs, r, tb, tc), y):
  %Equal.sym(Bool, on, True{}, hon) : Laws.MemAd(A.Ac.dasync(_, ces, fcs, r, tb, tc), y)
  h

def Laws.ac_drule_complete_async(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, r, k, a, site, fn, target, node, ld, ctx, file, tctx, ha, hc, hf, ht, hd, he):
  AA.r(A.Ac.ds(css, r, S.Scope.set(X.Cx.ids(cls, k)), S.Scope.set(dvs), S.Scope.set(eps)), A.Ac.dasync(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)), A.Ad{r, site, fn}, DA.c(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps), A.Ad{r, site, fn}, ha, DE.c(ces, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), S.Scope.set(dvs), S.Scope.set(eps), site, fn, target, node, ld, ctx, hc, D3c(S.Scope.has(S.Scope.set(N.Nc.fns(fcs, 1, 0)), target), S.Scope.has(S.Scope.set(dvs), site), S.Scope.has(S.Scope.set(eps), fn), SL.scope_set_complete(N.Nc.fns(fcs, 1, 0), target, NP.Fns.c(fcs, target, file, tctx, 1, 0, hf, ht)), SL.scope_set_complete(dvs, site, hd), SL.scope_set_complete(eps, fn, he)))))

# ---- every row ------------------------------------------------------------------------------------
def XR.up(+k: A.Rx, +t: List<&2, A.Rx>, +f: A.AF, +y: A.Ad, w: TL.Ex(A.Rx, g => TL.And(Laws.MemRx(t, g), Laws.MemAd(A.Ac.xrule(f, g), y)))) -> TL.Ex(A.Rx, g => TL.And(Laws.MemRx(Con{k, t}, g), Laws.MemAd(A.Ac.xrule(f, g), y))):
  match w:
    case Tuple{g, Tuple{mg, m}}:
      Tuple{g, Tuple{Inr{mg}, m}}

def XR.s2(+k: A.Rx, +t: List<&2, A.Rx>, +f: A.AF, +y: A.Ad, o: Either<&2, &2, Laws.MemAd(A.Ac.xrule(f, k), y), Laws.MemAd(A.Ac.xrules(f, t), y)>, ih: Laws.MemAd(A.Ac.xrules(f, t), y) -> TL.Ex(A.Rx, g => TL.And(Laws.MemRx(t, g), Laws.MemAd(A.Ac.xrule(f, g), y)))) -> TL.Ex(A.Rx, g => TL.And(Laws.MemRx(Con{k, t}, g), Laws.MemAd(A.Ac.xrule(f, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      XR.up(k, t, f, y, ih(m))

def XR.s(ks: List<&2, A.Rx>, +f: A.AF, +y: A.Ad, h: Laws.MemAd(A.Ac.xrules(f, ks), y)) -> TL.Ex(A.Rx, g => TL.And(Laws.MemRx(ks, g), Laws.MemAd(A.Ac.xrule(f, g), y))):
  match ks:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      XR.s2(k, t, f, y, AA.split(A.Ac.xrule(f, k), A.Ac.xrules(f, t), y, h), m => XR.s(t, f, y, m))

def XR.c(ks: List<&2, A.Rx>, +f: A.AF, +k: A.Rx, +y: A.Ad, hk: Laws.MemRx(ks, k), hm: Laws.MemAd(A.Ac.xrule(f, k), y)) -> Laws.MemAd(A.Ac.xrules(f, ks), y):
  match ks:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(A.Rx, h, k, e) : Laws.MemAd(A.Ac.xrules(f, Con{_, t}), y)
          AA.l(A.Ac.xrule(f, k), A.Ac.xrules(f, t), y, hm)
        case Inr{q}:
          AA.r(A.Ac.xrule(f, h), A.Ac.xrules(f, t), y, XR.c(t, f, k, y, q, hm))

def DRR.up(+k: A.Rd, +t: List<&2, A.Rd>, +f: A.AF, +y: A.Ad, w: TL.Ex(A.Rd, g => TL.And(Laws.MemRd(t, g), Laws.MemAd(A.Ac.drule(f, g), y)))) -> TL.Ex(A.Rd, g => TL.And(Laws.MemRd(Con{k, t}, g), Laws.MemAd(A.Ac.drule(f, g), y))):
  match w:
    case Tuple{g, Tuple{mg, m}}:
      Tuple{g, Tuple{Inr{mg}, m}}

def DRR.s2(+k: A.Rd, +t: List<&2, A.Rd>, +f: A.AF, +y: A.Ad, o: Either<&2, &2, Laws.MemAd(A.Ac.drule(f, k), y), Laws.MemAd(A.Ac.drules(f, t), y)>, ih: Laws.MemAd(A.Ac.drules(f, t), y) -> TL.Ex(A.Rd, g => TL.And(Laws.MemRd(t, g), Laws.MemAd(A.Ac.drule(f, g), y)))) -> TL.Ex(A.Rd, g => TL.And(Laws.MemRd(Con{k, t}, g), Laws.MemAd(A.Ac.drule(f, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      DRR.up(k, t, f, y, ih(m))

def DRR.s(ks: List<&2, A.Rd>, +f: A.AF, +y: A.Ad, h: Laws.MemAd(A.Ac.drules(f, ks), y)) -> TL.Ex(A.Rd, g => TL.And(Laws.MemRd(ks, g), Laws.MemAd(A.Ac.drule(f, g), y))):
  match ks:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      DRR.s2(k, t, f, y, AA.split(A.Ac.drule(f, k), A.Ac.drules(f, t), y, h), m => DRR.s(t, f, y, m))

def DRR.c(ks: List<&2, A.Rd>, +f: A.AF, +k: A.Rd, +y: A.Ad, hk: Laws.MemRd(ks, k), hm: Laws.MemAd(A.Ac.drule(f, k), y)) -> Laws.MemAd(A.Ac.drules(f, ks), y):
  match ks:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(A.Rd, h, k, e) : Laws.MemAd(A.Ac.drules(f, Con{_, t}), y)
          AA.l(A.Ac.drule(f, k), A.Ac.drules(f, t), y, hm)
        case Inr{q}:
          AA.r(A.Ac.drule(f, h), A.Ac.drules(f, t), y, DRR.c(t, f, k, y, q, hm))

def Laws.ac_excl_sound(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, y, hm):
  XR.s(rxs, A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, y, hm)

def Laws.ac_excl_complete(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, k, y, hk, hm):
  XR.c(rxs, A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k, y, hk, hm)

def Laws.ac_dropped_sound(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, y, hm):
  DRR.s(rds, A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, y, hm)

def Laws.ac_dropped_complete(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, k, y, hk, hm):
  DRR.c(rds, A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k, y, hk, hm)

# ---- output and the section -----------------------------------------------------------------------
def Laws.ac_lines_shape(f):
  {==}

def Laws.async_on(rows, on):
  %Equal.sym(Bool, A.AsyncIn.on(rows), True{}, on) : {A.AsyncIn.go1(_, rows) == A.AsyncIn.go(A.AsyncCtx.decode(rows)) : Maybe<List<&2, String>>}
  {==}

def Laws.async_go_lines(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, hs, hc):
  %Equal.sym(Bool, A.Ac.cs_sorted(css), True{}, hs) : {A.AsyncIn.ok(Bool.and(_, N.Nc.ce_sorted(ces)), A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}) == Some{A.AsyncCtx.lines(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds})} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, N.Nc.ce_sorted(ces), True{}, hc) : {A.AsyncIn.ok(Bool.and(True{}, _), A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}) == Some{A.AsyncCtx.lines(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds})} : Maybe<List<&2, String>>}
  {==}

def Laws.async_go_refuses():
  {==}

def Laws.async_cs_unsorted_refuses(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, h):
  %Equal.sym(Bool, A.Ac.cs_sorted(css), False{}, h) : {A.AsyncIn.ok(Bool.and(_, N.Nc.ce_sorted(ces)), A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.async_ce_unsorted_refuses(css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds, h):
  %Equal.sym(Bool, N.Nc.ce_sorted(ces), False{}, h) : {A.AsyncIn.ok(Bool.and(A.Ac.cs_sorted(css), _), A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}) == None{} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, Bool.and(A.Ac.cs_sorted(css), False{}), False{}, NP.AndF(A.Ac.cs_sorted(css))) : {A.AsyncIn.ok(_, A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.async_off(rows, off):
  %Equal.sym(Bool, A.AsyncIn.on(rows), False{}, off) : {A.AsyncIn.go1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}
